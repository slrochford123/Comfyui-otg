import fs from "node:fs/promises";
import path from "node:path";

import {
  ensureDir,
  safeSegment,
} from "@/lib/paths";

import {
  submitComfyPromptWithGpuLease,
} from "@/lib/workers/comfyPromptLease";

import type {
  Ltx25IngredientsBackendId,
  Ltx25IngredientsGraph,
} from "@/lib/production/ltx25IngredientsWorkflow";

export const LTX25_INGREDIENTS_BACKEND_PRIORITY = [
  "rtx5060ti",
  "rtx3090",
] as const satisfies readonly
  Ltx25IngredientsBackendId[];

export const LTX25_INGREDIENTS_BACKEND_PROFILES = {
  rtx5060ti: {
    id: "rtx5060ti",
    label: "RTX 5060 Ti",
    baseUrl:
      process.env
        .OTG_LTX25_5060_COMFY_URL
      || "http://100.98.212.116:8188",
    workerId:
      "production-v2-ltx25-5060",
  },

  rtx3090: {
    id: "rtx3090",
    label: "RTX 3090",
    baseUrl:
      process.env
        .OTG_LTX25_3090_COMFY_URL
      || "http://100.75.162.64:8188",
    workerId:
      "production-v2-ltx25-3090",
  },
} as const;

export type Ltx25BackendProbe = {
  backend:
    Ltx25IngredientsBackendId;

  healthy: boolean;
  compatible: boolean;
  idle: boolean;

  reason: string;

  missingNodes: string[];
  missingAssets: string[];

  queueRunning: number;
  queuePending: number;
};

export type Ltx25ComfyHistoryFile = {
  filename: string;
  subfolder?: string;
  type?: string;
  nodeId?: string;
};

export type Ltx25PromptHistory = {
  exists: boolean;
  completed: boolean;
  failed: boolean;
  status: Record<string, unknown>;
  files: Ltx25ComfyHistoryFile[];
};

export class Ltx25BackendBusyError
  extends Error {
  readonly code =
    "ltx25_backend_busy";

  readonly status = 409;

  constructor(
    readonly backend:
      Ltx25IngredientsBackendId,
    message?: string,
  ) {
    super(
      message
      || `${LTX25_INGREDIENTS_BACKEND_PROFILES[backend].label} ComfyUI queue is active.`,
    );

    this.name =
      "Ltx25BackendBusyError";
  }
}

export class Ltx25SubmissionUnknownError
  extends Error {
  readonly code =
    "ltx25_submission_unknown";

  readonly status = 503;

  constructor(message: string) {
    super(message);

    this.name =
      "Ltx25SubmissionUnknownError";
  }
}

type Fetcher = (
  url: string,
  init?: RequestInit,
) => Promise<Response>;

function clean(
  value: unknown,
) {
  return String(value ?? "")
    .trim();
}

function abortAfter(
  ms: number,
) {
  const controller =
    new AbortController();

  const timer =
    setTimeout(
      () =>
        controller.abort(),
      ms,
    );

  return {
    signal:
      controller.signal,

    clear:
      () =>
        clearTimeout(timer),
  };
}

async function fetchWithTimeout(
  fetcher: Fetcher,
  url: string,
  init: RequestInit = {},
  timeoutMs = 10_000,
) {
  const timeout =
    abortAfter(timeoutMs);

  try {
    return await fetcher(
      url,
      {
        ...init,
        signal:
          timeout.signal,
      },
    );
  } finally {
    timeout.clear();
  }
}

