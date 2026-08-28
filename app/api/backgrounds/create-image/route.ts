import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { randomInt, randomUUID } from "node:crypto";
import { submitComfyPromptWith5060Lease } from "@/lib/workers/comfyPromptLease";
import { SessionInvalidError } from "@/lib/ownerKey";
import { requireSessionUser } from "@/lib/sessionUser";

// OTG_BACKGROUND_STUDIO_FIVE_MODEL_CREATE_V1

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OUTPUT_WIDTH = 1280;
const OUTPUT_HEIGHT = 720;
const MAGE_INTERNAL_WIDTH = 1280;
const BACKEND_PROBE_TIMEOUT_MS = 12_000;
const SUBMIT_TIMEOUT_MS = 30_000;

type BackgroundCreateModelId =
  | "ernie-image"
  | "z-image"
  | "krea-2"
  | "boogu"
  | "mage-flow";

type ModelConfig = {
  id: BackgroundCreateModelId;
  label: string;
  workflowFile: string;
  outputNodeId: string;
  requiredNodes: string[];
  requirements: {
    unet: string;
    clip: string;
    vae: string;
  };
  preferredBackend: "image-primary" | "local-3090";
};

const MODEL_CONFIG: Record<BackgroundCreateModelId, ModelConfig> = {
  "ernie-image": {
    id: "ernie-image",
    label: "Ernie Image",
    workflowFile:
      "workflows/characters/create/image_ernie_image_turbo.json",
    outputNodeId: "73",
    requiredNodes: [
      "UNETLoader",
      "CLIPLoader",
      "VAELoader",
      "EmptyFlux2LatentImage",
      "KSampler",
      "VAEDecode",
      "PreviewImage",
    ],
    requirements: {
      unet: "ernie-image-turbo.safetensors",
      clip: "ministral-3-3b.safetensors",
      vae: "flux2-vae.safetensors",
    },
    preferredBackend: "image-primary",
  },

  "z-image": {
    id: "z-image",
    label: "Z Image",
    workflowFile:
      "workflows/characters/create/image_z_image_turbo.json",
    outputNodeId: "9",
    requiredNodes: [
      "UNETLoader",
      "CLIPLoader",
      "VAELoader",
      "EmptySD3LatentImage",
      "ModelSamplingAuraFlow",
      "KSampler",
      "VAEDecode",
      "PreviewImage",
    ],
    requirements: {
      unet: "z_image_turbo_bf16.safetensors",
      clip: "qwen_3_4b.safetensors",
      vae: "ae.safetensors",
    },
    preferredBackend: "image-primary",
  },

  "krea-2": {
    id: "krea-2",
    label: "Krea 2",
    workflowFile:
      "workflows/characters/create/image_krea2_turbo_t2i.json",
    outputNodeId: "29",
    requiredNodes: [
      "UNETLoader",
      "CLIPLoader",
      "VAELoader",
      "EmptyLatentImage",
      "ComfySwitchNode",
      "KSampler",
      "VAEDecode",
      "PreviewImage",
    ],
    requirements: {
      unet: "krea2_turbo_fp8_scaled.safetensors",
      clip: "qwen3vl_4b_fp8_scaled.safetensors",
      vae: "qwen_image_vae.safetensors",
    },
    preferredBackend: "image-primary",
  },

  boogu: {
    id: "boogu",
    label: "Boogu",
    workflowFile:
      "workflows/characters/create/image_boogu_image_0_1_turbo_t2i.json",
    outputNodeId: "33",
    requiredNodes: [
      "UNETLoader",
      "CLIPLoader",
      "VAELoader",
      "EmptyLatentImage",
      "KSampler",
      "VAEDecode",
      "PreviewImage",
    ],
    requirements: {
      unet: "boogu_image_turbo_fp8_scaled.safetensors",
      clip: "qwen3vl_8b_fp8_scaled.safetensors",
      vae: "ae.safetensors",
    },
    preferredBackend: "image-primary",
  },

  "mage-flow": {
    id: "mage-flow",
    label: "Mage Flow",
    workflowFile:
      "workflows/characters/create/image_mage_flow_turbo_t2i_int8.json",
    outputNodeId: "10",
    requiredNodes: [
      "UNETLoader",
      "CLIPLoader",
      "VAELoader",
      "TextEncodeMageFlowEdit",
      "KSampler",
      "VAEDecode",
      "ImageScale",
      "PreviewImage",
    ],
    requirements: {
      unet: "mage_flow_turbo_int8_convrot.safetensors",
      clip: "qwen3vl_4b_bf16.safetensors",
      vae: "mage_flow_vae_bf16.safetensors",
    },
    preferredBackend: "image-primary",
  },
};

