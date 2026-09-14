import {
  NextRequest,
  NextResponse,
} from "next/server";
import fs from "node:fs";
import path from "node:path";
import {
  randomInt,
  randomUUID,
} from "node:crypto";

import {
  ASSET_IMAGE_MODELS,
  type AssetImageModelId,
} from "@/lib/assets/imageModelCatalog";
import {
  getOwnerContext,
  SessionInvalidError,
} from "@/lib/ownerKey";
import {
  submitComfyPromptWith5060Lease,
} from "@/lib/workers/comfyPromptLease";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OUTPUT_WIDTH = 1024;
const OUTPUT_HEIGHT = 1024;
const MAGE_INTERNAL_WIDTH = 1088;

const BACKEND_PROBE_TIMEOUT_MS = 12_000;
const SUBMIT_TIMEOUT_MS = 30_000;

type ModelConfig = {
  id: AssetImageModelId;
  label: string;
  workflowFile: string;
  outputNodeId: string;
  requiredNodes: string[];
  requirements: {
    unet: string;
    clip: string;
    vae: string;
  };
  preferredBackend:
    | "image-primary"
    | "local-3090";
};

const MODEL_CONFIG: Record<
  AssetImageModelId,
  ModelConfig
> = {
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
      unet:
        "ernie-image-turbo.safetensors",
      clip:
        "ministral-3-3b.safetensors",
      vae:
        "flux2-vae.safetensors",
    },
    preferredBackend:
      "image-primary",
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
      unet:
        "z_image_turbo_bf16.safetensors",
      clip:
        "qwen_3_4b.safetensors",
      vae:
        "ae.safetensors",
    },
    preferredBackend:
      "image-primary",
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
      unet:
        "krea2_turbo_fp8_scaled.safetensors",
      clip:
        "qwen3vl_4b_fp8_scaled.safetensors",
      vae:
        "qwen_image_vae.safetensors",
    },
    preferredBackend:
      "image-primary",
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
      unet:
        "boogu_image_turbo_fp8_scaled.safetensors",
      clip:
        "qwen3vl_8b_fp8_scaled.safetensors",
      vae:
        "ae.safetensors",
    },
    preferredBackend:
      "image-primary",
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
      unet:
        "mage_flow_turbo_int8_convrot.safetensors",
      clip:
        "qwen3vl_4b_bf16.safetensors",
      vae:
        "mage_flow_vae_bf16.safetensors",
    },
    preferredBackend:
      "local-3090",
  },
};

const supportCache = new Map<
  string,
  {
    expiresAt: number;
    objectInfo: Record<string, any>;
  }
>();

function noStore(
  payload: unknown,
  init?: ResponseInit,
) {
  return NextResponse.json(payload, {
    ...init,
    headers: {
      "Cache-Control":
        "private, no-store",
      ...(init?.headers || {}),
    },
  });
}

function normalizeBaseUrl(
  value: unknown,
) {
  return String(value || "")
    .trim()
    .replace(/\/+$/, "");
}

function imagePrimaryBaseUrl() {
  return normalizeBaseUrl(
    process.env
      .OTG_ASSET_IMAGE_COMFY_URL ||
      process.env
        .OTG_CHARACTER_IMAGE_COMFY_URL ||
      process.env.COMFYUI_IMAGE_URL ||
      process.env.COMFY_IMAGE_BASE_URL ||
      process.env.COMFY_BASE_URL ||
      process.env.COMFYUI_URL ||
      "",
  );
}

function local3090BaseUrl(
  request: NextRequest,
) {
  return normalizeBaseUrl(
    process.env
      .OTG_ASSET_MAGE_COMFY_URL ||
      process.env
        .OTG_CHARACTER_MAGE_COMFY_URL ||
      process.env
        .OTG_CHARACTER_IMAGE_FALLBACK_COMFY_URL ||
      `http://${request.nextUrl.hostname}:8188`,
  );
}

function randomSeed() {
  return randomInt(
    0,
    281_474_976_710_000,
  );
}

