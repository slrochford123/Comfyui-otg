import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

import { resolveFfmpegPath, resolveFfprobePath, runCmd } from "@/lib/ffmpeg";
import type { OwnerContext } from "@/lib/ownerKey";
import { OTG_DATA_ROOT, ensureDir, safeJoin, safeSegment } from "@/lib/paths";
import {
  downloadH3VideoFromBaseUrl,
  submitH3PromptToBaseUrl,
  uploadH3InputToBaseUrl,
} from "@/lib/production/h3Comfy";
import {
  H3_LTX_ALPHA_5060_PROFILE,
  H3_LTX_ALPHA_GENERATOR_ID,
  H3_LTX_ALPHA_WORKFLOW_FILE,
  assertH3LtxAlphaAvailable,
  buildH3LtxAlphaWorkflow,
  inspectH3LtxAlphaCompatibility,
  normalizeH3LtxAlphaFrameCount,
} from "@/lib/h3SpecialModes/ltxAlphaMotion";
import {
  readH3RefModSidecar,
  validateH3RefModCreateRequest,
  writeH3RefModSidecar,
  type H3RefModCreateConfig,
  type H3RefModCreateConfigInput,
  type H3RefModCreateSource,
} from "@/lib/h3SpecialModes/refModCreation";
import {
  buildH3RefModAudioPackWorkflow,
  buildH3RefModVisualPackWorkflow,
  type H3RefModCreationBuiltWorkflow,
} from "@/lib/h3SpecialModes/refModCreationWorkflow";
import { H3_BACKEND_PROFILES } from "@/lib/production/h3Workflows";

export type H3RefModCreateJobInput = {
  config: H3RefModCreateConfig;
  sources: H3RefModCreateSource[];
};

export type H3RefModCreateJob = {
  id: string;
  ownerKey: string;
  status: "queued" | "preparing" | "submitted" | "running" | "completed" | "failed";
  statusMessage: string;
  input: H3RefModCreateJobInput;
  backendUrl: string;
  clientId: string | null;
  promptId: string | null;
  workflowId: H3RefModCreationBuiltWorkflow["workflowId"] | null;
  workflowFile: string | null;
  libraryName: string;
  savedPath: string | null;
  alphaMattePath?: string | null;
  isolatedDerivativePath?: string | null;
  originalSourcePath?: string | null;
  galleryOwner: Pick<OwnerContext, "ownerKey" | "username" | "deviceId" | "scope"> | null;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
};

type HistoryState = {
  state: "pending" | "running" | "completed" | "failed";
  error?: string;
  savedPath?: string | null;
  video?: {
    filename: string;
    subfolder: string;
    type: string;
    nodeId?: string;
  } | null;
};

const GLOBAL_KEY = "__otgH3RefModCreateJobs";
const DEFAULT_REFMOD_CREATE_URL =
  process.env.OTG_H3_REFMODS_COMFY_URL
  || "http://100.75.162.64:8189";

function alphaProfileForBackendUrl(baseUrl: string) {
  return baseUrl.replace(/\/+$/, "") === H3_BACKEND_PROFILES.rtx5060ti.baseUrl
    ? H3_LTX_ALPHA_5060_PROFILE
    : null;
}

const globalState = globalThis as typeof globalThis & {
  [GLOBAL_KEY]?: { running: Set<string> };
};

function state() {
  globalState[GLOBAL_KEY] ||= { running: new Set<string>() };
  return globalState[GLOBAL_KEY];
}

function jobsDir(ownerKey: string) {
  const dir = safeJoin(OTG_DATA_ROOT, "h3-special", "refmods", safeSegment(ownerKey), "jobs");
  ensureDir(dir);
  return dir;
}

function jobPath(ownerKey: string, id: string) {
  return safeJoin(jobsDir(ownerKey), `${safeSegment(id)}.json`);
}

async function writeJob(job: H3RefModCreateJob) {
  await fsp.writeFile(jobPath(job.ownerKey, job.id), JSON.stringify(job, null, 2), "utf8");
  return job;
}