const BACKGROUND_NEGATIVE_PROMPT = [
  "characters, people, person",
  "face",
  "body",
  "portrait",
  "text",
  "captions",
  "watermark",
  "logo",
  "blurry",
  "low quality",
  "vertical frame",
].join(", ");

const BACKGROUND_STRUCTURE_RULE = [
  "Create a reusable production background environment.",
  "Landscape 16:9 composition.",
  "Exact target output is 1280x720.",
  "Use a horizontal wide environment composition.",
  "Environment only.",
  "Do not generate characters or people.",
  "Do not generate a portrait or vertical frame.",
  "Do not render captions, logos, watermarks, or visible text.",
].join(" ");

function normalizeBaseUrl(value: string) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function imagePrimaryBaseUrl() {
  return normalizeBaseUrl(
    process.env.OTG_CHARACTER_IMAGE_COMFY_URL ||
      process.env.COMFYUI_IMAGE_URL ||
      process.env.COMFY_BASE_URL ||
      process.env.COMFYUI_URL ||
      "",
  );
}

function local3090BaseUrl(request: NextRequest) {
  return normalizeBaseUrl(
    process.env.OTG_CHARACTER_MAGE_COMFY_URL ||
      process.env.OTG_CHARACTER_IMAGE_FALLBACK_COMFY_URL ||
      `http://${request.nextUrl.hostname}:8188`,
  );
}

function randomSeed() {
  return randomInt(0, 281_474_976_710_000);
}

function asRecord(value: unknown): Record<string, any> {
  return value &&
    typeof value === "object" &&
    !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
}

function getNode(
  graph: Record<string, any>,
  id: string,
) {
  const node = graph[id];

  if (!node || typeof node !== "object") {
    throw new Error(
      `Background workflow node ${id} is missing.`,
    );
  }

  if (!node.inputs || typeof node.inputs !== "object") {
    node.inputs = {};
  }

  return node;
}

function setInput(
  graph: Record<string, any>,
  nodeId: string,
  key: string,
  value: unknown,
) {
  const node = getNode(graph, nodeId);
  node.inputs[key] = value;
}

function replaceOutputWithPreview(
  graph: Record<string, any>,
  nodeId: string,
  imageSource?: [string, number],
) {
  const current = getNode(graph, nodeId);

  const source =
    imageSource ||
    (
      Array.isArray(current.inputs?.images)
        ? current.inputs.images
        : null
    );

  if (!source) {
    throw new Error(
      `Background workflow output node ${nodeId} has no image source.`,
    );
  }

  graph[nodeId] = {
    inputs: {
      images: source,
    },
    class_type: "PreviewImage",
    _meta: {
      title: "OTG Background Candidate Preview",
    },
  };
}

function loadWorkflow(config: ModelConfig) {
  const absolute = path.join(
    process.cwd(),
    config.workflowFile,
  );

  if (!fs.existsSync(absolute)) {
    throw new Error(
      `Background workflow file is missing: ${config.workflowFile}`,
    );
  }

  return asRecord(
    JSON.parse(
      fs.readFileSync(absolute, "utf8"),
    ),
  );
}

