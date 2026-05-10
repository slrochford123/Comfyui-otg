import crypto from "node:crypto";
import fs from "node:fs/promises";
import fssync from "node:fs";
import path from "node:path";

export type ThreeDJobStatus = "queued" | "processing" | "succeeded" | "failed";

export type ThreeDJobRecord = {
  jobId: string;
  ownerKey: string;
  deviceId: string;
  status: ThreeDJobStatus;
  createdAt: string;
  updatedAt: string;
  message: string;
  progressStage: string;
  removeBackground: boolean;
  inputName: string;
  inputMime: string;
  inputImagePath: string;
  inputImageUrl: string;
  processedImageUrl: string | null;
  preprocessChanged: boolean;
  preprocessConfidence: number | null;
  resultPath: string | null;
  resultUrl: string | null;
  resultExt: string | null;
  previewSupported: boolean;
  promptId: string | null;
  endpoint: string | null;
  preprocessNote: string | null;
  error: string | null;
  detail: unknown;
};

type CreateThreeDJobArgs = {
  ownerKey: string;
  deviceId: string;
  fileName: string;
  inputBytes: Buffer;
  inputMime: string;
  removeBackground: boolean;
};

type RunThreeDJobArgs = {
  jobId: string;
  baseUrl: string;
  cookieHeader: string;
  deviceId: string;
};

const activeJobs = new Map<string, Promise<void>>();

function getDataRoot() {
  return process.env.OTG_DATA_DIR || path.join(process.cwd(), "data");
}

function safeSegment(raw: string) {
  return String(raw || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120) || "upload";
}

function nowIso() {
  return new Date().toISOString();
}

function getOwnerRoot(ownerKey: string) {
  return path.join(getDataRoot(), "3d_jobs", ownerKey);
}

function getJobDir(ownerKey: string, jobId: string) {
  return path.join(getOwnerRoot(ownerKey), jobId);
}

function getJobFile(ownerKey: string, jobId: string) {
  return path.join(getJobDir(ownerKey, jobId), "job.json");
}

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

async function writeJson(filePath: string, value: unknown) {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}

function serializeErrorMessage(value: unknown, fallback: string) {
  if (typeof value === "string" && value.trim()) return value;
  if (value instanceof Error) return value.message || fallback;
  try {
    const text = JSON.stringify(value);
    return text && text !== "{}" ? text : fallback;
  } catch {
    return fallback;
  }
}

export async function createThreeDJob(args: CreateThreeDJobArgs): Promise<ThreeDJobRecord> {
  const jobId = `job_${crypto.randomUUID()}`;
  const createdAt = nowIso();
  const safeName = safeSegment(args.fileName || `image_${Date.now()}.png`);
  const inputPath = path.join(getJobDir(args.ownerKey, jobId), safeName);

  await ensureDir(path.dirname(inputPath));
  await fs.writeFile(inputPath, args.inputBytes);

  const record: ThreeDJobRecord = {
    jobId,
    ownerKey: args.ownerKey,
    deviceId: args.deviceId,
    status: "queued",
    createdAt,
    updatedAt: createdAt,
    message: "Job queued.",
    progressStage: "queued",
    removeBackground: args.removeBackground,
    inputName: safeName,
    inputMime: args.inputMime || "image/png",
    inputImagePath: inputPath,
    inputImageUrl: `/api/file?path=${encodeURIComponent(inputPath)}`,
    processedImageUrl: null,
    preprocessChanged: false,
    preprocessConfidence: null,
    resultPath: null,
    resultUrl: null,
    resultExt: null,
    previewSupported: false,
    promptId: null,
    endpoint: null,
    preprocessNote: null,
    error: null,
    detail: null,
  };

  await writeThreeDJob(record);
  return record;
}

export async function readThreeDJob(ownerKey: string, jobId: string): Promise<ThreeDJobRecord | null> {
  try {
    const raw = await fs.readFile(getJobFile(ownerKey, jobId), "utf8");
    return JSON.parse(raw) as ThreeDJobRecord;
  } catch {
    return null;
  }
}

export async function writeThreeDJob(record: ThreeDJobRecord) {
  record.updatedAt = nowIso();
  await writeJson(getJobFile(record.ownerKey, record.jobId), record);
}

export async function updateThreeDJob(
  ownerKey: string,
  jobId: string,
  mutate: (current: ThreeDJobRecord) => ThreeDJobRecord | Promise<ThreeDJobRecord>
) {
  const current = await readThreeDJob(ownerKey, jobId);
  if (!current) throw new Error(`3D job not found: ${jobId}`);
  const next = await mutate(current);
  await writeThreeDJob(next);
  return next;
}

