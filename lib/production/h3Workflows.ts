import fs from "node:fs";
import path from "node:path";

import {
  resolveProductionV2H3UserLoras,
  type ProductionV2H3UserLoraState,
} from "@/lib/production/h3Loras";
import {
  H3_PRODUCTION_DURATION_OPTIONS,
  H3_NATIVE_RESOLUTIONS,
  getH3NativeDimensions,
  normalizeH3Orientation,
  type H3Orientation,
  H3_PRODUCTION_RECIPES,
  H3_PRODUCTION_ROUTE_KEYS,
  getH3ProductionRecipe,
  type H3ProductionDuration,
  type H3ProductionRecipe,
  type H3Quality,
} from "@/lib/production/h3ProductionRecipes";

import {
  assertProductionV2BackgroundVisualReference,
} from "@/lib/production/v2";

import type {
  ProductionV2Duration,
  ProductionV2GenerationMode,
  ProductionV2ResolvedVoiceBinding,
  ProductionV2VisualReference,
} from "@/lib/production/v2";

export type ProductionV2H3BackendId = "rtx3090" | "rtx5060ti";
export type ProductionV2H3Mode = Extract<
  ProductionV2GenerationMode,
  "h3-text-to-video" | "h3-image-to-video" | "h3-reference-to-video"
>;
export type H3PromptGraph = Record<string, { class_type: string; inputs: Record<string, unknown>; _meta?: Record<string, unknown> }>;

export const H3_MAX_IMAGE_REFERENCES = 9;
export const H3_MAX_VIDEO_REFERENCES = 3;
export const H3_MAX_AUDIO_REFERENCES = 3;
export const H3_LQ_NATIVE_WIDTH = H3_NATIVE_RESOLUTIONS.lq.width;
export const H3_LQ_NATIVE_HEIGHT = H3_NATIVE_RESOLUTIONS.lq.height;
export const H3_HQ_NATIVE_WIDTH = H3_NATIVE_RESOLUTIONS.hq.width;
export const H3_HQ_NATIVE_HEIGHT = H3_NATIVE_RESOLUTIONS.hq.height;
export const H3_FPS = 24;
export const H3_SAMPLER_STEPS = 8;
export const H3_BACKEND_PRIORITY: readonly ProductionV2H3BackendId[] = [
  "rtx5060ti",
  "rtx3090",
] as const;

const WORKFLOW_ROOT = "comfy_workflows/internal/production-v2";

export const H3_VSR_BACKEND = "rtx5060ti" as const;
export const H3_FINAL_WIDTH = 1920;
export const H3_FINAL_HEIGHT = 1080;
export const H3_VSR_WORKFLOW_FILE = `${WORKFLOW_ROOT}/minimax_h3_rtx_vsr_ultra_1080p.json`;
export const H3_VSR_REQUIRED_NODE_CLASSES = [
  "RTXVideoSuperResolution",
  "LoadVideo",
  "GetVideoComponents",
  "CreateVideo",
  "SaveVideo",
] as const;

export const H3_WORKFLOW_CONTRACTS = {
  "h3-text-to-video": {
    workflowId: "minimax-h3-t2v-native-1024x576-turbo8-spectrum-v1",
    conditioningNodeId: "39",
    promptInput: "prompt",
    durationNodeId: "17",
    durationInput: "value",
    seedNodeId: "31",
    seedInput: "noise_seed",
    outputVideoNodeId: "5",
    outputPrefixInput: "filename_prefix",
  },
  "h3-image-to-video": {
    workflowId: "minimax-h3-i2v-native-1024x576-turbo8-spectrum-v1",
    conditioningNodeId: "39",
    promptInput: "prompt",
    startImageNodeId: "40",
    startImageInput: "image",
    durationNodeId: "17",
    durationInput: "value",
    seedNodeId: "31",
    seedInput: "noise_seed",
    outputVideoNodeId: "5",
    outputPrefixInput: "filename_prefix",
  },
  "h3-reference-to-video": {
    workflowId: "minimax-h3-r2v-native-1024x576-turbo8-spectrum-v1",
    conditioningNodeId: "39",
    promptInput: "prompt",
    templateReferencePlaceholderNodeIds: ["40"],
    referenceImageNodeIds: ["80", "81", "82", "83", "84", "85", "86", "87", "88"],
    referenceImageInput: "image",
    referenceAudioNodeIds: ["90", "91", "92"],
    referenceAudioInput: "audio",
    videoReferenceLoaderNodeId: "60",
    videoReferenceComponentsNodeId: "61",
    continuationGuideImageNodeId: "40",
    continuationGuideNodeId: "93",
    basicGuiderNodeId: "32",
    samplerNodeId: "21",
    durationNodeId: "17",
    durationInput: "value",
    seedNodeId: "31",
    seedInput: "noise_seed",
    outputVideoNodeId: "5",
    outputPrefixInput: "filename_prefix",
  },
} as const;

export const H3_BACKEND_PROFILES = {
  rtx3090: {
    id: "rtx3090" as const,
    label: "RTX 3090",
    baseUrl: "http://100.75.162.64:8189",
    diffusionModel: "minimax_h3_fl2va_pruned_fp8_scaled.safetensors",
    textEncoder: "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors",
  },
  rtx5060ti: {
    id: "rtx5060ti" as const,
    label: "RTX 5060 Ti",
    baseUrl: "http://100.98.212.116:8188",
    diffusionModel: "minimax_h3_fl2va_pruned_int8_convrot.safetensors",
    textEncoder: "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors",
  },
} as const;

