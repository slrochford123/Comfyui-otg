import { ensureTerminalVideoPreviewNode } from "@/lib/comfyVideoPreview";
import type { H3PromptGraph } from "@/lib/production/h3Workflows";

export const H3_LTX_ALPHA_GENERATOR_ID = "ltx-2.5-alpha-gen" as const;
export const H3_LTX_ALPHA_WORKFLOW_FILE = "LTX-2.5_V2V_ICLoRA_Single_Stage_Distilled.json";
export const H3_LTX_ALPHA_LORA_NAME = "ltx-2.5-22b-ic-lora-alpha-gen-0.9.safetensors";
export const H3_LTX_ALPHA_MODEL_ASSETS = {
  diffusionModel: "ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors",
  videoVae: "ltx-2.5-video-vae-bf16.safetensors",
  audioVae: "ltx-2.5-audio-vae-bf16.safetensors",
  textEncoder: "gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors",
} as const;

export const H3_LTX_ALPHA_REQUIRED_NODE_CLASSES = [
  "UNETLoader",
  "VAELoader",
  "CLIPLoader",
  "LTXICLoRALoaderModelOnly",
  "LTXVConditioning",
  "LTXAddVideoICLoRAGuide",
  "EmptyLTXVLatentVideo",
  "LTXVEmptyLatentAudio",
  "LTXVConcatAVLatent",
  "LTXVCropGuides",
  "LTXVSeparateAVLatent",
  "SamplerCustomAdvanced",
  "KSamplerSelect",
  "ManualSigmas",
  "CFGGuider",
  "RandomNoise",
  "VAEDecodeTiled",
  "GetVideoComponents",
  "CLIPTextEncode",
  "CreateVideo",
  "SaveVideo",
  "LoadVideo",
  "VHS_LoadVideo",
] as const;

export type H3LtxAlphaWorkflowInput = {
  videoFilename: string;
  width: number;
  height: number;
  frames: number;
  fps: number;
  seed: number;
  outputPrefix: string;
  profile?: "default" | "rtx5060ti-conservative";
};

export type H3LtxAlphaBuiltWorkflow = {
  workflowId: "ltx-2.5-alpha-gen";
  workflowFile: typeof H3_LTX_ALPHA_WORKFLOW_FILE;
  graph: H3PromptGraph;
  outputNodeId: "25";
};

type ObjectInfo = Record<string, unknown>;
type ComboNodeInfo = {
  input?: {
    required?: Record<string, unknown>;
  };
};

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function abortAfter(ms: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, cancel: () => clearTimeout(timer) };
}

async function fetchJson<T>(url: string, timeoutMs = 10_000): Promise<T | null> {
  const timeout = abortAfter(timeoutMs);
  try {
    const response = await fetch(url, { cache: "no-store", signal: timeout.signal });
    if (!response.ok) return null;
    return await response.json().catch(() => null) as T | null;
  } finally {
    timeout.cancel();
  }
}

function comboValues(node: ComboNodeInfo | undefined, field: string) {
  const raw = node?.input?.required?.[field];
  if (!Array.isArray(raw)) return [];
  const first = raw[0];
  if (Array.isArray(first)) return first.map((item) => clean(item)).filter(Boolean);
  if (first && typeof first === "object" && Array.isArray((first as { options?: unknown }).options)) {
    return ((first as { options: unknown[] }).options).map((item) => clean(item)).filter(Boolean);
  }
  return [];
}

function hasComboValue(node: ComboNodeInfo | undefined, field: string, value: string) {
  return comboValues(node, field).includes(value);
}

