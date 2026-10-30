import {
  NextRequest,
  NextResponse,
} from "next/server";
import fs from "node:fs";
import { buildMossWorkflow, MOSS_FILES, MOSS_REQUIRED_NODES, mossDimensions, mossSeed, mossTarget, mossOutputShape, MossInputError } from "@/lib/images/mossImage";
import { chooseMossBackend } from "@/lib/images/mossBackend";
import {NATIVE_CREATE_CONFIGS, isNativeImageModel, buildNativeImageGraph, nativeImageDimensions} from "@/lib/images/nativeImageModels";
import {chooseNativeImageBackend} from "@/lib/images/nativeImageBackend";
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
import {
  QWEN21_TURBO_CFG,
  QWEN21_TURBO_CONTRACT,
  QWEN21_TURBO_LORA,
  QWEN21_TURBO_STEPS,
} from "@/lib/imageGenerateWorkflows";

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
    lora?: string;
  };
  preferredBackend:
    | "image-primary"
    | "local-3090";
};

const MODEL_CONFIG: Record<
  AssetImageModelId,
  ModelConfig
> = {
  ...NATIVE_CREATE_CONFIGS,
  "moss-image-sft": {
    id: "moss-image-sft", label: "MOSS-Image SFT (INT8)",
    workflowFile: "workflows/characters/create/image_moss_image_sft_t2i.json",
    outputNodeId: "9", requiredNodes: MOSS_REQUIRED_NODES,
    requirements: MOSS_FILES, preferredBackend: "image-primary",
  },
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

  "qwen-image-2-1": {
    id: "qwen-image-2-1",
    label: QWEN21_TURBO_CONTRACT.label,
    workflowFile:
      "workflows/characters/create/image_qwen_image_2_1_t2i.json",
    outputNodeId: "461",
    requiredNodes: [
      "UNETLoader",
      "CLIPLoader",
      "VAELoader",
      "TextEncodeQwenImage21",
      "KSampler",
      "VAEDecode",
      "SaveImageAdvanced",
      "LoraLoaderModelOnly",
    ],
    requirements: {
      unet:
        "qwen_image_2.1_int8_convrot.safetensors",
      clip:
        "qwen3vl_8b_int8_convrot.safetensors",
      vae:
        "qwen_image_2.1_vae_bf16.safetensors",
      lora:
        QWEN21_TURBO_LORA,
    },
    preferredBackend:
      "image-primary",
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
  visualKind?: string;
}) {
  const kind = String(args.visualKind || "object").trim().toLowerCase();
  const locationKinds = new Set(["location", "environment", "storyboard", "scene_image", "shot_reference"]);
  const characterKinds = new Set(["character", "villain", "creature", "animal"]);
  const productionRules = locationKinds.has(kind)
    ? [
        "Create one complete cinematic environment or shot image matching the described story setting",
        "preserve the requested characters, location, atmosphere, composition, and story action",
        "do not replace the requested environment with a studio backdrop or isolated-object presentation",
      ]
    : characterKinds.has(kind)
      ? [
          "Create one complete production character reference matching the described identity",
          "keep the character fully readable and preserve continuity-critical appearance, wardrobe, and distinctive details",
          "do not add unrelated characters or replace the requested setting when one is specified",
        ]
      : [
          "Create exactly one isolated reusable production object, prop, vehicle, device, item, or other non-character production asset",
          "center the complete asset in frame and keep the full object visible with comfortable margin around it",
          "simple clean neutral studio background suitable for later isolation and production compositing",
          "do not create an environmental scene around the asset",
          "do not create duplicate copies, repeated versions, mirrored copies, or a collection of the same object",
        ];
  return [
    args.prompt.trim(),
    args.artStyle
      ? `Visual style: ${args.artStyle.trim()}`
      : "",
    `Asset identity name: ${args.name.trim()}`,
    ...productionRules,
    "preserve clear stable shape, proportions, materials, colors, markings, and continuity-critical visible details",
    "clean production reference image",
    "no crop",
    "no watermark",
    "no visible text or logo unless the user's description explicitly requests that design detail",
  ]
    .filter(Boolean)
    .join(". ");
}

