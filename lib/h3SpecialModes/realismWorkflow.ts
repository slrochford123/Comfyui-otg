import {
  H3_COMBAT_V2_LORA,
  H3_SINGULARITY_CHECKPOINT,
  type H3CheckpointMode,
} from "@/lib/production/h3Settings";
import type { ResolvedH3OptionalLora } from "@/lib/h3LoraCatalogServer";
import { applyH3OptionalLoraChainBeforeConsumer } from "@/lib/h3OptionalLoraChain";
import fs from "node:fs";
import path from "node:path";

import { ensureTerminalVideoPreviewNode } from "@/lib/comfyVideoPreview";
import {
  getH3NativeDimensions,
  normalizeH3Orientation,
  normalizeH3Quality,
  type H3Orientation,
  type H3ProductionDuration,
  type H3Quality,
} from "@/lib/production/h3ProductionRecipes";
import {
  compileH3RealismPrompt,
  H3_REALISM_PEOPLE_TRIGGER,
  normalizeH3RealismLoras,
  validateH3RealismRequest,
  type H3RealismLoraSettingsInput,
  type H3RealismReferenceInput,
} from "@/lib/h3SpecialModes/realism";

type ComfyGraphNode = {
  class_type?: string;
  inputs?: Record<string, any>;
  _meta?: Record<string, unknown>;
};

export type H3RealismWorkflowReference = H3RealismReferenceInput & {
  uploadedFilename: string;
};

export type H3RealismWorkflowInput = {
  prompt: string;
  quality: H3Quality;
  orientation: H3Orientation;
  durationSeconds: H3ProductionDuration;
  seed: number;
  outputPrefix: string;
  references?: H3RealismWorkflowReference[];
  loraSettings?: H3RealismLoraSettingsInput;
  optionalLoras?: ResolvedH3OptionalLora[];
  checkpointMode?: H3CheckpointMode;
  combatLoraEnabled?: boolean;
  compiledPromptOverride?: string;
};

export type H3RealismBuiltWorkflow = {
  workflowId: "h3-realism-special";
  workflowFile: string;
  graph: Record<string, ComfyGraphNode>;
  compiledPrompt: string;
};

const WORKFLOW_FILE = "comfy_workflows/internal/h3-special/realism.api.json";
const TEMPLATE_PATH = path.join(process.cwd(), WORKFLOW_FILE);
const CONDITIONING_NODE_ID = "265";
const PROMPT_NODE_ID = "263";
const DURATION_NODE_ID = "259";
const SEED_NODE_ID = "256";
const SCHEDULER_NODE_ID = "261";
const SPLIT_SIGMAS_NODE_ID = "289";
const DUAL_CLOCK_NODE_ID = "332";
const GUIDER_NODE_ID = "223";
const PRIMARY_SAMPLER_NODE_ID = "226";
const SAMPLER_SELECT_NODE_ID = "255";
const BASE_MODEL_NODE_ID = "192";
const LOCAL_REALISM_STANDARD_CHECKPOINT =
  "minimax_h3_ref2va_pruned_int8_convrot.safetensors";
const LOCAL_REALISM_SINGULARITY_CHECKPOINT =
  H3_SINGULARITY_CHECKPOINT;
const ACTIVE_SPEED_LORA_NODE_ID = "53";
const PEOPLE_LORA_NODE_ID = "337";
const ATTENTION_PATCH_NODE_ID = "58";
const OUTPUT_NODE_IDS = ["264"] as const;
const SPEED_LORA_NODE_IDS = ["53", "335", "336"] as const;
const IMAGE_NODE_IDS = ["51", "49", "331", "43", "19", "23", "199", "200", "201"] as const;
const VIDEO_NODE_IDS = ["27", "25", "26"] as const;
const AUDIO_NODE_IDS = ["48", "14", "15"] as const;
const FRAME_COUNTS: Record<H3ProductionDuration, 124 | 243> = {
  5: 124,
  10: 243,
};

function cloneTemplate() {
  return JSON.parse(fs.readFileSync(TEMPLATE_PATH, "utf8")) as Record<string, ComfyGraphNode>;
}

