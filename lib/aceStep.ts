import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { probeDurationSeconds, resolveFfmpegPath, runCmd } from "@/lib/ffmpeg";
import { dataRoot } from "@/lib/runtime/configPaths";
import { resolveComfyPhysicalGpu } from "@/lib/workers/clusterGpu";
import { mediaQueueEnabled, acquireExternalMediaGpuChoice } from "@/lib/workers/mediaGpuQueue";
import { sharedMediaAdmissionConfigured } from "@/lib/workers/mediaGpuAdmission";
import { acquireVoiceGpuFileLease } from "@/lib/workers/voiceGpuFileLease";
import { releaseIdle3090Peer } from "@/lib/workers/comfy3090Peer";
import { requestedMediaGpu } from "@/lib/mediaGpuRoutingServer";
import { AuxiliaryGpuBusyError } from "@/lib/workers/auxiliary3090Lease";

type AceTaskResult = {
  file?: string;
  metas?: {
    bpm?: number;
    duration?: number;
    keyscale?: string;
    timesignature?: string;
  };
  prompt?: string;
  seed_value?: string;
  dit_model?: string;
  generation_info?: string;
};

export type AceGenerateMusicInput = {
  prompt: string;
  durationSeconds: number;
  bpm?: number;
  keyscale?: string;
  seed?: number;
  referenceAudioPath?: string;
};

export type AceGeneratedMusic = {
  taskId: string;
  admissionOperationId: string;
  audioBuffer: Buffer;
  result: AceTaskResult;
  durationSeconds?: number;
  bpm?: number;
  model?: string;
};

const ACE_POLL_INTERVAL_MS = Math.max(1000, Number(process.env.ACE_STEP_POLL_MS || 5000));
const ACE_MAX_MS = Math.max(60_000, Number(process.env.ACE_STEP_MAX_MS || 20 * 60 * 1000));
const ACE_MODEL = "acestep-v15-turbo"; // Existing contract: never substitute an XL variant.

export class AceMusicUnavailableError extends Error {}
export class AceMusicUnconfirmedError extends Error {
  constructor(readonly operationId: string, readonly taskId: string | null) {
    super("ACE-Step execution or ownership is unconfirmed. Its GPU reservation is retained; do not resubmit until the original operation is reconciled.");
  }
}

type AceReceipt = {
  schemaVersion: 1; operationId: string; baseUrl: string; model: string; gpu: "rtx3090";
  queueJobId: string | null; taskId: string | null; phase: string; updatedAt: string;
};

async function saveAceReceipt(receipt: AceReceipt) {
  // Correlation/ownership evidence only, NOT another scheduler or authority.
  // No prompt, audio, user credential or provider response is stored here.
  const directory = path.join(dataRoot(), "ace-admission");
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const target = path.join(directory, `${receipt.operationId}.json`);
  const temporary = `${target}.${randomUUID()}.tmp`;
  const file = await fs.open(temporary, "wx", 0o600);
  try {
    await file.writeFile(JSON.stringify({ ...receipt, updatedAt: new Date().toISOString() }));
    await file.sync();
  } finally { await file.close(); }
  await fs.rename(temporary, target);
  const parent = await fs.open(directory, "r");
  try { await parent.sync(); } finally { await parent.close(); }
}

function qualifiedAceBaseUrl() {
  const base = aceBaseUrl();
  const url = new URL(base);
  // The inspected ACE instance is loopback8002 ON SHAWN. A loopback endpoint
  // on SLR is not a 3090 service, and a remote path needs input staging first.
  if (url.origin !== base || url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.port !== "8002"
    || resolveComfyPhysicalGpu("http://127.0.0.1:8188") !== "shawn-3090") {
    throw new AceMusicUnavailableError("This ACE-Step endpoint has no qualified local RTX 3090 runtime and input-staging contract.");
  }
  return base;
}

async function assertAceIdle(base: string) {
  const response = await aceFetch(base, "/v1/stats", { method: "GET" }, 5000);
  const raw = await readAceJson(response); const stats = raw?.data || raw;
  const counts = [stats?.queue_size, stats?.jobs?.running, stats?.jobs?.queued];
  if (!response.ok || raw?.error || raw?.code >= 400 || counts.some(n => !Number.isSafeInteger(n) || n < 0)) {
    throw new AceMusicUnavailableError("ACE-Step queue state cannot be confirmed.");
  }
  if (counts.some(n => n !== 0)) throw new AuxiliaryGpuBusyError("ACE-Step is busy with another operation.");
}