export const H3_SHARED_ASSETS = {
  videoVae: "minimax_h3_video_vae_fp16.safetensors",
  audioVae: "minimax_h3_audio_vae_fp32.safetensors",
  turboLora: "MiniMax-H3/Acceleration/minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors",
  referenceTurboLora: "minimax_h3_ref2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors",
  attention: "H3 SLA",
} as const;

const H3_COMMON_REQUIRED_NODE_CLASSES = [
  "UNETLoader",
  "CLIPLoader",
  "VAELoader",
  "LoraLoaderModelOnly",
  "MiniMaxH3SigmaShift",
  "ResolutionSelector",
  "ComfyMathExpression",
  "LoadImage",
  "LoadAudio",
  "LoadVideo",
  "GetVideoComponents",
  "CreateVideo",
  "SaveVideo",
  "MiniMaxH3ImageToVideo",
  "MiniMaxH3ReferenceToVideo",
  "MiniMaxH3AddGuide",
  "BasicScheduler",
  "KSamplerSelect",
  "SamplerCustomAdvanced",
  "RandomNoise",
  "BasicGuider",
  "H3SLAAttention",
] as const;

/**
 * Kept for source compatibility. Runtime compatibility checks must use
 * h3RequiredNodeClassesForBackend() because the two GPUs intentionally
 * use different attention implementations.
 */
export const H3_REQUIRED_NODE_CLASSES = H3_COMMON_REQUIRED_NODE_CLASSES;

export function h3RequiredNodeClassesForBackend(
  _backend: ProductionV2H3BackendId,
): string[] {
  return [...H3_COMMON_REQUIRED_NODE_CLASSES];
}

/**
 * Read the exact assets from the qualified workflow templates.
 * This prevents the runtime compatibility check from drifting away
 * from the workflow JSON that is actually submitted.
 */
