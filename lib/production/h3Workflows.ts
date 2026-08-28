import fs from "node:fs";
import path from "node:path";

import {
  resolveProductionV2H3UserLoras,
  type ProductionV2H3UserLoraState,
} from "@/lib/production/h3Loras";
import type {
  ProductionV2Duration,
  ProductionV2GenerationMode,
  ProductionV2ResolvedVoiceBinding,
  ProductionV2VisualReference,
} from "@/lib/production/v2";

export type ProductionV2H3BackendId = "rtx3090" | "rtx5060ti";
export type ProductionV2H3Mode = Extract<ProductionV2GenerationMode, "h3-image-to-video" | "h3-reference-to-video">;
export type H3PromptGraph = Record<string, { class_type: string; inputs: Record<string, unknown>; _meta?: Record<string, unknown> }>;

export const H3_MAX_IMAGE_REFERENCES = 9;
export const H3_MAX_AUDIO_REFERENCES = 3;
export const H3_NATIVE_WIDTH = 1024;
export const H3_NATIVE_HEIGHT = 576;
export const H3_FPS = 24;
export const H3_SAMPLER_STEPS = 8;

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
    workflowFiles: {
      "h3-image-to-video": `${WORKFLOW_ROOT}/minimax_h3_i2v_rtx3090.json`,
      "h3-reference-to-video": `${WORKFLOW_ROOT}/minimax_h3_r2v_rtx3090.json`,
    },
    diffusionModel: "minimax_h3_fl2va_pruned_fp8_scaled.safetensors",
    textEncoder: "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors",
  },
  rtx5060ti: {
    id: "rtx5060ti" as const,
    label: "RTX 5060 Ti",
    baseUrl: "http://127.0.0.1:8188",
    workflowFiles: {
      "h3-image-to-video": `${WORKFLOW_ROOT}/minimax_h3_i2v_rtx5060ti.json`,
      "h3-reference-to-video": `${WORKFLOW_ROOT}/minimax_h3_r2v_rtx5060ti.json`,
    },
    diffusionModel: "minimax_h3_fl2va_pruned_int8_convrot.safetensors",
    textEncoder: "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors",
  },
} as const;

export const H3_SHARED_ASSETS = {
  videoVae: "minimax_h3_video_vae_fp16.safetensors",
  audioVae: "minimax_h3_audio_vae_fp32.safetensors",
  turboLora: "MiniMax-H3/Acceleration/minimax_h3_fl2v_turbo_4step_v1.0_768p_comfyui_bf16.safetensors",
  attention: "comfy kitchen attention",
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
  "BasicScheduler",
  "KSamplerSelect",
  "SamplerCustomAdvanced",
  "RandomNoise",
  "BasicGuider",
  "SpectrumApplyMiniMaxH3",
] as const;

/**
 * Kept for source compatibility. Runtime compatibility checks must use
 * h3RequiredNodeClassesForBackend() because the two GPUs intentionally
 * use different attention implementations.
 */
export const H3_REQUIRED_NODE_CLASSES = H3_COMMON_REQUIRED_NODE_CLASSES;

