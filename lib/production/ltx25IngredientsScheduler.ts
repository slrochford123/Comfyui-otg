import path from "node:path";

import {
  OTG_DATA_ROOT,
  safeJoin,
  safeSegment,
} from "@/lib/paths";

import {
  composeLtx25IngredientsSheet,
  ltx25IngredientsSheetOutputPath,
} from "@/lib/production/ltx25IngredientsSheet";

import {
  buildLtx25IngredientsWorkflow,
  type Ltx25IngredientsBackendId,
} from "@/lib/production/ltx25IngredientsWorkflow";

import {
  LTX25_INGREDIENTS_BACKEND_PRIORITY,
  LTX25_INGREDIENTS_BACKEND_PROFILES,
  Ltx25BackendBusyError,
  Ltx25SubmissionUnknownError,
  downloadLtx25IngredientsVideo,
  getLtx25IngredientsPromptHistory,
  inspectLtx25IngredientsBackend,
  submitLtx25IngredientsPrompt,
  uploadLtx25IngredientsSheet,
  type Ltx25BackendProbe,
} from "@/lib/production/ltx25IngredientsComfy";

import {
  claimProductionV2Ltx25GenerationJob,
  completeProductionV2Ltx25GenerationJob,
  failProductionV2Ltx25GenerationJob,
  getOldestActiveProductionV2Ltx25GenerationJob,
  getOldestWaitingProductionV2Ltx25GenerationJob,
  getProductionV2Ltx25GenerationJob,
  markProductionV2Ltx25GenerationRunning,
  markProductionV2Ltx25GenerationWaiting,
  markProductionV2Ltx25SheetReady,
  markProductionV2Ltx25SubmissionAccepted,
  markProductionV2Ltx25SubmissionAttempting,
  requeueProductionV2Ltx25GenerationBeforeAcceptance,
  type ProductionV2Ltx25GenerationJob,
} from "@/lib/production/ltx25IngredientsJobs";

export const LTX25_INGREDIENTS_SCHEDULER_VERSION =
  "production-v2-ltx25-ingredients-scheduler-v1" as const;

export type Ltx25IngredientsSchedulerDependencies = {
  probe?: (
    backend:
      Ltx25IngredientsBackendId,
  ) => Promise<Ltx25BackendProbe>;

  compose?:
    typeof composeLtx25IngredientsSheet;

  upload?:
    typeof uploadLtx25IngredientsSheet;

  build?:
    typeof buildLtx25IngredientsWorkflow;

  submit?:
    typeof submitLtx25IngredientsPrompt;

  history?:
    typeof getLtx25IngredientsPromptHistory;

  download?:
    typeof downloadLtx25IngredientsVideo;
};

export function chooseProductionV2Ltx25Backend(
  probes:
    Ltx25BackendProbe[],
): Ltx25IngredientsBackendId | null {
  const byId =
    new Map(
      probes.map(
        (probe) => [
          probe.backend,
          probe,
        ],
      ),
    );

  /*
   * LTX policy differs intentionally from H3:
   *
   * We NEVER deliberately enqueue an LTX Ingredients
   * job behind existing Comfy work.
   *
   * 5060 Ti is first choice because the qualified
   * benchmark was materially faster.
   *
   * 3090 is fallback only when actually idle.
   */
  for (
    const backend
    of LTX25_INGREDIENTS_BACKEND_PRIORITY
  ) {
    const probe =
      byId.get(backend);

    if (
      probe?.healthy
      && probe.compatible
      && probe.idle
    ) {
      return backend;
    }
  }

  return null;
}

function waitingMessage(
  probes:
    Ltx25BackendProbe[],
) {
  const busy =
    probes.filter(
      (probe) =>
        probe.reason
        === "comfy-queue-active",
    );

  if (
    busy.length
    === probes.length
    && probes.length
  ) {
    return (
      "Waiting for an idle LTX 2.5 GPU; "
      + "all qualified Comfy backends are currently busy"
    );
  }

  const unavailable =
    probes
      .filter(
        (probe) =>
          !probe.healthy
          || !probe.compatible,
      )
      .map(
        (probe) =>
          `${
            LTX25_INGREDIENTS_BACKEND_PROFILES[
              probe.backend
            ].label
          }: ${probe.reason}`,
      );

  if (unavailable.length) {
    return (
      "Waiting for a compatible idle LTX 2.5 GPU. "
      + unavailable.join("; ")
    );
  }

  return (
    "Waiting for an idle LTX 2.5 GPU"
  );
}

export function ltx25IngredientsVideoOutputPath(
  job:
    ProductionV2Ltx25GenerationJob,
) {
  return safeJoin(
    OTG_DATA_ROOT,
    "productions-v2",
    "ltx25-ingredients",
    safeSegment(job.ownerKey),
    safeSegment(job.productionId),
    safeSegment(job.sceneId),
    "outputs",
    `${safeSegment(job.id)}.mp4`,
  );
}

