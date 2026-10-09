import fs from "node:fs";
import path from "node:path";

import { ensureTerminalVideoPreviewNode } from "@/lib/comfyVideoPreview";
import {
  getH3NativeDimensions,
  type H3Orientation,
  type H3ProductionDuration,
  type H3Quality,
} from "@/lib/production/h3ProductionRecipes";
import {
  compileH3BodySwapPrompt,
  validateH3BodySwapRequest,
} from "@/lib/h3SpecialModes/bodySwap";

type ComfyGraphNode = {
  class_type?: string;
  inputs?: Record<string, any>;
  _meta?: Record<string, unknown>;
};

export type H3BodySwapWorkflowInput = {
  sourceVideoFilename: string;
  replacementImageFilename: string;
  prompt?: string;
  selector: string;
  quality: H3Quality;
  orientation: H3Orientation;
  durationSeconds: H3ProductionDuration;
  seed: number;
  outputPrefix: string;
  preserveOriginalAudio?: boolean;
  compiledPromptOverride?: string;
};

export type H3BodySwapBuiltWorkflow = {
  workflowId: "h3-body-swap-single-person";
  workflowFile: string;
  graph: Record<string, ComfyGraphNode>;
  compiledPrompt: string;
};

const WORKFLOW_FILE = "comfy_workflows/internal/h3-special/body-swap.api.json";
const TEMPLATE_PATH = path.join(process.cwd(), WORKFLOW_FILE);
const SOURCE_VIDEO_NODE_ID = "720";
const REPLACEMENT_IMAGE_NODE_ID = "164";
const PROMPT_NODE_ID = "138";
const SELECTOR_NODE_ID = "715";
const SAM_TRACK_NODE_ID = "716";
const SAM_MASK_NODE_ID = "717";
const SEED_NODE_ID = "129";
const SCHEDULER_NODE_ID = "124";
const SILENCE_AUDIO_NODE_ID = "704";
const OUTPUT_NODE_ID = "92";
const MASK_PREVIEW_OUTPUT_NODE_ID = "722";
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
  if (!node) throw new Error(`Body Swap workflow template is missing node ${id}.`);
  if (classType && node.class_type !== classType) {
    throw new Error(`Body Swap workflow node ${id} must be ${classType}.`);
  }
  node.inputs ||= {};
  return node;
}

function setPrompt(graph: Record<string, ComfyGraphNode>, prompt: string) {
  const node = assertNode(graph, PROMPT_NODE_ID, "PrimitiveStringMultiline");
  node.inputs!.value = prompt;
}

function setInputs(graph: Record<string, ComfyGraphNode>, input: H3BodySwapWorkflowInput) {
  if (!input.sourceVideoFilename.trim()) throw new Error("Body Swap source video upload is required.");
  if (!input.replacementImageFilename.trim()) throw new Error("Body Swap replacement image upload is required.");
  const dimensions = getH3NativeDimensions(input.quality, input.orientation);
  const sourceVideo = assertNode(graph, SOURCE_VIDEO_NODE_ID, "VHS_LoadVideo");
  sourceVideo.inputs!.video = input.sourceVideoFilename;
  sourceVideo.inputs!.force_rate = 24;
  sourceVideo.inputs!.custom_width = dimensions.width;
  sourceVideo.inputs!.custom_height = dimensions.height;
  sourceVideo.inputs!.frame_load_cap = FRAME_COUNTS[input.durationSeconds];
  assertNode(graph, REPLACEMENT_IMAGE_NODE_ID, "LoadImage").inputs!.image = input.replacementImageFilename;
  assertNode(graph, SELECTOR_NODE_ID, "CLIPTextEncode").inputs!.text = input.selector;
  const track = assertNode(graph, SAM_TRACK_NODE_ID, "SAM3_VideoTrack");
  track.inputs!.detection_threshold = 0.5;
  track.inputs!.max_objects = 1;
  track.inputs!.detect_interval = 1;
  assertNode(graph, SAM_MASK_NODE_ID, "SAM3_TrackToMask").inputs!.object_indices = "0";
}

function setSeed(graph: Record<string, ComfyGraphNode>, seed: number) {
  if (!Number.isSafeInteger(seed) || seed < 0) {
    throw new Error("Body Swap seed must be a non-negative safe integer.");
  }
  assertNode(graph, SEED_NODE_ID, "RandomNoise").inputs!.noise_seed = seed;
}

function setSampling(graph: Record<string, ComfyGraphNode>) {
  const scheduler = assertNode(graph, SCHEDULER_NODE_ID, "BasicScheduler");
  scheduler.inputs!.scheduler = "simple";
  scheduler.inputs!.steps = 4;
}

function setOutputPrefix(graph: Record<string, ComfyGraphNode>, outputPrefix: string) {
  const prefix = outputPrefix.trim();
  if (!prefix) throw new Error("Body Swap output prefix is required.");
  assertNode(graph, OUTPUT_NODE_ID, "SaveVideo").inputs!.filename_prefix = prefix;
  assertNode(graph, MASK_PREVIEW_OUTPUT_NODE_ID, "SaveVideo").inputs!.filename_prefix = `${prefix}_mask`;
}

function preserveWorkflowSilencePath(graph: Record<string, ComfyGraphNode>) {
  // The supplied workflow intentionally renders silent audio. The app remuxes
  // the original source audio after visual generation when requested.
  assertNode(graph, SILENCE_AUDIO_NODE_ID, "AudioAdjustVolume").inputs!.volume = -100;
}

export function buildH3BodySwapWorkflow(
  input: H3BodySwapWorkflowInput,
): H3BodySwapBuiltWorkflow {
  const normalized = validateH3BodySwapRequest({
    prompt: input.prompt,
    selector: input.selector,
    quality: input.quality,
    orientation: input.orientation,
    durationSeconds: input.durationSeconds,
    preserveOriginalAudio: input.preserveOriginalAudio,
  });
  const graph = cloneTemplate();
  const compiledPrompt = input.compiledPromptOverride?.trim()
    || compileH3BodySwapPrompt({
      prompt: normalized.prompt,
      selector: normalized.selector,
      preserveOriginalAudio: normalized.preserveOriginalAudio,
    });

  setPrompt(graph, compiledPrompt);
  setInputs(graph, { ...input, selector: normalized.selector, durationSeconds: normalized.durationSeconds });
  setSeed(graph, input.seed);
  setSampling(graph);
  preserveWorkflowSilencePath(graph);
  setOutputPrefix(graph, input.outputPrefix);
  ensureTerminalVideoPreviewNode(graph);

  return {
    workflowId: "h3-body-swap-single-person",
    workflowFile: WORKFLOW_FILE,
    graph,
    compiledPrompt,
  };
}
