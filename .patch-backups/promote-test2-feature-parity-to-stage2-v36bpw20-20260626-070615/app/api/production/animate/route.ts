import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";

export const runtime = "nodejs";

type WorkflowMode = "default" | "director";

type AnimateSegmentInput = {
  index?: number;
  imagePath?: string;
  imageUrl?: string;
  imageB64?: string;
  fileName?: string;
  name?: string;
  prompt?: string;
  seconds?: number;
  durationSeconds?: number;
  frames?: number;
};

type AnimateRequestBody = {
  workflowMode?: WorkflowMode;
  animateMode?: WorkflowMode;
  mode?: WorkflowMode;
  sceneId?: string;
  sceneTitle?: string;
  productionTitle?: string;
  fps?: number;
  frameRate?: number;
  guideStrength?: number;
  imageStrength?: number;
  useCustomAudio?: boolean;
  globalPrompt?: string;
  width?: number;
  height?: number;
  resizeMethod?: string;
  outputPrefix?: string;
  seed?: number;
  segments?: AnimateSegmentInput[];
  frames?: AnimateSegmentInput[];
  images?: AnimateSegmentInput[];
};

type WorkflowNode = {
  inputs?: Record<string, unknown>;
  class_type?: string;
  _meta?: Record<string, unknown>;
};

type WorkflowGraph = Record<string, WorkflowNode>;

const DEFAULT_WORKFLOW_PATH = path.join(
  process.cwd(),
  "app",
  "workflows",
  "production-animate-default-ltx23.json"
);

const DIRECTOR_WORKFLOW_PATH = path.join(
  process.cwd(),
  "app",
  "workflows",
  "production-animate-ltx-director.json"
);

const DEFAULT_FPS = 24;
const MAX_SEGMENTS = 4;
const DEFAULT_SEGMENT_SECONDS = 2;

const DEFAULT_SEGMENT_COLORS = ["#4f8edc", "#e07b3a", "#5cb85c", "#d9534f"];

const DEFAULT_MODE_NODE_IDS = {
  promptRelay: "948",
  imageNodes: ["820", "1072", "1082", "1092"],
  frameNodes: ["950", "1074", "1084", "1094"],
  fps: "697",
  width: "699",
  height: "701",
  imageStrength: "1118",
  output: "757",
};

function jsonError(message: string, status = 400, details?: unknown) {
  return NextResponse.json(
    {
      ok: false,
      error: message,
      details,
    },
    { status }
  );
}

function comfyUrl() {
  return (
    process.env.COMFYUI_URL ||
    process.env.COMFY_URL ||
    process.env.NEXT_PUBLIC_COMFYUI_URL ||
    process.env.NEXT_PUBLIC_COMFY_URL ||
    "http://127.0.0.1:8188"
  ).replace(/\/$/, "");
}

function comfyRoot() {
  return process.env.COMFYUI_ROOT || process.env.COMFY_ROOT || "C:\\AI\\Comfyui";
}

function comfyInputDir() {
  return process.env.COMFYUI_INPUT_DIR || process.env.COMFY_INPUT_DIR || path.join(comfyRoot(), "input");
}