export async function inspectH3LtxAlphaCompatibility(baseUrl: string) {
  const base = clean(baseUrl).replace(/\/+$/, "");
  if (!base) {
    return {
      compatible: false,
      missingNodes: [...H3_LTX_ALPHA_REQUIRED_NODE_CLASSES],
      missingAssets: [
        H3_LTX_ALPHA_LORA_NAME,
        H3_LTX_ALPHA_MODEL_ASSETS.diffusionModel,
        H3_LTX_ALPHA_MODEL_ASSETS.videoVae,
        H3_LTX_ALPHA_MODEL_ASSETS.audioVae,
        H3_LTX_ALPHA_MODEL_ASSETS.textEncoder,
      ],
      workflowFile: H3_LTX_ALPHA_WORKFLOW_FILE,
    };
  }
  const [entries, unetInfo, vaeInfo, clipInfo, loraInfo] = await Promise.all([
    Promise.all(
    H3_LTX_ALPHA_REQUIRED_NODE_CLASSES.map(async (node) => {
      const payload = await fetchJson<ObjectInfo>(`${base}/object_info/${encodeURIComponent(node)}`);
      return [node, payload?.[node] ? true : false] as const;
    }),
    ),
    fetchJson<Record<string, ComboNodeInfo>>(`${base}/object_info/UNETLoader`),
    fetchJson<Record<string, ComboNodeInfo>>(`${base}/object_info/VAELoader`),
    fetchJson<Record<string, ComboNodeInfo>>(`${base}/object_info/CLIPLoader`),
    fetchJson<Record<string, ComboNodeInfo>>(`${base}/object_info/LTXICLoRALoaderModelOnly`),
  ]);
  const missingNodes = entries.flatMap(([node, present]) => present ? [] : [node]);
  const missingAssets = [
    hasComboValue(unetInfo?.UNETLoader, "unet_name", H3_LTX_ALPHA_MODEL_ASSETS.diffusionModel)
      ? null
      : H3_LTX_ALPHA_MODEL_ASSETS.diffusionModel,
    hasComboValue(vaeInfo?.VAELoader, "vae_name", H3_LTX_ALPHA_MODEL_ASSETS.videoVae)
      ? null
      : H3_LTX_ALPHA_MODEL_ASSETS.videoVae,
    hasComboValue(vaeInfo?.VAELoader, "vae_name", H3_LTX_ALPHA_MODEL_ASSETS.audioVae)
      ? null
      : H3_LTX_ALPHA_MODEL_ASSETS.audioVae,
    hasComboValue(clipInfo?.CLIPLoader, "clip_name", H3_LTX_ALPHA_MODEL_ASSETS.textEncoder)
      ? null
      : H3_LTX_ALPHA_MODEL_ASSETS.textEncoder,
    hasComboValue(loraInfo?.LTXICLoRALoaderModelOnly, "lora_name", H3_LTX_ALPHA_LORA_NAME)
      ? null
      : H3_LTX_ALPHA_LORA_NAME,
  ].filter((asset): asset is string => Boolean(asset));
  return {
    compatible: missingNodes.length === 0 && missingAssets.length === 0,
    missingNodes,
    missingAssets,
    workflowFile: H3_LTX_ALPHA_WORKFLOW_FILE,
  };
}

export async function assertH3LtxAlphaAvailable(baseUrl: string) {
  const compatibility = await inspectH3LtxAlphaCompatibility(baseUrl);
  if (!compatibility.compatible) {
    throw new Error(
      `LTX 2.5 Alpha Generation is unavailable on this backend. Missing nodes: ${compatibility.missingNodes.join(", ") || "none"}. Missing assets: ${compatibility.missingAssets.join(", ") || "none"}.`,
    );
  }
  return compatibility;
}