async function prepareAndSubmitLtx25Job(
  job:
    ProductionV2Ltx25GenerationJob,
  dependencies:
    Ltx25IngredientsSchedulerDependencies,
) {
  if (!job.backend) {
    throw new Error(
      "Claimed LTX 2.5 job has no backend.",
    );
  }

  const compose =
    dependencies.compose
    || composeLtx25IngredientsSheet;

  const upload =
    dependencies.upload
    || uploadLtx25IngredientsSheet;

  const build =
    dependencies.build
    || buildLtx25IngredientsWorkflow;

  const submit =
    dependencies.submit
    || submitLtx25IngredientsPrompt;

  let sheetPath =
    job.sheetPath;

  let sheetSha256 =
    job.sheetSha256;

  if (
    !sheetPath
    || !sheetSha256
  ) {
    const outputPath =
      ltx25IngredientsSheetOutputPath({
        ownerKey:
          job.ownerKey,

        productionId:
          job.productionId,

        sceneId:
          job.sceneId,

        jobId:
          job.id,
      });

    const composed =
      await compose({
        manifest:
          job.payload.manifest,

        outputPath,
      });

    sheetPath =
      composed.outputPath;

    sheetSha256 =
      composed.sha256;

    const persisted =
      markProductionV2Ltx25SheetReady(
        job.id,
        {
          sheetPath,
          sheetSha256,
        },
      );

    if (
      !persisted
      || persisted.sheetPath
        !== sheetPath
    ) {
      throw new Error(
        "Could not persist the LTX Ingredients sheet contract.",
      );
    }
  }

  const uploadedFilename =
    await upload({
      backend:
        job.backend,

      sourcePath:
        sheetPath,

      uploadName:
        `pv2_ltx25_${job.id}_ingredients`,
    });

  /*
   * OTG_PRODUCTION_V2_LTX_CONTINUATION_FIRST_FRAME_V1
   *
   * This path is server-owned durable job state. The API
   * preparation layer added in the next C2-C step will
   * resolve it from an owner-verified prior media version.
   */
  const continuationFirstFramePath =
    String(
      job.payload
        .continuationFirstFramePath
      ?? "",
    ).trim();

  let continuationFirstFrameFilename:
    string | undefined;

  if (continuationFirstFramePath) {
    continuationFirstFrameFilename =
      await upload({
        backend:
          job.backend,

        sourcePath:
          continuationFirstFramePath,

        uploadName:
          `pv2_ltx25_${job.id}_continuation_first_frame`,
      });
  }

  const built =
    build({
      backend:
        job.backend,

      ingredientsSheetFilename:
        uploadedFilename,

      continuationFirstFrameFilename,

      finalPrompt:
        job.payload.finalPrompt,

      durationSeconds:
        job.payload.durationSeconds,

      seed:
        job.payload.seed,

      outputPrefix:
        (
          "production_v2_ltx25/"
          + safeSegment(job.id)
        ),
    });

  let acceptedPersisted =
    false;

  try {
    const result =
      await submit({
        backend:
          job.backend,

        graph:
          built.graph,

        clientId:
          `production-v2-ltx25-${job.id}`,

        ownerId:
          job.id,

        /*
         * This callback executes only AFTER the protected
         * queue recheck says the backend is still idle,
         * and immediately BEFORE the actual /prompt POST.
         *
         * From this point onward automatic replay is unsafe
         * until acceptance or deterministic rejection is known.
         */
        onBeforePromptPost:
          async () => {
            const attempting =
              markProductionV2Ltx25SubmissionAttempting(
                job.id,
              );

            if (
              !attempting
              || attempting
                .submissionState
                !== "unknown"
            ) {
              throw new Error(
                "Could not durably mark LTX prompt dispatch.",
              );
            }
          },

        onPromptAccepted:
          async (
            promptId,
          ) => {
            const accepted =
              markProductionV2Ltx25SubmissionAccepted(
                job.id,
                {
                  promptId,
                  workflowId:
                    built.workflowId,

                  workflowFile:
                    built.workflowFile,
                },
              );

            if (
              !accepted
              || accepted
                .submissionState
                !== "accepted"
            ) {
              throw new Error(
                "ComfyUI accepted the LTX prompt but the acceptance record could not be persisted.",
              );
            }

            acceptedPersisted =
              true;
          },
      });

    /*
     * Preserve the dependency-injected testing seam:
     * a test submitter may return a prompt ID without
     * calling the production acceptance callback.
     */
    if (!acceptedPersisted) {
      const accepted =
        markProductionV2Ltx25SubmissionAccepted(
          job.id,
          {
            promptId:
              result.promptId,

            workflowId:
              built.workflowId,

            workflowFile:
              built.workflowFile,
          },
        );

      if (
        !accepted
        || accepted
          .submissionState
          !== "accepted"
      ) {
        throw new Error(
          "Could not persist accepted LTX prompt ID.",
        );
      }
    }

    return (
      markProductionV2Ltx25GenerationRunning(
        job.id,
      )
      || getProductionV2Ltx25GenerationJob(
        job.id,
      )
    );
  } catch (error) {
    const current =
      getProductionV2Ltx25GenerationJob(
        job.id,
      );

    if (
      error
      instanceof Ltx25BackendBusyError
    ) {
      /*
       * The busy refusal occurs BEFORE onBeforePromptPost,
       * therefore pre-submit is still deterministic and may
       * safely be rerouted on a later scheduler tick.
       */
      if (
        current?.submissionState
        === "pre-submit"
        && !current.comfyPromptId
      ) {
        return (
          requeueProductionV2Ltx25GenerationBeforeAcceptance(
            job.id,
            (
              `${
                LTX25_INGREDIENTS_BACKEND_PROFILES[
                  job.backend
                ].label
              } became busy before prompt admission; waiting for another idle LTX backend`
            ),
          )
          || current
        );
      }

      return failProductionV2Ltx25GenerationJob(
        job.id,
        (
          "LTX backend became busy after submission state "
          + "was no longer safely replayable."
        ),
        true,
      );
    }

    if (
      error
      instanceof Ltx25SubmissionUnknownError
    ) {
      return failProductionV2Ltx25GenerationJob(
        job.id,
        error.message,
        true,
      );
    }

    /*
     * A readable HTTP rejection or deterministic local
     * preparation failure is not ambiguous.
     */
    return failProductionV2Ltx25GenerationJob(
      job.id,
      error instanceof Error
        ? error.message
        : String(error),
      false,
    );
  }
}