function clampNumber(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function safeFileName(value: string) {
  return value
    .replace(/[^a-z0-9_\-]+/gi, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

function stripDataUrlPrefix(imageB64: string) {
  const match = imageB64.match(/^data:image\/[a-zA-Z0-9.+-]+;base64,(.*)$/);
  return match ? match[1] : imageB64;
}

function mimeToExt(imageB64: string) {
  const match = imageB64.match(/^data:image\/([a-zA-Z0-9.+-]+);base64,/);
  if (!match) return ".png";
  const type = match[1].toLowerCase();
  if (type.includes("jpeg") || type.includes("jpg")) return ".jpg";
  if (type.includes("webp")) return ".webp";
  if (type.includes("bmp")) return ".bmp";
  return ".png";
}

async function fileExists(filePath: string) {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

function getGalleryRoots() {
  return [
    process.env.OTG_GALLERY_DIR,
    process.env.GALLERY_DIR,
    process.env.COMFY_OUTPUT_DIR,
    process.env.COMFYUI_OUTPUT_DIR,
    "E:\\Renders\\ComfyUI",
    "C:\\AI\\Comfyui\\output",
    path.join(process.cwd(), "public"),
    path.join(process.cwd(), "public", "gallery"),
  ].filter(Boolean) as string[];
}

function extractNameFromUrlOrPath(raw: string) {
  try {
    if (raw.startsWith("http://") || raw.startsWith("https://")) {
      const url = new URL(raw);
      return url.searchParams.get("name") || url.searchParams.get("filename") || path.basename(url.pathname);
    }

    if (raw.includes("?")) {
      const fake = new URL(raw, "http://local");
      return fake.searchParams.get("name") || fake.searchParams.get("filename") || path.basename(fake.pathname);
    }

    return path.basename(raw);
  } catch {
    return path.basename(raw);
  }
}

function getInputSegments(body: AnimateRequestBody) {
  const source = body.segments || body.frames || body.images || [];
  return source
    .filter(Boolean)
    .slice(0, MAX_SEGMENTS)
    .map((segment, index) => ({
      ...segment,
      index: Number.isFinite(Number(segment.index)) ? Number(segment.index) : index + 1,
    }));
}

function buildLocalPrompt(segment: AnimateSegmentInput, index: number) {
  const prompt = String(segment.prompt || "").trim();
  if (prompt) return prompt;
  return `Segment ${index + 1}: Animate this keyframe with smooth cinematic motion, consistent character identity, and natural camera movement.`;
}

async function resolveImageFile(segment: AnimateSegmentInput) {
  const rawPath =
    segment.imagePath ||
    segment.imageUrl ||
    segment.fileName ||
    segment.name ||
    "";

  if (!rawPath) return null;

  const candidates: string[] = [];

  if (path.isAbsolute(rawPath)) {
    candidates.push(rawPath);
  }

  const normalizedRaw = rawPath.replace(/^\/+/, "");
  candidates.push(path.join(process.cwd(), normalizedRaw));
  candidates.push(path.join(process.cwd(), "public", normalizedRaw));

  const fileName = extractNameFromUrlOrPath(rawPath);
  for (const root of getGalleryRoots()) {
    candidates.push(path.join(root, fileName));
  }

  for (const candidate of candidates) {
    if (await fileExists(candidate)) {
      return candidate;
    }
  }

  return null;
}

async function resolveImageToB64(segment: AnimateSegmentInput) {
  if (segment.imageB64) {
    return stripDataUrlPrefix(segment.imageB64);
  }

  const resolvedFile = await resolveImageFile(segment);
  if (!resolvedFile) return null;

  const buffer = await fs.readFile(resolvedFile);
  return buffer.toString("base64");
}

async function ensureComfyInputImage(segment: AnimateSegmentInput, label: string) {  // OTG_PRODUCTION_ANIMATE_COMFY_UPLOAD_RETURN_FIX_V5
  const uploadedComfyName = String(
    (segment as any).comfyImageName ||
      (segment as any).comfyInputName ||
      (segment as any).uploadedComfyName ||
      ""
  ).trim();

  if (uploadedComfyName) {
    return uploadedComfyName;
  }

  const inputDir = comfyInputDir();
  await fs.mkdir(inputDir, { recursive: true });

  if (segment.imageB64) {
    const ext = mimeToExt(segment.imageB64);
    const fileName = `${label}${ext}`;
    const target = path.join(inputDir, fileName);
    await fs.writeFile(target, Buffer.from(stripDataUrlPrefix(segment.imageB64), "base64"));
    return fileName;
  }

  const resolvedFile = await resolveImageFile(segment);
  if (!resolvedFile) {
    throw new Error(`Could not resolve image for ${label}. Send imageB64 or a valid image path/name.`);
  }

  const ext = path.extname(resolvedFile) || ".png";
  const fileName = `${label}${ext}`;
  await fs.copyFile(resolvedFile, path.join(inputDir, fileName));
  return fileName;
}

function findNodeByClass(workflow: WorkflowGraph, classType: string) {
  for (const [id, node] of Object.entries(workflow)) {
    if (node?.class_type === classType) {
      return { id, node };
    }
  }
  return null;
}

async function loadWorkflow(workflowPath: string) {
  const raw = await fs.readFile(workflowPath, "utf8");
  return JSON.parse(raw) as WorkflowGraph;
}

function resolveMode(body: AnimateRequestBody): WorkflowMode {
  const mode = body.workflowMode || body.animateMode || body.mode;
  return mode === "director" ? "director" : "default";
}

function setNodeInput(workflow: WorkflowGraph, nodeId: string, inputName: string, value: unknown) {
  const node = workflow[nodeId];
  if (!node) {
    throw new Error(`Workflow node ${nodeId} not found.`);
  }

  node.inputs = node.inputs || {};
  node.inputs[inputName] = value;
}

function buildPreparedSegments(body: AnimateRequestBody, fps: number) {
  const inputSegments = getInputSegments(body);

  if (inputSegments.length < 1) {
    throw new Error("Animate requires at least one segment/image.");
  }

  return inputSegments.map((segment, index) => {
    const secondsResolved = clampNumber(
      segment.seconds ?? segment.durationSeconds,
      DEFAULT_SEGMENT_SECONDS,
      0.25,
      60
    );

    const framesResolved = Math.max(
      1,
      Number.isFinite(Number(segment.frames))
        ? Math.round(Number(segment.frames))
        : Math.round(secondsResolved * fps)
    );

    return {
      ...segment,
      promptResolved: buildLocalPrompt(segment, index),
      secondsResolved,
      framesResolved,
    };
  });
}

async function queueComfyWorkflow(workflow: WorkflowGraph) {
  const clientId = `otg-production-animate-${Date.now()}`;

  const response = await fetch(`${comfyUrl()}/prompt`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: clientId,
      prompt: workflow,
    }),
  });

  const responseText = await response.text();
  let responseJson: unknown = null;

  try {
    responseJson = JSON.parse(responseText);
  } catch {
    responseJson = responseText;
  }

  if (!response.ok) {
    throw new Error(`ComfyUI rejected workflow: ${JSON.stringify(responseJson)}`);
  }

  const promptId =
    responseJson &&
    typeof responseJson === "object" &&
    "prompt_id" in responseJson
      ? String((responseJson as { prompt_id: unknown }).prompt_id)
      : null;

  return {
    clientId,
    promptId,
    comfy: responseJson,
  };
}


// OTG_PRODUCTION_ANIMATE_CONDITIONING_FRAME_POSITION_FIX_V1_START
function buildDefaultModeConditioningFramePositions(
  segments: Array<AnimateSegmentInput & { framesResolved?: number }>,
  totalFrames: number
) {
  const safeTotalFrames = Math.max(1, Math.round(Number(totalFrames) || 1));
  const maxFrameIndex = Math.max(0, safeTotalFrames - 1);
  let cursor = 0;

  return segments.map((segment, index) => {
    if (index === 0) {
      return 0;
    }

    const previous = segments[index - 1];
    const previousFrames = Math.max(
      1,
      Math.round(Number(previous?.framesResolved) || 1)
    );

    cursor += previousFrames;

    return Math.max(0, Math.min(maxFrameIndex, cursor));
  });
}
// OTG_PRODUCTION_ANIMATE_CONDITIONING_FRAME_POSITION_FIX_V1_END

// OTG_PRODUCTION_ANIMATE_DEFAULT_DURATION_CONTROL_V1_START
function otgProductionAnimateIsNumericLike(value: unknown): boolean {
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string" && value.trim()) return Number.isFinite(Number(value));
  return false;
}

function otgProductionAnimateDurationFrameInputName(inputName: string): boolean {
  const key = String(inputName || "").trim();
  const normalized = key.replace(/[^a-zA-Z0-9]+/g, "_").toLowerCase();

  return [
    "num_frames",
    "number_of_frames",
    "frame_count",
    "frames",
    "video_frames",
    "total_frames",
    "duration_frames",
    "length",
    "latent_length",
    "num_video_frames",
    "max_frames",
    "target_frames",
  ].includes(normalized);
}

function otgProductionAnimateDurationSecondInputName(inputName: string): boolean {
  const key = String(inputName || "").trim();
  const normalized = key.replace(/[^a-zA-Z0-9]+/g, "_").toLowerCase();

  return [
    "duration_seconds",
    "duration_sec",
    "seconds",
    "target_seconds",
  ].includes(normalized);
}

function otgProductionAnimateFpsInputName(inputName: string): boolean {
  const key = String(inputName || "").trim();
  const normalized = key.replace(/[^a-zA-Z0-9]+/g, "_").toLowerCase();

  return [
    "fps",
    "frame_rate",
    "framerate",
  ].includes(normalized);
}

function applyDefaultModeDurationOverrides(
  workflow: WorkflowGraph,
  totalFrames: number,
  totalSeconds: number,
  fps: number
) {
  const safeFrames = Math.max(1, Math.round(Number(totalFrames) || 1));
  const safeSeconds = Math.max(0.1, Number(totalSeconds) || safeFrames / Math.max(1, fps));
  const safeFps = Math.max(1, Math.round(Number(fps) || DEFAULT_FPS));
  const skippedNodeIds = new Set<string>([
    DEFAULT_MODE_NODE_IDS.promptRelay,
    ...DEFAULT_MODE_NODE_IDS.frameNodes,
    ...DEFAULT_MODE_NODE_IDS.imageNodes,
  ]);

  let frameInputsUpdated = 0;
  let secondInputsUpdated = 0;
  let fpsInputsUpdated = 0;

  for (const [nodeId, node] of Object.entries(workflow)) {
    if (!node?.inputs || typeof node.inputs !== "object") continue;
    if (skippedNodeIds.has(nodeId)) continue;

    for (const inputName of Object.keys(node.inputs)) {
      const current = node.inputs[inputName];

      if (otgProductionAnimateDurationFrameInputName(inputName) && otgProductionAnimateIsNumericLike(current)) {
        node.inputs[inputName] = safeFrames;
        frameInputsUpdated += 1;
        continue;
      }

      if (otgProductionAnimateDurationSecondInputName(inputName) && otgProductionAnimateIsNumericLike(current)) {
        node.inputs[inputName] = Number(safeSeconds.toFixed(3));
        secondInputsUpdated += 1;
        continue;
      }

      if (otgProductionAnimateFpsInputName(inputName) && otgProductionAnimateIsNumericLike(current)) {
        node.inputs[inputName] = safeFps;
        fpsInputsUpdated += 1;
      }
    }
  }

  return {
    durationFrames: safeFrames,
    durationSeconds: Number(safeSeconds.toFixed(3)),
    fps: safeFps,
    frameInputsUpdated,
    secondInputsUpdated,
    fpsInputsUpdated,
  };
}
// OTG_PRODUCTION_ANIMATE_DEFAULT_DURATION_CONTROL_V1_END
async function runDefaultMode(body: AnimateRequestBody) {
  const fps = clampNumber(body.fps ?? body.frameRate, DEFAULT_FPS, 1, 60);
  const width = Math.round(clampNumber(body.width, 1280, 32, 8192));
  const height = Math.round(clampNumber(body.height, 720, 32, 8192));
  const imageStrength = clampNumber(body.imageStrength ?? body.guideStrength, 0.7, 0, 2);

  const activeSegments = buildPreparedSegments(body, fps);
  const paddedSegments = [...activeSegments];

  while (paddedSegments.length < MAX_SEGMENTS) {
    const last = paddedSegments[paddedSegments.length - 1];
    paddedSegments.push({
      ...last,
      promptResolved: `${last.promptResolved} Continue the motion naturally.`,
      secondsResolved: 1 / fps,
      framesResolved: 1,
    });
  }

  const defaultModeTotalFrames = Math.max(
    1,
    activeSegments.reduce(
      (sum, segment) => sum + Math.max(1, Math.round(Number(segment.framesResolved) || 1)),
      0
    )
  );
  const defaultModeConditioningFramePositions = buildDefaultModeConditioningFramePositions(
    paddedSegments,
    defaultModeTotalFrames
  );
  const defaultModeRequestedFrames = Math.max(
    1,
    activeSegments.reduce(
      (sum, segment) => sum + Math.max(1, Math.round(Number(segment.framesResolved) || 1)),
      0
    )
  );
  const defaultModeRequestedSeconds = activeSegments.reduce(
    (sum, segment) => sum + Math.max(0.1, Number(segment.secondsResolved) || 0),
    0
  );

  const workflow = await loadWorkflow(DEFAULT_WORKFLOW_PATH);
  const defaultModeDurationOverride = applyDefaultModeDurationOverrides(
    workflow,
    defaultModeRequestedFrames,
    defaultModeRequestedSeconds,
    fps
  );

  const runSlug = safeFileName(`${body.productionTitle || "production"}_${body.sceneTitle || body.sceneId || "scene"}_${Date.now()}`);

  for (let i = 0; i < MAX_SEGMENTS; i++) {
    const imageName = await ensureComfyInputImage(paddedSegments[i], `otg_${runSlug}_segment_${i + 1}`);
    setNodeInput(workflow, DEFAULT_MODE_NODE_IDS.imageNodes[i], "image", imageName);
    setNodeInput(workflow, DEFAULT_MODE_NODE_IDS.frameNodes[i], "value", defaultModeConditioningFramePositions[i] ?? 0);
  }

  const activeTimelineSegments = activeSegments.map((segment, index) => ({
    prompt: segment.promptResolved,
    length: segment.framesResolved,
    color: DEFAULT_SEGMENT_COLORS[index],
  }));

  setNodeInput(workflow, DEFAULT_MODE_NODE_IDS.promptRelay, "global_prompt", String(body.globalPrompt || "").trim());
  setNodeInput(workflow, DEFAULT_MODE_NODE_IDS.promptRelay, "timeline_data", JSON.stringify({ segments: activeTimelineSegments }));
  setNodeInput(workflow, DEFAULT_MODE_NODE_IDS.promptRelay, "local_prompts", activeSegments.map((segment) => segment.promptResolved).join(" | "));
  setNodeInput(workflow, DEFAULT_MODE_NODE_IDS.promptRelay, "segment_lengths", activeSegments.map((segment) => String(segment.framesResolved)).join(", "));
  setNodeInput(workflow, DEFAULT_MODE_NODE_IDS.promptRelay, "fps", fps);
  setNodeInput(workflow, DEFAULT_MODE_NODE_IDS.promptRelay, "time_units", "frames");
  setNodeInput(workflow, DEFAULT_MODE_NODE_IDS.promptRelay, "duration_frames", defaultModeRequestedFrames);
  setNodeInput(workflow, DEFAULT_MODE_NODE_IDS.promptRelay, "duration_seconds", Number(defaultModeRequestedSeconds.toFixed(3)));
  setNodeInput(workflow, DEFAULT_MODE_NODE_IDS.promptRelay, "duration_override", defaultModeDurationOverride);

  setNodeInput(workflow, DEFAULT_MODE_NODE_IDS.fps, "value", fps);
  setNodeInput(workflow, DEFAULT_MODE_NODE_IDS.width, "value", width);
  setNodeInput(workflow, DEFAULT_MODE_NODE_IDS.height, "value", height);
  setNodeInput(workflow, DEFAULT_MODE_NODE_IDS.imageStrength, "value", imageStrength);
  setNodeInput(workflow, DEFAULT_MODE_NODE_IDS.output, "filename_prefix", body.outputPrefix || `OTG_Default_${runSlug}`);

  const randomNoise = findNodeByClass(workflow, "RandomNoise");
  if (randomNoise?.node?.inputs) {
    randomNoise.node.inputs.noise_seed =
      Number.isFinite(Number(body.seed)) && Number(body.seed) > 0
        ? Math.round(Number(body.seed))
        : Math.floor(Math.random() * 2147483647);
  }

  const queued = await queueComfyWorkflow(workflow);

  return {
    mode: "default",
    fps,
    width,
    height,
    durationFrames: defaultModeRequestedFrames,
    durationSeconds: Number(defaultModeRequestedSeconds.toFixed(3)),
    segmentCount: activeSegments.length,
    outputPrefix: body.outputPrefix || `OTG_Default_${runSlug}`,
    durationOverride: defaultModeDurationOverride,
    ...queued,
  };
}

function buildDirectorTimelineData(
  segments: Array<AnimateSegmentInput & {
    imageB64Resolved: string;
    promptResolved: string;
    secondsResolved: number;
    framesResolved: number;
  }>,
  fps: number
) {
  let cursorSeconds = 0;
  let cursorFrames = 0;

  const timelineSegments: Record<string, unknown>[] = [];

  segments.forEach((segment, index) => {
    const startSeconds = cursorSeconds;
    const endSeconds = cursorSeconds + segment.secondsResolved;
    const startFrame = cursorFrames;
    const endFrame = cursorFrames + segment.framesResolved;

    timelineSegments.push({
      id: `image_${index + 1}`,
      type: "image",
      label: `Image ${index + 1}`,
      start: startSeconds,
      end: endSeconds,
      startTime: startSeconds,
      endTime: endSeconds,
      duration: segment.secondsResolved,
      durationSeconds: segment.secondsResolved,
      startFrame,
      endFrame,
      durationFrames: segment.framesResolved,
      imageB64: segment.imageB64Resolved,
      imageFile: "",
      fileName: `segment_${index + 1}.png`,
      prompt: segment.promptResolved,
      text: segment.promptResolved,
      guideStrength: 1,
    });

    timelineSegments.push({
      id: `prompt_${index + 1}`,
      type: "text",
      label: `Prompt ${index + 1}`,
      start: startSeconds,
      end: endSeconds,
      startTime: startSeconds,
      endTime: endSeconds,
      duration: segment.secondsResolved,
      durationSeconds: segment.secondsResolved,
      startFrame,
      endFrame,
      durationFrames: segment.framesResolved,
      prompt: segment.promptResolved,
      text: segment.promptResolved,
    });

    cursorSeconds = endSeconds;
    cursorFrames = endFrame;
  });

  return {
    fps,
    frameRate: fps,
    duration: cursorSeconds,
    durationSeconds: cursorSeconds,
    durationFrames: cursorFrames,
    segments: timelineSegments,
    audioSegments: [],
  };
}

async function runDirectorMode(body: AnimateRequestBody) {
  const fps = clampNumber(body.fps ?? body.frameRate, DEFAULT_FPS, 1, 60);
  const guideStrength = clampNumber(body.guideStrength, 1, 0, 2);

  const baseSegments = buildPreparedSegments(body, fps);

  const preparedSegments = [];

  for (let i = 0; i < baseSegments.length; i++) {
    const imageB64Resolved = await resolveImageToB64(baseSegments[i]);
    if (!imageB64Resolved) {
      throw new Error(`Could not resolve image for Director segment ${i + 1}.`);
    }

    preparedSegments.push({
      ...baseSegments[i],
      imageB64Resolved,
    });
  }

  const workflow = await loadWorkflow(DIRECTOR_WORKFLOW_PATH);
  const director = findNodeByClass(workflow, "LTXDirector");

  if (!director) {
    throw new Error("Director mode selected, but LTXDirector node was not found in production-animate-ltx-director.json.");
  }

  const totalFrames = preparedSegments.reduce((sum, segment) => sum + segment.framesResolved, 0);
  const totalSeconds = preparedSegments.reduce((sum, segment) => sum + segment.secondsResolved, 0);
  const timelineData = buildDirectorTimelineData(preparedSegments, fps);

  director.node.inputs = director.node.inputs || {};
  director.node.inputs.global_prompt = String(body.globalPrompt || "").trim();
  director.node.inputs.duration_frames = totalFrames;
  director.node.inputs.duration_seconds = Number(totalSeconds.toFixed(3));
  director.node.inputs.timeline_data = JSON.stringify(timelineData);
  director.node.inputs.local_prompts = preparedSegments.map((segment) => segment.promptResolved).join("\n");
  director.node.inputs.segment_lengths = preparedSegments.map((segment) => String(segment.framesResolved)).join(",");
  director.node.inputs.guide_strength = String(guideStrength);
  director.node.inputs.use_custom_audio = Boolean(body.useCustomAudio);
  director.node.inputs.frame_rate = fps;
  director.node.inputs.display_mode = "seconds";
  director.node.inputs.custom_width = Math.round(clampNumber(body.width, 0, 0, 8192));
  director.node.inputs.custom_height = Math.round(clampNumber(body.height, 0, 0, 8192));
  director.node.inputs.resize_method = body.resizeMethod || "maintain aspect ratio";

  const saveVideo = findNodeByClass(workflow, "SaveVideo");
  const runSlug = safeFileName(`${body.productionTitle || "production"}_${body.sceneTitle || body.sceneId || "scene"}_${Date.now()}`);
  const outputPrefix = body.outputPrefix || `video/OTG_Director_${runSlug}`;

  if (saveVideo?.node?.inputs) {
    saveVideo.node.inputs.filename_prefix = outputPrefix;
    saveVideo.node.inputs.format = "auto";
    saveVideo.node.inputs.codec = "auto";
  }

  const randomNoise = findNodeByClass(workflow, "RandomNoise");
  if (randomNoise?.node?.inputs) {
    randomNoise.node.inputs.noise_seed =
      Number.isFinite(Number(body.seed)) && Number(body.seed) > 0
        ? Math.round(Number(body.seed))
        : Math.floor(Math.random() * 2147483647);
  }

  const queued = await queueComfyWorkflow(workflow);

  return {
    mode: "director",
    fps,
    durationFrames: totalFrames,
    durationSeconds: Number(totalSeconds.toFixed(3)),
    segmentCount: preparedSegments.length,
    outputPrefix,
    ...queued,
  };
}


// OTG_PRODUCTION_ANIMATE_SINGLE_FRAME_PAYLOAD_FIX_V1B_START
function otgProductionAnimateDecodeApiFilePath(value: unknown): string {
  const raw = String(value || "").trim();
  if (!raw) return "";

  try {
    const parsed = new URL(raw, "http://otg.local");
    if (parsed.pathname === "/api/file") {
      return parsed.searchParams.get("path") || raw;
    }
    if (parsed.pathname === "/api/gallery/file") {
      return parsed.searchParams.get("name") || raw;
    }
  } catch {
    // keep raw
  }

  const pathMatch = raw.match(/[?&]path=([^&]+)/);
  if (pathMatch?.[1]) {
    try {
      return decodeURIComponent(pathMatch[1]);
    } catch {
      return pathMatch[1];
    }
  }

  const nameMatch = raw.match(/[?&]name=([^&]+)/);
  if (nameMatch?.[1]) {
    try {
      return decodeURIComponent(nameMatch[1]);
    } catch {
      return nameMatch[1];
    }
  }

  return raw;
}

function otgProductionAnimateNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function otgNormalizeProductionAnimatePayload<T extends Record<string, any>>(input: T): T {
  const body: any = input && typeof input === "object" ? { ...input } : {};

  const existingSegments = Array.isArray(body.segments) ? body.segments : [];
  const normalizedExistingSegments = existingSegments
    .map((segment: any, index: number) => {
      if (!segment || typeof segment !== "object") return null;

      const rawImage =
        segment.imagePath ||
        segment.image ||
        segment.sourceImage ||
        segment.imageUrl ||
        segment.indexImageUrl ||
        segment.frameImageUrl ||
        segment.frameUrl ||
        "";

      const imagePath = String(
        segment.imagePath ||
          segment.image ||
          segment.sourceImage ||
          otgProductionAnimateDecodeApiFilePath(rawImage)
      ).trim();

      const imageUrl = String(
        segment.imageUrl ||
          segment.indexImageUrl ||
          segment.frameImageUrl ||
          segment.frameUrl ||
          rawImage ||
          ""
      ).trim();

      const durationSec = otgProductionAnimateNumber(
        segment.durationSec ?? segment.durationSeconds ?? body.durationSec ?? body.durationSeconds,
        4
      );

      return {
        ...segment,
        index: otgProductionAnimateNumber(segment.index ?? segment.frameIndex, index),
        frameIndex: otgProductionAnimateNumber(segment.frameIndex ?? segment.index, index),
        image: segment.image || imagePath || imageUrl,
        sourceImage: segment.sourceImage || imagePath || imageUrl,
        imagePath,
        imageUrl,
        prompt: String(segment.prompt || body.prompt || body.globalPrompt || "").trim(),
        durationSec,
        durationSeconds: durationSec,
        guideStrength: otgProductionAnimateNumber(segment.guideStrength ?? body.guideStrength, 0.75),
      };
    })
    .filter((segment: any) => Boolean(segment?.imagePath || segment?.imageUrl || segment?.image || segment?.sourceImage));

  if (normalizedExistingSegments.length > 0) {
    return {
      ...body,
      workflowMode: body.workflowMode || body.mode || "default",
      mode: body.mode || body.workflowMode || "default",
      segments: normalizedExistingSegments,
    } as T;
  }

  const rawImage =
    body.imagePath ||
    body.image ||
    body.sourceImage ||
    body.indexImagePath ||
    body.frameImagePath ||
    body.imageUrl ||
    body.indexImageUrl ||
    body.frameImageUrl ||
    body.frameUrl ||
    "";

  const imagePath = String(
    body.imagePath ||
      body.image ||
      body.sourceImage ||
      body.indexImagePath ||
      body.frameImagePath ||
      otgProductionAnimateDecodeApiFilePath(rawImage)
  ).trim();

  const imageUrl = String(
    body.imageUrl ||
      body.indexImageUrl ||
      body.frameImageUrl ||
      body.frameUrl ||
      rawImage ||
      ""
  ).trim();

  if (!imagePath && !imageUrl) {
    return input;
  }

  const durationSec = otgProductionAnimateNumber(body.durationSec ?? body.durationSeconds ?? body.seconds, 4);
  const frameRate = otgProductionAnimateNumber(body.frameRate ?? body.fps, 24);
  const width = otgProductionAnimateNumber(body.width, String(body.aspectRatio || "").includes("9:16") ? 720 : 1280);
  const height = otgProductionAnimateNumber(body.height, String(body.aspectRatio || "").includes("9:16") ? 1280 : 720);
  const frameIndex = otgProductionAnimateNumber(body.frameIndex ?? body.index, 0);

  const segment = {
    index: frameIndex,
    frameIndex,
    image: imagePath || imageUrl,
    sourceImage: imagePath || imageUrl,
    imagePath,
    imageUrl,
    prompt: String(body.prompt || body.localPrompt || body.globalPrompt || "").trim(),
    durationSec,
    durationSeconds: durationSec,
    guideStrength: otgProductionAnimateNumber(body.guideStrength, 0.75),
    imageB64: body.imageB64 || body.imageDataUrl || "",
  };

  return {
    ...body,
    workflowMode: body.workflowMode || body.mode || "default",
    mode: body.mode || body.workflowMode || "default",
    image: body.image || imagePath || imageUrl,
    sourceImage: body.sourceImage || imagePath || imageUrl,
    imagePath: body.imagePath || imagePath,
    imageUrl: body.imageUrl || imageUrl,
    indexImageUrl: body.indexImageUrl || imageUrl,
    durationSec,
    durationSeconds: durationSec,
    frameRate,
    width,
    height,
    settings: {
      ...(body.settings || {}),
      durationSec: otgProductionAnimateNumber(body.settings?.durationSec ?? durationSec, durationSec),
      frameRate: otgProductionAnimateNumber(body.settings?.frameRate ?? frameRate, frameRate),
      width: otgProductionAnimateNumber(body.settings?.width ?? width, width),
      height: otgProductionAnimateNumber(body.settings?.height ?? height, height),
    },
    segments: [segment],
  } as T;
}
// OTG_PRODUCTION_ANIMATE_SINGLE_FRAME_PAYLOAD_FIX_V1B_END

// OTG_PRODUCTION_ANIMATE_UPLOAD_SEGMENT_IMAGES_V2_START
function otgProductionAnimateCleanBaseUrl(value: unknown): string {
  return String(value || "").trim().replace(/\/+$/, "");
}

function otgProductionAnimateConfiguredComfyBaseUrl(raw: unknown): string {
  const direct = otgProductionAnimateCleanBaseUrl(raw);
  if (direct) return direct;

  const candidates = [
    process.env.OTG_VIDEO_COMFY_BASE_URL,
    process.env.VIDEO_COMFY_BASE_URL,
    process.env.COMFY_VIDEO_BASE_URL,
    process.env.NEXT_PUBLIC_VIDEO_COMFY_BASE_URL,
    process.env.OTG_COMFY_BASE_URL,
    process.env.COMFY_BASE_URL,
    process.env.COMFYUI_BASE_URL,
    process.env.NEXT_PUBLIC_COMFY_BASE_URL,
    process.env.NEXT_PUBLIC_COMFYUI_BASE_URL,
  ];

  for (const candidate of candidates) {
    const normalized = otgProductionAnimateCleanBaseUrl(candidate);
    if (normalized) return normalized;
  }

  return "http://127.0.0.1:8188";
}

function otgProductionAnimateUploadSafeName(value: unknown, fallback: string): string {
  const raw = String(value || fallback || "otg_production_animate_input.png").trim();
  const base = raw.split(/[\\/]/g).pop() || fallback || "otg_production_animate_input.png";
  const noQuery = base.split("?")[0] || base;
  const cleaned = noQuery.replace(/[^a-zA-Z0-9._() -]+/g, "_").slice(0, 160);
  return cleaned || fallback || "otg_production_animate_input.png";
}

function otgProductionAnimateSourceCandidates(segment: any, body: any) {
  const values = [
    segment?.imageB64,
    segment?.imageDataUrl,
    body?.imageB64,
    body?.imageDataUrl,
    segment?.sourceImageUrl,
    segment?.sourceUrl,
    segment?.originalImageUrl,
    segment?.frameImageUrl,
    segment?.indexImageUrl,
    segment?.imageUrl,
    segment?.frameUrl,
    body?.sourceImageUrl,
    body?.indexImageUrl,
    body?.frameImageUrl,
    body?.imageUrl,
    segment?.sourceImagePath,
    segment?.originalImagePath,
    segment?.frameImagePath,
    segment?.indexImagePath,
    segment?.imagePath,
    segment?.image,
    segment?.sourceImage,
  ];

  const seen = new Set<string>();
  const out: string[] = [];

  for (const value of values) {
    const text = String(value || "").trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }

  return out;
}


// OTG_PRODUCTION_ANIMATE_IMAGEB64_FIX_V3_ROUTE_BASE64_START
function otgProductionAnimateBase64ToFile(value: unknown, fallbackName: string): File | null {
  const raw = String(value || "").trim();
  if (!raw) return null;

  let base64 = raw;
  let contentType = "image/png";

  const dataUrlMatch = raw.match(/^data:([^;]+);base64,(.+)$/i);
  if (dataUrlMatch) {
    contentType = dataUrlMatch[1] || contentType;
    base64 = dataUrlMatch[2] || "";
  }

  if (!base64 || base64.length < 64) return null;
  if (!/^[a-zA-Z0-9+/=\r\n]+$/.test(base64)) return null;

  try {
    const bytes = Buffer.from(base64, "base64");
    if (!bytes.length) return null;
    const safeName = otgProductionAnimateUploadSafeName(fallbackName, "otg_production_animate_input.png");
    return new File([new Uint8Array(bytes)], safeName, { type: contentType });
  } catch {
    return null;
  }
}
// OTG_PRODUCTION_ANIMATE_IMAGEB64_FIX_V3_ROUTE_BASE64_END
async function otgProductionAnimateFileFromFetch(
  req: Request,
  rawSource: string,
  fallbackName: string
): Promise<File | null> {
  const source = String(rawSource || "").trim();
  if (!source) return null;

  let url = "";

  try {
    url = new URL(source, req.url).toString();
  } catch {
    return null;
  }

  if (!/^https?:\/\//i.test(url)) return null;

  const headers: Record<string, string> = {};
  const cookie = req.headers.get("cookie");
  if (cookie) headers.cookie = cookie;

  const response = await fetch(url, {
    cache: "no-store",
    headers,
  });

  if (!response.ok) {
    throw new Error(`Could not fetch Animate source image ${source}: ${response.status}`);
  }

  const blob = await response.blob();
  if (!blob.size) {
    throw new Error(`Animate source image was empty: ${source}`);
  }

  const contentType = response.headers.get("content-type") || blob.type || "image/png";
  const name = otgProductionAnimateUploadSafeName(source, fallbackName);

  return new File([blob], name, { type: contentType });
}

async function otgProductionAnimateFileFromLocalPath(
  rawSource: string,
  fallbackName: string
): Promise<File | null> {
  const source = String(rawSource || "").trim();
  if (!source) return null;

  const looksLocal =
    /^[a-zA-Z]:[\\/]/.test(source) ||
    source.startsWith("/") ||
    source.startsWith(".\\") ||
    source.startsWith("./");

  if (!looksLocal) return null;

  try {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const buffer = await fs.readFile(source);
    const name = otgProductionAnimateUploadSafeName(path.basename(source), fallbackName);

    return new File([new Uint8Array(buffer)], name, { type: "image/png" });
  } catch {
    return null;
  }
}

async function otgProductionAnimateSourceToFile(
  req: Request,
  sources: string[],
  fallbackName: string
): Promise<File> {
  let lastError: unknown = null;

  for (const source of sources) {
    try {
      const fromBase64 = otgProductionAnimateBase64ToFile(source, fallbackName);
      if (fromBase64) return fromBase64;
    } catch (error) {
      lastError = error;
    }
    try {
      const fetched = await otgProductionAnimateFileFromFetch(req, source, fallbackName);
      if (fetched) return fetched;
    } catch (error) {
      lastError = error;
    }

    try {
      const local = await otgProductionAnimateFileFromLocalPath(source, fallbackName);
      if (local) return local;
    } catch (error) {
      lastError = error;
    }
  }

  const detail = lastError instanceof Error ? lastError.message : String(lastError || "no usable source");
  throw new Error(`Could not prepare Animate source image for Comfy upload: ${detail}`);
}

async function otgProductionAnimateUploadImageToComfy(
  comfyBaseUrlRaw: unknown,
  file: File
): Promise<string> {
  const comfyBaseUrl = otgProductionAnimateConfiguredComfyBaseUrl(comfyBaseUrlRaw);
  const form = new FormData();

  form.append("image", file, file.name);
  form.append("type", "input");
  form.append("overwrite", "true");

  const response = await fetch(`${comfyBaseUrl}/upload/image`, {
    method: "POST",
    body: form,
  });

  const text = await response.text();
  let data: any = null;

  try {
    data = JSON.parse(text);
  } catch {
    data = null;
  }

  if (!response.ok) {
    throw new Error(`Comfy image upload failed (${response.status}): ${text.slice(0, 300)}`);
  }

  const name = String(data?.name || data?.filename || "").trim();
  if (!name) {
    throw new Error(`Comfy image upload did not return a filename: ${text.slice(0, 300)}`);
  }

  const subfolder = String(data?.subfolder || "")
    .split("\\")
    .join("/")
    .split("/")
    .filter(Boolean)
    .join("/");

  return subfolder ? `${subfolder}/${name}` : name;
}

async function otgPrepareProductionAnimateImagesForComfy<T extends Record<string, any>>(
  req: Request,
  comfyBaseUrlRaw: unknown,
  input: T
): Promise<T> {
  const body: any = input && typeof input === "object" ? { ...input } : {};
  const segments = Array.isArray(body.segments) ? body.segments : [];

  if (!segments.length) return input;

  const uploadedNames: string[] = [];
  const nextSegments = [];

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index] || {};
    const fallbackName = `otg_production_animate_segment_${index + 1}.png`;
    const sources = otgProductionAnimateSourceCandidates(segment, body);
    const file = await otgProductionAnimateSourceToFile(req, sources, fallbackName);
    const comfyImageName = await otgProductionAnimateUploadImageToComfy(comfyBaseUrlRaw, file);

    uploadedNames.push(comfyImageName);

    nextSegments.push({
      ...segment,
      originalImagePath: segment.imagePath || segment.image || segment.sourceImage || "",
      originalImageUrl: segment.imageUrl || segment.indexImageUrl || segment.frameImageUrl || "",
      comfyImageName,
      image: comfyImageName,
      sourceImage: comfyImageName,
      imagePath: comfyImageName,
      imageUrl: comfyImageName,
      indexImageUrl: comfyImageName,
      frameImageUrl: comfyImageName,
    });
  }

  return {
    ...body,
    image: body.image || uploadedNames[0] || "",
    sourceImage: body.sourceImage || uploadedNames[0] || "",
    imageA: body.imageA || uploadedNames[0] || "",
    imagePath: uploadedNames[0] || body.imagePath || "",
    imageUrl: uploadedNames[0] || body.imageUrl || "",
    indexImageUrl: uploadedNames[0] || body.indexImageUrl || "",
    inputImages: uploadedNames,
    segments: nextSegments,
  } as T;
}
// OTG_PRODUCTION_ANIMATE_UPLOAD_SEGMENT_IMAGES_V2_END