function asRecord(
  value: unknown,
): Record<string, any> {
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

  if (
    !node ||
    typeof node !== "object"
  ) {
    throw new Error(
      `Workflow node ${id} is missing.`,
    );
  }

  if (
    !node.inputs ||
    typeof node.inputs !== "object"
  ) {
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
  const node = getNode(
    graph,
    nodeId,
  );

  node.inputs[key] = value;
}

function replaceOutputWithPreview(
  graph: Record<string, any>,
  nodeId: string,
  imageSource?: [
    string,
    number,
  ],
) {
  const current = getNode(
    graph,
    nodeId,
  );

  const source =
    imageSource ||
    (Array.isArray(
      current.inputs?.images,
    )
      ? current.inputs.images
      : null);

  if (!source) {
    throw new Error(
      `Workflow output node ${nodeId} has no image source.`,
    );
  }

  graph[nodeId] = {
    inputs: {
      images: source,
    },
    class_type:
      "PreviewImage",
    _meta: {
      title:
        "OTG Asset Candidate Preview",
    },
  };
}

function loadWorkflow(
  config: ModelConfig,
) {
  const absolute = path.join(
    process.cwd(),
    config.workflowFile,
  );

  if (!fs.existsSync(absolute)) {
    throw new Error(
      `Asset workflow file is missing: ${config.workflowFile}`,
    );
  }

  return asRecord(
    JSON.parse(
      fs.readFileSync(
        absolute,
        "utf8",
      ),
    ),
  );
}

function buildAssetPrompt(args: {
  name: string;
  prompt: string;
  artStyle: string;
}) {
  return [
    args.prompt.trim(),
    args.artStyle
      ? `Visual style: ${args.artStyle.trim()}`
      : "",
    `Asset identity name: ${args.name.trim()}`,
    "Create exactly one isolated reusable production object, prop, vehicle, device, item, or other non-character production asset",
    "center the complete asset in frame and keep the full object visible with comfortable margin around it",
    "simple clean neutral studio background suitable for later isolation and production compositing",
    "do not create an environmental scene around the asset",
    "do not create duplicate copies, repeated versions, mirrored copies, or a collection of the same object",
    "preserve clear stable shape, proportions, materials, colors, markings, and continuity-critical visible details",
    "clean production reference image",
    "no crop",
    "no watermark",
    "no visible text or logo unless the user's description explicitly requests that design detail",
  ]
    .filter(Boolean)
    .join(". ");
}

function assetNegativePrompt() {
  return [
    "duplicate asset",
    "multiple copies",
    "repeated object",
    "mirrored duplicate",
    "collection of objects",
    "cropped object",
    "cut off object",
    "cluttered scene",
    "large surrounding environment",
    "watermark",
  ].join(", ");
}

function mutateWorkflow(args: {
  graph: Record<string, any>;
  config: ModelConfig;
  prompt: string;
  seed: number;
}) {
  const {
    graph,
    config,
    prompt,
    seed,
  } = args;

  switch (config.id) {
    case "ernie-image":
      setInput(
        graph,
        "88:94",
        "value",
        prompt,
      );
      setInput(
        graph,
        "88:96",
        "value",
        false,
      );
      setInput(
        graph,
        "88:71",
        "width",
        OUTPUT_WIDTH,
      );
      setInput(
        graph,
        "88:71",
        "height",
        OUTPUT_HEIGHT,
      );
      setInput(
        graph,
        "88:70",
        "seed",
        seed,
      );
      replaceOutputWithPreview(
        graph,
        config.outputNodeId,
      );
      break;

    case "z-image":
      setInput(
        graph,
        "57:27",
        "text",
        prompt,
      );
      setInput(
        graph,
        "57:13",
        "width",
        OUTPUT_WIDTH,
      );
      setInput(
        graph,
        "57:13",
        "height",
        OUTPUT_HEIGHT,
      );
      setInput(
        graph,
        "57:3",
        "seed",
        seed,
      );
      replaceOutputWithPreview(
        graph,
        config.outputNodeId,
      );
      break;

    case "krea-2":
      setInput(
        graph,
        "30:19",
        "value",
        prompt,
      );
      setInput(
        graph,
        "30:24",
        "value",
        false,
      );
      setInput(
        graph,
        "30:5",
        "width",
        OUTPUT_WIDTH,
      );
      setInput(
        graph,
        "30:5",
        "height",
        OUTPUT_HEIGHT,
      );
      setInput(
        graph,
        "30:3",
        "seed",
        seed,
      );
      replaceOutputWithPreview(
        graph,
        config.outputNodeId,
      );
      break;

    case "boogu":
      setInput(
        graph,
        "34:11",
        "text",
        prompt,
      );
      setInput(
        graph,
        "34:8",
        "width",
        OUTPUT_WIDTH,
      );
      setInput(
        graph,
        "34:8",
        "height",
        OUTPUT_HEIGHT,
      );
      setInput(
        graph,
        "34:32",
        "seed",
        seed,
      );
      replaceOutputWithPreview(
        graph,
        config.outputNodeId,
      );
      break;

    case "mage-flow":
      setInput(
        graph,
        "12:5",
        "prompt",
        prompt,
      );
      setInput(
        graph,
        "12:5",
        "negative_prompt",
        assetNegativePrompt(),
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
      setInput(
        graph,
        "12:6",
        "seed",
        seed,
      );

      graph["900001"] = {
        inputs: {
          upscale_method:
            "lanczos",
          width: OUTPUT_WIDTH,
          height: OUTPUT_HEIGHT,
          crop: "disabled",
          image: [
            "12:8",
            0,
          ],
        },
        class_type:
          "ImageScale",
        _meta: {
          title:
            "OTG Exact 1024x1024 Asset Candidate",
        },
      };

      replaceOutputWithPreview(
        graph,
        config.outputNodeId,
        [
          "900001",
          0,
        ],
      );
      break;
  }

  return graph;
}

async function fetchJsonWithTimeout(
  url: string,
  timeoutMs: number,
) {
  const controller =
    new AbortController();

  const timer = setTimeout(
    () =>
      controller.abort(),
    timeoutMs,
  );

  try {
    const response =
      await fetch(url, {
        cache: "no-store",
        signal:
          controller.signal,
      });

    if (!response.ok) {
      throw new Error(
        `${url} returned HTTP ${response.status}.`,
      );
    }

    return asRecord(
      await response.json(),
    );
  } finally {
    clearTimeout(timer);
  }
}

async function objectInfo(
  baseUrl: string,
) {
  const cached =
    supportCache.get(baseUrl);

  if (
    cached &&
    cached.expiresAt >
      Date.now()
  ) {
    return cached.objectInfo;
  }

  const info =
    await fetchJsonWithTimeout(
      `${baseUrl}/object_info`,
      BACKEND_PROBE_TIMEOUT_MS,
    );

  supportCache.set(
    baseUrl,
    {
      expiresAt:
        Date.now() + 30_000,
      objectInfo: info,
    },
  );

  return info;
}

function loaderChoices(
  info: Record<string, any>,
  loader: string,
  inputName: string,
) {
  const value =
    info?.[loader]?.input
      ?.required?.[inputName]?.[0];

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
      reason:
        "Backend URL is not configured.",
    };
  }

  try {
    const info =
      await objectInfo(baseUrl);

    for (
      const node of
      config.requiredNodes
    ) {
      if (!info[node]) {
        return {
          ok: false,
          reason:
            `Required ComfyUI node is missing: ${node}`,
        };
      }
    }

    const unets =
      loaderChoices(
        info,
        "UNETLoader",
        "unet_name",
      );

    const clips =
      loaderChoices(
        info,
        "CLIPLoader",
        "clip_name",
      );

    const vaes =
      loaderChoices(
        info,
        "VAELoader",
        "vae_name",
      );

    if (
      !unets.includes(
        config.requirements.unet,
      )
    ) {
      return {
        ok: false,
        reason:
          `Required diffusion model is missing: ${config.requirements.unet}`,
      };
    }

    if (
      !clips.includes(
        config.requirements.clip,
      )
    ) {
      return {
        ok: false,
        reason:
          `Required text encoder is missing: ${config.requirements.clip}`,
      };
    }

    if (
      !vaes.includes(
        config.requirements.vae,
      )
    ) {
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
        error?.message ||
        String(error),
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
    const probe =
      await validateBackend(
        local3090,
        config,
      );

    if (!probe.ok) {
      throw new Error(
        `${config.label} requires the local 3090 Asset backend, but it is unavailable: ${probe.reason}`,
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
      label:
        "local-3090-fallback",
      baseUrl: local3090,
      fallbackUsed: true,
      primaryFailure:
        primaryProbe.reason,
    };
  }

  throw new Error(
    `${config.label} is unavailable on both Asset image backends. ` +
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
    () =>
      controller.abort(),
    SUBMIT_TIMEOUT_MS,
  );

  try {
    const response =
      await submitComfyPromptWith5060Lease({
        baseUrl,
        workerId:
          "api-assets-create-image",
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
              `otg-asset-${randomUUID()}`,
          }),
          signal:
            controller.signal,
        },
      });

    const responseText =
      await response.text();

    let json:
      Record<string, any> = {};

    try {
      json = responseText
        ? asRecord(
            JSON.parse(
              responseText,
            ),
          )
        : {};
    } catch {
      json = {};
    }

    if (!response.ok) {
      throw new Error(
        String(
          json?.error ||
            json?.node_errors ||
            responseText ||
            `ComfyUI prompt submission failed (${response.status}).`,
        ),
      );
    }

    const promptId =
      String(
        json.prompt_id ||
          json.promptId ||
          "",
      ).trim();

    if (!promptId) {
      throw new Error(
        "ComfyUI accepted the Asset request but returned no prompt id.",
      );
    }

    return promptId;
  } finally {
    clearTimeout(timer);
  }
}

