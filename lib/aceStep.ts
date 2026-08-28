import fs from "node:fs/promises";
import path from "node:path";

import { probeDurationSeconds, resolveFfmpegPath, runCmd } from "@/lib/ffmpeg";

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
  audioBuffer: Buffer;
  result: AceTaskResult;
  durationSeconds?: number;
  bpm?: number;
  model?: string;
};

const ACE_POLL_INTERVAL_MS = Math.max(1000, Number(process.env.ACE_STEP_POLL_MS || 5000));
const ACE_MAX_MS = Math.max(60_000, Number(process.env.ACE_STEP_MAX_MS || 20 * 60 * 1000));

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

async function aceFetch(pathname: string, init: RequestInit, timeoutMs = 60_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(`${aceBaseUrl()}${pathname}`, {
      ...init,
      signal: controller.signal,
      cache: "no-store",
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

async function submitAceTask(input: AceGenerateMusicInput) {
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
    model: "acestep-v15-turbo",
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

async function pollAceTask(taskId: string) {
  const started = Date.now();
  let lastPayload: any = null;

  while (Date.now() - started < ACE_MAX_MS) {
    const res = await aceFetch(
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

    const item = Array.isArray(data?.data) ? data.data[0] : null;
    const status = Number(item?.status ?? 0);
    if (status === 1) {
      const results = parseAceResult(item?.result);
      const hit = results.find((candidate) => String(candidate?.file || "").trim()) || results[0];
      if (!hit?.file) throw new Error("ACE-Step completed without an audio file.");
      return hit;
    }
    if (status === 2) {
      throw new Error(String(item?.error || item?.result || "ACE-Step generation failed."));
    }

    await sleep(ACE_POLL_INTERVAL_MS);
  }

  throw new Error(`Timed out waiting for ACE-Step task ${taskId}. Last response: ${JSON.stringify(lastPayload).slice(0, 1000)}`);
}

async function downloadAceAudio(fileUrl: string) {
  const url = fileUrl.startsWith("http://") || fileUrl.startsWith("https://")
    ? fileUrl
    : `${aceBaseUrl()}${fileUrl.startsWith("/") ? "" : "/"}${fileUrl}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`ACE-Step audio download failed (${res.status}).`);
  }
  return Buffer.from(await res.arrayBuffer());
}

export async function generateAceMusic(input: AceGenerateMusicInput): Promise<AceGeneratedMusic> {
  const taskId = await submitAceTask(input);
  const result = await pollAceTask(taskId);
  const audioBuffer = await downloadAceAudio(String(result.file || ""));
  return {
    audioBuffer,
    result,
    durationSeconds: Number(result.metas?.duration || input.durationSeconds) || undefined,
    bpm: Number(result.metas?.bpm || input.bpm) || undefined,
    model: String(result.dit_model || "acestep-v15-turbo"),
  };
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
