/** Local native ComfyUI graphs. These are not BRIA's paid API nodes. */
export type NativeImageModel = "minimax-h3-image" | "fibo2-dev" | "fibo2-edit-turbo";
export type NativeImageGraph = Record<string, {class_type: string; inputs: Record<string, unknown>}>;
export const NATIVE_IMAGE_MODELS = {
  "minimax-h3-image": {
    label: "MiniMax H3 Image", operation: "create", steps: 30, cfg: null,
    unet: "minimax_h3_fl2va_pruned_int8_convrot.safetensors",
    clip: "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors", clipType: "minimax",
    vae: "minimax_h3_video_vae_fp16.safetensors",
    workflowFile: "workflows/official/image_minimax_h3_t2i.json",
  },
  "fibo2-dev": {
    label: "Fibo 2.0 Dev", operation: "create-edit", steps: 50, cfg: 5,
    unet: "SLR-TEST-FIBO/fibo2_dev_int8_convrot.safetensors",
    clip: "qwen3vl_4b_bf16.safetensors", clipType: "fibo2",
    vae: "flux2-vae.safetensors", workflowFile: "workflows/official/image_fibo2_dev_t2i.json",
  },
  "fibo2-edit-turbo": {
    label: "Fibo 2.0 Turbo Edit", operation: "edit", steps: 4, cfg: 1,
    unet: "SLR-TEST-FIBO/fibo2_edit_turbo_int8_convrot.safetensors",
    clip: "qwen3vl_4b_bf16.safetensors", clipType: "fibo2",
    vae: "flux2-vae.safetensors", workflowFile: "workflows/official/image_fibo2_edit_turbo.json",
  },
} as const;
export function isNativeImageModel(value: unknown): value is NativeImageModel {
  return typeof value === "string" && Object.hasOwn(NATIVE_IMAGE_MODELS, value);
}
export function nativeImageDimensions(kind: "character" | "asset" | "background") {
  return kind === "character" ? {width: 768, height: 1344}
    : kind === "background" ? {width: 1344, height: 768} : {width: 1024, height: 1024};
}
export function nativeImageEditDimensions(width: number, height: number) {
  if (!Number.isFinite(width / height) || width < 1 || height < 1) throw Error("Invalid source image dimensions.");
  const ratio = width / height;
  const sizes: Array<{width: number; height: number}> = [];
  for (let w = 256; w <= 1536; w += 32) for (let h = 256; h <= 1536; h += 32) {
    if (w * h >= 900_000 && w * h <= 1_100_000) sizes.push({width: w, height: h});
  }
  return sizes.sort((a, b) => Math.abs(Math.log(a.width / a.height / ratio)) - Math.abs(Math.log(b.width / b.height / ratio))
    || Math.abs(a.width * a.height - 1_048_576) - Math.abs(b.width * b.height - 1_048_576))[0];
}
export const NATIVE_CREATE_CONFIGS = Object.fromEntries(
  (["minimax-h3-image", "fibo2-dev"] as const).map(id => {
    const config = NATIVE_IMAGE_MODELS[id];
    return [id, {id, label: config.label, workflowFile: config.workflowFile, outputNodeId: "461",
      requiredNodes: [] as string[], requirements: {unet: config.unet, clip: config.clip, vae: config.vae},
      preferredBackend: "image-primary" as const}];
  }),
) as Record<"minimax-h3-image" | "fibo2-dev", {
  id: "minimax-h3-image" | "fibo2-dev"; label: string; workflowFile: string; outputNodeId: string;
  requiredNodes: string[]; requirements: {unet: string; clip: string; vae: string}; preferredBackend: "image-primary";
}>;
export function buildNativeImageGraph(args: {
  model: NativeImageModel; prompt: string; negativePrompt?: string;
  width: number; height: number; seed: number; image?: string;
}): NativeImageGraph {
  const config = NATIVE_IMAGE_MODELS[args.model];
  if (!config) throw Error("Unknown native image model.");
  if (!args.prompt.trim()) throw Error("An image prompt or edit instruction is required.");
  if (!Number.isSafeInteger(args.seed) || args.seed < 0) throw Error("Invalid image seed.");
  for (const dimension of [args.width, args.height]) {
    if (!Number.isInteger(dimension) || dimension < 256 || dimension > 1536 || dimension % 32) {
      throw Error("Image dimensions must be multiples of 32 between 256 and 1536.");
    }
  }
  if (args.width * args.height > 1_100_000) throw Error("Native image generation is limited to about one megapixel.");
  if (config.operation === "edit" && !args.image) throw Error("Fibo Turbo is an edit model: a source image is required.");
  if (args.model === "minimax-h3-image" && args.image) throw Error("This H3 template is text-to-image, not image editing.");
  const graph: NativeImageGraph = {
    "451": {class_type: "UNETLoader", inputs: {unet_name: config.unet, weight_dtype: "default"}},
    "453": {class_type: "CLIPLoader", inputs: {clip_name: config.clip, type: config.clipType, device: "default"}},
    "454": {class_type: "VAELoader", inputs: {vae_name: config.vae}},
    "457": {class_type: "VAEDecode", inputs: {samples: ["458", 0], vae: ["454", 0]}},
    "461": {class_type: "SaveImage", inputs: {images: ["457", 0], filename_prefix: "SLR_TEST_Images/image"}},
  };
  if (args.model !== "minimax-h3-image") {
    graph["474"] = {class_type: "TextEncodeFibo2", inputs: {
      clip: ["453", 0], vae: ["454", 0], prompt: args.prompt,
      negative_prompt: args.negativePrompt || "", width: args.width, height: args.height, batch_size: 1,
      ...(args.image ? {"images.image_1": ["470", 0]} : {}),
    }};
    if (args.image) graph["470"] = {class_type: "LoadImage", inputs: {image: args.image}};
    graph["458"] = {class_type: "KSampler", inputs: {
      model: ["451", 0], positive: ["474", 0], negative: ["474", 1], latent_image: ["474", 2],
      seed: args.seed, steps: config.steps, cfg: config.cfg, sampler_name: "euler", scheduler: "simple", denoise: 1,
    }};
  } else {
    // Official still-image path: no video/audio latent, no legacy SLA, no
    // Singularity/FastH3 checkpoint substitution and no automatic Turbo LoRA.
    graph["474"] = {class_type: "CLIPTextEncode", inputs: {clip: ["453", 0], text: args.prompt}};
    graph["46"] = {class_type: "EmptyLatentImage", inputs: {width: args.width, height: args.height, batch_size: 1}};
    graph["44"] = {class_type: "ModelAttentionBackend", inputs: {model: ["451", 0], attention: "comfy kitchen attention"}};
    graph["16"] = {class_type: "BasicGuider", inputs: {model: ["44", 0], conditioning: ["474", 0]}};
    graph["15"] = {class_type: "RandomNoise", inputs: {noise_seed: args.seed}};
    graph["17"] = {class_type: "KSamplerSelect", inputs: {sampler_name: "res_multistep"}};
    graph["9"] = {class_type: "BasicScheduler", inputs: {model: ["44", 0], scheduler: "simple", steps: 30, denoise: 1}};
    graph["458"] = {class_type: "SamplerCustomAdvanced", inputs: {noise: ["15", 0], guider: ["16", 0], sampler: ["17", 0], sigmas: ["9", 0], latent_image: ["46", 0]}};
    graph["39"] = {class_type: "LTXVSeparateAVLatent", inputs: {av_latent: ["458", 0]}};
    graph["457"].inputs.samples = ["39", 0];
  }
  return graph;
}
