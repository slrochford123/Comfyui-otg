import {
  isRtx5060Comfy8188Endpoint,
} from "@/lib/workers/comfy5060Lease";
import {
  resolveComfyPhysicalGpu,
} from "@/lib/workers/clusterGpu";
import {
  runWithComfySubmissionCriticalSection,
} from "@/lib/workers/comfySubmissionCriticalSection";


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

export async function submitComfyPromptWithGpuLease(args: {
  baseUrl: string;
  init: RequestInit;
  workerId: string;
  ownerId?: string;
  fetcher?: (
    url: string,
    init: RequestInit,
  ) => Promise<Response>;
  purpose?: "image" | "video" | "ltx-fallback";
  preSubmitCleanup?: "free" | null;
    submitTimeoutMs?: number;
    onPromptAccepted?: (
      promptId: string,
    ) => Promise<void> | void;
}): Promise<Response> {
  // OTG_COMFY_PROMPT_QUEUE_ONLY_V1
  //
  // ComfyUI remains responsible for render-time FIFO queueing.
  // OTG does not hold a GPU workload lock while a render runs.
  //
  // OTG_COMFY_SUBMISSION_CRITICAL_SECTION_V1
  //
  // The separate physical-endpoint mutex below protects only:
  //
  //   queue recheck -> optional /free -> /prompt
  //
  // It is released immediately after the submission request
  // finishes.
  const baseUrl =
    normalizeBaseUrl(args.baseUrl);

  const submit =
    args.fetcher || fetch;

  const physicalGpu =
    resolveComfyPhysicalGpu(
      baseUrl,
    );

  const on5060 =
    physicalGpu === "slr-5060"
    || isRtx5060Comfy8188Endpoint(
      baseUrl,
    );

  const on3090 =
    physicalGpu === "shawn-3090";

  if (!on5060 && !on3090) {
    throw new UnclassifiedComfyGpuError(
      baseUrl,
    );
  }

  const guarded =
    await runWithComfySubmissionCriticalSection(
      {
        physicalGpu:
          on5060
            ? "slr-5060"
            : "shawn-3090",
        ownerId:
          String(
            args.ownerId
            || (
              `${args.workerId}:`
              + `${process.pid}:`
              + `${Date.now()}`
            ),
          ).trim(),
        workerId:
          args.workerId,

          /*
           * OTG_COMFY_ADMISSION_WAIT_OUTLIVES_CALLER_TIMEOUT_V1
           *
           * Capacity/admission waiting is queue state.
           * A transport timer must not reject work merely because
           * another submission owns the short physical mutex.
           */
          signal:
            null,
      },
      async () => {
        if (
          args.preSubmitCleanup
          === "free"
        ) {
          if (!on5060) {
            return new Response(
              JSON.stringify({
                error:
                  "Pre-submit /free is qualified only for RTX 5060 Ti H3 R2V.",
              }),
              {
                status: 503,
                headers: {
                  "Content-Type":
                    "application/json",
                },
              },
            );
          }

          const queueResponse =
            await submit(
              `${baseUrl}/queue`,
              {
                method: "GET",
                cache: "no-store",
              },
            );

          if (!queueResponse.ok) {
            return new Response(
              JSON.stringify({
                error:
                  `Could not recheck the RTX 5060 Ti Comfy queue before /free: HTTP ${queueResponse.status}.`,
              }),
              {
                status: 503,
                headers: {
                  "Content-Type":
                    "application/json",
                },
              },
            );
          }

          const queue =
            await queueResponse
              .json()
              .catch(() => null) as {
                queue_running?: unknown;
                queue_pending?: unknown;
              } | null;

          if (
            !queue
            || !Array.isArray(
              queue.queue_running,
            )
            || !Array.isArray(
              queue.queue_pending,
            )
          ) {
            return new Response(
              JSON.stringify({
                error:
                  "RTX 5060 Ti queue recheck returned an unreadable queue state; /free was not issued.",
              }),
              {
                status: 503,
                headers: {
                  "Content-Type":
                    "application/json",
                },
              },
            );
          }

          const queueBusy =
            queue.queue_running.length > 0
            || queue.queue_pending.length > 0;

          if (queueBusy) {
            return new Response(
              JSON.stringify({
                error:
                  "RTX 5060 Ti queue became busy before the required R2V /free operation.",
              }),
              {
                status: 409,
                headers: {
                  "Content-Type":
                    "application/json",
                },
              },
            );
          }

          const freeResponse =
            await submit(
              `${baseUrl}/free`,
              {
                method: "POST",
                headers: {
                  "Content-Type":
                    "application/json",
                },
                body:
                  JSON.stringify({
                    unload_models: true,
                    free_memory: true,
                  }),
              },
            );

          if (!freeResponse.ok) {
            return new Response(
              JSON.stringify({
                error:
                  `RTX 5060 Ti pre-submit /free failed with HTTP ${freeResponse.status}.`,
              }),
              {
                status: 503,
                headers: {
                  "Content-Type":
                    "application/json",
                },
              },
            );
          }
        }


          const submitTimeoutMs =
            args.submitTimeoutMs == null
              ? (
                  args.init.signal
                    ? 30_000
                    : null
                )
              : Math.max(
                  1_000,
                  Math.floor(
                    Number(
                      args.submitTimeoutMs,
                    ) || 30_000,
                  ),
                );

          let submitController:
            AbortController | null =
              null;

          let submitTimer:
            ReturnType<typeof setTimeout>
            | null =
              null;

          if (
            submitTimeoutMs != null
          ) {
            submitController =
              new AbortController();

            submitTimer =
              setTimeout(
                () =>
                  submitController?.abort(),
                submitTimeoutMs,
              );
          }

          let response:
            Response;

          try {
            response =
              await submit(
                `${baseUrl}/prompt`,
                {
                  ...args.init,

                  /*
                   * Reset a caller timeout that may have expired
                   * while waiting for GPU admission.
                   */
                  signal:
                    submitController?.signal,
                },
              );
          } finally {
            if (submitTimer) {
              clearTimeout(
                submitTimer,
              );
            }
          }

          if (
            response.ok
            && args.onPromptAccepted
          ) {
            const text =
              await response
                .clone()
                .text()
                .catch(() => "");

            let payload:
              Record<string, unknown> = {};

            if (text) {
              try {
                payload =
                  JSON.parse(text) as
                    Record<string, unknown>;
              } catch {}
            }

            const promptId =
              String(
                payload.prompt_id
                || payload.promptId
                || "",
              ).trim();

            if (promptId) {
              await args.onPromptAccepted(
                promptId,
              );
            }
          }

          return response;
      },
    );

  if (!guarded.ok) {
    return new Response(
      JSON.stringify({
        error: guarded.error,
      }),
      {
        status: guarded.status,
        headers: {
          "Content-Type":
            "application/json",
        },
      },
    );
  }

  return guarded.value;
}

/** Backward-compatible name retained while callers migrate to the physical-GPU abstraction. */
export const submitComfyPromptWith5060Lease = submitComfyPromptWithGpuLease;