export function h3ExpectedAssetChoicesForBackend(
  backend: ProductionV2H3BackendId,
  userLoraFilenames: readonly string[] = [],
): Array<readonly [string, string, string]> {
  const checkedInputs: Record<string, readonly string[]> = {
    UNETLoader: ["unet_name"],
    CLIPLoader: ["clip_name"],
    VAELoader: ["vae_name"],
    LoraLoaderModelOnly: ["lora_name"],
    ModelAttentionBackend: ["attention"],
    PathchSageAttentionKJ: ["sage_attention"],
  };

  const seen = new Set<string>();
  const result: Array<readonly [string, string, string]> = [];

  for (const routeKey of H3_PRODUCTION_ROUTE_KEYS) {
    const recipe = H3_PRODUCTION_RECIPES[routeKey];
    if (recipe.backend !== backend) continue;
    const graph = loadH3WorkflowTemplate(
      recipe.backend,
      recipe.mode,
      recipe.durationSeconds,
      recipe.quality,
    );

    for (const node of Object.values(graph)) {
      const inputNames = checkedInputs[node.class_type] || [];

      for (const inputName of inputNames) {
        const expected = clean(node.inputs[inputName]);
        if (!expected) continue;

        const key = `${node.class_type}\u0000${inputName}\u0000${expected}`;
        if (seen.has(key)) continue;

        seen.add(key);
        result.push([node.class_type, inputName, expected] as const);
      }
    }
  }

  for (const filename of userLoraFilenames) {
    const expected = clean(filename);
    if (!expected) continue;
    const key = `LoraLoaderModelOnly\u0000lora_name\u0000${expected}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(["LoraLoaderModelOnly", "lora_name", expected] as const);
  }

  return result;
}

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function templatePath(recipe: H3ProductionRecipe) {
  return path.join(process.cwd(), recipe.workflowFile);
}

export function h3FrameCountForDuration(duration: ProductionV2Duration) {
  const frames = Math.max(5, Math.round(duration * H3_FPS));
  return frames + ((5 - (frames % 17)) % 17);
}

export function loadH3WorkflowTemplate(
  backend: ProductionV2H3BackendId,
  mode: ProductionV2H3Mode,
  durationSeconds: H3ProductionDuration,
  quality: H3Quality,
): H3PromptGraph {
  const recipe = getH3ProductionRecipe(mode, durationSeconds, backend, quality);
  return JSON.parse(fs.readFileSync(templatePath(recipe), "utf8")) as H3PromptGraph;
}

function assertNode(graph: H3PromptGraph, nodeId: string, classType: string) {
  if (graph[nodeId]?.class_type !== classType) {
    throw new Error(`H3 workflow contract expected node ${nodeId} to be ${classType}.`);
  }
}

function classEntries(graph: H3PromptGraph, classType: string) {
  return Object.entries(graph).filter(([, node]) => node.class_type === classType);
}

function oneClassNode(graph: H3PromptGraph, classType: string) {
  const entries = classEntries(graph, classType);

  if (entries.length !== 1) {
    throw new Error(
      `H3 workflow contract expected exactly one ${classType}; found ${entries.length}.`,
    );
  }

  return {
    id: entries[0][0],
    node: entries[0][1],
  };
}

function assertGraphLink(value: unknown, expectedNodeId: string, expectedOutput: number, label: string) {
  if (
    !Array.isArray(value)
    || String(value[0]) !== expectedNodeId
    || Number(value[1]) !== expectedOutput
  ) {
    throw new Error(
      `H3 workflow contract ${label} must consume output ${expectedOutput} from node ${expectedNodeId}.`,
    );
  }
}

function assertModelLink(value: unknown, expectedNodeId: string, label: string) {
  assertGraphLink(value, expectedNodeId, 0, label);
}

export function validateH3WorkflowTemplate(
  backend: ProductionV2H3BackendId,
  mode: ProductionV2H3Mode,
  durationSeconds: H3ProductionDuration,
  quality: H3Quality,
  graph = loadH3WorkflowTemplate(backend, mode, durationSeconds, quality),
) {
  const recipe = getH3ProductionRecipe(
    mode,
    durationSeconds,
    backend,
    quality,
  );
  const contract = H3_WORKFLOW_CONTRACTS[mode];

  assertNode(
    graph,
    contract.conditioningNodeId,
    mode === "h3-reference-to-video"
      ? "MiniMaxH3ReferenceToVideo"
      : "MiniMaxH3ImageToVideo",
  );

  assertNode(graph, contract.durationNodeId, "PrimitiveFloat");
  assertNode(graph, contract.seedNodeId, "RandomNoise");
  assertNode(graph, contract.outputVideoNodeId, "SaveVideo");
  assertNode(graph, "30", "UNETLoader");
  assertNode(graph, "15", "CLIPLoader");
  assertNode(graph, "36", "LoraLoaderModelOnly");
  assertNode(graph, "38", "MiniMaxH3SigmaShift");
  assertNode(graph, "24", "BasicScheduler");
  assertNode(graph, "18", "KSamplerSelect");
  assertNode(graph, "21", "SamplerCustomAdvanced");
  assertNode(graph, "32", "BasicGuider");
  assertNode(graph, "34", "CreateVideo");

  if (classEntries(graph, "SplitSigmas").length !== 0) {
    throw new Error("Qualified H3 workflow must not contain SplitSigmas.");
  }

  if (
    graph["24"].inputs.steps !== 8
    || graph["24"].inputs.scheduler !== "simple"
    || graph["24"].inputs.denoise !== 1
  ) {
    throw new Error(
      "Qualified H3 scheduler must be simple / 8 steps / denoise 1.",
    );
  }

  if (graph["18"].inputs.sampler_name !== "euler") {
    throw new Error("Qualified H3 sampler must be Euler.");
  }

  assertModelLink(
    graph["21"].inputs.sigmas,
    "24",
    "SamplerCustomAdvanced.sigmas",
  );

  if (
    graph["38"].inputs.shift_video !== recipe.videoSigmaShift
    || graph["38"].inputs.shift_audio !== recipe.audioSigmaShift
  ) {
    throw new Error("Qualified H3 sigma shifts must be video 6 / audio 3.");
  }

  const conditioning = graph[contract.conditioningNodeId];

  if (
    conditioning.inputs.width !== recipe.nativeWidth
    || conditioning.inputs.height !== recipe.nativeHeight
  ) {
    throw new Error(
      `Qualified H3 ${quality.toUpperCase()} native resolution must be ${recipe.nativeWidth}x${recipe.nativeHeight}.`,
    );
  }

  if (
    Number(conditioning.inputs.length) !== recipe.frameCount
    || Number(graph["17"].inputs.value) !== durationSeconds
  ) {
    throw new Error(
      `Qualified H3 ${durationSeconds}s route must use ${recipe.frameCount} frames.`,
    );
  }

  if (
    mode === "h3-reference-to-video"
    && conditioning.inputs.ref_image_size !== "match"
  ) {
    throw new Error("Qualified H3 R2V ref_image_size must be match.");
  }

  if (mode === "h3-image-to-video") {
    const imageContract = H3_WORKFLOW_CONTRACTS["h3-image-to-video"];
    assertNode(graph, imageContract.startImageNodeId, "LoadImage");
    assertGraphLink(
      conditioning.inputs.first_frame,
      imageContract.startImageNodeId,
      0,
      "MiniMaxH3ImageToVideo.first_frame",
    );
  }

  if (mode === "h3-text-to-video") {
    if (Object.prototype.hasOwnProperty.call(conditioning.inputs, "first_frame")) {
      throw new Error("Qualified H3 T2V must not include a first_frame input.");
    }

    if (classEntries(graph, "LoadImage").length !== 0) {
      throw new Error("Qualified H3 T2V must not include a LoadImage node.");
    }
  }

  if (graph["34"].inputs.fps !== 24) {
    throw new Error("Qualified H3 output must be 24 fps.");
  }

  const clipName = clean(graph["15"].inputs.clip_name);

  if (clipName !== "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors") {
    throw new Error("Qualified H3 text encoder changed.");
  }

  const unetName = clean(graph["30"].inputs.unet_name);
  const turboName = clean(graph["36"].inputs.lora_name);

  if (Number(graph["36"].inputs.strength_model) !== 1) {
    throw new Error("Qualified H3 Turbo LoRA strength must be 1.");
  }

  assertModelLink(
    graph["38"].inputs.model,
    "36",
    "MiniMaxH3SigmaShift",
  );

  if (mode === "h3-reference-to-video") {
    if (
      unetName
      !== "minimax_h3_ref2va_pruned_int8_convrot.safetensors"
    ) {
      throw new Error(
        "Qualified H3 R2V must use the Ref2VA INT8 ConvRot diffusion model.",
      );
    }

    if (
      turboName
      !== "minimax_h3_ref2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors"
    ) {
      throw new Error(
        "Qualified H3 R2V must use the official Ref2V Turbo LoRA.",
      );
    }
  } else {
    if (!/^minimax_h3_fl2va_/i.test(unetName)) {
      throw new Error(
        "Qualified H3 T2V/I2V must remain on the FL2VA diffusion family.",
      );
    }

    if (!/minimax_h3_fl2v_turbo_8step/i.test(turboName)) {
      throw new Error(
        "Qualified H3 T2V/I2V must remain on the FL2V Turbo LoRA family.",
      );
    }
  }

  if (classEntries(graph, "SpectrumApplyMiniMaxH3").length !== 0) {
    throw new Error("Qualified LQ/HQ H3 routes must not use obsolete Spectrum attention.");
  }

  const sla = oneClassNode(graph, "H3SLAAttention");
  const expectedDenseBackend = backend === "rtx5060ti"
    ? "comfy_kitchen"
    : "sage:qk_int8_pv_fp16_cuda";
  const expectedSparsity = mode === "h3-reference-to-video" ? 0.85 : 0.9;

  if (
    sla.node.inputs.enabled !== true
    || Number(sla.node.inputs.sparsity_ratio) !== expectedSparsity
    || sla.node.inputs.block_size !== "64"
    || Number(sla.node.inputs.min_seq_len) !== 8192
    || Number(sla.node.inputs.dense_last_steps) !== 0
    || sla.node.inputs.protect_audio !== true
    || sla.node.inputs.dense_steps !== "0"
    || sla.node.inputs.dense_backend !== expectedDenseBackend
    || sla.node.inputs.disable_fp16_accum !== true
  ) {
    throw new Error(`Qualified ${backend} H3 SLA contract changed.`);
  }

  assertModelLink(sla.node.inputs.model, "38", "H3 SLA");
  assertModelLink(graph["32"].inputs.model, sla.id, "BasicGuider");

  return true;
}

type UploadedVisualReference = ProductionV2VisualReference & { uploadedFilename: string };
type UploadedVoiceReference = ProductionV2ResolvedVoiceBinding & { uploadedFilename: string };
type UploadedVideoReference = { uploadedFilename: string; includeAudio: boolean };

function orderedReferences(references: UploadedVisualReference[], allowEmpty = false) {
  if (!references.length && !allowEmpty) throw new Error("MiniMax H3 Reference-to-Video requires at least one visual reference.");
  if (references.length > H3_MAX_IMAGE_REFERENCES) throw new Error(`MiniMax H3 supports at most ${H3_MAX_IMAGE_REFERENCES} image references; no reference was dropped.`);
  const ordered = [...references].sort((left, right) => Number(left.pictureSlot || 0) - Number(right.pictureSlot || 0));
  ordered.forEach((reference, index) => {
    assertProductionV2BackgroundVisualReference(reference);
    const slot = index + 1;
    if (reference.pictureSlot !== slot || reference.subjectSlot !== slot) throw new Error("H3 Picture and Subject ordering must be contiguous and identical to the resolved manifest.");
    if (!clean(reference.workflowImage)) throw new Error(`${reference.name} does not have a model-facing generation image.`);
    if (reference.sourceKind === "character" && reference.generationSourceType !== "character-card") {
      throw new Error(`${reference.name} must use its Character Card for H3 generation.`);
    }
  });
  return ordered;
}

function orderedVoices(voices: UploadedVoiceReference[]) {
  if (voices.length > H3_MAX_AUDIO_REFERENCES) throw new Error(`MiniMax H3 supports at most ${H3_MAX_AUDIO_REFERENCES} standalone audio references.`);
  const ordered = [...voices].sort((left, right) => left.audioSlot - right.audioSlot);
  const characterSlots = new Set<string>();
  ordered.forEach((voice, index) => {
    if (voice.audioSlot !== index + 1 || voice.speakerId !== index + 1) throw new Error("H3 Audio and speaker ordering must be contiguous and deterministic.");
    if (!clean(voice.sourcePath)) throw new Error(`${voice.snapshotName} does not have a saved Character voice.`);
    if (characterSlots.has(voice.characterId)) throw new Error(`${voice.snapshotName} was mapped to more than one H3 Audio reference.`);
    characterSlots.add(voice.characterId);
  });
  return ordered;
}

function assertReferencePromptMatchesManifest(
  prompt: string,
  references: UploadedVisualReference[],
  videos: UploadedVideoReference[],
  voices: UploadedVoiceReference[],
) {
  references.forEach((reference) => {
    if (!prompt.includes(`<Picture ${reference.pictureSlot}>`) || !prompt.includes(`<Subject ${reference.subjectSlot}>`)) {
      throw new Error(`The exact final prompt is missing the manifest mapping for Picture ${reference.pictureSlot} / Subject ${reference.subjectSlot}.`);
    }
  });

  let embeddedAudioSlot = 0;
  videos.forEach((video) => {
    if (video.includeAudio) {
      embeddedAudioSlot += 1;
    }
  });

  voices.forEach((voice) => {
    const promptAudioSlot = embeddedAudioSlot + voice.audioSlot;
    if (!prompt.includes(`<Audio ${promptAudioSlot}>`)) {
      throw new Error(`The exact final prompt is missing the manifest mapping for standalone Audio ${promptAudioSlot}.`);
    }
  });
  for (const match of prompt.matchAll(/<(Picture|Subject|Video|Audio)\s+(\d+)>/g)) {
    const type = match[1];
    const slot = Number(match[2]);
    const limit = type === "Audio"
      ? embeddedAudioSlot + voices.length
      : type === "Video"
        ? videos.length
        : references.length;
    if (slot < 1 || slot > limit) throw new Error(`The exact final prompt refers to ${type} ${slot}, but the submitted manifest contains only ${limit}.`);
  }
}

export type H3WorkflowBuildInput = {
  backend: ProductionV2H3BackendId;
  mode: ProductionV2H3Mode;
  h3Quality: H3Quality;
  orientation?: H3Orientation;
  finalPrompt: string;
  durationSeconds: ProductionV2Duration;
  seed: number;
  outputPrefix: string;
  startImageFilename?: string;
  lastImageFilename?: string;
  references?: Array<ProductionV2VisualReference & { uploadedFilename: string }>;
  voices?: Array<ProductionV2ResolvedVoiceBinding & { uploadedFilename: string }>;
  operation?: "scene-generation" | "visual-edit";
  videoReferenceFilename?: string;
  includeVideoReferenceAudio?: boolean;
  videoReferences?: Array<{
    uploadedFilename: string;
    includeAudio: boolean;
  }>;
  userLoras?: ProductionV2H3UserLoraState;
  optionalLoras?: Array<{
    id: string;
    label: string;
    filename: string;
    strength: number;
  }>;
};

function asH3ProductionDuration(
  value: ProductionV2Duration,
): H3ProductionDuration {
  const duration = Number(value) as H3ProductionDuration;

  if (!H3_PRODUCTION_DURATION_OPTIONS.includes(duration)) {
    throw new Error(
      `Qualified MiniMax H3 production supports only ${H3_PRODUCTION_DURATION_OPTIONS.join(" or ")} second scenes.`,
    );
  }

  return duration;
}

function assertQualifiedRecipeGraph(
  graph: H3PromptGraph,
  recipe: H3ProductionRecipe,
) {
  if (
    Number(graph["24"].inputs.steps) !== recipe.steps
    || graph["24"].inputs.scheduler !== recipe.scheduler
  ) {
    throw new Error(
      `H3 recipe ${recipe.recipeId} scheduler mutation failed.`,
    );
  }

  if (graph["18"].inputs.sampler_name !== recipe.sampler) {
    throw new Error(
      `H3 recipe ${recipe.recipeId} sampler mutation failed.`,
    );
  }

  const contract = H3_WORKFLOW_CONTRACTS[recipe.mode];
  const conditioning = graph[contract.conditioningNodeId];

  if (
    Number(conditioning.inputs.width) !== recipe.nativeWidth
    || Number(conditioning.inputs.height) !== recipe.nativeHeight
  ) {
    throw new Error(
      `H3 recipe ${recipe.recipeId} native resolution mutation failed.`,
    );
  }

  if (recipe.referenceImageSize === "match") {
    if (conditioning.inputs.ref_image_size !== "match") {
      throw new Error(
        `H3 recipe ${recipe.recipeId} must use ref_image_size=match.`,
      );
    }
  }

  if (!graph["36"] || graph["36"].class_type !== "LoraLoaderModelOnly") {
    throw new Error(
      `H3 recipe ${recipe.recipeId} requires the qualified Turbo8 LoRA node.`,
    );
  }

  if (Number(graph["36"].inputs.strength_model) !== 1) {
    throw new Error(
      `H3 recipe ${recipe.recipeId} Turbo8 LoRA strength must be 1.`,
    );
  }

  const turboName = clean(graph["36"].inputs.lora_name);

  if (
    recipe.turboLoraFamily === "fl2v"
    && !/minimax_h3_fl2v_turbo_8step/i.test(turboName)
  ) {
    throw new Error(
      `H3 recipe ${recipe.recipeId} requires the FL2V Turbo8 LoRA family.`,
    );
  }

  if (
    recipe.turboLoraFamily === "r2v"
    && turboName !== "minimax_h3_ref2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors"
  ) {
    throw new Error(
      `H3 recipe ${recipe.recipeId} requires the Ref2V Turbo8 LoRA.`,
    );
  }

  assertModelLink(graph["38"].inputs.model, "36", "MiniMaxH3SigmaShift Turbo8 base");
}

function applyQualifiedH3ProductionRecipe(
  graph: H3PromptGraph,
  input: Pick<
    H3WorkflowBuildInput,
    "backend" | "mode" | "durationSeconds" | "h3Quality"
  >,
) {
  const durationSeconds =
    asH3ProductionDuration(input.durationSeconds);

  const recipe = getH3ProductionRecipe(
    input.mode,
    durationSeconds,
    input.backend,
    input.h3Quality,
  );

  assertQualifiedRecipeGraph(
    graph,
    recipe,
  );

  return {
    recipe,
    baseModelNodeId: "36",
  };
}

function applyH3UserLoraChain(
  graph: H3PromptGraph,
  value: ProductionV2H3UserLoraState | undefined,
  baseModelNodeId: string,
  optionalLoras: H3WorkflowBuildInput["optionalLoras"] = [],
) {
  const selected = [
    ...resolveProductionV2H3UserLoras(value),
    ...optionalLoras.map((lora) => ({ ...lora, triggerPhrases: [], experimental: false })),
  ];
  let previousNodeId = baseModelNodeId;

  selected.forEach((lora, index) => {
    const nodeId = String(70 + index);

    if (graph[nodeId]) {
      throw new Error(
        `H3 user LoRA node ${nodeId} collides with the qualified workflow template.`,
      );
    }

    graph[nodeId] = {
      class_type: "LoraLoaderModelOnly",
      inputs: {
        model: [previousNodeId, 0],
        lora_name: lora.filename,
        strength_model: lora.strength,
      },
      _meta: {
        title: `OTG H3 ${lora.label} LoRA`,
      },
    };

    previousNodeId = nodeId;
  });

  graph["38"].inputs.model = [
    previousNodeId,
    0,
  ];

  return selected;
}

export function buildH3Workflow(input: H3WorkflowBuildInput) {
  const graph = loadH3WorkflowTemplate(
    input.backend,
    input.mode,
    asH3ProductionDuration(input.durationSeconds),
    input.h3Quality,
  );

  // Validate the immutable qualified template before any
  // duration/backend recipe mutation.
  validateH3WorkflowTemplate(
    input.backend,
    input.mode,
    asH3ProductionDuration(input.durationSeconds),
    input.h3Quality,
    graph,
  );

  const {
    recipe,
    baseModelNodeId,
  } = applyQualifiedH3ProductionRecipe(
    graph,
    input,
  );

  applyH3UserLoraChain(
    graph,
    input.userLoras,
    baseModelNodeId,
    input.optionalLoras,
  );

  const contract = H3_WORKFLOW_CONTRACTS[input.mode];
  const orientation = normalizeH3Orientation(input.orientation);
  const nativeDimensions = getH3NativeDimensions(
    input.h3Quality,
    orientation,
  );
  graph[contract.conditioningNodeId].inputs.width = nativeDimensions.width;
  graph[contract.conditioningNodeId].inputs.height = nativeDimensions.height;
  const prompt = clean(input.finalPrompt);

  if (!prompt) {
    throw new Error(
      "H3 generation requires a final model prompt.",
    );
  }
  if (!Number.isSafeInteger(input.seed) || input.seed < 0) throw new Error("H3 generation seed must be a non-negative safe integer.");
  graph[contract.conditioningNodeId].inputs[contract.promptInput] = prompt;
  graph[contract.durationNodeId].inputs[contract.durationInput] = input.durationSeconds;
  graph[contract.seedNodeId].inputs[contract.seedInput] = input.seed;
  graph[contract.outputVideoNodeId].inputs[contract.outputPrefixInput] = clean(input.outputPrefix);

  if (input.operation === "visual-edit" && input.mode !== "h3-reference-to-video") {
    throw new Error("H3 visual editing requires the Reference-to-Video workflow.");
  }

  if (input.mode === "h3-text-to-video") {
    // T2V intentionally uses the same H3 Image-to-Video node and model family without first_frame wiring.
  } else if (input.mode === "h3-image-to-video") {
    const filename = clean(input.startImageFilename);
    if (!filename) throw new Error("H3 Image-to-Video requires exactly one uploaded starting image.");
    graph[H3_WORKFLOW_CONTRACTS["h3-image-to-video"].startImageNodeId].inputs.image = filename;
    const lastImageFilename = clean(input.lastImageFilename);
    if (lastImageFilename) {
      const lastImageNodeId = "42";
      if (graph[lastImageNodeId]) {
        throw new Error(`H3 last-image node ${lastImageNodeId} collides with the qualified workflow template.`);
      }
      graph[lastImageNodeId] = {
        class_type: "LoadImage",
        inputs: { image: lastImageFilename },
        _meta: { title: "OTG H3 Last Image" },
      };
      graph[contract.conditioningNodeId].inputs.last_frame = [lastImageNodeId, 0];
    }
  } else {
    const referenceContract = H3_WORKFLOW_CONTRACTS["h3-reference-to-video"];
    for (const nodeId of referenceContract.templateReferencePlaceholderNodeIds) delete graph[nodeId];
    for (const nodeId of referenceContract.referenceImageNodeIds) delete graph[nodeId];
    for (const nodeId of referenceContract.referenceAudioNodeIds) delete graph[nodeId];
    for (const key of Object.keys(graph[contract.conditioningNodeId].inputs)) {
      if (key.startsWith("ref_images.") || key.startsWith("ref_audios.") || key.startsWith("ref_videos.") || key.startsWith("ref_video_audios.")) delete graph[contract.conditioningNodeId].inputs[key];
    }

    /*
     * OTG_PRODUCTION_V2_H3_R2V_FRAME0_GUIDE_R11B_V1
     *
     * Continue Scene R2V is a hybrid:
     *
     *   MiniMaxH3ReferenceToVideo positive
     *       -> MiniMaxH3AddGuide(frame_idx=0, exact final frame)
     *       -> BasicGuider conditioning
     *
     * The R2V AV latent itself remains connected directly to
     * SamplerCustomAdvanced.latent_image.
     *
     * Character/Picture/voice/prior-video references remain ordinary
     * MiniMaxH3ReferenceToVideo inputs and are not replaced by the guide.
     */
    const continuationGuideFilename =
      clean(input.startImageFilename);

    if (continuationGuideFilename) {
      const guideImageNodeId =
        referenceContract.continuationGuideImageNodeId;

      const guideNodeId =
        referenceContract.continuationGuideNodeId;

      const basicGuiderNodeId =
        referenceContract.basicGuiderNodeId;

      const samplerNodeId =
        referenceContract.samplerNodeId;

      if (graph[guideNodeId]) {
        throw new Error(
          `H3 continuation guide node ${guideNodeId} collides with the qualified R2V workflow.`,
        );
      }

      assertGraphLink(
        graph[basicGuiderNodeId].inputs.conditioning,
        contract.conditioningNodeId,
        0,
        "BasicGuider pre-guide conditioning",
      );

      assertGraphLink(
        graph[samplerNodeId].inputs.latent_image,
        contract.conditioningNodeId,
        1,
        "SamplerCustomAdvanced R2V latent",
      );

      const videoVaeLink =
        graph[contract.conditioningNodeId].inputs.vae;

      if (
        !Array.isArray(videoVaeLink)
        || videoVaeLink.length < 2
      ) {
        throw new Error(
          "Qualified H3 R2V workflow lost its video VAE link.",
        );
      }

      graph[guideImageNodeId] = {
        class_type: "LoadImage",
        inputs: {
          image: continuationGuideFilename,
        },
        _meta: {
          title:
            "OTG H3 Continue Scene Exact Frame-0 Guide",
        },
      };

      graph[guideNodeId] = {
        class_type: "MiniMaxH3AddGuide",
        inputs: {
          positive: [
            contract.conditioningNodeId,
            0,
          ],
          latent: [
            contract.conditioningNodeId,
            1,
          ],
          frame_idx: 0,
          vae: videoVaeLink,
          image: [
            guideImageNodeId,
            0,
          ],
        },
        _meta: {
          title:
            "OTG H3 Continue Scene Frame-0 Anchor",
        },
      };

      graph[basicGuiderNodeId]
        .inputs.conditioning = [
          guideNodeId,
          0,
        ];
    }

    if (input.operation === "visual-edit") {
      const filename = clean(input.videoReferenceFilename);
      if (!filename) throw new Error("H3 visual editing requires the exact selected video reference.");
      graph[referenceContract.videoReferenceLoaderNodeId] = {
        class_type: "LoadVideo",
        inputs: { file: filename },
        _meta: { title: "OTG H3 Selected Video Reference" },
      };
      graph[referenceContract.videoReferenceComponentsNodeId] = {
        class_type: "GetVideoComponents",
        inputs: { video: [referenceContract.videoReferenceLoaderNodeId, 0] },
        _meta: { title: "OTG H3 Video Reference Components" },
      };
      graph[contract.conditioningNodeId].inputs["ref_videos.ref_video_0"] = [referenceContract.videoReferenceComponentsNodeId, 0];
      if (input.includeVideoReferenceAudio !== false) {
        graph[contract.conditioningNodeId].inputs["ref_video_audios.ref_video_audio_0"] = [referenceContract.videoReferenceComponentsNodeId, 1];
      }
    } else {
      const references = orderedReferences(
        input.references || [],
        Boolean(input.videoReferences?.length || input.videoReferenceFilename || input.voices?.length),
      );
      const voices = orderedVoices(input.voices || []);
      const videoFilename = clean(input.videoReferenceFilename);
      // The legacy single-video continuation remains slot ref_videos.ref_video_0.
      // Direct H3 extends the same node contract deterministically through slots 1 and 2.
      const videoReferences = input.videoReferences?.length
        ? input.videoReferences.map((video) => ({
            uploadedFilename: clean(video.uploadedFilename),
            includeAudio: video.includeAudio !== false,
          }))
        : videoFilename
          ? [{
              uploadedFilename: videoFilename,
              includeAudio: input.includeVideoReferenceAudio !== false,
            }]
          : [];

      if (videoReferences.length > H3_MAX_VIDEO_REFERENCES) {
        throw new Error(`MiniMax H3 supports at most ${H3_MAX_VIDEO_REFERENCES} video references; no reference was dropped.`);
      }

      videoReferences.forEach((videoReference, index) => {
        if (!videoReference.uploadedFilename) {
          throw new Error(`H3 Video ${index + 1} is missing its uploaded filename.`);
        }
      });

      assertReferencePromptMatchesManifest(prompt, references, videoReferences, voices);

      references.forEach((reference, index) => {
        const nodeId = referenceContract.referenceImageNodeIds[index];
        graph[nodeId] = {
          class_type: "LoadImage",
          inputs: { image: clean(reference.uploadedFilename) },
          _meta: { title: `OTG H3 Picture ${index + 1}` },
        };
        graph[contract.conditioningNodeId].inputs[`ref_images.ref_image_${index}`] = [nodeId, 0];
      });

      voices.forEach((voice, index) => {
        const nodeId = referenceContract.referenceAudioNodeIds[index];
        graph[nodeId] = {
          class_type: "LoadAudio",
          inputs: { audio: clean(voice.uploadedFilename) },
          _meta: { title: `OTG H3 Audio ${index + 1}` },
        };
        graph[contract.conditioningNodeId].inputs[`ref_audios.ref_audio_${index}`] = [nodeId, 0];
      });

      /*
       * OTG_PRODUCTION_V2_H3_R2V_COMBINED_VIDEO_REFERENCE_V1
       *
       * Continuation video is additive. It must never replace the
       * ordinary Picture/Subject or Character voice references.
       */
      videoReferences.forEach((videoReference, index) => {
        const loaderNodeId = String(60 + index * 2);
        const componentsNodeId = String(61 + index * 2);
        if (graph[loaderNodeId] || graph[componentsNodeId]) {
          throw new Error(`H3 video-reference nodes ${loaderNodeId}/${componentsNodeId} collide with the qualified workflow template.`);
        }
        graph[loaderNodeId] = {
          class_type: "LoadVideo",
          inputs: {
            file:
              videoReference.uploadedFilename,
          },
          _meta: {
            title:
              `OTG H3 Video ${index + 1}`,
          },
        };

        graph[componentsNodeId] = {
          class_type:
            "GetVideoComponents",
          inputs: {
            video: [
              loaderNodeId,
              0,
            ],
          },
          _meta: {
            title:
              `OTG H3 Video ${index + 1} Components`,
          },
        };

        graph[contract.conditioningNodeId]
          .inputs[`ref_videos.ref_video_${index}`] = [
            componentsNodeId,
            0,
          ];

        if (videoReference.includeAudio) {
          graph[contract.conditioningNodeId]
            .inputs[`ref_video_audios.ref_video_audio_${index}`] = [
              componentsNodeId,
              1,
            ];
        }
      });
    }
  }

  return {
    workflowId:
      input.operation === "visual-edit"
        ? `${recipe.recipeId}-visual-edit`
        : recipe.recipeId,
    workflowFile:
      recipe.workflowFile,
    recipeId: recipe.recipeId,
    nativeWidth: nativeDimensions.width,
    nativeHeight: nativeDimensions.height,
    steps: recipe.steps,
    preSubmitCleanup: recipe.preSubmitCleanup,
    frameCount:
      h3FrameCountForDuration(input.durationSeconds),
    graph,
  };
}

export function loadH3VsrWorkflowTemplate(): H3PromptGraph {
  return JSON.parse(fs.readFileSync(path.join(process.cwd(), H3_VSR_WORKFLOW_FILE), "utf8")) as H3PromptGraph;
}

export function validateH3VsrWorkflowTemplate(graph = loadH3VsrWorkflowTemplate()) {
  assertNode(graph, "1", "RTXVideoSuperResolution");
  assertNode(graph, "6", "LoadVideo");
  assertNode(graph, "7", "GetVideoComponents");
  assertNode(graph, "8", "CreateVideo");
  assertNode(graph, "9", "SaveVideo");

  if (
    graph["1"].inputs.resize_type !== "target dimensions"
    || graph["1"].inputs["resize_type.width"] !== H3_FINAL_WIDTH
    || graph["1"].inputs["resize_type.height"] !== H3_FINAL_HEIGHT
    || graph["1"].inputs.quality !== "ULTRA"
  ) {
    throw new Error("Qualified RTX VSR must target 1920x1080 with ULTRA quality.");
  }

  if (graph["8"].inputs.bit_depth !== 8) {
    throw new Error("Qualified RTX VSR CreateVideo bit depth must be 8.");
  }

  assertGraphLink(graph["7"].inputs.video, "6", 0, "GetVideoComponents.video");
  assertGraphLink(graph["1"].inputs.images, "7", 0, "RTXVideoSuperResolution.images");
  assertGraphLink(graph["8"].inputs.images, "1", 0, "CreateVideo.images");
  assertGraphLink(graph["8"].inputs.audio, "7", 1, "CreateVideo.audio");
  assertGraphLink(graph["8"].inputs.fps, "7", 2, "CreateVideo.fps");
  assertGraphLink(graph["9"].inputs.video, "8", 0, "SaveVideo.video");
  return true;
}

export function buildH3VsrWorkflow(input: { videoInputFilename: string; outputPrefix: string }) {
  const graph = loadH3VsrWorkflowTemplate();
  validateH3VsrWorkflowTemplate(graph);
  const videoInputFilename = clean(input.videoInputFilename);
  const outputPrefix = clean(input.outputPrefix);
  if (!videoInputFilename) throw new Error("RTX VSR requires an uploaded native H3 video.");
  if (!outputPrefix) throw new Error("RTX VSR requires a deterministic output prefix.");
  graph["6"].inputs.file = videoInputFilename;
  graph["9"].inputs.filename_prefix = outputPrefix;
  return {
    workflowId: "minimax-h3-rtx-vsr-ultra-1080p-v1",
    workflowFile: H3_VSR_WORKFLOW_FILE,
    graph,
  };
}