async function qualifyAceModel(base: string) {
  const [healthResponse, inventoryResponse] = await Promise.all([
    aceFetch(base, "/health", { method: "GET" }, 5000),
    aceFetch(base, "/v1/model_inventory", { method: "GET" }, 5000),
  ]);
  const healthRaw = await readAceJson(healthResponse), inventoryRaw = await readAceJson(inventoryResponse);
  const health = healthRaw?.data || healthRaw, inventory = inventoryRaw?.data || inventoryRaw;
  const model = Array.isArray(inventory?.models) ? inventory.models.find((m: any) => m?.name === ACE_MODEL) : null;
  if (!healthResponse.ok || !inventoryResponse.ok || healthRaw?.error || inventoryRaw?.error
    || healthRaw?.code >= 400 || inventoryRaw?.code >= 400 || health?.service !== "ACE-Step API"
    || health?.models_initialized !== true || !model || model.is_loaded !== true) {
    throw new AceMusicUnavailableError(`The exact requested ACE-Step model ${ACE_MODEL} is not loaded/qualified. No model will be substituted or initialized.`);
  }
  await assertAceIdle(base);
}

function aceBaseUrl() {
  return String(process.env.ACE_STEP_API_URL || "http://127.0.0.1:8001").trim().replace(/\/+$/, "");
}

function clampNumber(value: unknown, fallback: number, min: number, max: number) {
  const next = Number(value);
  return Math.max(min, Math.min(max, Number.isFinite(next) ? next : fallback));
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readAceJson(res: Response) {
  const text = await res.text().catch(() => "");
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
}

async function aceFetch(base: string, pathname: string, init: RequestInit, timeoutMs = 60_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(`${base}${pathname}`, {
      ...init,
      signal: controller.signal,
      cache: "no-store",
      redirect: "error",
    });
  } finally {
    clearTimeout(timer);
  }
}

function firstTaskId(data: any) {
  return String(data?.data?.task_id || data?.task_id || "").trim();
}

function parseAceResult(value: unknown): AceTaskResult[] {
  if (Array.isArray(value)) return value as AceTaskResult[];
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

async function submitAceTask(base: string, input: AceGenerateMusicInput) {
  const prompt = String(input.prompt || "").trim();
  if (!prompt) throw new Error("ACE-Step music prompt is required.");

  const durationSeconds = clampNumber(input.durationSeconds, 30, 10, 600);
  const bpm = input.bpm ? clampNumber(input.bpm, 95, 30, 300) : undefined;
  const seed = Number(input.seed);

  const payload: Record<string, unknown> = {
    prompt,
    lyrics: "[Instrumental]",
    audio_duration: durationSeconds,
    audio_format: "mp3",
    batch_size: 1,
    thinking: false,
    model: ACE_MODEL,
    inference_steps: 8,
    use_cot_caption: false,
    use_cot_language: false,
  };

  if (bpm) payload.bpm = bpm;
  if (input.keyscale) payload.key_scale = input.keyscale;
  if (Number.isFinite(seed) && seed >= 0) {
    payload.seed = seed;
    payload.use_random_seed = false;
  }
  if (input.referenceAudioPath) {
    payload.reference_audio_path = input.referenceAudioPath;
    payload.audio_cover_strength = 0.25;
  }

  const res = await aceFetch(
    base,
    "/release_task",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    60_000,
  );
  const data = await readAceJson(res);
  if (!res.ok || data?.code >= 400 || data?.error) {
    throw new Error(String(data?.error || data?.detail || `ACE-Step task submit failed (${res.status}).`));
  }

  const taskId = firstTaskId(data);
  if (!taskId) throw new Error("ACE-Step did not return a task id.");
  return taskId;
}

async function pollAceTask(base: string, taskId: string) {
  const started = Date.now();
  let lastPayload: any = null;

  while (Date.now() - started < ACE_MAX_MS) {
    const res = await aceFetch(
      base,
      "/query_result",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task_id_list: [taskId] }),
      },
      60_000,
    );
    const data = await readAceJson(res);
    lastPayload = data;

    if (!res.ok || data?.code >= 400 || data?.error) {
      throw new Error(String(data?.error || data?.detail || `ACE-Step query failed (${res.status}).`));
    }

    const matches = Array.isArray(data?.data) ? data.data.filter((row: any) => row?.task_id === taskId) : [];
    if (matches.length !== 1) throw new Error("ACE-Step did not confirm the original task identity.");
    const item = matches[0];
    const status = Number(item?.status ?? 0);
    if (status === 1 || status === 2) return { status, item };
    if (status !== 0) throw new Error("ACE-Step returned an unknown task state.");

    await sleep(ACE_POLL_INTERVAL_MS);
  }

  throw new Error(`Timed out waiting for ACE-Step task ${taskId}. Last response: ${JSON.stringify(lastPayload).slice(0, 1000)}`);
}

async function downloadAceAudio(base: string, fileUrl: string) {
  const url = new URL(fileUrl, `${base}/`);
  if (url.origin !== base || url.username || url.password) throw new Error("ACE-Step output does not belong to the assigned backend.");
  const res = await fetch(url, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(60_000) });
  if (!res.ok) {
    throw new Error(`ACE-Step audio download failed (${res.status}).`);
  }
  return Buffer.from(await res.arrayBuffer());
}