function assertNode(
  graph: Record<string, ComfyGraphNode>,
  id: string,
  classType?: string,
) {
  const node = graph[id];
  if (!node) throw new Error(`Realism workflow template is missing node ${id}.`);
  if (classType && node.class_type !== classType) {
    throw new Error(`Realism workflow node ${id} must be ${classType}.`);
  }
  node.inputs ||= {};
  return node;
}

function setPrompt(graph: Record<string, ComfyGraphNode>, prompt: string) {
  const node = assertNode(graph, PROMPT_NODE_ID);
  if (!node.class_type) {
    node.class_type = "PrimitiveStringMultiline";
    node._meta = { ...(node._meta || {}), title: "Compiled MiniMax H3 prompt" };
  }
  if (node.class_type === "PrimitiveStringMultiline" || node.class_type === "PrimitiveString") {
    delete node.inputs!.UNKNOWN;
    node.inputs!.value = prompt;
    return;
  }
  if (Object.prototype.hasOwnProperty.call(node.inputs, "value")) {
    node.inputs!.value = prompt;
    return;
  }
  if (Object.prototype.hasOwnProperty.call(node.inputs, "text")) {
    node.inputs!.text = prompt;
    return;
  }
  node.inputs!.UNKNOWN = prompt;
}

function setDimensions(
  graph: Record<string, ComfyGraphNode>,
  quality: H3Quality,
  orientation: H3Orientation,
  durationSeconds: H3ProductionDuration,
) {
  const dimensions = getH3NativeDimensions(quality, orientation);
  const conditioning = assertNode(graph, CONDITIONING_NODE_ID, "MiniMaxH3ReferenceToVideo");
  conditioning.inputs!.width = dimensions.width;
  conditioning.inputs!.height = dimensions.height;
  conditioning.inputs!.length = FRAME_COUNTS[durationSeconds];
  assertNode(graph, DURATION_NODE_ID, "PrimitiveFloat").inputs!.value = durationSeconds;
}

function setSeed(graph: Record<string, ComfyGraphNode>, seed: number) {
  if (!Number.isSafeInteger(seed) || seed < 0) {
    throw new Error("Realism seed must be a non-negative safe integer.");
  }
  assertNode(graph, SEED_NODE_ID, "RandomNoise").inputs!.noise_seed = seed;
}

function setLocalModelAssets(
  graph: Record<string, ComfyGraphNode>,
  checkpointMode: H3CheckpointMode,
) {
  assertNode(
    graph,
    BASE_MODEL_NODE_ID,
    "UNETLoader",
  ).inputs!.unet_name =
    checkpointMode === "singularity"
      ? LOCAL_REALISM_SINGULARITY_CHECKPOINT
      : LOCAL_REALISM_STANDARD_CHECKPOINT;
}

function pruneReferenceSlots(
  graph: Record<string, ComfyGraphNode>,
  references: H3RealismWorkflowReference[],
) {
  const conditioning = assertNode(graph, CONDITIONING_NODE_ID, "MiniMaxH3ReferenceToVideo");
  const images = references.filter((item) => item.kind === "image");
  const videos = references.filter((item) => item.kind === "video");
  const audios = references.filter((item) => item.kind === "audio");

  IMAGE_NODE_IDS.forEach((nodeId, index) => {
    const input = `ref_images.ref_image_${index}`;
    if (images[index]) {
      assertNode(graph, nodeId, "LoadImage").inputs!.image = images[index].uploadedFilename;
      conditioning.inputs![input] = [nodeId, 0];
    } else {
      delete conditioning.inputs![input];
      delete graph[nodeId];
    }
  });

  VIDEO_NODE_IDS.forEach((nodeId, index) => {
    const input = `ref_videos.ref_video_${index}`;
    if (videos[index]) {
      assertNode(graph, nodeId, "VHS_LoadVideo").inputs!.video = videos[index].uploadedFilename;
      conditioning.inputs![input] = [nodeId, 0];
    } else {
      delete conditioning.inputs![input];
      delete graph[nodeId];
    }
  });

  AUDIO_NODE_IDS.forEach((nodeId, index) => {
    const input = `ref_audios.ref_audio_${index}`;
    if (audios[index]) {
      assertNode(graph, nodeId, "LoadAudio").inputs!.audio = audios[index].uploadedFilename;
      conditioning.inputs![input] = [nodeId, 0];
    } else {
      delete conditioning.inputs![input];
      delete graph[nodeId];
    }
  });
}

