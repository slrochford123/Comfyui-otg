import { buildH3Workflow, type H3PromptGraph } from "@/lib/production/h3Workflows";
import { h3SmartRefModLoaderInputs } from "@/lib/h3SmartReferencesGraph";
import type { H3RefModSlot } from "@/lib/h3SpecialModes/refMods";
import type { ReplacementSettings } from "./contract";

export const SWAP_LORA = "h3_character_swap_pro4500_1000.safetensors";
export const STANDARD_MODEL = "minimax_h3_ref2va_pruned_int8_convrot.safetensors";
export const SINGULARITY_MODEL = "Minimax-h3_Singularity_ref2va_Pruned_v1.3_int8.safetensors";
export const SAM_MODEL = "sam3.1_multiplex_fp16.safetensors";
export const MASK_OUTPUT_NODE = "9902";
export function replacementCanvas(quality: ReplacementSettings["quality"], portrait: boolean) {
  const [w, h] = { "0.2": [608, 352], "0.6": [1056, 608], "1": [1376, 768] }[quality];
  return { width: portrait ? h : w, height: portrait ? w : h };
}
export function replacementPrompt(s: ReplacementSettings, kind: "image" | "video") {
  // Combined orders ordinary pictures, source video, then the one saved RefMod.
  // A RefMod is attached ONCE; a video-kind card is Video 2, never Picture 1.
  const identity = kind === "video" ? "<Video 2>" : `<Picture ${s.imageId ? 2 : 1}>`;
  return [`${s.workflow === "A" ? "Correct the visual identity of" : "Replace only"} the subject described as: ${s.subject}.`,
    s.strength > 0 ? `Use <Video 1> as the source performance and scene. Use ${identity} (saved RefMod) only for the target character's visual identity.` : "Use <Video 1> as the source performance and scene. RefMod strength is zero: this is a no-RefMod baseline.",
    s.imageId ? "<Picture 1> is an additional ordinary identity reference for that same target, not another person to replace." : "",
    "Retain the source action, body positions, timing, camera, composition, environment, lighting, water and reflections as closely as possible. Leave every other subject unchanged. Do not invent age, outfit, eye color or other appearance details absent from the identity references.", s.prompt].filter(Boolean).join("\n");
}
export function buildReplacementGraph(s: ReplacementSettings, args: { video: string; originalVideo?: string; image?: string; mask?: string; refKind: "image" | "video"; portrait: boolean; prefix: string }) {
  if (s.backend !== "rtx3090") throw Error("RTX 5060 Ti lacks PK_MiniMaxH3Combined. No alternate GPU or conditioning is substituted.");
  const prompt = replacementPrompt(s, args.refKind), size = replacementCanvas(s.quality, args.portrait);
  // Build the installed model/sampler chain first. The combined encoder below
  // owns the expanded source + saved-mod media map, not the legacy builder.
  const built = buildH3Workflow({ backend: s.backend, mode: "h3-reference-to-video", h3Quality: s.quality === "0.2" ? "sh" : s.quality === "0.6" ? "lq" : "hq", orientation: args.portrait ? "portrait" : "landscape", finalPrompt: "Follow the source performance in <Video 1>.", durationSeconds: s.seconds > 5 ? 10 : 5, seed: s.seed, outputPrefix: args.prefix,
    preserveLegacyReference: true, videoReferences: [{ uploadedFilename: args.video, includeAudio: false }], h3Settings: { renderMode: "native", checkpointMode: s.model === "singularity" ? "singularity" : "standard", combatLoraEnabled: false, refMod: { enabled: false, strength: "balanced" }, motionLab: { enabled: false } } });
  const g = built.graph;
  g["30"].inputs.unet_name = s.model === "standard" ? STANDARD_MODEL : SINGULARITY_MODEL;
  g["15"].inputs.clip_name = "qwen3vl_32b_minimax_h3_int8_convrot.safetensors";
  g["24"].inputs.steps = 20; g["24"].inputs.denoise = 1; g["18"].inputs.sampler_name = "res_multistep";
  // Explicit dense PyTorch avoids inheriting worker-wide attention overrides.
  g["41"] = { class_type: "ModelAttentionBackend", inputs: { model: g["41"].inputs.model, attention: "pytorch attention" } };
  g.lab_source = { class_type: "LoadVideo", inputs: { file: args.video } };
  g.lab_frames = { class_type: "GetVideoComponents", inputs: { video: ["lab_source", 0] } };
  const slot: H3RefModSlot = { id: "target", name: s.refMod, strength: s.strength, visualStrength: 1, audioStrength: 0, copies: 1, components: "Visual", category: "character", sourceKind: args.refKind, description: "", characterId: "" };
  g.lab_mod = { class_type: "MiniMaxH3RefModsLoader", inputs: h3SmartRefModLoaderInputs([slot]) };
  g["39"] = { class_type: "PK_MiniMaxH3Combined", inputs: { clip: ["15", 0], vae: ["3", 0], audio_vae: ["4", 0], prompt, width: size.width, height: size.height, length: Math.max(124, Math.ceil((s.seconds * 24 - 5) / 17) * 17 + 5), ref_image_size: "match", vlm_resolution: 384, vlm_video_resolution: 384, reference_fps: 24, max_total_tokens: 0, video: ["lab_frames", 0], mods: ["lab_mod", 0] } };
  if (args.image) { g.lab_image = { class_type: "LoadImage", inputs: { image: args.image } }; g["39"].inputs["reference_images.reference_image_0"] = ["lab_image", 0]; }
  if (s.workflow !== "A" && s.swapLora) {
    g.lab_swap = { class_type: "LoraLoaderModelOnly", inputs: { model: ["30", 0], lora_name: SWAP_LORA, strength_model: s.swapStrength } };
    for (const [id, node] of Object.entries(g)) if (id !== "lab_swap" && Array.isArray(node.inputs.model) && node.inputs.model[0] === "30") node.inputs.model = ["lab_swap", 0];
  }
  delete g["34"].inputs.audio; g["34"].inputs.fps = 24;
  Object.assign(g["5"].inputs, { format: "mp4", "format.codec": "h264", codec: "h264" });
  const decoded = g["34"].inputs.images;
  g.lab_trim = { class_type: "ImageFromBatch", inputs: { image: decoded, batch_index: 0, length: s.seconds * 24 } };
  g["34"].inputs.images = ["lab_trim", 0];
  if (s.workflow === "C") {
    g.lab_original = { class_type: "LoadVideo", inputs: { file: args.originalVideo || args.video } };
    g.lab_original_frames = { class_type: "GetVideoComponents", inputs: { video: ["lab_original", 0] } };
    let mask: [string, number];
    if (s.maskMode === "tracked") {
      g.lab_sam = { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: SAM_MODEL } };
      g.lab_selector = { class_type: "CLIPTextEncode", inputs: { clip: ["lab_sam", 1], text: s.subject } };
      g.lab_track = { class_type: "SAM3_VideoTrack", inputs: { images: ["lab_original_frames", 0], model: ["lab_sam", 0], conditioning: ["lab_selector", 0], detection_threshold: .5, max_objects: 1, detect_interval: 1 } };
      g.lab_mask = { class_type: "SAM3_TrackToMask", inputs: { track_data: ["lab_track", 0], object_indices: "0" } };
      mask = ["lab_mask", 0];
    } else {
      if (!args.mask) throw Error("Upload a time-aligned white-subject / black-background mask video.");
      g.lab_mask_video = { class_type: "LoadVideo", inputs: { file: args.mask } };
      g.lab_mask_frames = { class_type: "GetVideoComponents", inputs: { video: ["lab_mask_video", 0] } };
      g.lab_mask = { class_type: "ImageToMask", inputs: { image: ["lab_mask_frames", 0], channel: "red" } }; mask = ["lab_mask", 0];
    }
    g.lab_composite = { class_type: "ImageCompositeMasked", inputs: { destination: ["lab_original_frames", 0], source: ["lab_trim", 0], mask, x: 0, y: 0, resize_source: false } };
    g["34"].inputs.images = ["lab_composite", 0];
    g.lab_mask_preview = { class_type: "MaskToImage", inputs: { mask } };
    g.lab_mask_video_out = { class_type: "CreateVideo", inputs: { images: ["lab_mask_preview", 0], fps: 24 } };
    g[MASK_OUTPUT_NODE] = { class_type: "SaveVideo", inputs: { video: ["lab_mask_video_out", 0], filename_prefix: args.prefix + "_mask", format: "mp4", "format.codec": "h264", codec: "h264" } };
  }
  // Prune unused template branches so no stale media, extra conditioning or output runs.
  const keep = new Set<string>();
  const visit = (id: string) => { if (keep.has(id)) return; if (!g[id]) throw Error(`Missing graph dependency ${id}.`); keep.add(id); for (const v of Object.values(g[id].inputs)) if (Array.isArray(v) && v.length === 2 && typeof v[0] === "string" && typeof v[1] === "number") visit(v[0]); };
  visit("5"); if (s.workflow === "C") visit(MASK_OUTPUT_NODE);
  for (const id of Object.keys(g)) if (!keep.has(id)) delete g[id];
  return { graph: g, prompt, ...size, reconstruction: s.workflow === "C" ? "Full H3 regeneration followed by source-background masked compositing; not native inpainting." : "Full H3 video regeneration from reference conditioning; not frame-preserving editing." };
}
/** Read-only schema and enum validation, never POST /prompt. */
export function graphCompatibility(graph: H3PromptGraph, info: Record<string, any>) {
  const errors: string[] = [];
  for (const [id, node] of Object.entries(graph)) {
    const schema = info[node.class_type]; if (!schema) { errors.push(`${id}: missing ${node.class_type}`); continue; }
    for (const key of Object.keys(schema.input?.required || {})) if (!(key in node.inputs)) errors.push(`${id}: missing ${key}`);
    for (const [key, value] of Object.entries(node.inputs)) {
      const descriptor = schema.input?.required?.[key] || schema.input?.optional?.[key];
      const rawChoices = Array.isArray(descriptor?.[0]) ? descriptor[0] : descriptor?.[1]?.options;
      const choices = rawChoices?.map((c: any) => c && typeof c === "object" ? c.key : c);
      // Upload filenames are dynamic and are checked by the worker on execution.
      // A cached enum cannot establish existence of a just-uploaded server input.
      const uploaded = ["LoadVideo", "LoadImage"].includes(node.class_type) && ["file", "image"].includes(key);
      if (!uploaded && choices && !Array.isArray(value) && !choices.includes(value)) errors.push(`${id}: unavailable ${key}=${value}`);
      if (Array.isArray(value) && value.length === 2 && typeof value[1] === "number" && !graph[value[0]]) errors.push(`${id}: dangling ${key}`);
    }
  }
  return errors;
}
