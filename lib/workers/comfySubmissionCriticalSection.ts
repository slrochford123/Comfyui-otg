import {
  acquireResourceLock,
  releaseResourceLock,
} from "@/lib/workers/resourceLocks";
import type {
  WorkerResourceLockId,
} from "@/lib/workers/workerCatalog";

export type ComfySubmissionPhysicalGpu =
  | "slr-5060"
  | "shawn-3090";

const COMFY_SUBMISSION_LOCK_IDS: Record<
  ComfySubmissionPhysicalGpu,
  WorkerResourceLockId
> = {
  "slr-5060": "comfy-submit:slr-5060",
  "shawn-3090": "comfy-submit:shawn-3090",
};

export type ComfySubmissionCriticalSectionResult<T> =
  | {
      ok: true;
      value: T;
    }
  | {
      ok: false;
      status: 409;
      error: string;
    };

/**
 * OTG_COMFY_SUBMISSION_CRITICAL_SECTION_V1
 *
 * This is intentionally NOT a render-duration GPU lease.
 *
 * It exists only around the final physical-Comfy admission window:
 *
 *   optional queue recheck
 *   optional /free
 *   /prompt
 *
 * Contention waits here instead of becoming a GPU-busy rejection.
 * The lock is released as soon as the short callback completes.
 */
export async function runWithComfySubmissionCriticalSection<T>(
  input: {
    physicalGpu: ComfySubmissionPhysicalGpu;
    ownerId: string;
    workerId: string;
    signal?: AbortSignal | null;
  },
  action: () => Promise<T>,
): Promise<ComfySubmissionCriticalSectionResult<T>> {
  const ownerId = String(input.ownerId || "").trim();
  const workerId = String(input.workerId || "").trim();

  if (!ownerId) {
    throw new Error(
      "Comfy submission critical section requires an owner ID.",
    );
  }

  if (!workerId) {
    throw new Error(
      "Comfy submission critical section requires a worker ID.",
    );
  }

  const lockId =
    COMFY_SUBMISSION_LOCK_IDS[input.physicalGpu];

  const acquire = () =>
    acquireResourceLock({
      lockId,
      ownerId,
      ownerType: "job",
      workerId,
      resourceName: "comfy-prompt-admission",
      ttlSeconds: 300,
    });

  let acquired =
    acquire();

  // Queue-first invariant:
  // brief submission contention is not a user-visible failure.
  // Wait for this tiny admission section, then submit normally.
  while (!acquired.ok) {
    if (input.signal?.aborted) {
      throw new DOMException(
        "Comfy submission wait was aborted.",
        "AbortError",
      );
    }

    await new Promise<void>(
      (resolve) => {
        setTimeout(resolve, 50);
      },
    );

    acquired =
      acquire();
  }

  const lease = acquired.lock;

  try {
    return {
      ok: true,
      value: await action(),
    };
  } finally {
    releaseResourceLock(
      lease.lockId,
      lease.ownerId,
      lease.fencingToken,
    );
  }
}
