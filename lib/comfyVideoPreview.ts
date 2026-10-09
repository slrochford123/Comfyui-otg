export type ComfyVideoPreviewGraphNode = {
  class_type?: string;
  inputs?: Record<string, unknown>;
  _meta?: Record<string, unknown>;
};

export type ComfyVideoPreviewGraph = Record<string, ComfyVideoPreviewGraphNode>;

const TERMINAL_PREVIEW_CLASS = "DenoVideoPreview";

function linkTarget(value: unknown) {
  return Array.isArray(value) && typeof value[0] === "string" ? value[0] : null;
}

function hasTerminalPreview(graph: ComfyVideoPreviewGraph) {
  return Object.values(graph).some((node) =>
    node?.class_type === TERMINAL_PREVIEW_CLASS
    && node._meta?.title === "OTG terminal video preview",
  );
}

function nextFreeNodeId(graph: ComfyVideoPreviewGraph, preferred = 9800) {
  let id = preferred;
  while (graph[String(id)]) id += 1;
  return String(id);
}

function addDenoPreview(
  graph: ComfyVideoPreviewGraph,
  inputs: Record<string, unknown>,
  preferredId?: number,
) {
  const images = inputs.images;
  if (!Array.isArray(images)) return false;

  const previewInputs: Record<string, unknown> = {
    images,
    frame_rate: Number(inputs.frame_rate || inputs.fps || 24) || 24,
  };
  if (Array.isArray(inputs.audio)) previewInputs.audio = inputs.audio;

  graph[nextFreeNodeId(graph, preferredId)] = {
    class_type: TERMINAL_PREVIEW_CLASS,
    inputs: previewInputs,
    _meta: { title: "OTG terminal video preview" },
  };
  return true;
}

function sortedNodeEntries(graph: ComfyVideoPreviewGraph) {
  return Object.entries(graph).sort(([left], [right]) => {
    const leftNumber = Number(left);
    const rightNumber = Number(right);
    if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
      return leftNumber - rightNumber;
    }
    return left.localeCompare(right);
  });
}

export function ensureTerminalVideoPreviewNode(
  graph: ComfyVideoPreviewGraph,
  preferredNodeId = 9800,
) {
  if (hasTerminalPreview(graph)) return graph;

  for (const [, node] of sortedNodeEntries(graph)) {
    if (node?.class_type !== "SaveVideo") continue;
    const sourceId = linkTarget(node.inputs?.video);
    const source = sourceId ? graph[sourceId] : null;
    if (source?.class_type === "CreateVideo" && addDenoPreview(graph, source.inputs || {}, preferredNodeId)) {
      return graph;
    }
  }

  const vhsNodes = sortedNodeEntries(graph)
    .filter(([, node]) => node?.class_type === "VHS_VideoCombine" && Array.isArray(node.inputs?.images));
  const savedVhsNodes = vhsNodes.filter(([, node]) => node.inputs?.save_output !== false);
  for (const [, node] of (savedVhsNodes.length ? savedVhsNodes : vhsNodes).reverse()) {
    if (addDenoPreview(graph, node.inputs || {}, preferredNodeId)) {
      return graph;
    }
  }

  for (const [, node] of sortedNodeEntries(graph)) {
    if (node?.class_type === "CreateVideo" && addDenoPreview(graph, node.inputs || {}, preferredNodeId)) {
      return graph;
    }
  }

  return graph;
}