// OTG_PRODUCTION_ANIMATE_IMAGEB64_EXACT_V4_ROUTE_START
function otgProductionAnimateBodyHasImageB64(body: any): boolean {
  if (!body || typeof body !== "object") return false;

  if (typeof body.imageB64 === "string" && body.imageB64.trim().length > 64) return true;
  if (typeof body.imageDataUrl === "string" && body.imageDataUrl.trim().length > 64) return true;

  const collections = [body.segments, body.frames, body.images];

  for (const collection of collections) {
    if (!Array.isArray(collection)) continue;

    for (const item of collection) {
      if (!item || typeof item !== "object") continue;
      if (typeof item.imageB64 === "string" && item.imageB64.trim().length > 64) return true;
      if (typeof item.imageDataUrl === "string" && item.imageDataUrl.trim().length > 64) return true;
    }
  }

  return false;
}
// OTG_PRODUCTION_ANIMATE_IMAGEB64_EXACT_V4_ROUTE_END
export async function POST(request: NextRequest) {
  try {
    let body = (await request.json()) as AnimateRequestBody;
    body = otgNormalizeProductionAnimatePayload(body);
    // OTG_PRODUCTION_ANIMATE_COMFY_UPLOAD_RETURN_FIX_V5
    body = await otgPrepareProductionAnimateImagesForComfy(request, comfyUrl(), body);
    const mode = resolveMode(body);

    const result =
      mode === "director"
        ? await runDirectorMode(body)
        : await runDefaultMode(body);

    return NextResponse.json({
      ok: true,
      sceneId: body.sceneId || null,
      sceneTitle: body.sceneTitle || null,
      workflowMode: mode,
      ...result,
    });
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : "Unknown production animate error.",
      400
    );
  }
}