function positiveInteger(value: unknown, fallback: number) {
  const number = Math.round(Number(value));
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

export const H3_LTX_ALPHA_5060_PROFILE = {
  width: 608,
  height: 352,
  frames: 81,
  fps: 24,
} as const;

export function normalizeH3LtxAlphaFrameCount(value: unknown) {
  const frames = positiveInteger(value, 81);
  const clamped = Math.min(Math.max(frames, 9), 145);
  return clamped % 8 === 1 ? clamped : clamped - ((clamped - 1) % 8);
}

export function buildH3LtxAlphaWorkflow(input: H3LtxAlphaWorkflowInput): H3LtxAlphaBuiltWorkflow {
  const use5060Profile = input.profile === "rtx5060ti-conservative";
  const width = use5060Profile ? H3_LTX_ALPHA_5060_PROFILE.width : positiveInteger(input.width, 608);
  const height = use5060Profile ? H3_LTX_ALPHA_5060_PROFILE.height : positiveInteger(input.height, 352);
  const frames = use5060Profile ? H3_LTX_ALPHA_5060_PROFILE.frames : normalizeH3LtxAlphaFrameCount(input.frames);
  const fps = use5060Profile ? H3_LTX_ALPHA_5060_PROFILE.fps : positiveInteger(input.fps, 24);
  const seed = positiveInteger(input.seed, 42424402);
  const videoFilename = clean(input.videoFilename);
  const outputPrefix = clean(input.outputPrefix);
  if (!videoFilename) throw new Error("LTX Alpha source video is required.");
  if (!outputPrefix) throw new Error("LTX Alpha output prefix is required.");

  const graph: H3PromptGraph = {
    "1": use5060Profile
      ? {
        class_type: "VHS_LoadVideo",
        inputs: {
          video: videoFilename,
          force_rate: fps,
          custom_width: width,
          custom_height: height,
          frame_load_cap: frames,
          skip_first_frames: 0,
          select_every_nth: 1,
          format: "LTXV",
        },
      }
      : { class_type: "LoadVideo", inputs: { file: videoFilename } },
    ...(use5060Profile ? {} : {
      "2": { class_type: "GetVideoComponents", inputs: { video: ["1", 0] } },
    }),
    "3": { class_type: "VAELoader", inputs: { vae_name: H3_LTX_ALPHA_MODEL_ASSETS.audioVae } },
    "4": { class_type: "VAELoader", inputs: { vae_name: H3_LTX_ALPHA_MODEL_ASSETS.videoVae } },
    "5": { class_type: "UNETLoader", inputs: { unet_name: H3_LTX_ALPHA_MODEL_ASSETS.diffusionModel, weight_dtype: "default" } },
    "6": { class_type: "CLIPLoader", inputs: { clip_name: H3_LTX_ALPHA_MODEL_ASSETS.textEncoder, type: "ltxv", device: "default" } },
    "7": { class_type: "LTXICLoRALoaderModelOnly", inputs: { model: ["5", 0], lora_name: H3_LTX_ALPHA_LORA_NAME, strength_model: 1.0 } },
    "8": { class_type: "CLIPTextEncode", inputs: { text: "", clip: ["6", 0] } },
    "9": { class_type: "CLIPTextEncode", inputs: { text: "", clip: ["6", 0] } },
    "10": { class_type: "LTXVConditioning", inputs: { positive: ["8", 0], negative: ["9", 0], frame_rate: fps } },
    "11": { class_type: "EmptyLTXVLatentVideo", inputs: { width, height, length: frames, batch_size: 1 } },
    "13": {
      class_type: "LTXAddVideoICLoRAGuide",
      inputs: {
        positive: ["10", 0],
        negative: ["10", 1],
        vae: ["4", 0],
        latent: ["11", 0],
        image: use5060Profile ? ["1", 0] : ["2", 0],
        frame_idx: 0,
        strength: 1.0,
        latent_downscale_factor: ["7", 1],
        crop: "disabled",
        use_tiled_encode: false,
        tile_size: 256,
        tile_overlap: 64,
      },
    },
    "14": { class_type: "LTXVEmptyLatentAudio", inputs: { frames_number: frames, frame_rate: fps, batch_size: 1, audio_vae: ["3", 0] } },
    "15": { class_type: "LTXVConcatAVLatent", inputs: { video_latent: ["13", 2], audio_latent: ["14", 0] } },
    "16": { class_type: "CFGGuider", inputs: { model: ["7", 0], positive: ["13", 0], negative: ["13", 1], cfg: 1.0 } },
    "17": { class_type: "KSamplerSelect", inputs: { sampler_name: "euler_ancestral" } },
    "18": { class_type: "ManualSigmas", inputs: { sigmas: "1.0, 0.99375, 0.9875, 0.98125, 0.975, 0.909375, 0.725, 0.421875, 0.0" } },
    "19": { class_type: "RandomNoise", inputs: { noise_seed: seed } },
    "20": { class_type: "SamplerCustomAdvanced", inputs: { noise: ["19", 0], guider: ["16", 0], sampler: ["17", 0], sigmas: ["18", 0], latent_image: ["15", 0] } },
    "21": { class_type: "LTXVSeparateAVLatent", inputs: { av_latent: ["20", 0] } },
    "22": { class_type: "LTXVCropGuides", inputs: { positive: ["13", 0], negative: ["13", 1], latent: ["21", 0] } },
    "23": { class_type: "VAEDecodeTiled", inputs: { samples: ["22", 2], vae: ["4", 0], tile_size: 512, overlap: 64, temporal_size: 64, temporal_overlap: 8 } },
    "24": { class_type: "CreateVideo", inputs: { images: ["23", 0], fps, bit_depth: 8, codec: "h264" } },
    "25": { class_type: "SaveVideo", inputs: { video: ["24", 0], filename_prefix: outputPrefix, format: "auto", codec: "auto" } },
  };
  ensureTerminalVideoPreviewNode(graph);

  return {
    workflowId: H3_LTX_ALPHA_GENERATOR_ID,
    workflowFile: H3_LTX_ALPHA_WORKFLOW_FILE,
    graph,
    outputNodeId: "25",
  };
}