function buildPrompt(value: string) {
  const prompt = String(value || "").trim();

  return [
    prompt,
    BACKGROUND_STRUCTURE_RULE,
  ]
    .filter(Boolean)
    .join(" ");
}

function buildNegativePrompt(value: unknown) {
  const requested = String(value || "").trim();

  return [
    BACKGROUND_NEGATIVE_PROMPT,
    requested,
  ]
    .filter(Boolean)
    .join(", ");
}

function mutateWorkflow(args: {
  graph: Record<string, any>;
  config: ModelConfig;
  prompt: string;
  negativePrompt: string;
  seed: number;
}) {
  const {
    graph,
    config,
    prompt,
    negativePrompt,
    seed,
  } = args;

  switch (config.id) {
    case "ernie-image":
      setInput(graph, "88:94", "value", prompt);
      setInput(graph, "88:96", "value", false);
      setInput(graph, "88:71", "width", OUTPUT_WIDTH);
      setInput(graph, "88:71", "height", OUTPUT_HEIGHT);
      setInput(graph, "88:70", "seed", seed);
      replaceOutputWithPreview(
        graph,
        config.outputNodeId,
      );
      break;

    case "z-image":
      setInput(graph, "57:27", "text", prompt);
      setInput(graph, "57:13", "width", OUTPUT_WIDTH);
      setInput(graph, "57:13", "height", OUTPUT_HEIGHT);
      setInput(graph, "57:3", "seed", seed);
      replaceOutputWithPreview(
        graph,
        config.outputNodeId,
      );
      break;

    case "krea-2":
      setInput(graph, "30:19", "value", prompt);
      setInput(graph, "30:24", "value", false);
      setInput(graph, "30:5", "width", OUTPUT_WIDTH);
      setInput(graph, "30:5", "height", OUTPUT_HEIGHT);
      setInput(graph, "30:3", "seed", seed);
      replaceOutputWithPreview(
        graph,
        config.outputNodeId,
      );
      break;

    case "boogu":
      setInput(graph, "34:11", "text", prompt);
      setInput(graph, "34:8", "width", OUTPUT_WIDTH);
      setInput(graph, "34:8", "height", OUTPUT_HEIGHT);
      setInput(graph, "34:32", "seed", seed);
      replaceOutputWithPreview(
        graph,
        config.outputNodeId,
      );
      break;

    case "mage-flow":
      setInput(graph, "12:5", "prompt", prompt);
      setInput(
        graph,
        "12:5",
        "negative_prompt",
        negativePrompt,
      );
      setInput(
        graph,
        "12:5",
        "width",
        MAGE_INTERNAL_WIDTH,
      );
      setInput(
        graph,
        "12:5",
        "height",
        OUTPUT_HEIGHT,
      );
      setInput(graph, "12:6", "seed", seed);

      graph["900001"] = {
        inputs: {
          upscale_method: "lanczos",
          width: OUTPUT_WIDTH,
          height: OUTPUT_HEIGHT,
          crop: "disabled",
          image: ["12:8", 0],
        },
        class_type: "ImageScale",
        _meta: {
          title: "OTG Exact 1280x720 Background Output",
        },
      };

      replaceOutputWithPreview(
        graph,
        config.outputNodeId,
        ["900001", 0],
      );
      break;
  }

  return graph;
}

async function fetchJsonWithTimeout(
  url: string,
  timeoutMs: number,
) {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    timeoutMs,
  );

  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(
        `${url} returned HTTP ${response.status}.`,
      );
    }

    return asRecord(await response.json());
  } finally {
    clearTimeout(timer);
  }
}

const supportCache = new Map<
  string,
  {
    expiresAt: number;
    objectInfo: Record<string, any>;
  }
>();

