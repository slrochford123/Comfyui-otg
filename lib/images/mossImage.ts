/** OpenMOSS SFT, official native ComfyUI implementation. No model fallback. */
export const MOSS_MODEL_ID = "moss-image-sft" as const;
export const MOSS_FILES = {
  unet: "moss_image_sft_int8_convrot.safetensors",
  clip: "qwen3.5_9b_w4a8_gptq.safetensors",
  vae: "flux2-vae_small.safetensors",
} as const;
export const MOSS_REQUIRED_NODES = ["UNETLoader", "CLIPLoader", "VAELoader", "CLIPTextEncode", "EmptyFlux2LatentImage", "SkipLayerGuidanceDiTSimple", "KSampler", "VAEDecode", "PreviewImage"];
export type MossTarget = "3090" | "5060ti";
export class MossInputError extends Error { readonly status = 400; }
export function mossTarget(value: unknown): MossTarget {
  if (value === undefined || value === "" || value === "5060ti") return "5060ti";
  if (value === "3090") return "3090";
  throw new MossInputError("Choose RTX 3090 or RTX 5060 Ti for MOSS-Image.");
}
export function mossBackend(target: MossTarget) {
  return target === "3090" ? "http://100.75.162.64:8188" : "http://100.98.212.116:8188";
}
export function mossFiles(target: MossTarget) {
  const prefix = target === "5060ti" ? "TEST-MOSS/" : "";
  return Object.fromEntries(Object.entries(MOSS_FILES).map(([key, value]) => [key, prefix + value])) as Record<keyof typeof MOSS_FILES, string>;
}
export function mossDimensions(width: unknown, height: unknown, kind: "character" | "background" | "asset") {
  const defaults = kind === "character" ? [768, 1344] : kind === "background" ? [1344, 768] : [1024, 1024];
  const w = width === undefined ? defaults[0] : Number(width);
  const h = height === undefined ? defaults[1] : Number(height);
  if (!Number.isInteger(w) || !Number.isInteger(h) || w % 16 || h % 16 || w < 256 || h < 256 || w > 2048 || h > 2048 || w * h < 262144 || w * h > 4194304) {
    throw new MossInputError("MOSS dimensions must be multiples of 16, 256–2048 per side and 0.25–4 megapixels.");
  }
  return { width: w, height: h };
}
export function mossSeed(value: unknown, fallback: number) {
  if (value === undefined || value === "") return fallback;
  const seed = Number(value);
  if (!Number.isSafeInteger(seed) || seed < 0) throw new MossInputError("MOSS seed must be a non-negative safe integer.");
  return seed;
}
export function buildMossWorkflow(args: { prompt: string; negativePrompt?: string; width: number; height: number; seed: number; target: MossTarget }): Record<string, { class_type: string; inputs: Record<string, any> }> {
  mossDimensions(args.width, args.height, "asset");
  mossSeed(args.seed, 0);
  const files = mossFiles(args.target);
  return {
    "1": { class_type: "UNETLoader", inputs: { unet_name: files.unet, weight_dtype: "default" } },
    // CPU text encoding is explicitly supported by native CLIPLoader. This
    // avoids simultaneous 9B encoder + DiT residency on either GPU, without
    // changing weights, image resolution, step count or guidance.
    "2": { class_type: "CLIPLoader", inputs: { clip_name: files.clip, type: "moss_image", device: "cpu" } },
    "3": { class_type: "VAELoader", inputs: { vae_name: files.vae } },
    "4": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 0], text: args.prompt } },
    "5": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 0], text: args.negativePrompt || "" } },
    "6": { class_type: "EmptyFlux2LatentImage", inputs: { width: args.width, height: args.height, batch_size: 1 } },
    "10": { class_type: "SkipLayerGuidanceDiTSimple", inputs: { model: ["1", 0], double_layers: "", single_layers: "22", start_percent: 0, end_percent: 1 } },
    "7": { class_type: "KSampler", inputs: { model: ["10", 0], positive: ["4", 0], negative: ["5", 0], latent_image: ["6", 0], seed: args.seed, steps: 50, cfg: 3, sampler_name: "euler", scheduler: "sgm_uniform", denoise: 1 } },
    "8": { class_type: "VAEDecode", inputs: { samples: ["7", 0], vae: ["3", 0] } },
    "9": { class_type: "PreviewImage", inputs: { images: ["8", 0] } },
  };
}
export function mossSupport(info: Record<string, any>, target: MossTarget): string | null {
  for (const node of MOSS_REQUIRED_NODES) if (!info[node]) return `Missing node: ${node}`;
  const files = mossFiles(target);
  for (const [node, field, file] of [["UNETLoader", "unet_name", files.unet], ["CLIPLoader", "clip_name", files.clip], ["VAELoader", "vae_name", files.vae]]) {
    if (!info[node]?.input?.required?.[field]?.[0]?.includes(file)) return `Missing MOSS file: ${file}`;
  }
  if (!info.CLIPLoader?.input?.required?.type?.[0]?.includes("moss_image")) return "Native MOSS text encoder support is missing.";
  return null;
}
export function mossOutputShape(width: number, height: number) {
  let a = width, b = height;
  while (b) [a, b] = [b, a % b];
  return { orientation: width === height ? "square" : width > height ? "landscape" : "portrait", aspectRatio: `${width / a}:${height / a}` };
}
