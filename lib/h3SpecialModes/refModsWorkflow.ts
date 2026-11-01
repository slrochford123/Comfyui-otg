import { applyH3SmartReferenceGraph } from "@/lib/h3SmartReferencesGraph";
import type { H3SmartReferenceInput } from "@/lib/h3SmartReferences";
import { applyH3ResolvedRenderSettings, loadH3WorkflowTemplate, validateH3WorkflowTemplate } from "@/lib/production/h3Workflows";
import { normalizeH3AdvancedSettings, type H3AdvancedSettings } from "@/lib/production/h3Settings";
import { applyH3OmniRef, isH3OmniRefMode } from "@/lib/h3OmniRef";
import { applyH3SelfLift } from "@/lib/h3SelfLift";
import { assertFastH3Loras } from "@/lib/h3FastLora";
import { applyH3LoraTriggers } from "@/lib/h3LoraGuidance";
import type { ResolvedH3OptionalLora } from "@/lib/h3LoraCatalogServer";
import { applyH3OptionalLoraChainBeforeConsumer } from "@/lib/h3OptionalLoraChain";

import { ensureTerminalVideoPreviewNode } from "@/lib/comfyVideoPreview";
import {
  getH3ProductionRecipe,
  type H3Orientation,
  type H3ProductionDuration,
  type H3Quality,
} from "@/lib/production/h3ProductionRecipes";
import type {
  H3PromptGraph,
  ProductionV2H3BackendId,
} from "@/lib/production/h3Workflows";
import { h3RefModsDimensions } from "@/lib/h3SpecialModes/refMods";
import type { H3RefModSlot } from "@/lib/h3SpecialModes/refMods";

export type H3RefModsT2VWorkflowInput = {
  smartReferences?: H3SmartReferenceInput;
  smartImageFilenames?: string[];
  smartFirstFrameFilename?: string;
  backend: ProductionV2H3BackendId;
  quality: H3Quality;
  orientation: H3Orientation;
  durationSeconds: H3ProductionDuration;
  prompt: string;
  refMods: H3RefModSlot[];
  turbo: boolean;
  h3Settings?: H3AdvancedSettings;
  optionalLoras?: ResolvedH3OptionalLora[];
  seed: number;
  outputPrefix: string;
};

export type H3RefModsT2VBuiltWorkflow = {
  workflowId: "h3-refmods-t2v";
  workflowFile: string;
  nativeWidth: number;
  nativeHeight: number;
  steps: number;
  graph: H3PromptGraph;
};

const LOADER_NODE_ID = "9400";
const TEXT_ENCODE_NODE_ID = "9401";
function clean(value: unknown) { return String(value ?? "").trim(); }

function assertNode(graph: H3PromptGraph, nodeId: string, classType: string) {
  const node = graph[nodeId];
  if (!node || node.class_type !== classType) {
    throw new Error(`H3 Ref Mods workflow requires node ${nodeId} (${classType}).`);
  }
  return node;
}

function componentValue(value: H3RefModSlot["components"]) {
  return value === "Auto" ? "All" : value;
}

function loaderInputs(refMods: H3RefModSlot[]) {
  const inputs: Record<string, unknown> = {
    show_info: true,
    max_total_tokens: 0,
  };

  for (let index = 0; index < 8; index += 1) {
    const slot = refMods[index];
    const slotNumber = index + 1;
    inputs[`mod_${slotNumber}`] = slot?.name || "(none)";
    inputs[`strength_${slotNumber}`] = slot?.strength ?? 1;
    inputs[`copies_${slotNumber}`] = slot?.copies ?? 1;
    inputs[`components_${slotNumber}`] = slot ? componentValue(slot.components) : "All";
    inputs[`visual_strength_${slotNumber}`] = slot?.visualStrength ?? 1;
    inputs[`audio_strength_${slotNumber}`] = slot?.audioStrength ?? 1;
  }

  return inputs;
}