async function objectInfo(baseUrl: string) {
  const cached = supportCache.get(baseUrl);

  if (
    cached &&
    cached.expiresAt > Date.now()
  ) {
    return cached.objectInfo;
  }

  const info = await fetchJsonWithTimeout(
    `${baseUrl}/object_info`,
    BACKEND_PROBE_TIMEOUT_MS,
  );

  supportCache.set(baseUrl, {
    expiresAt: Date.now() + 30_000,
    objectInfo: info,
  });

  return info;
}

function loaderChoices(
  info: Record<string, any>,
  loader: string,
  inputName: string,
) {
  const value =
    info?.[loader]?.input?.required?.[inputName]?.[0];

  return Array.isArray(value)
    ? value.map(String)
    : [];
}

async function validateBackend(
  baseUrl: string,
  config: ModelConfig,
) {
  if (!baseUrl) {
    return {
      ok: false,
      reason: "Backend URL is not configured.",
    };
  }

  try {
    const info = await objectInfo(baseUrl);

    for (const node of config.requiredNodes) {
      if (!info[node]) {
        return {
          ok: false,
          reason:
            `Required ComfyUI node is missing: ${node}`,
        };
      }
    }

    const unets = loaderChoices(
      info,
      "UNETLoader",
      "unet_name",
    );

    const clips = loaderChoices(
      info,
      "CLIPLoader",
      "clip_name",
    );

    const vaes = loaderChoices(
      info,
      "VAELoader",
      "vae_name",
    );

    if (!unets.includes(config.requirements.unet)) {
      return {
        ok: false,
        reason:
          `Required diffusion model is missing: ${config.requirements.unet}`,
      };
    }

    if (!clips.includes(config.requirements.clip)) {
      return {
        ok: false,
        reason:
          `Required text encoder is missing: ${config.requirements.clip}`,
      };
    }

    if (!vaes.includes(config.requirements.vae)) {
      return {
        ok: false,
        reason:
          `Required VAE is missing: ${config.requirements.vae}`,
      };
    }

    return {
      ok: true,
      reason: "",
    };
  } catch (error: any) {
    return {
      ok: false,
      reason:
        error?.message || String(error),
    };
  }
}

async function chooseBackend(
  request: NextRequest,
  config: ModelConfig,
) {
  const imagePrimary =
    imagePrimaryBaseUrl();

  const local3090 =
    local3090BaseUrl(request);

  if (
    config.preferredBackend ===
    "local-3090"
  ) {
    const probe = await validateBackend(
      local3090,
      config,
    );

    if (!probe.ok) {
      throw new Error(
        `${config.label} requires the local 3090 image backend, but it is unavailable: ${probe.reason}`,
      );
    }

    return {
      label: "local-3090",
      baseUrl: local3090,
      fallbackUsed: false,
    };
  }

  const primaryProbe =
    await validateBackend(
      imagePrimary,
      config,
    );

  if (primaryProbe.ok) {
    return {
      label: "image-primary",
      baseUrl: imagePrimary,
      fallbackUsed: false,
    };
  }

  const fallbackProbe =
    await validateBackend(
      local3090,
      config,
    );

  if (fallbackProbe.ok) {
    return {
      label: "local-3090-fallback",
      baseUrl: local3090,
      fallbackUsed: true,
      primaryFailure:
        primaryProbe.reason,
    };
  }

  throw new Error(
    `${config.label} is unavailable on both Background image backends. ` +
      `Image primary: ${primaryProbe.reason} ` +
      `Local 3090: ${fallbackProbe.reason}`,
  );
}