async function updateJob(ownerKey: string, id: string, patch: Partial<H3RefModCreateJob>) {
  const current = await getH3RefModCreateJob(ownerKey, id);
  if (!current) throw new Error("H3 RefMod creation job was not found.");
  return writeJob({ ...current, ...patch });
}

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function collectHistoryFiles(
  value: unknown,
  nodeId = "",
): Array<{ filename: string; subfolder: string; type: string; nodeId?: string }> {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap((item) => collectHistoryFiles(item, nodeId));
  const record = value as Record<string, unknown>;
  const nextNodeId = typeof record.node_id === "string" ? record.node_id : nodeId;
  const direct = typeof record.filename === "string"
    ? [{
        filename: record.filename,
        subfolder: typeof record.subfolder === "string" ? record.subfolder : "",
        type: typeof record.type === "string" ? record.type : "output",
        nodeId: nextNodeId,
      }]
    : [];
  return [
    ...direct,
    ...Object.values(record).flatMap((item) => collectHistoryFiles(item, nextNodeId)),
  ];
}

export async function getH3RefModCreateJob(ownerKey: string, id: string) {
  try {
    return JSON.parse(await fsp.readFile(jobPath(ownerKey, id), "utf8")) as H3RefModCreateJob;
  } catch {
    return null;
  }
}

export async function getLatestH3RefModCreateJob(ownerKey: string) {
  let names: string[];
  try {
    names = await fsp.readdir(jobsDir(ownerKey));
  } catch {
    return null;
  }
  const jobs = await Promise.all(
    names
      .filter((name) => name.endsWith(".json"))
      .map(async (name) => {
        try {
          return JSON.parse(await fsp.readFile(path.join(jobsDir(ownerKey), name), "utf8")) as H3RefModCreateJob;
        } catch {
          return null;
        }
      }),
  );
  return jobs
    .filter((job): job is H3RefModCreateJob => Boolean(job?.id && job.ownerKey === ownerKey))
    .sort((a, b) => Date.parse(b.createdAt || "") - Date.parse(a.createdAt || ""))[0] || null;
}

export function validateH3RefModCreateJobInput(input: {
  config: H3RefModCreateConfigInput;
  sources: H3RefModCreateSource[];
}): H3RefModCreateJobInput {
  return validateH3RefModCreateRequest(input.config, input.sources);
}

