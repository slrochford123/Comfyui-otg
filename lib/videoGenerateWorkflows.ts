export type VideoGenerateOperation = "text_to_video" | "image_to_video" | "first_last_frame";
export type VideoGenerateModelId = "ltx23" | "wan22";
export type VideoGenerateFormat = "safetensor" | "gguf";
export type VideoGenerateOrientation = "portrait" | "landscape";

// Generate-page names retained by the Phase 2 UI/persisted-state contract.
export type VideoGenerationType = "create" | "starter_image" | "first_last";
export type VideoModelFamily = VideoGenerateModelId;
export type VideoModelFormat = "safetensors" | "gguf";

export type VideoGenerateWorkflow = {
  workflowId: string;
  label: string;
  operation: VideoGenerateOperation;
  modelId: VideoGenerateModelId;
  format: VideoGenerateFormat;
  needsImages: 0 | 1 | 2;
  runtime: string;
  nodes?: {
    outputNodeIds: string[];
    sizeNodeIds: string[];
    frameNodeIds: string[];
    fpsNodeIds: string[];
    firstImageNodeId?: string;
    lastImageNodeId?: string;
  };
};

export const VIDEO_GENERATE_FPS = 24;
export const VIDEO_GENERATE_DURATIONS = [5, 10, 15] as const;
export const VIDEO_GENERATE_SIZES = {
  landscape: { width: 1280, height: 720 },
  portrait: { width: 720, height: 1280 },
} as const;

export const VIDEO_GENERATE_OPERATION_LABELS: Record<VideoGenerateOperation, string> = {
  text_to_video: "Create Video",
  image_to_video: "Create Video with Starter Image",
  first_last_frame: "Create First and Last Image Video",
};

export const VIDEO_GENERATION_OPTIONS: Array<{
  id: VideoGenerationType;
  label: string;
  description: string;
}> = [
  { id: "create", label: "Create Video", description: "Generate a video from a text prompt." },
  { id: "starter_image", label: "Create Video with Starter Image", description: "Animate one starting image." },
  { id: "first_last", label: "Create First and Last Image Video", description: "Generate the transition between two supplied frames." },
];

export const VIDEO_GENERATE_MODEL_OPTIONS: Array<{ id: VideoGenerateModelId; label: string }> = [
  { id: "ltx23", label: "LTX 2.3" },
  { id: "wan22", label: "WAN 2.2" },
];

export const VIDEO_MODEL_OPTIONS = VIDEO_GENERATE_MODEL_OPTIONS;

export const VIDEO_GENERATE_FORMAT_LABELS: Record<VideoGenerateFormat, string> = {
  safetensor: "SafeTensor",
  gguf: "GGUF",
};

export const VIDEO_FORMAT_OPTIONS: Array<{ id: VideoModelFormat; label: string }> = [
  { id: "safetensors", label: "SafeTensor" },
  { id: "gguf", label: "GGUF" },
];