async function reconcileActiveLtx25Job(
  job:
    ProductionV2Ltx25GenerationJob,
  dependencies:
    Ltx25IngredientsSchedulerDependencies,
) {
  /*
   * Crash recovery:
   *
   * pre-submit claim = safe to requeue
   * unknown dispatch = NEVER automatically replay
   */
  if (
    job.status === "claimed"
  ) {
    if (
      job.submissionState
      === "pre-submit"
      && !job.comfyPromptId
    ) {
      return (
        requeueProductionV2Ltx25GenerationBeforeAcceptance(
          job.id,
          (
            "Recovered a pre-submit LTX claim; "
            + "waiting for an idle backend"
          ),
        )
        || job
      );
    }

    if (
      job.submissionState
      === "unknown"
      && !job.comfyPromptId
    ) {
      return failProductionV2Ltx25GenerationJob(
        job.id,
        (
          "LTX prompt dispatch state is ambiguous after interruption. "
          + "The job was not replayed automatically."
        ),
        true,
      );
    }
  }

  if (
    job.status !== "submitted"
    && job.status !== "running"
  ) {
    return job;
  }

  if (
    !job.backend
    || !job.comfyPromptId
  ) {
    return failProductionV2Ltx25GenerationJob(
      job.id,
      "Accepted LTX job is missing backend or ComfyUI prompt ID.",
      true,
    );
  }

  const history =
    dependencies.history
    || getLtx25IngredientsPromptHistory;

  let result:
    Awaited<
      ReturnType<
        typeof getLtx25IngredientsPromptHistory
      >
    >;

  try {
    result =
      await history({
        backend:
          job.backend,

        promptId:
          job.comfyPromptId,
      });
  } catch {
    /*
     * History/network reads are retryable. Do not destroy
     * a valid accepted job because one polling request failed.
     */
    return job;
  }

  if (!result) {
    return (
      markProductionV2Ltx25GenerationRunning(
        job.id,
      )
      || job
    );
  }

  if (result.failed) {
    return failProductionV2Ltx25GenerationJob(
      job.id,
      "ComfyUI reported an LTX 2.5 Ingredients execution failure.",
      false,
    );
  }

  if (!result.completed) {
    return (
      markProductionV2Ltx25GenerationRunning(
        job.id,
      )
      || job
    );
  }

  const video =
    result.files.find(
      (file) =>
        /\.(mp4|mov|webm)$/i.test(
          file.filename,
        ),
    );

  if (!video) {
    return failProductionV2Ltx25GenerationJob(
      job.id,
      "Completed LTX prompt did not expose a video output.",
      false,
    );
  }

  const download =
    dependencies.download
    || downloadLtx25IngredientsVideo;

  const destinationPath =
    ltx25IngredientsVideoOutputPath(
      job,
    );

  try {
    await download({
      backend:
        job.backend,

      file:
        video,

      destinationPath,
    });
  } catch {
    /*
     * Output transfer is retryable because Comfy has already
     * completed and the remote output filename is durable.
     */
    return job;
  }

  return (
    completeProductionV2Ltx25GenerationJob(
      job.id,
      destinationPath,
    )
    || job
  );
}