export async function createH3RefModCreateJob(
  ownerKey: string,
  input: { config: H3RefModCreateConfigInput; sources: H3RefModCreateSource[] },
  galleryOwner: H3RefModCreateJob["galleryOwner"] = null,
) {
  const normalized = validateH3RefModCreateJobInput(input);
  const id = `h3-refmod-create-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  return writeJob({
    id,
    ownerKey,
    status: "queued",
    statusMessage: "Waiting to create RefMod",
    input: normalized,
    backendUrl: DEFAULT_REFMOD_CREATE_URL,
    clientId: null,
    promptId: null,
    workflowId: null,
    workflowFile: null,
    libraryName: normalized.config.libraryName,
    savedPath: null,
    alphaMattePath: null,
    isolatedDerivativePath: null,
    originalSourcePath: null,
    galleryOwner,
    error: null,
    createdAt: now,
    startedAt: null,
    completedAt: null,
  });
}

async function refModExists(baseUrl: string, libraryName: string) {
  const sidecar = readH3RefModSidecar(libraryName);
  if (sidecar) return true;
  const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/refmods/library`, {
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  if (!response?.ok) return false;
  const entries = await response.json().catch(() => null);
  return Array.isArray(entries)
    && entries.some((entry) => clean((entry as Record<string, unknown>).name) === libraryName);
}

async function uploadVisualSources(job: H3RefModCreateJob) {
  const subfolder = `otg_refmods/${safeSegment(job.id)}`;
  await Promise.all(job.input.sources.map((source, index) =>
    uploadH3InputToBaseUrl({
      baseUrl: job.backendUrl,
      sourcePath: source.path,
      mediaType: source.kind,
      uploadName: `${String(index + 1).padStart(2, "0")}-${path.parse(source.name).name || source.kind}`,
      subfolder,
    }),
  ));
  return subfolder;
}

async function probeVideoShape(filePath: string) {
  const result = await runCmd(
    resolveFfprobePath(),
    [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height,r_frame_rate,nb_frames,duration",
      "-of",
      "json",
      filePath,
    ],
    { timeoutMs: 20_000 },
  );
  if (result.code !== 0) {
    throw new Error(`Could not inspect video for Alpha isolation: ${result.stderr || result.stdout || "ffprobe failed"}`);
  }
  const parsed = JSON.parse(result.stdout || "{}");
  const stream = parsed?.streams?.[0] || {};
  const [num, den] = String(stream.r_frame_rate || "24/1").split("/").map(Number);
  const fps = Number.isFinite(num / den) && den ? Math.round(num / den) : 24;
  const duration = Number(stream.duration || 0);
  const frames = Number(stream.nb_frames || 0) || Math.max(9, Math.round(duration * fps));
  return {
    width: Number(stream.width || 608),
    height: Number(stream.height || 352),
    fps: fps || 24,
    frames: normalizeH3LtxAlphaFrameCount(frames),
  };
}

async function waitForAlphaCompletion(args: {
  baseUrl: string;
  promptId: string;
  ownerKey: string;
  jobId: string;
}) {
  const started = Date.now();
  while (Date.now() - started < 45 * 60_000) {
    const history = await readPromptHistory(args.baseUrl, args.promptId);
    if (history.state === "failed") throw new Error(history.error || "LTX Alpha Generation failed.");
    if (history.state === "completed" && history.video) {
      return downloadH3VideoFromBaseUrl({
        baseUrl: args.baseUrl,
        file: history.video,
        ownerKey: args.ownerKey,
        productionId: "h3-special",
        sceneId: "refmods-alpha",
        generationJobId: args.jobId,
        artifactSuffix: "alpha-matte",
      });
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error("Timed out waiting for LTX Alpha Generation.");
}

async function createIsolatedRgbDerivative(args: {
  sourcePath: string;
  mattePath: string;
  outputPath: string;
  width: number;
  height: number;
  fps: number;
}) {
  ensureDir(path.dirname(args.outputPath));
  const result = await runCmd(
    resolveFfmpegPath(),
    [
      "-y",
      "-i",
      args.sourcePath,
      "-i",
      args.mattePath,
      "-filter_complex",
      `[1:v]format=gray,scale=${args.width}:${args.height}[mask];[0:v]scale=${args.width}:${args.height},format=rgba[src];[src][mask]alphamerge[fg];color=c=gray:s=${args.width}x${args.height}:r=${args.fps}[bg];[bg][fg]overlay=shortest=1,format=yuv420p[v]`,
      "-map",
      "[v]",
      "-an",
      "-r",
      String(args.fps),
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      args.outputPath,
    ],
    { timeoutMs: 10 * 60_000 },
  );
  if (result.code !== 0) {
    throw new Error(`Could not create isolated RGB subject preview: ${result.stderr || result.stdout || "ffmpeg failed"}`);
  }
  return args.outputPath;
}

async function isolateMotionSource(job: H3RefModCreateJob) {
  const source = job.input.sources[0];
  const shape = await probeVideoShape(source.path);
  const alphaProfile = alphaProfileForBackendUrl(job.backendUrl);
  const alphaShape = alphaProfile || shape;
  const uploaded = await uploadH3InputToBaseUrl({
    baseUrl: job.backendUrl,
    sourcePath: source.path,
    mediaType: "video",
    uploadName: `${job.id}-alpha-source`,
  });
  const built = buildH3LtxAlphaWorkflow({
    videoFilename: uploaded,
    width: alphaShape.width,
    height: alphaShape.height,
    frames: alphaShape.frames,
    fps: alphaShape.fps,
    seed: Math.floor(Date.now() % 1_000_000_000),
    outputPrefix: `otg_alpha/${safeSegment(job.id)}-matte`,
    profile: alphaProfile ? "rtx5060ti-conservative" : "default",
  });
  const submitted = await submitH3PromptToBaseUrl({
    baseUrl: job.backendUrl,
    graph: built.graph,
    clientId: `otg-${job.id}-alpha`,
    jobId: `${job.id}-alpha`,
    ownerKey: job.ownerKey,
    deviceId: job.galleryOwner?.deviceId || "",
    workerId: "h3-refmod-alpha",
    preSubmitCleanup: null,
  });
  if (!submitted.accepted) throw new Error(submitted.error || "ComfyUI rejected LTX Alpha Generation.");
  const mattePath = await waitForAlphaCompletion({
    baseUrl: job.backendUrl,
    promptId: submitted.promptId,
    ownerKey: job.ownerKey,
    jobId: job.id,
  });
  const isolatedPath = safeJoin(
    OTG_DATA_ROOT,
    "h3-special",
    "refmods",
    safeSegment(job.ownerKey),
    "alpha",
    safeSegment(job.id),
    "isolated-rgb.mp4",
  );
  await createIsolatedRgbDerivative({
    sourcePath: source.path,
    mattePath,
    outputPath: isolatedPath,
    width: alphaShape.width,
    height: alphaShape.height,
    fps: alphaShape.fps,
  });
  return {
    source: {
      ...source,
      path: isolatedPath,
      name: `${path.parse(source.name || "motion").name}-isolated.mp4`,
    },
    mattePath,
    isolatedPath,
    originalSourcePath: source.path,
  };
}

async function buildWorkflow(job: H3RefModCreateJob) {
  const { config, sources } = job.input;
  if (config.kind === "audio") {
    const uploaded = await uploadH3InputToBaseUrl({
      baseUrl: job.backendUrl,
      sourcePath: sources[0].path,
      mediaType: "audio",
      uploadName: `${job.id}-audio`,
    });
    return buildH3RefModAudioPackWorkflow({
      audioFilename: uploaded,
      name: config.name,
      subfolder: config.subfolder,
      audioCategory: config.audioCategory || "ambience",
      description: config.description,
    });
  }

  if (config.kind === "motion" && config.isolateSubject) {
    const compatibility = await inspectH3LtxAlphaCompatibility(job.backendUrl);
    if (!compatibility.compatible) {
      throw new Error(
        `LTX 2.5 Alpha Generation is unavailable on this backend. Missing nodes: ${compatibility.missingNodes.join(", ") || "none"}. Missing assets: ${compatibility.missingAssets.join(", ") || "none"}.`,
      );
    }
    await assertH3LtxAlphaAvailable(job.backendUrl);
    await updateJob(job.ownerKey, job.id, {
      status: "running",
      statusMessage: "Generating isolation with LTX 2.5 Alpha Gen",
    });
    const isolated = await isolateMotionSource(job);
    job.input.sources = [isolated.source];
    job = await updateJob(job.ownerKey, job.id, {
      input: job.input,
      alphaMattePath: isolated.mattePath,
      isolatedDerivativePath: isolated.isolatedPath,
      originalSourcePath: isolated.originalSourcePath,
      status: "preparing",
      statusMessage: "Isolation ready; creating Motion RefMod from isolated RGB",
    });
  }

  const folder = await uploadVisualSources(job);
  return buildH3RefModVisualPackWorkflow({
    folder,
    name: config.name,
    subfolder: config.subfolder,
    kind: config.kind,
    description: config.description,
    sourceCount: job.input.sources.length,
  });
}

function collectStrings(value: unknown, out: string[] = []) {
  if (typeof value === "string") {
    out.push(value);
    return out;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectStrings(item, out));
    return out;
  }
  if (value && typeof value === "object") {
    Object.values(value as Record<string, unknown>).forEach((item) => collectStrings(item, out));
  }
  return out;
}

export function selectH3RefModSavedPathFromHistoryEntry(entry: Record<string, unknown>) {
  const outputStrings = collectStrings(entry.outputs);
  const allStrings = collectStrings(entry);
  const candidates = [
    ...outputStrings,
    ...allStrings,
  ]
    .map((item) => item.trim())
    .filter((item, index, items) =>
      item.endsWith(".safetensors")
      && items.indexOf(item) === index,
    );

  return candidates.find((item) => /(^|[/\\])refmods([/\\]|$)/i.test(item))
    || candidates.find((item) => /[/\\]/.test(item))
    || candidates[0]
    || null;
}

async function readPromptHistory(baseUrl: string, promptId: string): Promise<HistoryState> {
  const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/history/${encodeURIComponent(promptId)}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`ComfyUI history returned HTTP ${response.status}.`);
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  const entry = payload?.[promptId] as Record<string, unknown> | undefined;
  if (!entry) return { state: "pending" };
  const status = entry.status as { completed?: boolean; status_str?: string; messages?: unknown[] } | undefined;
  const messages = status?.messages || [];
  const executionError = messages.find((message) => Array.isArray(message) && message[0] === "execution_error");
  if (status?.status_str === "error" || executionError) {
    return {
      state: "failed",
      error: JSON.stringify(executionError || status).slice(0, 1000),
    };
  }
  const savedPath = selectH3RefModSavedPathFromHistoryEntry(entry);
  const video = collectHistoryFiles(entry.outputs || entry)
    .find((file) => /\.(mp4|webm|mov|m4v|mkv)$/i.test(file.filename))
    || null;
  if (status?.completed) return { state: "completed", savedPath, video };
  return { state: "running" };
}

async function waitForPromptCompletion(job: H3RefModCreateJob, timeoutMs = 45 * 60_000) {
  if (!job.promptId) throw new Error("RefMod creation prompt was not submitted.");
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const history = await readPromptHistory(job.backendUrl, job.promptId);
    if (history.state === "completed") return history;
    if (history.state === "failed") throw new Error(history.error || "ComfyUI failed while creating the RefMod.");
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error("Timed out waiting for RefMod creation to complete.");
}

async function runJob(job: H3RefModCreateJob) {
  const running = state().running;
  if (running.has(job.id)) return;
  running.add(job.id);
  try {
    await updateJob(job.ownerKey, job.id, {
      status: "preparing",
      statusMessage: "Checking RefMod library and staging source media",
      startedAt: new Date().toISOString(),
    });

    if (!job.input.config.replace && await refModExists(job.backendUrl, job.libraryName)) {
      throw new Error(`RefMod "${job.libraryName}" already exists. Choose Replace to overwrite it.`);
    }

    const built = await buildWorkflow(job);
    job = await getH3RefModCreateJob(job.ownerKey, job.id) || job;
    const clientId = `otg-${job.id}`;
    await updateJob(job.ownerKey, job.id, {
      status: "preparing",
      statusMessage: "Submitting RefMod creation workflow to ComfyUI",
      clientId,
      workflowId: built.workflowId,
      workflowFile: built.workflowFile,
      libraryName: built.libraryName,
    });

    const submitted = await submitH3PromptToBaseUrl({
      baseUrl: job.backendUrl,
      graph: built.graph,
      clientId,
      jobId: job.id,
      ownerKey: job.ownerKey,
      deviceId: job.galleryOwner?.deviceId || "",
      workerId: "h3-refmod-create",
      preSubmitCleanup: null,
    });

    if (!submitted.accepted) {
      throw new Error(submitted.error || "ComfyUI rejected the RefMod creation workflow.");
    }

    job = await updateJob(job.ownerKey, job.id, {
      status: "submitted",
      statusMessage: "RefMod creation prompt accepted",
      promptId: submitted.promptId,
    });

    await updateJob(job.ownerKey, job.id, {
      status: "running",
      statusMessage: "Creating RefMod on the RTX 3090 backend",
    });

    const history = await waitForPromptCompletion(job);
    const completedAt = new Date().toISOString();
    writeH3RefModSidecar({
      version: 1,
      libraryName: job.libraryName,
      name: job.input.config.name,
      category: job.input.config.kind,
      subfolder: job.input.config.subfolder,
      sourceType: "otg-created",
      createdAt: completedAt,
      updatedAt: completedAt,
      jobId: job.id,
      ownerKey: job.ownerKey,
      characterId: job.input.config.characterId || null,
      description: job.input.config.description,
      savedPath: history.savedPath || null,
      motionType: job.input.config.motionType,
      isolationEnabled: job.input.config.isolateSubject,
      alphaGenerator: job.input.config.isolateSubject ? H3_LTX_ALPHA_GENERATOR_ID : null,
      sourceClipPath: job.input.config.kind === "motion" ? job.originalSourcePath || job.input.sources[0]?.path || null : null,
      isolatedDerivativePath: job.isolatedDerivativePath || null,
      alphaWorkflow: job.input.config.isolateSubject ? H3_LTX_ALPHA_WORKFLOW_FILE : null,
      sourceAssets: job.input.sources,
    });

    await updateJob(job.ownerKey, job.id, {
      status: "completed",
      statusMessage: "RefMod created and registered",
      savedPath: history.savedPath || null,
      alphaMattePath: job.alphaMattePath || null,
      isolatedDerivativePath: job.isolatedDerivativePath || null,
      originalSourcePath: job.originalSourcePath || null,
      completedAt,
    });
  } catch (error) {
    await updateJob(job.ownerKey, job.id, {
      status: "failed",
      statusMessage: "RefMod creation failed",
      error: error instanceof Error ? error.message : "RefMod creation failed.",
      completedAt: new Date().toISOString(),
    }).catch(() => null);
  } finally {
    running.delete(job.id);
  }
}

export function startH3RefModCreateJob(job: H3RefModCreateJob) {
  setTimeout(() => {
    void runJob(job);
  }, 0);
}

export function ensureH3RefModCreateJobRunner(job: H3RefModCreateJob) {
  if (["queued", "preparing", "submitted", "running"].includes(job.status)) {
    startH3RefModCreateJob(job);
  }
}

export function h3RefModCreatePublicStatus(job: H3RefModCreateJob) {
  return {
    id: job.id,
    status: job.status,
    statusMessage: job.statusMessage,
    backendUrl: job.backendUrl,
    promptId: job.promptId,
    workflowId: job.workflowId,
    workflowFile: job.workflowFile,
    libraryName: job.libraryName,
    savedPath: job.savedPath,
    error: job.error,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
  };
}
