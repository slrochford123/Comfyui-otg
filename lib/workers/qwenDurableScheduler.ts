import {
  QwenClusterBusyError,
  QwenContextUnsupportedError,
  qwenClusterFetch,
} from "@/lib/workers/qwenClusterRouter";

import {
  claimQwenDurableJob,
  completeQwenDurableJob,
  createQwenDurableJob,
  failQwenDurableJob,
  listQueuedQwenDurableJobs,
  markQwenDurableJobRunning,
  requeueQwenDurableJobBeforeExecution,
  type QwenDurableJob,
} from "@/lib/workers/qwenDurableJobs";

/*
 * OTG_QWEN_DURABLE_QUEUE_V1
 *
 * A busy GPU is durable queue state, never terminal failure.
 *
 * Execution timeout begins only after a physical Qwen route can
 * actually be acquired.
 */

export type QwenDurableSchedulerDependencies = {
  execute?: typeof qwenClusterFetch;
  sleep?: (
    milliseconds: number,
  ) => Promise<void>;
};

type ProcessResult =
  | "completed"
  | "requeued"
  | "failed"
  | "skipped";

function errorMessage(
  error: unknown,
) {
  return error instanceof Error
    ? error.message
    : String(error);
}

async function processQwenJob(
  candidate: QwenDurableJob,
  dependencies:
    QwenDurableSchedulerDependencies,
): Promise<ProcessResult> {
  const claimed =
    claimQwenDurableJob(
      candidate.id,
    );

  if (!claimed) {
    return "skipped";
  }

  const execute =
    dependencies.execute
    || qwenClusterFetch;

  try {
    const response =
      await execute(
        claimed.path,
        claimed.payload,
        {
          requiredContextTokens:
            claimed.requiredContextTokens,

          /*
           * Capacity waiting is handled by the durable queue.
           * Never park this scheduler execution in a timed router wait.
           */
          waitMs: 0,

          timeoutMs:
            claimed.executionTimeoutMs,

          allowedNodes:
            claimed.allowedNodes,

          model:
            claimed.model
            || undefined,

          modelByNode:
            claimed.modelByNode,

          keepAlive:
            claimed.keepAlive
            ?? undefined,

          leaseTtlSeconds:
            claimed.leaseTtlSeconds
            ?? undefined,

          onRouteAcquired:
            async (route) => {
              const running =
                markQwenDurableJobRunning(
                  claimed.id,
                  route.node,
                );

              if (!running) {
                throw new Error(
                  "Qwen GPU route was acquired but durable running state could not be recorded. The model request was not sent.",
                );
              }
            },
        },
      );

    const responseBody =
      await response.text();

    const responseHeaders:
      Record<string, string> = {};

    response.headers.forEach(
      (value, key) => {
        responseHeaders[key] =
          value;
      },
    );

    const completed =
      completeQwenDurableJob({
        id:
          claimed.id,

        responseStatus:
          response.status,

        responseStatusText:
          response.statusText,

        responseHeaders,

        responseBody,
      });

    if (!completed) {
      failQwenDurableJob(
        claimed.id,
        "Qwen model execution completed but its durable result could not be recorded. Automatic re-execution is disabled.",
      );

      return "failed";
    }

    return "completed";
  } catch (error) {
    /*
     * Temporary physical capacity contention is the one condition
     * that returns to the durable queue.
     */
    if (
      error
      instanceof QwenClusterBusyError
    ) {
      requeueQwenDurableJobBeforeExecution(
        claimed.id,
        "Waiting for first available Qwen GPU",
      );

      return "requeued";
    }

    /*
     * This can never succeed by waiting for another GPU.
     */
    if (
      error
      instanceof QwenContextUnsupportedError
    ) {
      failQwenDurableJob(
        claimed.id,
        error.message,
      );

      return "failed";
    }

    /*
     * Once a model request may have started, do not blindly retry it.
     * Network/model/runtime failures remain real failures.
     */
    failQwenDurableJob(
      claimed.id,
      errorMessage(
        error,
      ),
    );

    return "failed";
  }
}

export async function runQwenDurableSchedulerTick(
  dependencies:
    QwenDurableSchedulerDependencies =
      {},
) {
  const queued =
    listQueuedQwenDurableJobs(
      12,
    );

  if (!queued.length) {
    return {
      examined: 0,
      completed: 0,
      requeued: 0,
      failed: 0,
      skipped: 0,
    };
  }

  /*
   * Start several candidates concurrently. The physical resource
   * locks decide which one or two can actually enter inference.
   *
   * Candidates that cannot acquire a compatible lane immediately
   * return to durable queued state.
   */
  const results =
    await Promise.all(
      queued.map(
        (job) =>
          processQwenJob(
            job,
            dependencies,
          ),
      ),
    );

  return {
    examined:
      results.length,

    completed:
      results.filter(
        (value) =>
          value === "completed",
      ).length,

    requeued:
      results.filter(
        (value) =>
          value === "requeued",
      ).length,

    failed:
      results.filter(
        (value) =>
          value === "failed",
      ).length,

    skipped:
      results.filter(
        (value) =>
          value === "skipped",
      ).length,
  };
}

let schedulerLoop:
  Promise<void>
  | null =
    null;

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

/*
 * Keep retrying durable capacity waits without depending on the
 * originating HTTP request remaining connected.
 */
export function kickQwenDurableScheduler(
  dependencies:
    QwenDurableSchedulerDependencies =
      {},
) {
  if (schedulerLoop) {
    return;
  }

  schedulerLoop =
    (async () => {
      for (;;) {
        const queued =
          listQueuedQwenDurableJobs(
            1,
          );

        if (!queued.length) {
          return;
        }

        const result =
          await runQwenDurableSchedulerTick(
            dependencies,
          );

        const remaining =
          listQueuedQwenDurableJobs(
            1,
          );

        if (!remaining.length) {
          return;
        }

        /*
         * If work merely requeued because capacity is occupied,
         * avoid a hot polling loop.
         */
        if (
          result.completed === 0
          && result.failed === 0
        ) {
          await (
            dependencies.sleep
            || sleep
          )(
            1_000,
          );
        }
      }
    })()
      .catch((error) => {
        console.error(
          "[qwen-durable-scheduler]",
          error,
        );
      })
      .finally(() => {
        schedulerLoop =
          null;
      });
}

export function enqueueQwenDurableRequest(
  input:
    Parameters<
      typeof createQwenDurableJob
    >[0],
) {
  const job =
    createQwenDurableJob(
      input,
    );

  kickQwenDurableScheduler();

  return job;
}