async function submitPrompt(
  baseUrl: string,
  graph: Record<string, any>,
) {
  const controller =
    new AbortController();

  const timer = setTimeout(
    () => controller.abort(),
    SUBMIT_TIMEOUT_MS,
  );

  try {
    const response =
      await submitComfyPromptWith5060Lease({
        baseUrl,
        workerId:
          "api-background-create-image",
        init: {
          method: "POST",
          cache: "no-store",
          headers: {
            "Content-Type":
              "application/json",
          },
          body: JSON.stringify({
            prompt: graph,
            client_id:
              `otg-background-${randomUUID()}`,
          }),
          signal: controller.signal,
        },
      });

    const text =
      await response.text();

    let json:
      Record<string, any> = {};

    try {
      json = text
        ? asRecord(JSON.parse(text))
        : {};
    } catch {
      json = {};
    }

    if (!response.ok) {
      throw new Error(
        String(
          json?.error ||
            json?.node_errors ||
            text ||
            `ComfyUI prompt submission failed (${response.status}).`,
        ),
      );
    }

    const promptId = String(
      json.prompt_id ||
        json.promptId ||
        "",
    ).trim();

    if (!promptId) {
      throw new Error(
        "ComfyUI accepted the Background request but returned no prompt id.",
      );
    }

    return promptId;
  } finally {
    clearTimeout(timer);
  }
}

function validModel(
  value: unknown,
): value is BackgroundCreateModelId {
  return Object.prototype.hasOwnProperty.call(
    MODEL_CONFIG,
    String(value || ""),
  );
}

function safeFilenamePrefix(
  value: unknown,
) {
  const cleaned = String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);

  return cleaned || "background-preview";
}

export async function POST(
  request: NextRequest,
) {
  try {
    // Authentication may consume the incoming Request stream.
    // Clone first so JSON parsing has an independent body.
    const bodyRequest = request.clone();

    const owner = await requireSessionUser(request);
    if (owner.scope !== "user" || !owner.username) {
      throw new SessionInvalidError("An authenticated Background account is required.");
    }

    const body = asRecord(
      await bodyRequest.json(),
    );

    if (!validModel(body.model)) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Invalid Background image model.",
        },
        {
          status: 400,
          headers: {
            "Cache-Control": "no-store",
          },
        },
      );
    }

    const inputPrompt = String(
      body.prompt ||
        body.description ||
        "",
    ).trim();

    if (!inputPrompt) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Background prompt is required.",
        },
        {
          status: 400,
          headers: {
            "Cache-Control": "no-store",
          },
        },
      );
    }

    if (inputPrompt.length > 8000) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Background prompt is too long.",
        },
        {
          status: 400,
          headers: {
            "Cache-Control": "no-store",
          },
        },
      );
    }

    const config =
      MODEL_CONFIG[body.model];

    const seed = randomSeed();

    const prompt =
      buildPrompt(inputPrompt);

    const negativePrompt =
      buildNegativePrompt(
        body.negativePrompt,
      );

    const filenamePrefix =
      safeFilenamePrefix(
        body.filenamePrefix ||
          body.title ||
          body.name,
      );

    const graph = mutateWorkflow({
      graph: loadWorkflow(config),
      config,
      prompt,
      negativePrompt,
      seed,
    });

    // Backend selection completes before POST /prompt.
    // Never submit the same generation to both GPUs.
    const backend =
      await chooseBackend(
        request,
        config,
      );

    const promptId =
      await submitPrompt(
        backend.baseUrl,
        graph,
      );

    return NextResponse.json(
      {
        ok: true,
        promptId,
        prompt_id: promptId,
        model: config.id,
        modelLabel: config.label,
        seed,
        width: OUTPUT_WIDTH,
        height: OUTPUT_HEIGHT,
        orientation: "landscape",
        aspectRatio: "16:9",
        outputNodeId:
          config.outputNodeId,
        filenamePrefix,
        comfyBaseUrl:
          backend.baseUrl,
        backend:
          backend.label,
        fallbackUsed:
          backend.fallbackUsed,
        temporaryCandidate: true,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error: any) {
    const message =
      error?.message ||
      String(error);

    const status =
      /session|auth|unauthor/i.test(
        message,
      )
        ? 401
        : 502;

    return NextResponse.json(
      {
        ok: false,
        error: message,
      },
      {
        status,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  }
}