export async function runProductionV2Ltx25SchedulerTick(
  dependencies:
    Ltx25IngredientsSchedulerDependencies = {},
) {
  /*
   * Only one LTX Production job is advanced at a time in V1.
   * This is deliberate while H3 and other services continue
   * sharing both physical GPUs.
   */
  const active =
    getOldestActiveProductionV2Ltx25GenerationJob();

  if (active) {
    return reconcileActiveLtx25Job(
      active,
      dependencies,
    );
  }

  const waiting =
    getOldestWaitingProductionV2Ltx25GenerationJob();

  if (!waiting) {
    return null;
  }

  const probe =
    dependencies.probe
    || (
      (
        backend:
          Ltx25IngredientsBackendId,
      ) =>
        inspectLtx25IngredientsBackend(
          backend,
        )
    );

  const probes:
    Ltx25BackendProbe[] = [];

  /*
   * Probe in actual routing order.
   * If the 5060 is qualified and idle we do not even need
   * to inspect the 3090 for this job.
   */
  for (
    const backend
    of LTX25_INGREDIENTS_BACKEND_PRIORITY
  ) {
    const result =
      await probe(backend);

    probes.push(result);

    if (
      result.healthy
      && result.compatible
      && result.idle
    ) {
      break;
    }
  }

  const backend =
    chooseProductionV2Ltx25Backend(
      probes,
    );

  if (!backend) {
    return (
      markProductionV2Ltx25GenerationWaiting(
        waiting.id,
        waitingMessage(probes),
      )
      || waiting
    );
  }

  const claimed =
    claimProductionV2Ltx25GenerationJob(
      waiting.id,
      backend,
    );

  if (!claimed) {
    return null;
  }

  return prepareAndSubmitLtx25Job(
    claimed,
    dependencies,
  );
}

type SchedulerGlobal = {
  timer:
    ReturnType<typeof setInterval>;
  running: boolean;
};

function schedulerGlobal() {
  return globalThis as
    typeof globalThis & {
      __otgProductionV2Ltx25Scheduler?:
        SchedulerGlobal;
    };
}

/*
 * Merely exporting this function does NOT activate the scheduler.
 * The Production V2 route will explicitly start it in a later patch.
 */
export function startProductionV2Ltx25Scheduler() {
  const root =
    schedulerGlobal();

  if (
    root
      .__otgProductionV2Ltx25Scheduler
      ?.timer
  ) {
    return;
  }

  const state:
    SchedulerGlobal = {
      timer: null as unknown as
        ReturnType<typeof setInterval>,

      running: false,
    };

  state.timer =
    setInterval(
      () => {
        if (state.running) {
          return;
        }

        state.running = true;

        void runProductionV2Ltx25SchedulerTick()
          .catch(() => {
            /*
             * Durable job state is authoritative.
             * One failed scheduler tick must not terminate
             * the web process or blindly replay a prompt.
             */
          })
          .finally(
            () => {
              state.running =
                false;
            },
          );
      },
      2_500,
    );

  (
    state.timer as
      ReturnType<typeof setInterval>
      & {
        unref?: () => void;
      }
  ).unref?.();

  root
    .__otgProductionV2Ltx25Scheduler =
      state;
}

export function productionV2Ltx25GenerationPublicStatus(
  job:
    ProductionV2Ltx25GenerationJob,
) {
  return {
    id:
      job.id,

    model:
      job.model,

    mode:
      job.mode,

    status:
      job.status,

    statusMessage:
      job.statusMessage,

    backend:
      job.backend,

    backendLabel:
      job.backend
        ? LTX25_INGREDIENTS_BACKEND_PROFILES[
            job.backend
          ].label
        : null,

    promptId:
      job.comfyPromptId,

    submissionState:
      job.submissionState,

    workflowId:
      job.workflowId,

    workflowFile:
      job.workflowFile,

    sheetSha256:
      job.sheetSha256,

    videoUrl:
      job.outputPath
        ? (
            "/api/file?path="
            + encodeURIComponent(
              path.resolve(
                job.outputPath,
              ),
            )
          )
        : null,

    error:
      job.error,

    attempts:
      job.attempts,

    createdAt:
      job.createdAt,

    updatedAt:
      job.updatedAt,

    submittedAt:
      job.submittedAt,

    completedAt:
      job.completedAt,
  };
}