function comboValues(
  node: any,
  inputName: string,
) {
  const descriptor =
    node?.input?.required?.[
      inputName
    ]
    || node?.input?.optional?.[
      inputName
    ];

  if (
    !Array.isArray(descriptor)
    || !descriptor.length
  ) {
    return [] as string[];
  }

  if (
    Array.isArray(
      descriptor[0],
    )
  ) {
    return descriptor[0]
      .map(clean)
      .filter(Boolean);
  }

  if (
    descriptor.length > 1
    && descriptor[1]
    && typeof descriptor[1]
      === "object"
    && Array.isArray(
      descriptor[1].options,
    )
  ) {
    return descriptor[1]
      .options
      .map(clean)
      .filter(Boolean);
  }

  return [] as string[];
}

const REQUIRED_NODES = [
  "LoadImage",
  "VAELoader",
  "UNETLoader",
  "CLIPLoader",
  "LTXICLoRALoaderModelOnly",
  "CLIPTextEncode",
  "LTXVConditioning",
  "EmptyLTXVLatentVideo",
  "RepeatImageBatch",
  "LTXAddVideoICLoRAGuide",
  "LTXVImgToVideoInplace",
  "LTXVEmptyLatentAudio",
  "LTXVConcatAVLatent",
  "CFGGuider",
  "KSamplerSelect",
  "ManualSigmas",
  "RandomNoise",
  "SamplerCustomAdvanced",
  "LTXVSeparateAVLatent",
  "LTXVCropGuides",
  "VAEDecodeTiled",
  "LTXVAudioVAEDecode",
  "CreateVideo",
  "SaveVideo",
] as const;

const TRANSFORMER =
  "ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors";

const TEXT_ENCODER =
  "gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors";

const VIDEO_VAE =
  "ltx-2.5-video-vae-bf16.safetensors";

const AUDIO_VAE =
  "ltx-2.5-audio-vae-bf16.safetensors";

const INGREDIENTS_LORA =
  "LTX-2.x/Control-and-Editing/"
  + "ltx-2.3-22b-ic-lora-ingredients-0.9.safetensors";

const SAMPLER =
  "euler_ancestral_cfg_pp";

async function queueState(
  backend:
    Ltx25IngredientsBackendId,
  fetcher: Fetcher,
) {
  const profile =
    LTX25_INGREDIENTS_BACKEND_PROFILES[
      backend
    ];

  const response =
    await fetchWithTimeout(
      fetcher,
      `${profile.baseUrl}/queue`,
      {
        method: "GET",
        cache: "no-store",
      },
      10_000,
    );

  if (!response.ok) {
    throw new Error(
      `queue HTTP ${response.status}`,
    );
  }

  const queue =
    await response
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
    throw new Error(
      "Unreadable ComfyUI queue state.",
    );
  }

  return {
    running:
      queue.queue_running.length,
    pending:
      queue.queue_pending.length,
  };
}