function applySingularityCombatLora(
  graph: Record<string, ComfyGraphNode>,
  enabled: boolean,
) {
  if (!enabled) return;

  const attention = assertNode(graph, ATTENTION_PATCH_NODE_ID);
  const currentModel = attention.inputs!.model;

  if (!Array.isArray(currentModel) || !currentModel.length) {
    throw new Error(
      "Realism Singularity Combat V2 could not resolve the current model chain.",
    );
  }

  const nodeId = "9490";

  if (graph[nodeId]) {
    throw new Error(
      `Realism Singularity Combat V2 node ${nodeId} collides with the workflow template.`,
    );
  }

  graph[nodeId] = {
    class_type: "LoraLoaderModelOnly",
    inputs: {
      model: [String(currentModel[0]), Number(currentModel[1]) || 0],
      lora_name: H3_COMBAT_V2_LORA,
      strength_model: 1,
    },
    _meta: {
      title: "OTG H3 Combat V2 LoRA",
    },
  };

  attention.inputs!.model = [nodeId, 0];
}

function applyExclusiveLoras(
  graph: Record<string, ComfyGraphNode>,
  loraSettings: H3RealismLoraSettingsInput | undefined,
) {
  const loras = normalizeH3RealismLoras(loraSettings);
  const speedLora = loras.loras.find((item) => item.id !== "minimax-h3-people");
  if (!speedLora) throw new Error("Realism requires exactly one speed LoRA.");
  const speedNode = assertNode(graph, ACTIVE_SPEED_LORA_NODE_ID, "LoraLoaderModelOnly");
  speedNode.inputs!.model = [BASE_MODEL_NODE_ID, 0];
  speedNode.inputs!.lora_name = speedLora.filename;
  speedNode.inputs!.strength_model = speedLora.strength;

  SPEED_LORA_NODE_IDS
    .filter((nodeId) => nodeId !== ACTIVE_SPEED_LORA_NODE_ID)
    .forEach((nodeId) => {
      delete graph[nodeId];
    });

  if (loras.peopleRealismEnabled) {
    const peopleNode = assertNode(graph, PEOPLE_LORA_NODE_ID, "LoraLoaderModelOnly");
    const peopleLora = loras.loras.find((item) => item.id === "minimax-h3-people");
    peopleNode.inputs!.model = [ACTIVE_SPEED_LORA_NODE_ID, 0];
    peopleNode.inputs!.lora_name = peopleLora?.filename || "minimax-h3-people.safetensors";
    peopleNode.inputs!.strength_model = peopleLora?.strength ?? 0.8;
    assertNode(graph, ATTENTION_PATCH_NODE_ID).inputs!.model = [PEOPLE_LORA_NODE_ID, 0];
  } else {
    delete graph[PEOPLE_LORA_NODE_ID];
    assertNode(graph, ATTENTION_PATCH_NODE_ID).inputs!.model = [ACTIVE_SPEED_LORA_NODE_ID, 0];
  }

  const passOneSteps = Math.max(6, loras.steps);
  const totalSteps = passOneSteps + 4;
  const clock = assertNode(graph, DUAL_CLOCK_NODE_ID);
  clock.class_type = "MiniMaxH3SigmaShift";
  clock.inputs = {
    model: [ATTENTION_PATCH_NODE_ID, 0],
    shift_video: totalSteps,
    shift_audio: 3,
  };
  clock._meta = { ...(clock._meta || {}), title: "ModelSamplingMiniMaxH3" };

  const scheduler = assertNode(graph, SCHEDULER_NODE_ID, "BasicScheduler");
  scheduler.inputs!.steps = totalSteps;
  scheduler.inputs!.model = [DUAL_CLOCK_NODE_ID, 0];
  assertNode(graph, SPLIT_SIGMAS_NODE_ID, "SplitSigmas").inputs!.step = passOneSteps;
  assertNode(graph, GUIDER_NODE_ID, "BasicGuider").inputs!.model = [DUAL_CLOCK_NODE_ID, 0];
  const primarySampler = assertNode(graph, PRIMARY_SAMPLER_NODE_ID, "SamplerCustomAdvanced");
  primarySampler.inputs!.sampler = [SAMPLER_SELECT_NODE_ID, 0];
  primarySampler.inputs!.sigmas = [SCHEDULER_NODE_ID, 0];

  return loras;
}