export function buildH3RefModsT2VWorkflow(
  input: H3RefModsT2VWorkflowInput,
): H3RefModsT2VBuiltWorkflow {
  // Reuse the same qualified Reference-to-Video base and model chain.
  // Saved RefMods provide its conditioning in place of uploaded references.
  const graph = loadH3WorkflowTemplate(input.backend, "h3-reference-to-video", input.durationSeconds, input.quality);
  validateH3WorkflowTemplate(input.backend, "h3-reference-to-video", input.durationSeconds, input.quality, graph);
  delete graph["40"];
  for (const key of Object.keys(graph["39"].inputs)) {
    if (/^ref_(images|videos|audios|video_audios)\./.test(key)) delete graph["39"].inputs[key];
  }
  const settings = normalizeH3AdvancedSettings(input.h3Settings || { renderMode: input.turbo ? "turbo" : "native" });
  const fast = isH3OmniRefMode(settings.checkpointMode);
  if (fast) assertFastH3Loras(input.optionalLoras || []);
  const dimensions = h3RefModsDimensions(input.quality, input.orientation, settings);
  const model = applyH3ResolvedRenderSettings(graph, {
    backend: input.backend, mode: "h3-reference-to-video", durationSeconds: input.durationSeconds, h3Quality: input.quality, h3Settings: settings,
  }, 0);
  graph["30"].inputs.unet_name = model.resolved.checkpoint === "standard"
    ? "minimax_h3_ref2va_pruned_int8_convrot.safetensors" : model.resolved.checkpoint;
  graph["38"].inputs.model = [model.baseModelNodeId, 0];
  const prompt = applyH3LoraTriggers(clean(input.prompt), [...model.resolved.singularityLoras, ...(input.optionalLoras || [])]);
  if (!prompt) throw new Error("H3 Ref Mods generation requires a compiled prompt.");
  if (!Number.isSafeInteger(input.seed) || input.seed < 0) {
    throw new Error("H3 Ref Mods seed must be a non-negative safe integer.");
  }
  if (graph[LOADER_NODE_ID] || graph[TEXT_ENCODE_NODE_ID]) {
    throw new Error("H3 Ref Mods adapter nodes collide with the base T2V workflow.");
  }

  const scheduler = assertNode(graph, "24", "BasicScheduler");
  assertNode(graph, "18", "KSamplerSelect");
  const noise = assertNode(graph, "31", "RandomNoise");
  const duration = assertNode(graph, "17", "PrimitiveFloat");
  const output = assertNode(graph, "5", "SaveVideo");
  const conditioning = assertNode(graph, "39", "MiniMaxH3ReferenceToVideo");
  const guider = assertNode(graph, "32", "BasicGuider");
  const samplerNode = assertNode(graph, "21", "SamplerCustomAdvanced");
  assertNode(graph, "15", "CLIPLoader");
  assertNode(graph, "3", "VAELoader");

  duration.inputs.value = input.durationSeconds;
  noise.inputs.noise_seed = input.seed;
  conditioning.inputs.prompt = prompt;
  conditioning.inputs.width = dimensions.width;
  conditioning.inputs.height = dimensions.height;
  output.inputs.filename_prefix = clean(input.outputPrefix);

  applyH3OptionalLoraChainBeforeConsumer(
    graph,
    "38",
    input.optionalLoras,
    9500,
    "H3 Ref Mods",
  );

  graph[LOADER_NODE_ID] = {
    class_type: "MiniMaxH3RefModsLoader",
    inputs: loaderInputs(input.refMods),
    _meta: { title: "OTG H3 RefMods Loader" },
  };
  graph[TEXT_ENCODE_NODE_ID] = {
    class_type: "MiniMaxH3RefModTextEncode",
    inputs: {
      clip: ["15", 0],
      mods: [LOADER_NODE_ID, 0],
      prompt,
      reference_fps: 24,
      max_total_tokens: 0,
      vae: ["3", 0],
    },
    _meta: { title: "OTG H3 RefMods Prompt Encoder" },
  };
  guider.inputs.conditioning = [TEXT_ENCODE_NODE_ID, 0];

  if (!Array.isArray(samplerNode.inputs.latent_image) || samplerNode.inputs.latent_image[0] !== "39") {
    throw new Error("H3 Ref Mods T2V base latent wiring is not the expected MiniMaxH3ImageToVideo output.");
  }

  if (fast) applyH3OmniRef(graph, input.backend);
  if (settings.checkpointMode === "selflift") {
    applyH3SelfLift(graph);
    graph["21"].inputs.positive = [TEXT_ENCODE_NODE_ID, 0];
    graph["selflift_negative"].inputs.conditioning = [TEXT_ENCODE_NODE_ID, 0];
  }

  applyH3SmartReferenceGraph(graph, input.smartReferences, {conditioningNodeId: "39", existingRefModEncoderId: "9401", imageFilenames: input.smartImageFilenames, firstFrameFilename: input.smartFirstFrameFilename});
  ensureTerminalVideoPreviewNode(graph);

  return {
    workflowId: "h3-refmods-t2v",
    workflowFile: getH3ProductionRecipe("h3-reference-to-video", input.durationSeconds, input.backend, input.quality).workflowFile,
    nativeWidth: dimensions.width,
    nativeHeight: dimensions.height,
    steps: Number(scheduler.inputs.steps) || model.resolved.steps,
    graph,
  };
}
