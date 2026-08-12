type ComfyNode = {
  class_type?: string;
  inputs?: Record<string, unknown>;
  _meta?: Record<string, unknown>;
};

export type ComfyPromptGraph = Record<string, ComfyNode>;

export const WAN_NATIVE_FPS = 16;
export const WAN_OUTPUT_FPS = 24;
export const WAN_DURATION_OPTIONS = [5, 10, 15] as const;

export type WanDurationSeconds = (typeof WAN_DURATION_OPTIONS)[number];

export type WanRifeTiming = {
  durationSeconds: WanDurationSeconds;
  nativeFps: typeof WAN_NATIVE_FPS;
  outputFps: typeof WAN_OUTPUT_FPS;
  nativeFrames: number;
  outputFrames: number;
  skippedInterpolationPairs: number[];
};

export type WanRifeApplyResult = WanRifeTiming & {
  applied: boolean;
  lengthNodeIds: string[];
  outputNodeIds: string[];
  rifeNodeIds: string[];
  scheduleNodeIds: string[];
};

const WAN_LENGTH_NODE_TYPES = new Set([
  "EmptyHunyuanLatentVideo",
  "WanImageToVideo",
  "WanFirstLastFrameToVideo",
]);

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function scalarStringValues(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (typeof value === "number" || typeof value === "boolean") return [String(value)];
  if (Array.isArray(value)) return value.flatMap(scalarStringValues);
  if (!value || typeof value !== "object") return [];
  return Object.values(value as Record<string, unknown>).flatMap(scalarStringValues);
}

export function isWan22VideoGraph(graph: ComfyPromptGraph, descriptor: unknown = {}): boolean {
  const request = asRecord(descriptor);
  const descriptorText = [
    request.workflowId,
    request.preset,
    request.workflowFile,
    request.workflowPath,
    request.workflowLabel,
    request.videoModel,
    request.modelId,
  ]
    .flatMap(scalarStringValues)
    .join(" ")
    .toLowerCase();
  if (/\bwan[\s._/-]*2[\s._/-]*2\b/.test(descriptorText) || descriptorText.includes("wan22")) {
    return true;
  }

  return Object.values(graph).some((node) => {
    const classType = String(node?.class_type || "").toLowerCase();
    if (!classType.includes("loader") && !classType.includes("wan")) return false;
    const inputText = scalarStringValues(node?.inputs).join(" ").toLowerCase();
    return /\bwan[\s._/-]*2[\s._/-]*2\b/.test(inputText) || inputText.includes("wan22");
  });
}

export function normalizeWanDurationSeconds(value: unknown): WanDurationSeconds {
  const numeric = Number(value);
  if (WAN_DURATION_OPTIONS.includes(numeric as WanDurationSeconds)) {
    return numeric as WanDurationSeconds;
  }

  if (!Number.isFinite(numeric)) return 5;
  return WAN_DURATION_OPTIONS.reduce((best, candidate) =>
    Math.abs(candidate - numeric) < Math.abs(best - numeric) ? candidate : best
  );
}

export function resolveWanRifeTiming(value: unknown): WanRifeTiming {
  const durationSeconds = normalizeWanDurationSeconds(value);
  const nativeFrames = durationSeconds * WAN_NATIVE_FPS + 1;
  const outputFrames = durationSeconds * WAN_OUTPUT_FPS + 1;

  // RIFE multiplier=2 adds one frame between every input pair. Skipping every
  // odd-numbered pair interpolates exactly half the intervals, producing the
  // required rational 3:2 conversion from 16 FPS to 24 FPS.
  const skippedInterpolationPairs = Array.from(
    { length: Math.floor((nativeFrames - 1) / 2) },
    (_, index) => index * 2 + 1
  );

  return {
    durationSeconds,
    nativeFps: WAN_NATIVE_FPS,
    outputFps: WAN_OUTPUT_FPS,
    nativeFrames,
    outputFrames,
    skippedInterpolationPairs,
  };
}

function nextGraphNodeId(graph: ComfyPromptGraph): string {
  const numericIds = Object.keys(graph)
    .map((key) => Number(key))
    .filter((value) => Number.isSafeInteger(value) && value >= 0);
  let candidate = numericIds.length ? Math.max(...numericIds) + 1 : 1;
  while (graph[String(candidate)]) candidate += 1;
  return String(candidate);
}

function findScheduleForRife(graph: ComfyPromptGraph, rifeNode: ComfyNode): string | null {
  const link = rifeNode.inputs?.optional_interpolation_states;
  if (!Array.isArray(link) || link.length < 1) return null;
  const id = String(link[0]);
  return graph[id]?.class_type === "Make Interpolation State List" ? id : null;
}

