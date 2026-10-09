import fs from "node:fs";
import path from "node:path";

import { ensureTerminalVideoPreviewNode } from "@/lib/comfyVideoPreview";
import {
  getH3NativeDimensions,
  type H3Orientation,
  type H3ProductionDuration,
  type H3Quality,
} from "@/lib/production/h3ProductionRecipes";
import type {
  H3PromptGraph,
  ProductionV2H3BackendId,
} from "@/lib/production/h3Workflows";
import type { H3RefModSlot } from "@/lib/h3SpecialModes/refMods";

export type H3RefModsT2VWorkflowInput = {
  backend: ProductionV2H3BackendId;
  quality: H3Quality;
  orientation: H3Orientation;
  durationSeconds: H3ProductionDuration;
  prompt: string;
  refMods: H3RefModSlot[];
  turbo: boolean;
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

const WORKFLOW_ROOT = "comfy_workflows/internal/production-v2";
const LOADER_NODE_ID = "9400";
const TEXT_ENCODE_NODE_ID = "9401";

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function templateFileForBackend(backend: ProductionV2H3BackendId) {
  return `${WORKFLOW_ROOT}/${backend === "rtx3090" ? "minimax_h3_t2v_rtx3090.json" : "minimax_h3_t2v_rtx5060ti.json"}`;
}

function loadTemplate(backend: ProductionV2H3BackendId): H3PromptGraph {
  return JSON.parse(
    fs.readFileSync(path.join(process.cwd(), templateFileForBackend(backend)), "utf8"),
  ) as H3PromptGraph;
}

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
  const graph = loadTemplate(input.backend);
  const dimensions = getH3NativeDimensions(input.quality, input.orientation);
  const prompt = clean(input.prompt);
  if (!prompt) throw new Error("H3 Ref Mods generation requires a compiled prompt.");
  if (!Number.isSafeInteger(input.seed) || input.seed < 0) {
    throw new Error("H3 Ref Mods seed must be a non-negative safe integer.");
  }
  if (graph[LOADER_NODE_ID] || graph[TEXT_ENCODE_NODE_ID]) {
    throw new Error("H3 Ref Mods adapter nodes collide with the base T2V workflow.");
  }

  const scheduler = assertNode(graph, "24", "BasicScheduler");
  const sampler = assertNode(graph, "18", "KSamplerSelect");
  const noise = assertNode(graph, "31", "RandomNoise");
  const duration = assertNode(graph, "17", "PrimitiveFloat");
  const output = assertNode(graph, "5", "SaveVideo");
  const conditioning = assertNode(graph, "39", "MiniMaxH3ImageToVideo");
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

  if (input.turbo) {
    scheduler.inputs.steps = 8;
  } else {
    scheduler.inputs.steps = 20;
    sampler.inputs.sampler_name = "res_multistep";
    delete graph["36"];
    if (graph["38"]) graph["38"].inputs.model = ["30", 0];
  }

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

  ensureTerminalVideoPreviewNode(graph);

  return {
    workflowId: "h3-refmods-t2v",
    workflowFile: templateFileForBackend(input.backend),
    nativeWidth: dimensions.width,
    nativeHeight: dimensions.height,
    steps: Number(scheduler.inputs.steps) || (input.turbo ? 8 : 20),
    graph,
  };
}