function validModel(
  value: unknown,
): value is AssetImageModelId {
  return ASSET_IMAGE_MODELS.some(
    (model) =>
      model.id === value,
  );
}

function validationError(
  error: string,
) {
  return noStore(
    {
      ok: false,
      error,
    },
    {
      status: 400,
    },
  );
}

export async function POST(
  request: NextRequest,
) {
  try {
    /*
     * Authentication can consume a request stream.
     * Clone first so JSON parsing stays independent.
     */
    const bodyRequest =
      request.clone();

    await getOwnerContext(
      request,
    );

    const body =
      asRecord(
        await bodyRequest.json(),
      );

    if (
      !validModel(body.model)
    ) {
      return validationError(
        "Invalid Asset image model.",
      );
    }

    const name =
      String(
        body.name || "",
      ).trim();

    const prompt =
      String(
        body.prompt || "",
      ).trim();

    const artStyle =
      String(
        body.artStyle || "",
      ).trim();

    if (!name) {
      return validationError(
        "Asset Name is required.",
      );
    }

    if (name.length > 120) {
      return validationError(
        "Asset Name is too long.",
      );
    }

    if (!prompt) {
      return validationError(
        "Asset prompt is required.",
      );
    }

    if (
      prompt.length > 4000
    ) {
      return validationError(
        "Asset prompt is too long.",
      );
    }

    if (
      artStyle.length > 200
    ) {
      return validationError(
        "Asset art style is too long.",
      );
    }

    const config =
      MODEL_CONFIG[body.model];

    const seed =
      randomSeed();

    const finalPrompt =
      buildAssetPrompt({
        name,
        prompt,
        artStyle,
      });

    const graph =
      mutateWorkflow({
        graph:
          loadWorkflow(config),
        config,
        prompt:
          finalPrompt,
        seed,
      });

    /*
     * Backend selection finishes before POST /prompt.
     * Never fail over after submission starts because a lost
     * response could otherwise create duplicate work.
     */
    const backend =
      await chooseBackend(
        request,
        config,
      );

    // OTG_ASSET_KREA2_SAVE_OUTPUT_FIX_V2
    //
    // The generic Asset candidate path converts the configured image
    // output node from SaveImage to PreviewImage. Krea 2 also contains
    // PreviewAny node 30:20, which then becomes the only executed output.
    // Restore the actual Krea image output before POST /prompt.
    if (config.id === "krea-2") {
      const kreaOutputNode = graph[config.outputNodeId];

      if (!kreaOutputNode || typeof kreaOutputNode !== "object") {
        throw new Error(
          `Krea 2 output contract mismatch: node ${config.outputNodeId} is missing.`,
        );
      }

      const existingInputs =
        kreaOutputNode.inputs && typeof kreaOutputNode.inputs === "object"
          ? kreaOutputNode.inputs
          : {};

      const existingMeta =
        kreaOutputNode._meta && typeof kreaOutputNode._meta === "object"
          ? kreaOutputNode._meta
          : {};

      kreaOutputNode.class_type = "SaveImage";
      kreaOutputNode.inputs = {
        ...existingInputs,
        filename_prefix: `OTG_Asset_Krea2_${Date.now()}`,
      };
      kreaOutputNode._meta = {
        ...existingMeta,
        title: "OTG Asset Krea 2 Candidate Save",
      };
    }
    const promptId =
      await submitPrompt(
        backend.baseUrl,
        graph,
      );

    return noStore({
      ok: true,
      promptId,
      prompt_id:
        promptId,
      assetName: name,
      model:
        config.id,
      modelLabel:
        config.label,
      artStyle,
      seed,
      width:
        OUTPUT_WIDTH,
      height:
        OUTPUT_HEIGHT,
      aspectRatio: "1:1",
      outputNodeId:
        config.outputNodeId,
      comfyBaseUrl:
        backend.baseUrl,
      backend:
        backend.label,
      fallbackUsed:
        backend.fallbackUsed,
      temporaryCandidate:
        true,
    });
  } catch (error) {
    if (
      error instanceof
      SessionInvalidError
    ) {
      return noStore(
        {
          ok: false,
          error:
            "Unauthorized",
        },
        {
          status: 401,
        },
      );
    }

    return noStore(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Asset image generation failed.",
      },
      {
        status: 502,
      },
    );
  }
}
