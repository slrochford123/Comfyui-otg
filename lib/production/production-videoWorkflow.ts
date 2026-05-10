import fs from "node:fs";
import path from "node:path";
import { readWorkflowJson } from "@/lib/comfyVoices";
import { extractPromptGraph, validatePromptGraph } from "@/lib/workflows";

export const DEFAULT_PRODUCTION_VIDEO_WORKFLOW = "presets/Production IA2V Lip Sync API.json";

export type ProductionVideoNodeMap = {
  imageNodeId: string;
  audioNodeId: string;
  positiveNodeId: string;
  negativeNodeId: string;
  durationNodeId: string;
  frameRateNodeId: string;
  widthNodeId?: string;
  heightNodeId?: string;
  seedNodeId?: string;
  combineNodeId?: string;
};

export type ProductionVideoWorkflowOptions = {
  workflowPath?: string;
  nodes?: Partial<ProductionVideoNodeMap>;
  comfyImageName: string;
  comfyAudioName: string;
  positivePrompt: string;
  negativePrompt: string;
  durationSeconds: number;
  frameRate: number;
  width?: number | null;
  height?: number | null;
  seed?: number | null;
  filenamePrefix?: string | null;
};

export const DEFAULT_PRODUCTION_VIDEO_NODES: ProductionVideoNodeMap = {
  imageNodeId: "269",
  audioNodeId: "276",
  positiveNodeId: "358",
  negativeNodeId: "364",
  durationNodeId: "378",
  frameRateNodeId: "379",
  widthNodeId: "368",
  heightNodeId: "382",
  combineNodeId: "400",
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function asNode(graph: any, id: string) {
  const node = graph?.[id];
  if (!node || typeof node !== "object") {
    throw new Error(`Workflow node ${id} is missing.`);
  }
  if (!node.inputs || typeof node.inputs !== "object") {
    throw new Error(`Workflow node ${id} does not contain inputs.`);
  }
  return node;
}

function setStringInput(node: any, keys: string[], value: string) {
  for (const key of keys) {
    if (typeof node.inputs?.[key] === "string" || node.inputs?.[key] == null) {
      node.inputs[key] = value;
      return true;
    }
  }
  return false;
}

function setNumberInput(node: any, keys: string[], value: number) {
  for (const key of keys) {
    if (typeof node.inputs?.[key] === "number" || node.inputs?.[key] == null) {
      node.inputs[key] = value;
      return true;
    }
  }
  return false;
}

function sanitizePrefix(raw: string | null | undefined): string {
  const text = String(raw || "").trim();
  if (!text) return "ProductionVideo";
  return text.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "ProductionVideo";
}

function workflowPathExists(relPath: string) {
  const root = path.resolve(process.cwd(), "comfy_workflows");
  return fs.existsSync(path.join(root, relPath));
}

export async function loadProductionVideoWorkflowTemplate(relPath = DEFAULT_PRODUCTION_VIDEO_WORKFLOW) {
  if (!workflowPathExists(relPath)) {
    throw new Error(
      `Production video workflow not found: ${relPath}. Export the working lip-sync workflow from ComfyUI in API/prompt format and save it under comfy_workflows/${relPath}.`
    );
  }

  const raw = await readWorkflowJson(relPath);
  const extracted = extractPromptGraph(raw);
  if (!extracted.ok) {
    throw new Error(
      `Production video workflow is not an API/prompt graph: ${extracted.error}`
    );
  }

  const valid = validatePromptGraph(extracted.graph);
  if (!valid.ok) {
    throw new Error(`Production video workflow is invalid: ${valid.error}`);
  }

  return clone(extracted.graph);
}

export async function buildProductionVideoPrompt(options: ProductionVideoWorkflowOptions) {
  const graph = await loadProductionVideoWorkflowTemplate(options.workflowPath || DEFAULT_PRODUCTION_VIDEO_WORKFLOW);
  const nodes: ProductionVideoNodeMap = {
    ...DEFAULT_PRODUCTION_VIDEO_NODES,
    ...(options.nodes || {}),
  };

  const imageNode = asNode(graph, nodes.imageNodeId);
  if (!setStringInput(imageNode, ["image", "filename", "file"], options.comfyImageName)) {
    throw new Error(`Unable to patch image input on workflow node ${nodes.imageNodeId}.`);
  }

  const audioNode = asNode(graph, nodes.audioNodeId);
  if (!setStringInput(audioNode, ["audio", "filename", "file"], options.comfyAudioName)) {
    throw new Error(`Unable to patch audio input on workflow node ${nodes.audioNodeId}.`);
  }

  const positiveNode = asNode(graph, nodes.positiveNodeId);
  if (!setStringInput(positiveNode, ["text", "prompt", "positive_prompt"], options.positivePrompt)) {
    throw new Error(`Unable to patch positive prompt on workflow node ${nodes.positiveNodeId}.`);
  }

  const negativeNode = asNode(graph, nodes.negativeNodeId);
  if (!setStringInput(negativeNode, ["text", "prompt", "negative_prompt"], options.negativePrompt)) {
    throw new Error(`Unable to patch negative prompt on workflow node ${nodes.negativeNodeId}.`);
  }

  const durationNode = asNode(graph, nodes.durationNodeId);
  if (!setNumberInput(durationNode, ["value", "duration", "seconds"], options.durationSeconds)) {
    throw new Error(`Unable to patch duration on workflow node ${nodes.durationNodeId}.`);
  }

  const frameRateNode = asNode(graph, nodes.frameRateNodeId);
  if (!setNumberInput(frameRateNode, ["value", "frame_rate", "fps"], options.frameRate)) {
    throw new Error(`Unable to patch frame rate on workflow node ${nodes.frameRateNodeId}.`);
  }

  if (nodes.widthNodeId && Number.isFinite(Number(options.width))) {
    const widthNode = asNode(graph, nodes.widthNodeId);
    setNumberInput(widthNode, ["value", "width"], Math.max(64, Math.floor(Number(options.width))));
  }

  if (nodes.heightNodeId && Number.isFinite(Number(options.height))) {
    const heightNode = asNode(graph, nodes.heightNodeId);
    setNumberInput(heightNode, ["value", "height"], Math.max(64, Math.floor(Number(options.height))));
  }

  if (nodes.seedNodeId && Number.isFinite(Number(options.seed))) {
    const seedNode = asNode(graph, nodes.seedNodeId);
    setNumberInput(seedNode, ["seed", "noise_seed", "value"], Math.floor(Number(options.seed)));
  }

  if (nodes.combineNodeId && graph[nodes.combineNodeId]?.inputs) {
    const combineNode = graph[nodes.combineNodeId];
    combineNode.inputs.save_output = true;
    const prefix = sanitizePrefix(options.filenamePrefix);
    if (typeof combineNode.inputs.filename_prefix === "string" || combineNode.inputs.filename_prefix == null) {
      combineNode.inputs.filename_prefix = prefix;
    }
  }

  return graph;
}
