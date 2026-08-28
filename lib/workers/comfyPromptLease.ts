import {
  acquireComfy5060Lease,
  createComfyLeaseOwnerId,
  isRtx5060Comfy8188Endpoint,
  releaseComfy5060Lease,
  type Comfy5060Lease,
} from "@/lib/workers/comfy5060Lease";
import {
  acquireShawnClusterGpuLease,
  resolveComfyPhysicalGpu,
  releaseClusterGpuLease,
  SHAWN_GPU_LOCK_ID,
  type ClusterGpuLease,
} from "@/lib/workers/clusterGpu";
import { heartbeatResourceLock } from "@/lib/workers/resourceLocks";

const IMAGE_LEASE_TTL_SECONDS = 6 * 60 * 60;
const MONITOR_POLL_MS = 2_000;

export class Comfy5060BusyError extends Error {
  readonly code = "gpu_linux_5060ti_busy";
  readonly status = 409;

  constructor(message = "RTX 5060 Ti is busy with another exclusive GPU workload.") {
    super(message);
    this.name = "Comfy5060BusyError";
  }
}

export class ComfyGpuBusyError extends Comfy5060BusyError {
  constructor(readonly gpu: "slr-5060" | "shawn-3090", message?: string) {
    super(message || `${gpu === "slr-5060" ? "RTX 5060 Ti" : "RTX 3090"} is busy with another exclusive GPU workload.`);
    this.name = "ComfyGpuBusyError";
  }
}

export class UnclassifiedComfyGpuError extends Error {
  readonly code = "comfy_gpu_unclassified";
  readonly status = 503;

  constructor(baseUrl: string) {
    super(`ComfyUI generation endpoint is not mapped to a cluster GPU resource: ${baseUrl}`);
    this.name = "UnclassifiedComfyGpuError";
  }
}

function normalizeBaseUrl(value: string): string {
  return String(value || "").trim().replace(/\/+$/, "");
}

function promptIdFromPayload(payload: unknown): string {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "";
  const record = payload as Record<string, unknown>;
  return String(record.prompt_id || record.promptId || "").trim();
}

function historyTerminal(entry: unknown): boolean {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
  const record = entry as Record<string, unknown>;
  const status = record.status && typeof record.status === "object" && !Array.isArray(record.status)
    ? record.status as Record<string, unknown>
    : {};
  return status.completed === true || status.status_str === "error" || !!record.outputs;
}

type PromptGpuLease = Comfy5060Lease | ClusterGpuLease;

async function waitForPromptTerminal(baseUrl: string, promptId: string, lease: PromptGpuLease): Promise<void> {
  let currentLease: PromptGpuLease | null = lease;
  const deadline = Date.now() + IMAGE_LEASE_TTL_SECONDS * 1000;
  let nextHeartbeat = 0;
  while (Date.now() < deadline && currentLease) {
    if (Date.now() >= nextHeartbeat) {
      const renewed = heartbeatResourceLock(currentLease.lockId, currentLease.ownerId, currentLease.fencingToken, IMAGE_LEASE_TTL_SECONDS);
      currentLease = renewed ? { ...renewed, purpose: currentLease.purpose } as PromptGpuLease : null;
      nextHeartbeat = Date.now() + 30_000;
      if (!currentLease) return;
    }
    try {
      const response = await fetch(`${baseUrl}/history/${encodeURIComponent(promptId)}`, { cache: "no-store" });
      if (response.ok) {
        const body = await response.json().catch(() => null) as Record<string, unknown> | null;
        const entry = body?.[promptId] ?? body;
        if (historyTerminal(entry)) return;
      }
    } catch {
      // Preserve the lease across transient history failures.
    }
    await new Promise((resolve) => setTimeout(resolve, MONITOR_POLL_MS));
  }
}

function monitorAndRelease(baseUrl: string, promptId: string, lease: PromptGpuLease): void {
  void waitForPromptTerminal(baseUrl, promptId, lease)
    .finally(() => {
      if (lease.lockId === SHAWN_GPU_LOCK_ID) releaseClusterGpuLease(lease as ClusterGpuLease);
      else releaseComfy5060Lease(lease as Comfy5060Lease);
    });
}

export async function submitComfyPromptWithGpuLease(args: {
  baseUrl: string;
  init: RequestInit;
  workerId: string;
  ownerId?: string;
  fetcher?: (url: string, init: RequestInit) => Promise<Response>;
  purpose?: "image" | "video" | "ltx-fallback";
}): Promise<Response> {
  const baseUrl = normalizeBaseUrl(args.baseUrl);
  const submit = args.fetcher || fetch;
  const physicalGpu = resolveComfyPhysicalGpu(baseUrl);
  const on5060 = physicalGpu === "slr-5060" || isRtx5060Comfy8188Endpoint(baseUrl);
  const on3090 = physicalGpu === "shawn-3090";
  if (!on5060 && !on3090) throw new UnclassifiedComfyGpuError(baseUrl);

  const purpose = args.purpose || (on3090 ? "video" : /fallback/i.test(args.workerId) ? "ltx-fallback" : "image");
  const leaseOwnerId = args.ownerId || createComfyLeaseOwnerId(args.workerId);
  const acquired = on3090
    ? await acquireShawnClusterGpuLease({ ownerId: leaseOwnerId, workerId: args.workerId, purpose, ttlSeconds: IMAGE_LEASE_TTL_SECONDS })
    : acquireComfy5060Lease({ ownerId: leaseOwnerId, workerId: args.workerId, purpose: purpose === "ltx-fallback" ? "ltx-fallback" : "image", ttlSeconds: IMAGE_LEASE_TTL_SECONDS });
  if (!acquired.ok) throw new ComfyGpuBusyError(on3090 ? "shawn-3090" : "slr-5060", acquired.error);

  const lease = acquired.lease;
  let response: Response;
  try {
    response = await submit(`${baseUrl}/prompt`, args.init);
  } catch (error) {
    // The POST outcome may be ambiguous. Keep ownership until the long lease
    // expires rather than allowing a second GPU workload to overlap it.
    throw error;
  }

  if (!response.ok) {
    if (lease.lockId === SHAWN_GPU_LOCK_ID) releaseClusterGpuLease(lease as ClusterGpuLease);
    else releaseComfy5060Lease(lease as Comfy5060Lease);
    return response;
  }

  const clone = response.clone();
  const parsed = await clone.json().catch(() => null);
  const promptId = promptIdFromPayload(parsed);
  if (!promptId) {
    // An unreadable success response is ambiguous. Retain the lease to expiry.
    return response;
  }
  monitorAndRelease(baseUrl, promptId, lease);
  return response;
}


/** Backward-compatible name retained while callers migrate to the physical-GPU abstraction. */
export const submitComfyPromptWith5060Lease = submitComfyPromptWithGpuLease;