function findRifeForOutput(graph: ComfyPromptGraph, outputNode: ComfyNode): string | null {
  const link = outputNode.inputs?.images;
  if (!Array.isArray(link) || link.length < 1) return null;
  const id = String(link[0]);
  return graph[id]?.class_type === "RIFE VFI" ? id : null;
}

function installOrUpdateRife(
  graph: ComfyPromptGraph,
  outputNodeId: string,
  timing: WanRifeTiming
): { rifeNodeId: string; scheduleNodeId: string } {
  const outputNode = graph[outputNodeId];
  outputNode.inputs = asRecord(outputNode.inputs);

  let rifeNodeId = findRifeForOutput(graph, outputNode);
  let sourceFrames: unknown;

  if (rifeNodeId) {
    sourceFrames = graph[rifeNodeId]?.inputs?.frames;
  } else {
    sourceFrames = outputNode.inputs.images;
    rifeNodeId = nextGraphNodeId(graph);
    graph[rifeNodeId] = {
      class_type: "RIFE VFI",
      inputs: {},
      _meta: { title: "OTG RIFE 16 FPS to 24 FPS" },
    };
    outputNode.inputs.images = [rifeNodeId, 0];
  }

  const rifeNode = graph[rifeNodeId];
  rifeNode.inputs = asRecord(rifeNode.inputs);

  let scheduleNodeId = findScheduleForRife(graph, rifeNode);
  if (!scheduleNodeId) {
    scheduleNodeId = nextGraphNodeId(graph);
    graph[scheduleNodeId] = {
      class_type: "Make Interpolation State List",
      inputs: {},
      _meta: { title: "OTG exact 3:2 interpolation schedule" },
    };
  }

  graph[scheduleNodeId].inputs = {
    frame_indices: timing.skippedInterpolationPairs.join(","),
    is_skip_list: true,
  };

  rifeNode.inputs = {
    ...rifeNode.inputs,
    frames: sourceFrames,
    optional_interpolation_states: [scheduleNodeId, 0],
    ckpt_name: "rife47.pth",
    clear_cache_after_n_frames: 10,
    multiplier: 2,
    fast_mode: true,
    ensemble: true,
    scale_factor: 1,
  };

  return { rifeNodeId, scheduleNodeId };
}

export function applyWanRifeFrameTiming(
  graph: ComfyPromptGraph,
  descriptor: Record<string, unknown> = {}
): WanRifeApplyResult {
  const requestedDuration =
    descriptor.durationSeconds ?? descriptor.durationSec ?? descriptor.seconds ?? descriptor.duration;
  const timing = resolveWanRifeTiming(requestedDuration);
  const empty: WanRifeApplyResult = {
    ...timing,
    applied: false,
    lengthNodeIds: [],
    outputNodeIds: [],
    rifeNodeIds: [],
    scheduleNodeIds: [],
  };

  if (!graph || typeof graph !== "object" || !isWan22VideoGraph(graph, descriptor)) return empty;

  const lengthNodeIds: string[] = [];
  const outputNodeIds: string[] = [];
  const rifeNodeIds: string[] = [];
  const scheduleNodeIds: string[] = [];

  for (const [nodeId, node] of Object.entries(graph)) {
    if (!node || typeof node !== "object") continue;
    node.inputs = asRecord(node.inputs);

    if (WAN_LENGTH_NODE_TYPES.has(String(node.class_type || "")) && "length" in node.inputs) {
      node.inputs.length = timing.nativeFrames;
      lengthNodeIds.push(nodeId);
    }

    if (node.class_type === "VHS_VideoCombine" && "images" in node.inputs) {
      node.inputs.frame_rate = timing.outputFps;
      outputNodeIds.push(nodeId);
    }
  }

  if (lengthNodeIds.length === 0 || outputNodeIds.length === 0) {
    throw new Error(
      "WAN 2.2 RIFE timing contract mismatch: expected a supported WAN latent-length node and VHS_VideoCombine output."
    );
  }

  for (const outputNodeId of outputNodeIds) {
    const installed = installOrUpdateRife(graph, outputNodeId, timing);
    rifeNodeIds.push(installed.rifeNodeId);
    scheduleNodeIds.push(installed.scheduleNodeId);
  }

  const interpolatedPairs =
    timing.nativeFrames - 1 - timing.skippedInterpolationPairs.length;
  const expectedFromSchedule = timing.nativeFrames + interpolatedPairs;
  if (expectedFromSchedule !== timing.outputFrames) {
    throw new Error(
      `WAN RIFE frame contract mismatch: expected ${timing.outputFrames} frames, calculated ${expectedFromSchedule}.`
    );
  }

  return {
    ...timing,
    applied: true,
    lengthNodeIds,
    outputNodeIds,
    rifeNodeIds,
    scheduleNodeIds,
  };
}