export async function inspectLtx25IngredientsBackend(
  backend:
    Ltx25IngredientsBackendId,
  options: {
    fetcher?: Fetcher;
  } = {},
): Promise<Ltx25BackendProbe> {
  const fetcher =
    options.fetcher
    || (fetch as unknown as Fetcher);

  const profile =
    LTX25_INGREDIENTS_BACKEND_PROFILES[
      backend
    ];

  try {
    const queue =
      await queueState(
        backend,
        fetcher,
      );

    /*
     * LTX Production policy:
     *
     * Never intentionally enqueue this job behind
     * unrelated Comfy work. A busy backend is not
     * eligible for selection during this tick.
     */
    if (
      queue.running > 0
      || queue.pending > 0
    ) {
      return {
        backend,
        healthy: true,
        compatible: false,
        idle: false,
        reason:
          "comfy-queue-active",
        missingNodes: [],
        missingAssets: [],
        queueRunning:
          queue.running,
        queuePending:
          queue.pending,
      };
    }

    const info =
      new Map<string, any>();

    const missingNodes:
      string[] = [];

    for (
      const nodeName
      of REQUIRED_NODES
    ) {
      const response =
        await fetchWithTimeout(
          fetcher,
          (
            `${profile.baseUrl}`
            + `/object_info/${encodeURIComponent(nodeName)}`
          ),
          {
            method: "GET",
            cache: "no-store",
          },
          15_000,
        );

      if (!response.ok) {
        missingNodes.push(
          nodeName,
        );

        continue;
      }

      const payload =
        await response
          .json()
          .catch(() => null) as
            Record<string, any>
            | null;

      const body =
        payload?.[nodeName];

      if (!body) {
        missingNodes.push(
          nodeName,
        );

        continue;
      }

      info.set(
        nodeName,
        body,
      );
    }

    const missingAssets:
      string[] = [];

    if (
      !comboValues(
        info.get("UNETLoader"),
        "unet_name",
      ).includes(TRANSFORMER)
    ) {
      missingAssets.push(
        TRANSFORMER,
      );
    }

    if (
      !comboValues(
        info.get("CLIPLoader"),
        "clip_name",
      ).includes(TEXT_ENCODER)
    ) {
      missingAssets.push(
        TEXT_ENCODER,
      );
    }

    const vaes =
      comboValues(
        info.get("VAELoader"),
        "vae_name",
      );

    if (
      !vaes.includes(
        VIDEO_VAE,
      )
    ) {
      missingAssets.push(
        VIDEO_VAE,
      );
    }

    if (
      !vaes.includes(
        AUDIO_VAE,
      )
    ) {
      missingAssets.push(
        AUDIO_VAE,
      );
    }

    if (
      !comboValues(
        info.get(
          "LTXICLoRALoaderModelOnly",
        ),
        "lora_name",
      ).includes(
        INGREDIENTS_LORA,
      )
    ) {
      missingAssets.push(
        INGREDIENTS_LORA,
      );
    }

    if (
      !comboValues(
        info.get(
          "KSamplerSelect",
        ),
        "sampler_name",
      ).includes(
        SAMPLER,
      )
    ) {
      missingAssets.push(
        SAMPLER,
      );
    }

    const compatible =
      !missingNodes.length
      && !missingAssets.length;

    return {
      backend,
      healthy: true,
      compatible,
      idle: compatible,
      reason:
        compatible
          ? "ready"
          : "ltx25-contract-missing",
      missingNodes,
      missingAssets,
      queueRunning: 0,
      queuePending: 0,
    };
  } catch (error) {
    return {
      backend,
      healthy: false,
      compatible: false,
      idle: false,
      reason:
        error instanceof Error
          ? error.message
          : "backend probe failed",
      missingNodes: [],
      missingAssets: [],
      queueRunning: 0,
      queuePending: 0,
    };
  }
}

export async function uploadLtx25IngredientsSheet(
  input: {
    backend:
      Ltx25IngredientsBackendId;
    sourcePath: string;
    uploadName: string;
    fetcher?: Fetcher;
  },
) {
  const fetcher =
    input.fetcher
    || (fetch as unknown as Fetcher);

  const profile =
    LTX25_INGREDIENTS_BACKEND_PROFILES[
      input.backend
    ];

  const bytes =
    await fs.readFile(
      input.sourcePath,
    );

  const filename =
    `${safeSegment(input.uploadName)}.png`;

  const body =
    new FormData();

  body.append(
    "image",
    new Blob([bytes], {
      type: "image/png",
    }),
    filename,
  );

  body.append(
    "type",
    "input",
  );

  body.append(
    "overwrite",
    "true",
  );

  const response =
    await fetchWithTimeout(
      fetcher,
      `${profile.baseUrl}/upload/image`,
      {
        method: "POST",
        body,
      },
      60_000,
    );

  const text =
    await response
      .text()
      .catch(() => "");

  if (!response.ok) {
    throw new Error(
      (
        "Could not upload LTX Ingredients sheet: "
        + `HTTP ${response.status}: `
        + text.slice(0, 240)
      ),
    );
  }

  let payload:
    Record<string, unknown> = {};

  try {
    payload =
      text
        ? JSON.parse(text)
        : {};
  } catch {}

  const uploaded =
    clean(
      payload.name
      || payload.filename,
    );

  if (!uploaded) {
    throw new Error(
      "ComfyUI accepted the Ingredients upload but returned no filename.",
    );
  }

  return uploaded;
}