export const VIDEO_GENERATE_WORKFLOWS: VideoGenerateWorkflow[] = [
  {
    workflowId: "presets/Create a Video",
    label: "LTX 2.3 - Create Video - SafeTensor",
    operation: "text_to_video",
    modelId: "ltx23",
    format: "safetensor",
    needsImages: 0,
    runtime: "Estimated runtime depends on duration and active backend.",
  },
  {
    workflowId: "presets/Create a Video from Images",
    label: "LTX 2.3 - Starter Image - SafeTensor",
    operation: "image_to_video",
    modelId: "ltx23",
    format: "safetensor",
    needsImages: 1,
    runtime: "Estimated runtime depends on duration and active backend.",
  },
  {
    workflowId: "presets/Create First Image to Last Image Video",
    label: "LTX 2.3 - First and Last Frame - SafeTensor",
    operation: "first_last_frame",
    modelId: "ltx23",
    format: "safetensor",
    needsImages: 2,
    runtime: "Estimated runtime depends on duration and active backend.",
  },
  {
    workflowId: "presets/WAN 2.2 T2V GGUF",
    label: "WAN 2.2 - Create Video - GGUF",
    operation: "text_to_video",
    modelId: "wan22",
    format: "gguf",
    needsImages: 0,
    runtime: "720p at 24 FPS. GGUF runtime depends on duration and active backend.",
    nodes: {
      outputNodeIds: ["114"],
      sizeNodeIds: ["121"],
      frameNodeIds: ["121"],
      fpsNodeIds: ["114"],
    },
  },
  {
    workflowId: "presets/WAN 2.2 T2V SafeTensor",
    label: "WAN 2.2 - Create Video - SafeTensor",
    operation: "text_to_video",
    modelId: "wan22",
    format: "safetensor",
    needsImages: 0,
    runtime: "720p at 24 FPS. SafeTensor runtime depends on duration and active backend.",
    nodes: {
      outputNodeIds: ["114"],
      sizeNodeIds: ["121"],
      frameNodeIds: ["121"],
      fpsNodeIds: ["114"],
    },
  },
  {
    workflowId: "presets/WAN 2.2 I2V GGUF",
    label: "WAN 2.2 - Starter Image - GGUF",
    operation: "image_to_video",
    modelId: "wan22",
    format: "gguf",
    needsImages: 1,
    runtime: "720p at 24 FPS. GGUF runtime depends on duration and active backend.",
    nodes: {
      outputNodeIds: ["102"],
      sizeNodeIds: ["84"],
      frameNodeIds: ["63"],
      fpsNodeIds: ["102"],
      firstImageNodeId: "62",
    },
  },
  {
    workflowId: "presets/WAN 2.2 I2V SafeTensor",
    label: "WAN 2.2 - Starter Image - SafeTensor",
    operation: "image_to_video",
    modelId: "wan22",
    format: "safetensor",
    needsImages: 1,
    runtime: "720p at 24 FPS. SafeTensor runtime depends on duration and active backend.",
    nodes: {
      outputNodeIds: ["102"],
      sizeNodeIds: ["84"],
      frameNodeIds: ["63"],
      fpsNodeIds: ["102"],
      firstImageNodeId: "62",
    },
  },
  {
    workflowId: "presets/WAN 2.2 FLF GGUF",
    label: "WAN 2.2 - First and Last Frame - GGUF",
    operation: "first_last_frame",
    modelId: "wan22",
    format: "gguf",
    needsImages: 2,
    runtime: "720p at 24 FPS. BoundBite Q8 GGUF runtime depends on duration and active backend.",
    nodes: {
      outputNodeIds: ["174"],
      sizeNodeIds: ["127"],
      frameNodeIds: ["177"],
      fpsNodeIds: ["174"],
      firstImageNodeId: "139",
      lastImageNodeId: "147",
    },
  },
  {
    workflowId: "presets/WAN 2.2 FLF SafeTensor",
    label: "WAN 2.2 - First and Last Frame - SafeTensor",
    operation: "first_last_frame",
    modelId: "wan22",
    format: "safetensor",
    needsImages: 2,
    runtime: "720p at 24 FPS. SafeTensor runtime depends on duration and active backend.",
    nodes: {
      outputNodeIds: ["174"],
      sizeNodeIds: ["127"],
      frameNodeIds: ["177"],
      fpsNodeIds: ["174"],
      firstImageNodeId: "139",
      lastImageNodeId: "147",
    },
  },
];

export function normalizeVideoGenerateDuration(value: unknown): (typeof VIDEO_GENERATE_DURATIONS)[number] {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 5;
  let selected: (typeof VIDEO_GENERATE_DURATIONS)[number] = 5;
  let delta = Math.abs(parsed - selected);
  for (const duration of VIDEO_GENERATE_DURATIONS) {
    const nextDelta = Math.abs(parsed - duration);
    if (nextDelta < delta) {
      selected = duration;
      delta = nextDelta;
    }
  }
  return selected;
}

export function videoFramesForDuration(value: unknown) {
  return normalizeVideoGenerateDuration(value) * VIDEO_GENERATE_FPS + 1;
}

function phase2Operation(value: VideoGenerationType): VideoGenerateOperation {
  if (value === "starter_image") return "image_to_video";
  if (value === "first_last") return "first_last_frame";
  return "text_to_video";
}

function phase2Format(value: VideoModelFormat): VideoGenerateFormat {
  return value === "safetensors" ? "safetensor" : value;
}

export function resolveVideoGenerateWorkflow(selection: {
  operation: VideoGenerateOperation;
  modelId: VideoGenerateModelId;
  format: VideoGenerateFormat;
}): VideoGenerateWorkflow | null;
export function resolveVideoGenerateWorkflow(
  generationType: VideoGenerationType,
  modelFamily: VideoModelFamily,
  modelFormat: VideoModelFormat
): VideoGenerateWorkflow | null;
export function resolveVideoGenerateWorkflow(
  selectionOrGenerationType:
    | { operation: VideoGenerateOperation; modelId: VideoGenerateModelId; format: VideoGenerateFormat }
    | VideoGenerationType,
  modelFamily?: VideoModelFamily,
  modelFormat?: VideoModelFormat
) {
  const selection = typeof selectionOrGenerationType === "object"
    ? selectionOrGenerationType
    : {
        operation: phase2Operation(selectionOrGenerationType),
        modelId: modelFamily as VideoModelFamily,
        format: phase2Format(modelFormat as VideoModelFormat),
      };
  return VIDEO_GENERATE_WORKFLOWS.find(
    (workflow) =>
      workflow.operation === selection.operation &&
      workflow.modelId === selection.modelId &&
      workflow.format === selection.format
  ) || null;
}