export function hasActiveThreeDJob(jobId: string) {
  return activeJobs.has(jobId);
}

export function launchThreeDJob(ownerKey: string, args: RunThreeDJobArgs) {
  if (activeJobs.has(args.jobId)) return;
  const run = runThreeDJob(ownerKey, args)
    .catch(() => {})
    .finally(() => {
      activeJobs.delete(args.jobId);
    });
  activeJobs.set(args.jobId, run);
}

function parseApiFilePath(url: string | null | undefined) {
  const value = String(url || "").trim();
  if (!value.startsWith("/api/file?")) return null;
  const queryIndex = value.indexOf("?");
  if (queryIndex < 0) return null;
  const params = new URLSearchParams(value.slice(queryIndex + 1));
  const p = params.get("path");
  return p ? p : null;
}

async function runThreeDJob(ownerKey: string, args: RunThreeDJobArgs) {
  const current = await readThreeDJob(ownerKey, args.jobId);
  if (!current) return;
  if (!fssync.existsSync(current.inputImagePath)) {
    await updateThreeDJob(ownerKey, args.jobId, (job) => ({
      ...job,
      status: "failed",
      progressStage: "input_missing",
      message: "Source image is missing on disk.",
      error: "Source image is missing on disk.",
    }));
    return;
  }

  await updateThreeDJob(ownerKey, args.jobId, (job) => ({
    ...job,
    status: "processing",
    progressStage: "submit_trellis",
    message: "Submitting image to the Trellis 2 textured 3D pipeline...",
    error: null,
    detail: null,
  }));

  try {
    const bytes = await fs.readFile(current.inputImagePath);
    const fd = new FormData();
    fd.append("image", new Blob([bytes], { type: current.inputMime || "image/png" }), current.inputName);
    fd.append("removeBackground", String(current.removeBackground));

    const target = new URL("/api/angles/trellis-3d", args.baseUrl).toString();
    const res = await fetch(target, {
      method: "POST",
      headers: {
        ...(args.cookieHeader ? { cookie: args.cookieHeader } : {}),
        ...(args.deviceId ? { "x-otg-device-id": args.deviceId } : {}),
      },
      body: fd,
      cache: "no-store",
    });

    const text = await res.text().catch(() => "");
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }

    if (!res.ok || !json?.ok) {
      const errorMessage = serializeErrorMessage(json?.error ?? json ?? text, `3D generation failed (${res.status}).`);
      await updateThreeDJob(ownerKey, args.jobId, (job) => ({
        ...job,
        status: "failed",
        progressStage: json?.stage || "trellis_failed",
        message: errorMessage,
        error: errorMessage,
        detail: json?.detail ?? text ?? null,
        endpoint: json?.endpoint ? String(json.endpoint) : job.endpoint,
        promptId: json?.promptId ? String(json.promptId) : job.promptId,
      }));
      return;
    }

    const resultUrl = String(json.modelUrl || "").trim();
    const resultPath = parseApiFilePath(resultUrl);
    const previewSupported = Boolean(json.previewSupported);
    const resultExt = String(json.modelExt || path.extname(resultPath || resultUrl) || ".glb");

    await updateThreeDJob(ownerKey, args.jobId, (job) => ({
      ...job,
      status: "succeeded",
      progressStage: "complete",
      message: "3D model finished and is ready to preview.",
      processedImageUrl: json?.processedImageUrl ? String(json.processedImageUrl) : job.processedImageUrl,
      preprocessChanged: Boolean(json?.preprocessChanged),
      preprocessConfidence: typeof json?.preprocessConfidence === "number" ? json.preprocessConfidence : job.preprocessConfidence,
      resultPath,
      resultUrl,
      resultExt,
      previewSupported,
      promptId: json?.promptId ? String(json.promptId) : null,
      endpoint: json?.endpoint ? String(json.endpoint) : null,
      preprocessNote: json?.preprocess ? String(json.preprocess) : null,
      error: null,
      detail: json,
    }));
  } catch (e: any) {
    const message = e?.message || String(e);
    await updateThreeDJob(ownerKey, args.jobId, (job) => ({
      ...job,
      status: "failed",
      progressStage: "exception",
      message,
      error: message,
      detail: { stack: e?.stack || null },
    }));
  }
}