function assetNegativePrompt(visualKind?: string) {
  const kind = String(visualKind || "object").trim().toLowerCase();
  const isEnvironment = new Set(["location", "environment", "storyboard", "scene_image", "shot_reference"]).has(kind);
  return [
    "duplicate asset",
    "multiple copies",
    "repeated object",
    "mirrored duplicate",
    "collection of objects",
    "cropped object",
    "cut off object",
    ...(isEnvironment ? [] : ["cluttered scene", "large surrounding environment"]),
    "watermark",
  ].join(", ");
}

function mutateWorkflow(args: {
  graph: Record<string, any>;
  config: ModelConfig;
  prompt: string;
  seed: number;
  visualKind?: string;
  persistOutput?: boolean;
  persistentOutputPrefix?: string;
}) {
  const {
    graph,
    config,
    prompt,
    seed,
    visualKind,
    persistOutput,
    persistentOutputPrefix,
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
        assetNegativePrompt(visualKind),
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

    case "qwen-image-2-1":
      setInput(
        graph,
        "452",
        "prompt",
        prompt,
      );
      setInput(
        graph,
        "452",
        "negative_prompt",
        assetNegativePrompt(visualKind),
      );
      setInput(
        graph,
        "456",
        "width",
        OUTPUT_WIDTH,
      );
      setInput(
        graph,
        "456",
        "height",
        OUTPUT_HEIGHT,
      );
      setInput(
        graph,
        "458",
        "seed",
        seed,
      );
      setInput(graph, "458", "steps", QWEN21_TURBO_STEPS);
      setInput(graph, "458", "cfg", QWEN21_TURBO_CFG);
      setInput(graph, "458", "sampler_name", QWEN21_TURBO_CONTRACT.sampling.sampler);
      setInput(graph, "458", "scheduler", QWEN21_TURBO_CONTRACT.sampling.scheduler);
      setInput(graph, "458", "denoise", QWEN21_TURBO_CONTRACT.sampling.denoise);
      if (
        String(graph?.["451"]?.inputs?.unet_name || "") !== QWEN21_TURBO_CONTRACT.checkpoint ||
        String(graph?.["453"]?.inputs?.clip_name || "") !== QWEN21_TURBO_CONTRACT.textEncoder ||
        String(graph?.["454"]?.inputs?.vae_name || "") !== QWEN21_TURBO_CONTRACT.vae ||
        String(graph?.["455"]?.inputs?.lora_name || "") !== QWEN21_TURBO_CONTRACT.acceleration.name ||
        Number(graph?.["455"]?.inputs?.strength_model) !== QWEN21_TURBO_CONTRACT.acceleration.strength
      ) {
        throw new Error("Qwen Image 2.1 Turbo workflow contract is not verified; generation was not submitted.");
      }
      if (persistOutput) {
        setInput(graph, config.outputNodeId, "filename_prefix", `otg_story/${persistentOutputPrefix || `qwen-${randomUUID()}`}`);
      } else {
        replaceOutputWithPreview(
          graph,
          config.outputNodeId,
        );
      }
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

    if (config.requirements.lora) {
      const loras =
        loaderChoices(
          info,
          "LoraLoaderModelOnly",
          "lora_name",
        );

      if (
        !loras.includes(
          config.requirements.lora,
        )
      ) {
        return {
          ok: false,
          reason:
            `Required LoRA is missing: ${config.requirements.lora}`,
        };
      }
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
  const mediaBackend=await (await import("@/lib/images/mediaGpuBackend")).chooseMediaImageBackend({
    primary3090:local3090,secondary5060:imagePrimary,allow5060:config.preferredBackend!=="local-3090",validate:base=>validateBackend(base,config)});
  if(mediaBackend)return mediaBackend;

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

  if (config.id === "qwen-image-2-1") {
    throw new Error(
      `${config.label} is unavailable on the required RTX 5060 Ti image backend: ${primaryProbe.reason}. ` +
      "Automatic fallback is disabled for this workflow.",
    );
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
  releaseIdlePeer = false,
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
        releaseIdlePeer,
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

    const startedAt = Date.now();

    const target = config.id === "moss-image-sft" ? await (await import("@/lib/images/mossBackend")).routeMossTarget(mossTarget(body.gpuTarget)) : null;
    const dimensions = isNativeImageModel(config.id) ? nativeImageDimensions("asset") : target ? mossDimensions(body.width, body.height, "asset") : { width: OUTPUT_WIDTH, height: OUTPUT_HEIGHT };
    const seed = target ? mossSeed(body.seed, randomSeed()) : randomSeed();

    const finalPrompt =
      buildAssetPrompt({
        name,
        prompt,
        artStyle,
        visualKind: String(body.visualKind || "object"),
      });

    const persistOutput = body.persistOutput === true;
    const persistentOutputPrefix = persistOutput && config.id === "qwen-image-2-1"
      ? `qwen-${randomUUID()}`
      : "";
    const graph =
      isNativeImageModel(config.id) ? buildNativeImageGraph({model: config.id, prompt: finalPrompt, ...dimensions, seed}) : target ? buildMossWorkflow({ prompt: finalPrompt, negativePrompt: String(body.negativePrompt || ""), ...dimensions, seed, target }) : mutateWorkflow({
        graph:
          loadWorkflow(config),
        config,
        prompt:
          finalPrompt,
        seed,
        visualKind: String(body.visualKind || "object"),
        persistOutput,
        persistentOutputPrefix,
      });

    /*
     * Backend selection finishes before POST /prompt.
     * Never fail over after submission starts because a lost
     * response could otherwise create duplicate work.
     */
    const backend =
      isNativeImageModel(config.id) ? await chooseNativeImageBackend(config.id) : target ? await chooseMossBackend(target) : await chooseBackend(
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
        target === "3090",
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
        dimensions.width,
      height:
        dimensions.height,
      ...(target ? mossOutputShape(dimensions.width, dimensions.height) : { aspectRatio: "1:1" }),
      outputNodeId:
        config.outputNodeId,
      comfyBaseUrl:
        backend.baseUrl,
      backend:
        backend.label,
      fallbackUsed:
        backend.fallbackUsed,
      temporaryCandidate:
        !persistOutput,
      persistentOutput:
        persistOutput,
      outputSubfolder:
        persistOutput ? "otg_story" : "",
      outputFilenamePrefix:
        persistentOutputPrefix,
      outputType:
        persistOutput ? "output" : "temp",
      workflowId: config.id === "qwen-image-2-1"
        ? "presets/image_qwen_image_2_1_t2i"
        : config.workflowFile,
      workflowFile: config.workflowFile,
      turbo: config.id === "qwen-image-2-1" ? QWEN21_TURBO_CONTRACT : null,
      checkpoint: config.requirements.unet,
      textEncoder: config.requirements.clip,
      vae: config.requirements.vae,
      acceleration: config.id === "qwen-image-2-1" ? QWEN21_TURBO_CONTRACT.acceleration : null,
      steps: config.id === "qwen-image-2-1" ? QWEN21_TURBO_STEPS : null,
      cfg: config.id === "qwen-image-2-1" ? QWEN21_TURBO_CFG : null,
      sampler: config.id === "qwen-image-2-1" ? QWEN21_TURBO_CONTRACT.sampling.sampler : null,
      scheduler: config.id === "qwen-image-2-1" ? QWEN21_TURBO_CONTRACT.sampling.scheduler : null,
      submissionRuntimeMs: Date.now() - startedAt,
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
        status: error instanceof MossInputError ? 400 : 502,
      },
    );
  }
}
