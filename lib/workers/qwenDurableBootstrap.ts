import {
  recoverQwenDurableJobsAfterProcessRestart,
} from "@/lib/workers/qwenDurableJobs";

import {
  kickQwenDurableScheduler,
} from "@/lib/workers/qwenDurableScheduler";

/*
 * OTG_QWEN_DURABLE_BOOTSTRAP_V1
 *
 * The durable DB survives the Next.js process.
 * This bootstrap reconnects process lifetime to persisted queue state.
 */

type QwenBootstrapGlobal =
  typeof globalThis & {
    __otgQwenDurableBootstrapV1?:
      boolean;
  };

function bootstrapGlobal() {
  return globalThis as
    QwenBootstrapGlobal;
}

export function bootstrapQwenDurableScheduler() {
  const state =
    bootstrapGlobal();

  if (
    state
      .__otgQwenDurableBootstrapV1
  ) {
    return {
      alreadyStarted:
        true,

      recovery:
        null,
    };
  }

  /*
   * Mark before bootstrapping so duplicate Next instrumentation
   * registration in the same process cannot race this recovery.
   *
   * If recovery itself throws, clear the flag so a deliberate
   * later retry remains possible.
   */
  state
    .__otgQwenDurableBootstrapV1 =
      true;

  try {
    const recovery =
      recoverQwenDurableJobsAfterProcessRestart();

    if (
      recovery.queued > 0
    ) {
      kickQwenDurableScheduler();
    }

    console.info(
      "[qwen-durable-bootstrap]",
      {
        requeued:
          recovery.requeued,

        failedAmbiguous:
          recovery.failedAmbiguous,

        queued:
          recovery.queued,
      },
    );

    return {
      alreadyStarted:
        false,

      recovery,
    };
  } catch (error) {
    state
      .__otgQwenDurableBootstrapV1 =
        false;

    throw error;
  }
}