function setOutputPrefix(
  graph: Record<string, ComfyGraphNode>,
  outputPrefix: string,
) {
  const prefix = outputPrefix.trim();
  if (!prefix) throw new Error("Realism output prefix is required.");
  delete graph["214"];
  OUTPUT_NODE_IDS.forEach((nodeId) => {
    const node = assertNode(graph, nodeId, "VHS_VideoCombine");
    node.inputs!.filename_prefix = prefix;
    node.inputs!.frame_rate = 24;
    node.inputs!.format = "video/h264-mp4";
    node.inputs!.pix_fmt = "yuv420p";
    node.inputs!.crf = 19;
    node.inputs!.save_metadata = true;
    node.inputs!.trim_to_audio = false;
  });
}

function ensurePeopleRealismTrigger(prompt: string, enabled: boolean) {
  const trimmed = prompt.trim();
  if (!enabled) return trimmed;
  return trimmed.startsWith(H3_REALISM_PEOPLE_TRIGGER)
    ? trimmed
    : `${H3_REALISM_PEOPLE_TRIGGER}\n\n${trimmed}`;
}

export function buildH3RealismWorkflow(
  input: H3RealismWorkflowInput,
): H3RealismBuiltWorkflow {
  const checkpointMode: H3CheckpointMode =
    input.checkpointMode === "singularity"
      ? "singularity"
      : "standard";

  const effectiveLoraSettings: H3RealismLoraSettingsInput | undefined =
    checkpointMode === "singularity"
      ? {
          ...(input.loraSettings || {}),
          peopleRealismEnabled: true,
        }
      : input.loraSettings;

  const normalized = validateH3RealismRequest({
    prompt: input.prompt,
    quality: input.quality,
    orientation: input.orientation,
    durationSeconds: input.durationSeconds,
    references: input.references || [],
    loraSettings: effectiveLoraSettings,
  });

  const graph = cloneTemplate();
  const orientation = normalizeH3Orientation(normalized.orientation);
  const quality = normalizeH3Quality(normalized.quality);
  const loras = applyExclusiveLoras(graph, effectiveLoraSettings);

  applySingularityCombatLora(
    graph,
    checkpointMode === "singularity"
      && input.combatLoraEnabled === true,
  );

  applyH3OptionalLoraChainBeforeConsumer(
    graph,
    ATTENTION_PATCH_NODE_ID,
    input.optionalLoras,
    9500,
    "H3 Realism",
  );

  const compiledPrompt = ensurePeopleRealismTrigger(
    input.compiledPromptOverride?.trim()
    || compileH3RealismPrompt({
      prompt: normalized.prompt,
      durationSeconds: normalized.durationSeconds,
      orientation,
      references: normalized.references,
      loras,
    }),
    loras.peopleRealismEnabled,
  );

  setPrompt(graph, compiledPrompt);
  setLocalModelAssets(graph, checkpointMode);
  setDimensions(graph, quality, orientation, normalized.durationSeconds);
  setSeed(graph, input.seed);
  pruneReferenceSlots(graph, input.references || []);
  setOutputPrefix(graph, input.outputPrefix);
  ensureTerminalVideoPreviewNode(graph);

  return {
    workflowId: "h3-realism-special",
    workflowFile: WORKFLOW_FILE,
    graph,
    compiledPrompt,
  };
}
