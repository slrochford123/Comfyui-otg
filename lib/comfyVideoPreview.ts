export type ComfyVideoPreviewGraphNode = {
  class_type?: string;
  inputs?: Record<string, unknown>;
  _meta?: Record<string, unknown>;
};

export type ComfyVideoPreviewGraph = Record<string, ComfyVideoPreviewGraphNode>;

const TERMINAL_PREVIEW_TITLE = "OTG terminal video preview";
const TERMINAL_PREVIEW_CLASS = "PreviewAnimation";
const LEGACY_TERMINAL_PREVIEW_CLASSES = new Set([
  "DenoVideoPreview",
  "PreviewAnimation",
]);
const APPROXIMATE_PREVIEW_CLASS = "ModelPreviewOverrideKJ";

function linkTarget(value: unknown) {
  return Array.isArray(value) && typeof value[0] === "string" ? value[0] : null;
}

function hasTerminalPreview(graph: ComfyVideoPreviewGraph) {
  return Object.values(graph).some((node) =>
    LEGACY_TERMINAL_PREVIEW_CLASSES.has(String(node?.class_type || ""))
    && node._meta?.title === TERMINAL_PREVIEW_TITLE,
  );
}

function nextFreeNodeId(graph: ComfyVideoPreviewGraph, preferred = 9800) {
  let id = preferred;
  while (graph[String(id)]) id += 1;
  return String(id);
}

function addTerminalPreview(
  graph: ComfyVideoPreviewGraph,
  inputs: Record<string, unknown>,
  preferredId?: number,
) {
  const images = inputs.images;
  if (!Array.isArray(images)) return false;

  const previewInputs: Record<string, unknown> = {
    fps: Number(inputs.frame_rate || inputs.fps || 24) || 24,
    images,
  };

  graph[nextFreeNodeId(graph, preferredId)] = {
    class_type: TERMINAL_PREVIEW_CLASS,
    inputs: previewInputs,
    _meta: { title: TERMINAL_PREVIEW_TITLE },
  };
  return true;
}

function isModelLink(value: unknown, nodeId: string) {
  return Array.isArray(value) && value[0] === nodeId;
}

function hasApproximatePreview(graph: ComfyVideoPreviewGraph, title: string) {
  return Object.values(graph).some((node) =>
    node?.class_type === APPROXIMATE_PREVIEW_CLASS
    && node._meta?.title === title,
  );
}

export function ensureModelApproximatePreviewNode(
  graph: ComfyVideoPreviewGraph,
  args: {
    sourceNodeId: string;
    consumerNodeIds: readonly string[];
    preferredNodeId?: number;
    title?: string;
  },
) {
  const sourceNodeId = String(args.sourceNodeId || "").trim();
  const title = args.title || "OTG H3 approximate preview";
  if (!sourceNodeId || !graph[sourceNodeId] || hasApproximatePreview(graph, title)) {
    return graph;
  }

  const previewNodeId = nextFreeNodeId(graph, args.preferredNodeId ?? 9700);
  graph[previewNodeId] = {
    class_type: APPROXIMATE_PREVIEW_CLASS,
    inputs: {
      max_resolution: 512,
      jpeg_quality: 80,
      suppress_default_preview: true,
      preview_frames: 8,
      preview_fps: 8,
      tiny_vae: "taeh3.safetensors",
      model: [sourceNodeId, 0],
    },
    _meta: { title },
  };

  for (const consumerNodeId of args.consumerNodeIds) {
    const consumer = graph[consumerNodeId];
    if (!consumer?.inputs) continue;
    if (isModelLink(consumer.inputs.model, sourceNodeId) || consumer.inputs.model) {
      consumer.inputs.model = [previewNodeId, 0];
    }
  }

  return graph;
}

export function ensureTerminalVideoPreviewNode(
  graph: ComfyVideoPreviewGraph,
  preferredNodeId = 9800,
) {
  if (hasTerminalPreview(graph)) return graph;

  for (const node of Object.values(graph)) {
    if (node?.class_type !== "SaveVideo") continue;
    const sourceId = linkTarget(node.inputs?.video);
    const source = sourceId ? graph[sourceId] : null;
    if (source?.class_type === "CreateVideo" && addTerminalPreview(graph, source.inputs || {}, preferredNodeId)) {
      return graph;
    }
  }

  for (const node of Object.values(graph)) {
    if (node?.class_type === "VHS_VideoCombine" && addTerminalPreview(graph, node.inputs || {}, preferredNodeId)) {
      return graph;
    }
  }

  for (const node of Object.values(graph)) {
    if (node?.class_type === "CreateVideo" && addTerminalPreview(graph, node.inputs || {}, preferredNodeId)) {
      return graph;
    }
  }

  return graph;
}