type LeaseSubmitter =
  typeof submitComfyPromptWithGpuLease;

export async function submitLtx25IngredientsPrompt(
  input: {
    backend:
      Ltx25IngredientsBackendId;
    graph:
      Ltx25IngredientsGraph;
    clientId: string;
    ownerId?: string;
    fetcher?: Fetcher;
    leaseSubmitter?:
      LeaseSubmitter;
    onBeforePromptPost?: (
      ) => Promise<void> | void;

    onPromptAccepted?: (
      promptId: string,
    ) => Promise<void> | void;
  },
) {
  const profile =
    LTX25_INGREDIENTS_BACKEND_PROFILES[
      input.backend
    ];

  const rawFetcher =
    input.fetcher
    || (fetch as unknown as Fetcher);

  /*
   * This wrapper executes from inside the shared
   * physical-Comfy submission mutex.
   *
   * Therefore the queue recheck happens immediately
   * before /prompt and LTX does not deliberately queue
   * behind another OTG Comfy submission.
   */
  const guardedFetcher:
    Fetcher =
      async (
        url,
        init = {},
      ) => {
        if (
          url
          === `${profile.baseUrl}/prompt`
        ) {
          const queue =
            await queueState(
              input.backend,
              rawFetcher,
            );

          if (
            queue.running > 0
            || queue.pending > 0
          ) {
            return new Response(
              JSON.stringify({
                code:
                  "ltx25_queue_busy",
                error:
                  `${profile.label} became busy before LTX prompt admission.`,
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
          if (
            input.onBeforePromptPost
          ) {
            await input.onBeforePromptPost();
          }
        }

        return rawFetcher(
          url,
          init,
        );
      };

  const leaseSubmitter =
    input.leaseSubmitter
    || submitComfyPromptWithGpuLease;

  let response:
    Response;

  try {
    response =
      await leaseSubmitter({
        baseUrl:
          profile.baseUrl,

        workerId:
          profile.workerId,

        ownerId:
          input.ownerId,

        purpose:
          "video",

        preSubmitCleanup:
          null,

        submitTimeoutMs:
          60_000,

        fetcher:
          (
            url: string,
            init: RequestInit,
          ) =>
            guardedFetcher(
              url,
              init,
            ),

        init: {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",
          },

          body:
            JSON.stringify({
              prompt:
                input.graph,

              client_id:
                input.clientId,
            }),
        },

        onPromptAccepted:
          input.onPromptAccepted,
      });
  } catch (error) {
    throw new Ltx25SubmissionUnknownError(
      (
        "LTX Comfy submission transport failed before "
        + "a readable acceptance response was returned: "
        + (
          error instanceof Error
            ? error.message
            : String(error)
        )
      ),
    );
  }

  const text =
    await response
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

  if (!response.ok) {
    if (
      response.status === 409
      && payload.code
        === "ltx25_queue_busy"
    ) {
      throw new Ltx25BackendBusyError(
        input.backend,
        clean(payload.error),
      );
    }

    throw new Error(
      (
        `ComfyUI rejected LTX prompt with HTTP ${response.status}: `
        + (
          clean(payload.error)
          || clean(payload.message)
          || text.slice(0, 300)
          || "unknown error"
        )
      ),
    );
  }

  const promptId =
    clean(
      payload.prompt_id
      || payload.promptId,
    );

  if (!promptId) {
    throw new Ltx25SubmissionUnknownError(
      "ComfyUI returned a successful but unreadable LTX prompt response; submission acceptance is ambiguous.",
    );
  }

  return {
    promptId,
    payload,
  };
}

function collectFiles(
  value: unknown,
  nodeId?: string,
  output:
    Ltx25ComfyHistoryFile[] = [],
) {
  if (
    !value
    || typeof value !== "object"
  ) {
    return output;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectFiles(
        item,
        nodeId,
        output,
      );
    }

    return output;
  }

  const record =
    value as
      Record<string, unknown>;

  const filename =
    clean(record.filename);

  if (filename) {
    output.push({
      filename,
      subfolder:
        clean(
          record.subfolder,
        ) || undefined,
      type:
        clean(record.type)
        || undefined,
      nodeId,
    });
  }

  for (
    const [
      key,
      nested,
    ]
    of Object.entries(record)
  ) {
    collectFiles(
      nested,
      nodeId || key,
      output,
    );
  }

  return output;
}

export async function getLtx25IngredientsPromptHistory(
  input: {
    backend:
      Ltx25IngredientsBackendId;
    promptId: string;
    fetcher?: Fetcher;
  },
): Promise<Ltx25PromptHistory | null> {
  const fetcher =
    input.fetcher
    || (fetch as unknown as Fetcher);

  const profile =
    LTX25_INGREDIENTS_BACKEND_PROFILES[
      input.backend
    ];

  const response =
    await fetchWithTimeout(
      fetcher,
      (
        `${profile.baseUrl}`
        + `/history/${encodeURIComponent(input.promptId)}`
      ),
      {
        method: "GET",
        cache: "no-store",
      },
      15_000,
    );

  if (!response.ok) {
    throw new Error(
      `ComfyUI history returned HTTP ${response.status}.`,
    );
  }

  const payload =
    await response
      .json()
      .catch(() => null) as
        Record<string, any>
        | null;

  const entry =
    payload?.[
      input.promptId
    ];

  if (!entry) {
    return null;
  }

  const status =
    (
      entry.status
      && typeof entry.status
        === "object"
    )
      ? entry.status
      : {};

  const statusString =
    clean(
      status.status_str,
    ).toLowerCase();

  const completed =
    status.completed === true;

  const messages =
    Array.isArray(
      status.messages,
    )
      ? status.messages
      : [];

  const failed =
    statusString === "error"
    || statusString === "failed"
    || messages.some(
      (message: unknown) =>
        JSON.stringify(message)
          .includes(
            "execution_error",
          ),
    );

  return {
    exists: true,
    completed,
    failed,
    status,
    files:
      collectFiles(
        entry.outputs || {},
      ),
  };
}

export async function downloadLtx25IngredientsVideo(
  input: {
    backend:
      Ltx25IngredientsBackendId;
    file:
      Ltx25ComfyHistoryFile;
    destinationPath: string;
    fetcher?: Fetcher;
  },
) {
  const fetcher =
    input.fetcher
    || (fetch as unknown as Fetcher);

  const profile =
    LTX25_INGREDIENTS_BACKEND_PROFILES[
      input.backend
    ];

  const url =
    new URL(
      `${profile.baseUrl}/view`,
    );

  url.searchParams.set(
    "filename",
    input.file.filename,
  );

  if (input.file.subfolder) {
    url.searchParams.set(
      "subfolder",
      input.file.subfolder,
    );
  }

  url.searchParams.set(
    "type",
    input.file.type
      || "output",
  );

  const response =
    await fetchWithTimeout(
      fetcher,
      url.toString(),
      {
        method: "GET",
      },
      120_000,
    );

  if (!response.ok) {
    throw new Error(
      `Could not download LTX output: HTTP ${response.status}.`,
    );
  }

  const bytes =
    Buffer.from(
      await response.arrayBuffer(),
    );

  const destinationPath =
    path.resolve(
      input.destinationPath,
    );

  ensureDir(
    path.dirname(
      destinationPath,
    ),
  );

  await fs.writeFile(
    destinationPath,
    bytes,
  );

  return {
    destinationPath,
    bytes:
      bytes.length,
  };
}
