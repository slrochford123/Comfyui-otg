import {
  QwenContextUnsupportedError,
  SHAWN_QWEN_CONTEXT_CAP,
  SLR_QWEN_CONTEXT_CAP,
  type QwenClusterNode,
} from "@/lib/workers/qwenClusterRouter";

import {
  createQwenDurableJob,
  getQwenDurableJob,
} from "@/lib/workers/qwenDurableJobs";

import {
  kickQwenDurableScheduler,
  type QwenDurableSchedulerDependencies,
} from "@/lib/workers/qwenDurableScheduler";

/*
 * OTG_QWEN_DURABLE_FETCH_V1
 *
 * Compatibility boundary for existing synchronous Qwen-backed
 * application routes.
 *
 * Capacity waiting has NO request-level timeout here.
 *
 * timeoutMs applies to model execution only after a physical
 * Qwen GPU has actually been acquired.
 *
 * The durable job continues independently if the caller stops
 * waiting for its response.
 */

export class QwenDurableJobFailedError extends Error {
  readonly code =
    "qwen_durable_job_failed";

  readonly status =
    502;

  readonly jobId:
    string;

  constructor(
    jobId: string,
    message: string,
  ) {
    super(message);

    this.name =
      "QwenDurableJobFailedError";

    this.jobId =
      jobId;
  }
}

export type QwenDurableFetchOptions = {
  requiredContextTokens?: number;

  /*
   * Kept for migration compatibility.
   *
   * Capacity waiting is intentionally NOT bounded by this value.
   */
  waitMs?: number;

  /*
   * Execution timeout only.
   */
  timeoutMs?: number;

  allowedNodes?:
    readonly QwenClusterNode[];

  model?: string;

  modelByNode?:
    Partial<
      Record<
        QwenClusterNode,
        string
      >
    >;

  keepAlive?:
    string
    | number;

  leaseTtlSeconds?: number;

  ownerKey?:
    string
    | null;

  requestKind?: string;

  /*
   * Aborting the waiter does not delete or cancel the durable job.
   */
  signal?:
    AbortSignal
    | null;

  /*
   * Dependency injection for contracts only.
   */
  schedulerDependencies?:
    QwenDurableSchedulerDependencies;
};

function estimatedContext(
  payload:
    Record<string, unknown>,
) {
  const options =
    payload.options
    && typeof payload.options
      === "object"
      ? payload.options as
          Record<string, unknown>
      : {};

  const explicit =
    Number(
      options.num_ctx
      || payload.required_context
      || 0,
    );

  if (
    Number.isFinite(explicit)
    && explicit > 0
  ) {
    return Math.floor(
      explicit,
    );
  }

  return Math.max(
    1,
    Math.ceil(
      JSON.stringify(
        payload.messages
        || payload.prompt
        || "",
      ).length / 3,
    ),
  );
}

function normalizedAllowedNodes(
  value:
    readonly QwenClusterNode[]
    | undefined,
): QwenClusterNode[] {
  const source =
    value?.length
      ? value
      : [
          "slr",
          "shawn",
        ];

  return Array.from(
    new Set(
      source.filter(
        (node) =>
          node === "slr"
          || node === "shawn",
      ),
    ),
  );
}

function maximumContextForNodes(
  nodes:
    readonly QwenClusterNode[],
) {
  let maximum = 0;

  for (const node of nodes) {
    if (node === "slr") {
      maximum =
        Math.max(
          maximum,
          SLR_QWEN_CONTEXT_CAP,
        );
    }

    if (node === "shawn") {
      maximum =
        Math.max(
          maximum,
          SHAWN_QWEN_CONTEXT_CAP,
        );
    }
  }

  return maximum;
}

function sleep(
  milliseconds: number,
) {
  return new Promise<void>(
    (resolve) => {
      setTimeout(
        resolve,
        milliseconds,
      );
    },
  );
}

export async function qwenDurableFetch(
  path:
    "/api/generate"
    | "/api/chat",

  payload:
    Record<string, unknown>,

  options:
    QwenDurableFetchOptions =
      {},
): Promise<Response> {
  const requiredContextTokens =
    Math.max(
      1,
      Math.floor(
        Number(
          options.requiredContextTokens,
        )
        || estimatedContext(
          payload,
        ),
      ),
    );

  const allowedNodes =
    normalizedAllowedNodes(
      options.allowedNodes,
    );

  if (!allowedNodes.length) {
    throw new Error(
      "No Qwen cluster nodes are enabled for this request.",
    );
  }

  const maximumContextTokens =
    maximumContextForNodes(
      allowedNodes,
    );

  /*
   * A capability mismatch can never be fixed by waiting.
   */
  if (
    requiredContextTokens
    > maximumContextTokens
  ) {
    throw new QwenContextUnsupportedError(
      requiredContextTokens,
      maximumContextTokens,
    );
  }

  const executionTimeoutMs =
    Math.max(
      1_000,
      Math.floor(
        Number(
          options.timeoutMs,
        )
        || 180_000,
      ),
    );

  const job =
    createQwenDurableJob({
      ownerKey:
        options.ownerKey
        ?? null,

      requestKind:
        String(
          options.requestKind
          || "qwen-fetch",
        ).trim()
        || "qwen-fetch",

      path,

      payload,

      requiredContextTokens,

      allowedNodes,

      model:
        options.model
        || null,

      modelByNode:
        options.modelByNode
        || {},

      keepAlive:
        options.keepAlive
        ?? null,

      executionTimeoutMs,

      leaseTtlSeconds:
        options.leaseTtlSeconds
        ?? null,
    });

  /*
   * Start the independent durable scheduler.
   *
   * This promise is deliberately not tied to the caller's wait loop.
   */
  kickQwenDurableScheduler(
    options.schedulerDependencies
    || {},
  );

  for (;;) {
    if (
      options.signal?.aborted
    ) {
      throw new DOMException(
        `Stopped waiting for Qwen job ${job.id}; the durable job remains queued or running.`,
        "AbortError",
      );
    }

    const current =
      getQwenDurableJob(
        job.id,
      );

    if (!current) {
      throw new Error(
        `Durable Qwen job ${job.id} disappeared from the job store.`,
      );
    }

    if (
      current.status
      === "completed"
    ) {
      const headers =
        new Headers(
          current.responseHeaders,
        );

      headers.set(
        "x-otg-qwen-job-id",
        current.id,
      );

      return new Response(
        current.responseBody
        ?? "",
        {
          status:
            current.responseStatus
            ?? 500,

          statusText:
            current.responseStatusText
            || undefined,

          headers,
        },
      );
    }

    if (
      current.status
      === "failed"
    ) {
      throw new QwenDurableJobFailedError(
        current.id,
        current.error
        || "Durable Qwen job failed.",
      );
    }

    /*
     * queued / claimed / running:
     *
     * No capacity deadline.
     */
    await sleep(
      250,
    );
  }
}
