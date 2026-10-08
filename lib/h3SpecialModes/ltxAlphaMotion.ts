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
  "LTXVImgToVideoInplace",
  "LTXVConcatAVLatent",
  "LTXVSetAudioRefTokens",
  "VAEEncodeAudio",
  "LTXVCropGuides",
  "LTXVSeparateAVLatent",
  "SamplerCustomAdvanced",
  "KSamplerSelect",
  "ManualSigmas",
  "CFGGuider",
  "RandomNoise",
  "VAEDecodeTiled",
  "LTXVAudioVAEDecode",
  "GetVideoComponents",
  "CreateVideo",
  "SaveVideo",
  "LoadVideo",
] as const;

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