export async function generateAceMusic(input: AceGenerateMusicInput): Promise<AceGeneratedMusic> {
  if (!String(input.prompt || "").trim()) throw new Error("ACE-Step music prompt is required.");
  if (process.env.ACE_STEP_ENABLED === "0") throw new AceMusicUnavailableError("ACE-Step is disabled.");
  if (!mediaQueueEnabled() || !sharedMediaAdmissionConfigured()) throw new AceMusicUnavailableError("Shared GPU admission is required for ACE-Step music.");
  if (await requestedMediaGpu() === "rtx5060ti") throw new AuxiliaryGpuBusyError("This ACE-Step runtime is only qualified for RTX 3090.");
  const base = qualifiedAceBaseUrl();
  await qualifyAceModel(base); // Read-only, before registering work or touching caches.
  const receipt: AceReceipt = { schemaVersion: 1, operationId: randomUUID(), baseUrl: base, model: ACE_MODEL,
    gpu: "rtx3090", queueJobId: null, taskId: null, phase: "prepared", updatedAt: "" };
  await saveAceReceipt(receipt);
  // Same central queue + voice flock + idle-peer cleanup as Edit Video, but
  // retain the existing fenced handle rather than its release-only adapter.
  const grant = await acquireExternalMediaGpuChoice(["rtx3090"], `ace-production:${receipt.operationId}`);
  let releaseVoice: (() => void) | null = null;
  let safeToRelease = true;
  try {
    receipt.queueJobId = grant.lease.ownerId; receipt.phase = "admitted"; await saveAceReceipt(receipt);
    releaseVoice = await acquireVoiceGpuFileLease();
    await qualifyAceModel(base); // Queue waiting must not reuse stale readiness.
    const fetcher = (url: string, init: RequestInit) => fetch(url, { ...init, signal: AbortSignal.timeout(5000) });
    await releaseIdle3090Peer("http://100.75.162.64:8189", fetcher);
    await releaseIdle3090Peer("http://100.75.162.64:8188", fetcher);
    receipt.phase = "submitting"; await saveAceReceipt(receipt);
    safeToRelease = false; // Durable intent BEFORE a possibly-lost POST response.
    receipt.taskId = await submitAceTask(base, input);
    receipt.phase = "submitted"; await saveAceReceipt(receipt);
    const terminal = await pollAceTask(base, receipt.taskId);
    // A status=2 cache timeout alone is not proof that GPU execution stopped.
    await assertAceIdle(base);
    receipt.phase = "terminal"; await saveAceReceipt(receipt);
    safeToRelease = true;
    if (terminal.status === 2) throw new Error("ACE-Step generation failed.");
    const results = parseAceResult(terminal.item.result);
    const result = results.find(candidate => String(candidate?.file || "").trim()) || results[0];
    if (!result?.file) throw new Error("ACE-Step completed without an audio file.");
    if (result.dit_model && result.dit_model !== ACE_MODEL) throw new Error("ACE-Step returned a different model; output was rejected.");
    const audioBuffer = await downloadAceAudio(base, result.file);
    return { audioBuffer, result, taskId: receipt.taskId, admissionOperationId: receipt.operationId,
      durationSeconds: Number(result.metas?.duration || input.durationSeconds) || undefined,
      bpm: Number(result.metas?.bpm || input.bpm) || undefined, model: String(result.dit_model || ACE_MODEL) };
  } catch (error) {
    if (!safeToRelease) {
      // Existing queue/authority ownership remains durable across app crashes.
      // Never auto-release or resubmit on a lost/invalid submit or poll response.
      // A failed status write must not erase the API's unknown-outcome fence.
      // The admitted reservation is still held: no release was requested.
      try { grant.uncertain(); } catch { /* retain existing running ownership */ }
      receipt.phase = "unknown"; await saveAceReceipt(receipt).catch(() => {});
      throw new AceMusicUnconfirmedError(receipt.operationId, receipt.taskId);
    }
    throw error;
  } finally {
    releaseVoice?.();
    if (safeToRelease) {
      receipt.phase = "release_requested";
      try { await saveAceReceipt(receipt); } catch {
        try { grant.uncertain(); } catch { /* retain existing running ownership */ }
        throw new AceMusicUnconfirmedError(receipt.operationId, receipt.taskId);
      }
      grant.release(); // Existing queue persists release intent and exact token.
    }
  }
}

export async function extractReferenceAudio(inputVideoPath: string, outputPath: string, seconds = 4) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const duration = Math.max(1, Math.min(15, Number(seconds) || 4));
  const result = await runCmd(
    resolveFfmpegPath(),
    [
      "-y",
      "-i",
      inputVideoPath,
      "-vn",
      "-t",
      String(duration),
      "-ac",
      "2",
      "-ar",
      "44100",
      "-c:a",
      "pcm_s16le",
      outputPath,
    ],
    { timeoutMs: 120_000 },
  );
  if (result.code !== 0) {
    throw new Error(`Could not extract ACE reference audio. ${result.stderr || result.stdout}`.slice(0, 2000));
  }
  const stat = await fs.stat(outputPath).catch(() => null);
  if (!stat?.isFile() || stat.size <= 0) {
    throw new Error("ACE reference audio extraction produced an empty file.");
  }
  return outputPath;
}

export async function audioDuration(filePath: string) {
  return probeDurationSeconds(filePath);
}