export function videoGenerateSelectionForWorkflowId(workflowId: unknown) {
  const normalized = String(workflowId || "").trim().toLowerCase();
  return VIDEO_GENERATE_WORKFLOWS.find((workflow) => workflow.workflowId.toLowerCase() === normalized) || null;
}

export function availableVideoGenerateFormats(
  operation: VideoGenerateOperation,
  modelId: VideoGenerateModelId
) {
  return (["safetensor", "gguf"] as VideoGenerateFormat[]).filter((format) =>
    Boolean(resolveVideoGenerateWorkflow({ operation, modelId, format }))
  );
}

function graphLinkNodeId(value: unknown, graph: Record<string, any>) {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const nodeId = String(value[0]);
  return graph[nodeId] ? nodeId : null;
}

export function prunePromptGraphToOutputs(graph: Record<string, any>, outputNodeIds: string[]) {
  const keep = new Set<string>();
  const visit = (nodeIdRaw: string) => {
    const nodeId = String(nodeIdRaw);
    if (keep.has(nodeId) || !graph[nodeId]) return;
    keep.add(nodeId);
    for (const value of Object.values(graph[nodeId]?.inputs || {})) {
      const linkedNodeId = graphLinkNodeId(value, graph);
      if (linkedNodeId) visit(linkedNodeId);
    }
  };

  for (const outputNodeId of outputNodeIds) visit(outputNodeId);
  for (const nodeId of Object.keys(graph)) {
    if (!keep.has(nodeId)) delete graph[nodeId];
  }
  return [...keep];
}

function requiredNode(graph: Record<string, any>, nodeId: string, label: string) {
  const node = graph[nodeId];
  if (!node?.inputs || typeof node.inputs !== "object") {
    throw new Error(`WAN 2.2 workflow contract mismatch: missing ${label} node ${nodeId}.`);
  }
  return node;
}

function activeWanModelFormats(graph: Record<string, any>) {
  const formats = new Set<VideoGenerateFormat>();
  for (const node of Object.values<any>(graph)) {
    const classType = String(node?.class_type || "").toLowerCase();
    if (classType.includes("unetloadergguf")) formats.add("gguf");
    else if (classType === "unetloader") formats.add("safetensor");
  }
  return [...formats];
}

export function applyWan22GenerateOverrides(
  graph: Record<string, any>,
  body: Record<string, any>,
  assets: { imageA?: string | null; imageB?: string | null }
) {
  const workflow = videoGenerateSelectionForWorkflowId(body.workflowId || body.preset);
  if (!workflow || workflow.modelId !== "wan22" || !workflow.nodes) return null;

  const nodes = workflow.nodes;
  prunePromptGraphToOutputs(graph, nodes.outputNodeIds);

  const activeFormats = activeWanModelFormats(graph);
  if (activeFormats.length !== 1 || activeFormats[0] !== workflow.format) {
    throw new Error(
      `WAN 2.2 workflow contract mismatch: selected ${workflow.format}, active model graph is ${activeFormats.join("+") || "unknown"}.`
    );
  }

  const orientation: VideoGenerateOrientation = body.orientation === "portrait" ? "portrait" : "landscape";
  const size = VIDEO_GENERATE_SIZES[orientation];
  const durationSeconds = 5;
  const frames = videoFramesForDuration(durationSeconds);

  for (const nodeId of nodes.sizeNodeIds) {
    const node = requiredNode(graph, nodeId, "size");
    node.inputs.width = size.width;
    node.inputs.height = size.height;
  }
  for (const nodeId of nodes.frameNodeIds) {
    const node = requiredNode(graph, nodeId, "frame count");
    node.inputs.length = frames;
  }
  for (const nodeId of nodes.fpsNodeIds) {
    const node = requiredNode(graph, nodeId, "frame rate");
    node.inputs.frame_rate = VIDEO_GENERATE_FPS;
  }

  if (workflow.needsImages >= 1) {
    if (!assets.imageA) throw new Error("Upload a starter image for this WAN 2.2 workflow.");
    requiredNode(graph, String(nodes.firstImageNodeId), "first image").inputs.image = assets.imageA;
  }
  if (workflow.needsImages === 2) {
    if (!assets.imageB) throw new Error("Upload both a first image and a last image for this WAN 2.2 workflow.");
    requiredNode(graph, String(nodes.lastImageNodeId), "last image").inputs.image = assets.imageB;
  }

  const outputPrefix = `video/WAN22_${workflow.operation}_${workflow.format}`;
  for (const nodeId of nodes.outputNodeIds) {
    requiredNode(graph, nodeId, "video output").inputs.filename_prefix = outputPrefix;
  }

  return {
    workflowId: workflow.workflowId,
    operation: workflow.operation,
    modelId: workflow.modelId,
    format: workflow.format,
    orientation,
    width: size.width,
    height: size.height,
    fps: VIDEO_GENERATE_FPS,
    durationSeconds,
    frames,
    outputPrefix,
  };
}