export function h3RequiredNodeClassesForBackend(
  backend: ProductionV2H3BackendId,
): string[] {
  return [
    ...H3_COMMON_REQUIRED_NODE_CLASSES,
    ...(backend === "rtx3090"
      ? ["PathchSageAttentionKJ", "SolAttnPatch"]
      : ["ModelAttentionBackend"]),
  ];
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

  const modes: ProductionV2H3Mode[] = [
    "h3-image-to-video",
    "h3-reference-to-video",
  ];

  const seen = new Set<string>();
  const result: Array<readonly [string, string, string]> = [];

  for (const mode of modes) {
    const graph = loadH3WorkflowTemplate(backend, mode);

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

function templatePath(backend: ProductionV2H3BackendId, mode: ProductionV2H3Mode) {
  return path.join(process.cwd(), H3_BACKEND_PROFILES[backend].workflowFiles[mode]);
}

export function h3FrameCountForDuration(duration: ProductionV2Duration) {
  const frames = Math.max(5, Math.round(duration * H3_FPS));
  return frames + ((5 - (frames % 17)) % 17);
}

export function loadH3WorkflowTemplate(backend: ProductionV2H3BackendId, mode: ProductionV2H3Mode): H3PromptGraph {
  return JSON.parse(fs.readFileSync(templatePath(backend, mode), "utf8")) as H3PromptGraph;
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
  graph = loadH3WorkflowTemplate(backend, mode),
) {
  const contract = H3_WORKFLOW_CONTRACTS[mode];

  assertNode(
    graph,
    contract.conditioningNodeId,
    mode === "h3-image-to-video"
      ? "MiniMaxH3ImageToVideo"
      : "MiniMaxH3ReferenceToVideo",
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
    graph["38"].inputs.shift_video !== 12
    || graph["38"].inputs.shift_audio !== 3
  ) {
    throw new Error("Qualified H3 sigma shifts must be video 12 / audio 3.");
  }

  const conditioning = graph[contract.conditioningNodeId];

  if (
    conditioning.inputs.width !== H3_NATIVE_WIDTH
    || conditioning.inputs.height !== H3_NATIVE_HEIGHT
  ) {
    throw new Error(
      `Qualified H3 native resolution must be ${H3_NATIVE_WIDTH}x${H3_NATIVE_HEIGHT}.`,
    );
  }

  if (
    mode === "h3-reference-to-video"
    && conditioning.inputs.ref_image_size !== "match"
  ) {
    throw new Error("Qualified H3 R2V ref_image_size must be match.");
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
      !== "minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors"
    ) {
      throw new Error(
        "Qualified H3 R2V must use the official Ref2V Turbo LoRA.",
      );
    }
  } else {
    if (!/^minimax_h3_fl2va_/i.test(unetName)) {
      throw new Error(
        "Qualified H3 I2V must remain on the FL2VA diffusion family.",
      );
    }

    if (!/minimax_h3_fl2v_turbo_4step/i.test(turboName)) {
      throw new Error(
        "Qualified H3 I2V must remain on the FL2V Turbo LoRA family.",
      );
    }
  }

  const spectrum = oneClassNode(graph, "SpectrumApplyMiniMaxH3");

  if (
    spectrum.node.inputs.enabled !== true
    || spectrum.node.inputs.debug !== false
  ) {
    throw new Error(
      "Qualified H3 Spectrum must be enabled with benchmark debug disabled.",
    );
  }

  if (backend === "rtx3090") {
    if (classEntries(graph, "ModelAttentionBackend").length !== 0) {
      throw new Error(
        "RTX 3090 qualified H3 workflow must not use Comfy Kitchen.",
      );
    }

    const sage = oneClassNode(graph, "PathchSageAttentionKJ");
    const sol = oneClassNode(graph, "SolAttnPatch");

    if (
      sage.node.inputs.sage_attention
      !== "sageattn_qk_int8_pv_fp16_cuda"
      || sage.node.inputs.allow_compile !== false
    ) {
      throw new Error("RTX 3090 SageAttention contract changed.");
    }

    if (
      sol.node.inputs.tau !== 1.3
      || sol.node.inputs.start_percent !== 0.2
      || sol.node.inputs.end_percent !== 0.9
      || sol.node.inputs.min_tokens !== 4096
      || sol.node.inputs.int8_qk !== false
      || sol.node.inputs.int8_pv !== false
      || sol.node.inputs.sink_conditioning !== "exact_kv_and_rows"
      || sol.node.inputs.morton !== false
      || sol.node.inputs.morton_curve !== "2d_frame"
      || sol.node.inputs.use_tma !== false
      || sol.node.inputs.dense_blocks !== ""
    ) {
      throw new Error("RTX 3090 Sol-Attn contract changed.");
    }

    assertModelLink(
      sage.node.inputs.model,
      "38",
      "SageAttention",
    );

    assertModelLink(
      sol.node.inputs.model,
      sage.id,
      "Sol-Attn",
    );

    assertModelLink(
      spectrum.node.inputs.model,
      sol.id,
      "Spectrum",
    );

    assertModelLink(
      graph["32"].inputs.model,
      spectrum.id,
      "BasicGuider",
    );
  } else {
    if (
      classEntries(graph, "PathchSageAttentionKJ").length !== 0
      || classEntries(graph, "SolAttnPatch").length !== 0
    ) {
      throw new Error(
        "RTX 5060 Ti qualified H3 workflow must use CK, not Sage/Sol.",
      );
    }

    const ck = oneClassNode(graph, "ModelAttentionBackend");

    if (ck.node.inputs.attention !== "comfy kitchen attention") {
      throw new Error("RTX 5060 Ti CK attention contract changed.");
    }

    assertModelLink(
      ck.node.inputs.model,
      "38",
      "Comfy Kitchen",
    );

    assertModelLink(
      spectrum.node.inputs.model,
      ck.id,
      "Spectrum",
    );

    assertModelLink(
      graph["32"].inputs.model,
      spectrum.id,
      "BasicGuider",
    );
  }

  return true;
}

type UploadedVisualReference = ProductionV2VisualReference & { uploadedFilename: string };
type UploadedVoiceReference = ProductionV2ResolvedVoiceBinding & { uploadedFilename: string };

function orderedReferences(references: UploadedVisualReference[]) {
  if (!references.length) throw new Error("MiniMax H3 Reference-to-Video requires at least one visual reference.");
  if (references.length > H3_MAX_IMAGE_REFERENCES) throw new Error(`MiniMax H3 supports at most ${H3_MAX_IMAGE_REFERENCES} image references; no reference was dropped.`);
  const ordered = [...references].sort((left, right) => Number(left.pictureSlot || 0) - Number(right.pictureSlot || 0));
  ordered.forEach((reference, index) => {
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

function assertReferencePromptMatchesManifest(prompt: string, references: UploadedVisualReference[], voices: UploadedVoiceReference[]) {
  references.forEach((reference) => {
    if (!prompt.includes(`<Picture ${reference.pictureSlot}>`) || !prompt.includes(`<Subject ${reference.subjectSlot}>`)) {
      throw new Error(`The exact reviewed prompt is missing the manifest mapping for Picture ${reference.pictureSlot} / Subject ${reference.subjectSlot}.`);
    }
  });
  voices.forEach((voice) => {
    if (!prompt.includes(`<Audio ${voice.audioSlot}>`)) throw new Error(`The exact reviewed prompt is missing the manifest mapping for Audio ${voice.audioSlot}.`);
  });
  for (const match of prompt.matchAll(/<(Picture|Subject|Audio)\s+(\d+)>/g)) {
    const type = match[1];
    const slot = Number(match[2]);
    const limit = type === "Audio" ? voices.length : references.length;
    if (slot < 1 || slot > limit) throw new Error(`The exact reviewed prompt refers to ${type} ${slot}, but the submitted manifest contains only ${limit}.`);
  }
}

export type H3WorkflowBuildInput = {
  backend: ProductionV2H3BackendId;
  mode: ProductionV2H3Mode;
  finalPrompt: string;
  durationSeconds: ProductionV2Duration;
  seed: number;
  outputPrefix: string;
  startImageFilename?: string;
  references?: Array<ProductionV2VisualReference & { uploadedFilename: string }>;
  voices?: Array<ProductionV2ResolvedVoiceBinding & { uploadedFilename: string }>;
  operation?: "scene-generation" | "visual-edit";
  videoReferenceFilename?: string;
  includeVideoReferenceAudio?: boolean;
  userLoras?: ProductionV2H3UserLoraState;
};

function applyH3UserLoraChain(graph: H3PromptGraph, value: ProductionV2H3UserLoraState | undefined) {
  const selected = resolveProductionV2H3UserLoras(value);
  let previousNodeId = "36";

  selected.forEach((lora, index) => {
    const nodeId = String(70 + index);
    if (graph[nodeId]) throw new Error(`H3 user LoRA node ${nodeId} collides with the qualified workflow template.`);
    graph[nodeId] = {
      class_type: "LoraLoaderModelOnly",
      inputs: {
        model: [previousNodeId, 0],
        lora_name: lora.filename,
        strength_model: lora.strength,
      },
      _meta: { title: `OTG H3 ${lora.label} LoRA` },
    };
    previousNodeId = nodeId;
  });

  graph["38"].inputs.model = [previousNodeId, 0];
  return selected;
}

export function buildH3Workflow(input: H3WorkflowBuildInput) {
  const graph = loadH3WorkflowTemplate(input.backend, input.mode);
  validateH3WorkflowTemplate(input.backend, input.mode, graph);
  applyH3UserLoraChain(graph, input.userLoras);
  const contract = H3_WORKFLOW_CONTRACTS[input.mode];
  const prompt = clean(input.finalPrompt);
  if (!prompt) throw new Error("H3 generation requires the exact reviewed final prompt.");
  if (!Number.isSafeInteger(input.seed) || input.seed < 0) throw new Error("H3 generation seed must be a non-negative safe integer.");
  graph[contract.conditioningNodeId].inputs[contract.promptInput] = prompt;
  graph[contract.durationNodeId].inputs[contract.durationInput] = input.durationSeconds;
  graph[contract.seedNodeId].inputs[contract.seedInput] = input.seed;
  graph[contract.outputVideoNodeId].inputs[contract.outputPrefixInput] = clean(input.outputPrefix);

  if (input.mode === "h3-image-to-video") {
    const filename = clean(input.startImageFilename);
    if (!filename) throw new Error("H3 Image-to-Video requires exactly one uploaded starting image.");
    graph[H3_WORKFLOW_CONTRACTS[input.mode].startImageNodeId].inputs.image = filename;
  } else {
    const referenceContract = H3_WORKFLOW_CONTRACTS["h3-reference-to-video"];
    for (const nodeId of referenceContract.templateReferencePlaceholderNodeIds) delete graph[nodeId];
    for (const nodeId of referenceContract.referenceImageNodeIds) delete graph[nodeId];
    for (const nodeId of referenceContract.referenceAudioNodeIds) delete graph[nodeId];
    for (const key of Object.keys(graph[contract.conditioningNodeId].inputs)) {
      if (key.startsWith("ref_images.") || key.startsWith("ref_audios.") || key.startsWith("ref_videos.") || key.startsWith("ref_video_audios.")) delete graph[contract.conditioningNodeId].inputs[key];
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
      const references = orderedReferences(input.references || []);
      const voices = orderedVoices(input.voices || []);
      assertReferencePromptMatchesManifest(prompt, references, voices);
      references.forEach((reference, index) => {
        const nodeId = referenceContract.referenceImageNodeIds[index];
        graph[nodeId] = { class_type: "LoadImage", inputs: { image: clean(reference.uploadedFilename) }, _meta: { title: `OTG H3 Picture ${index + 1}` } };
        graph[contract.conditioningNodeId].inputs[`ref_images.ref_image_${index}`] = [nodeId, 0];
      });
      voices.forEach((voice, index) => {
        const nodeId = referenceContract.referenceAudioNodeIds[index];
        graph[nodeId] = { class_type: "LoadAudio", inputs: { audio: clean(voice.uploadedFilename) }, _meta: { title: `OTG H3 Audio ${index + 1}` } };
        graph[contract.conditioningNodeId].inputs[`ref_audios.ref_audio_${index}`] = [nodeId, 0];
      });
    }
  }

  return {
    workflowId: input.operation === "visual-edit" ? "minimax-h3-video-edit-native-1024x576-turbo8-spectrum-v1" : H3_WORKFLOW_CONTRACTS[input.mode].workflowId,
    workflowFile: H3_BACKEND_PROFILES[input.backend].workflowFiles[input.mode],
    frameCount: h3FrameCountForDuration(input.durationSeconds),
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
