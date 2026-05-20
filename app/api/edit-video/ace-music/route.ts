import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import fssync from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

import { getOwnerContext, SessionInvalidError } from "@/lib/ownerKey";
import { OTG_DATA_ROOT, ensureDir, safeSegment } from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const AUDIO_EXT_RE = /\.(mp3|wav|m4a|aac|ogg|flac|webm)$/i;
const MEDIA_EXT_RE = /\.(mp3|wav|m4a|aac|ogg|flac|webm|mp4|mov|mkv|avi)$/i;

type AceMusicInput = {
  prompt: string;
  title: string;
  lyrics: string;
  durationSeconds: number;
  bpm: string;
  keyScale: string;
  seed: string;
  model: string;
  referenceAudioFile?: any;
  referenceAudioPath: string;
  referenceAudioUrl: string;
  referenceAudioFileName: string;
  referenceVideo: any;
  timeoutMs: number;
};

function fileUrlFor(absPath: string) {
  return `/api/file?path=${encodeURIComponent(absPath)}`;
}

function aceApiBase() {
  return String(process.env.ACE_STEP_API_URL || "http://127.0.0.1:8001").replace(/\/+$/, "");
}

function aceModelName(value: unknown) {
  const raw = String(value || "").trim().toLowerCase();

  if (!raw || raw === "turbo" || raw === "xl turbo" || raw === "xl-turbo" || raw === "fastest") {
    return "acestep-v15-turbo";
  }

  if (raw.includes("1.5") || raw.includes("v15")) return "acestep-v15-turbo";
  if (raw.includes("turbo")) return "acestep-v15-turbo";

  return "acestep-v15-turbo";
}

function basenameOnly(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  try {
    const parsed = raw.startsWith("http://") || raw.startsWith("https://")
      ? new URL(raw)
      : new URL(raw, "http://otg.local");

    const queryName =
      parsed.searchParams.get("name") ||
      parsed.searchParams.get("filename") ||
      parsed.searchParams.get("fileName") ||
      parsed.searchParams.get("path") ||
      "";

    return path.basename(decodeURIComponent(queryName || parsed.pathname || raw));
  } catch {
    return path.basename(raw.replace(/\\/g, "/"));
  }
}

function localPathFromFileUrl(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  try {
    const parsed = raw.startsWith("http://") || raw.startsWith("https://")
      ? new URL(raw)
      : new URL(raw, "http://otg.local");

    if (parsed.pathname !== "/api/file") return "";
    return String(parsed.searchParams.get("path") || "").trim();
  } catch {
    return "";
  }
}

function collectStrings(value: unknown, out: string[] = []) {
  if (typeof value === "string") {
    const raw = value.trim();

    if ((raw.startsWith("{") && raw.endsWith("}")) || (raw.startsWith("[") && raw.endsWith("]"))) {
      try {
        collectStrings(JSON.parse(raw), out);
        return out;
      } catch {
        // Keep raw string fallback below.
      }
    }

    out.push(raw);
    return out;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => collectStrings(item, out));
    return out;
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;

    ["file", "audio", "audio_url", "audioUrl", "url", "path", "output", "result"].forEach((key) => {
      if (record[key] !== undefined) collectStrings(record[key], out);
    });

    Object.values(record).forEach((item) => collectStrings(item, out));
  }

  return out;
}

function firstAudioCandidate(result: unknown) {
  const strings = collectStrings(result)
    .map((item) => String(item || "").trim())
    .filter(Boolean);

  /*
    OTG_ACE15_EXTRACT_FILE_FIELD_DOWNLOAD_FIX_V1:
    ACE-Step 1.5 query_result may return a JSON-stringified array where each
    item has { file: "/v1/audio?path=..." }. Do not wrap that whole JSON
    string as the path. Extract the nested file URL first.
  */
  return (
    strings.find((item) => /\/v1\/audio\?path=/i.test(item)) ||
    strings.find((item) => /^https?:\/\/.+\/v1\/audio\?path=/i.test(item)) ||
    strings.find((item) => /^https?:\/\/.+\.(mp3|wav|m4a|aac|ogg|flac|webm)(\?|#|$)/i.test(item)) ||
    strings.find((item) => /(^|[\\/])[^\\/]+\.(mp3|wav|m4a|aac|ogg|flac|webm)(\?|#|$)/i.test(item)) ||
    ""
  );
}

function absoluteAceAudioUrl(candidate: string) {
  const base = aceApiBase();
  const raw = String(candidate || "").trim();

  if (!raw) return "";

  if (/^https?:\/\//i.test(raw)) return raw;

  if (raw.startsWith("/v1/audio?path=")) {
    return `${base}${raw}`;
  }

  if (raw.startsWith("/")) {
    return `${base}${raw}`;
  }

  return `${base}/v1/audio?path=${encodeURIComponent(raw)}`;
}

async function runCommand(command: string, args: string[]) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderr = "";

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk || "");
    });

    child.on("error", reject);

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} failed with exit code ${code}: ${stderr.slice(-2000)}`));
    });
  });
}

async function transcodeReferenceToWav(inputPath: string) {
  const raw = String(inputPath || "").trim();

  if (!raw || !fssync.existsSync(raw)) return "";

  const out = path.join(os.tmpdir(), `otg_ace15_reference_${Date.now()}.wav`);

  await runCommand("ffmpeg", [
    "-y",
    "-i",
    raw,
    "-vn",
    "-ac",
    "2",
    "-ar",
    "44100",
    "-c:a",
    "pcm_s16le",
    out,
  ]);

  return out;
}

async function fetchToTempFile(req: NextRequest, value: string) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  const absoluteUrl = raw.startsWith("http://") || raw.startsWith("https://")
    ? raw
    : new URL(raw, req.nextUrl.origin).toString();

  const response = await fetch(absoluteUrl, {
    method: "GET",
    cache: "no-store",
    headers: {
      cookie: req.headers.get("cookie") || "",
    },
  });

  if (!response.ok) return "";

  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length) return "";

  const ext = MEDIA_EXT_RE.test(raw) ? path.extname(basenameOnly(raw)) || ".mp4" : ".mp4";
  const out = path.join(os.tmpdir(), `otg_ace15_reference_source_${Date.now()}${ext}`);

  await fs.writeFile(out, bytes);
  return out;
}

async function readAceMusicInput(req: NextRequest): Promise<AceMusicInput> {
  const contentType = req.headers.get("content-type") || "";

  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData();

    const referenceAudioFile =
      (form.get("reference_audio") as any) ||
      (form.get("ref_audio") as any) ||
      (form.get("sampleAudio") as any) ||
      (form.get("sample_audio") as any);

    return {
      prompt: String(form.get("prompt") || form.get("musicPrompt") || form.get("vibe") || "").trim(),
      title: String(form.get("title") || "video_with_music"),
      lyrics: String(form.get("lyrics") || ""),
      durationSeconds: Number(form.get("durationSeconds") || form.get("audio_duration") || 30) || 30,
      bpm: String(form.get("bpm") || ""),
      keyScale: String(form.get("keyScale") || form.get("keyscale") || form.get("key_scale") || ""),
      seed: String(form.get("seed") || ""),
      model: String(form.get("model") || "turbo"),
      referenceAudioFile,
      referenceAudioPath: String(form.get("referenceAudioPath") || form.get("reference_audio_path") || ""),
      referenceAudioUrl: String(form.get("referenceAudioUrl") || form.get("reference_audio_url") || ""),
      referenceAudioFileName: String(form.get("referenceAudioFileName") || form.get("reference_audio_file_name") || ""),
      referenceVideo: {},
      timeoutMs: Number(form.get("timeoutMs") || 240000) || 240000,
    };
  }

  const body = await req.json().catch(() => ({}));
  const referenceVideo = body?.referenceVideo && typeof body.referenceVideo === "object" ? body.referenceVideo : {};

  return {
    prompt: String(
      body?.prompt ||
        body?.musicPrompt ||
        body?.vibe ||
        body?.music_prompt ||
        body?.text ||
        ""
    ).trim(),
    title: String(body?.title || "video_with_music"),
    lyrics: String(body?.lyrics || ""),
    durationSeconds: Number(body?.durationSeconds || body?.audio_duration || body?.seconds || 30) || 30,
    bpm: String(body?.bpm || ""),
    keyScale: String(body?.keyScale || body?.keyscale || body?.key_scale || ""),
    seed: String(body?.seed ?? ""),
    model: String(body?.model || "turbo"),
    referenceAudioFile: null,
    referenceAudioPath: String(body?.referenceAudioPath || body?.reference_audio_path || ""),
    referenceAudioUrl: String(body?.referenceAudioUrl || body?.reference_audio_url || ""),
    referenceAudioFileName: String(body?.referenceAudioFileName || body?.reference_audio_file_name || ""),
    referenceVideo,
    timeoutMs: Number(body?.timeoutMs || 240000) || 240000,
  };
}

async function resolveReferenceSource(req: NextRequest, input: AceMusicInput) {
  const direct = String(input.referenceAudioPath || input.referenceVideo?.path || input.referenceVideo?.videoPath || "").trim();

  if (direct && path.isAbsolute(direct) && fssync.existsSync(direct)) {
    return path.normalize(direct);
  }

  const fromFileUrl =
    localPathFromFileUrl(input.referenceAudioUrl) ||
    localPathFromFileUrl(input.referenceVideo?.url) ||
    localPathFromFileUrl(input.referenceVideo?.videoUrl);

  if (fromFileUrl && path.isAbsolute(fromFileUrl) && fssync.existsSync(fromFileUrl)) {
    return path.normalize(fromFileUrl);
  }

  const url = String(input.referenceAudioUrl || input.referenceVideo?.url || input.referenceVideo?.videoUrl || "").trim();
  if (url) {
    const downloaded = await fetchToTempFile(req, url);
    if (downloaded) return downloaded;
  }

  const fileName = String(
    input.referenceAudioFileName ||
      input.referenceVideo?.fileName ||
      input.referenceVideo?.filename ||
      ""
  ).trim();

  if (fileName) {
    const downloaded = await fetchToTempFile(req, `/api/gallery/file?name=${encodeURIComponent(fileName)}`);
    if (downloaded) return downloaded;
  }

  return "";
}

async function referenceUploadToWav(input: AceMusicInput) {
  if (!input.referenceAudioFile || typeof input.referenceAudioFile.arrayBuffer !== "function") return "";

  const originalName = basenameOnly(input.referenceAudioFile.name || "reference_audio.mp3");
  const ext = MEDIA_EXT_RE.test(originalName) ? path.extname(originalName) || ".mp3" : ".mp3";
  const source = path.join(os.tmpdir(), `otg_ace15_reference_upload_${Date.now()}${ext}`);
  const bytes = Buffer.from(await input.referenceAudioFile.arrayBuffer());

  if (!bytes.length) return "";

  await fs.writeFile(source, bytes);
  return transcodeReferenceToWav(source);
}

async function resolveReferenceAudioForAce(req: NextRequest, input: AceMusicInput) {
  const uploadWav = await referenceUploadToWav(input);
  if (uploadWav) return uploadWav;

  const source = await resolveReferenceSource(req, input);
  if (!source) return "";

  return transcodeReferenceToWav(source);
}

async function pollAceTask(taskId: string, timeoutMs: number) {
  const base = aceApiBase();
  const deadline = Date.now() + timeoutMs;
  const body = JSON.stringify({ task_id_list: [taskId] });

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5000));

    const response = await fetch(`${base}/query_result`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      cache: "no-store",
    });

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      throw new Error(String(data?.error || `ACE-Step 1.5 query failed (${response.status}).`));
    }

    const item = Array.isArray(data?.data) ? data.data[0] : data?.data;
    const status = Number(item?.status ?? data?.status ?? 0);

    if (status === 1) return data;

    if (status < 0 || status === 2 || status === 3) {
      throw new Error(String(item?.error || data?.error || "ACE-Step 1.5 generation failed."));
    }
  }

  throw new Error("ACE-Step 1.5 generation timed out before completion.");
}

async function submitAceTask(req: NextRequest, input: AceMusicInput) {
  const base = aceApiBase();
  const durationSeconds = Math.max(10, Math.min(600, Number(input.durationSeconds || 30) || 30));
  const referenceAudioPath = await resolveReferenceAudioForAce(req, input);

  const form = new FormData();

  form.append("prompt", input.prompt);
  form.append("lyrics", input.lyrics || "");
  form.append("audio_duration", String(durationSeconds));
  form.append("audio_format", "mp3");
  form.append("thinking", "false");
  form.append("batch_size", "1");
  form.append("model", aceModelName(input.model));

  if (input.bpm) form.append("bpm", input.bpm);
  if (input.keyScale) form.append("key_scale", input.keyScale);
  if (input.seed && input.seed !== "-1") form.append("seed", input.seed);

  /*
    OTG_EDIT_VIDEO_ACE_STEP_15_REFERENCE_AUDIO_V1:
    This is ACE-Step 1.5 sample/reference mode. The selected video/audio clip
    is transcoded to WAV and sent as reference_audio so ACE generates new music
    based on the sample instead of merely making unrelated text-only music.
  */
  if (referenceAudioPath && fssync.existsSync(referenceAudioPath)) {
    const bytes = await fs.readFile(referenceAudioPath);
    const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const blob = new Blob([arrayBuffer], { type: "audio/wav" });
    form.append("reference_audio", blob, path.basename(referenceAudioPath));
    form.append("reference_audio_path", referenceAudioPath);
  }

  return fetch(`${base}/release_task`, {
    method: "POST",
    body: form,
    cache: "no-store",
  });
}

export async function POST(req: NextRequest) {
  try {
    if (process.env.ACE_STEP_ENABLED === "0") {
      return NextResponse.json({ ok: false, error: "ACE-Step 1.5 is disabled." }, { status: 400 });
    }

    /*
    OTG_ACE15_READ_BODY_BEFORE_OWNER_CONTEXT_V1:
    Read ACE music request data from a clone before owner/session handling.
    This prevents auth helpers from consuming the body before prompt parsing.
*/
    const inputReq = req.clone() as NextRequest;
    const input = await readAceMusicInput(inputReq);
    const owner = await getOwnerContext(req);

    if (!input.prompt) {
      return NextResponse.json(
        {
          ok: false,
          error: "Music prompt is required.",
          debug: {
            expectedAnyOf: ["prompt", "musicPrompt", "vibe", "music_prompt", "text"],
          },
        },
        { status: 400 }
      );
    }

    const base = aceApiBase();
    const health = await fetch(`${base}/health`, { cache: "no-store" }).catch(() => null);

    if (!health?.ok) {
      return NextResponse.json(
        { ok: false, error: `ACE-Step 1.5 API is not reachable at ${base}.` },
        { status: 503 }
      );
    }

    const releaseResponse = await submitAceTask(req, input);
    const releaseData = await releaseResponse.json().catch(() => null);

    if (!releaseResponse.ok) {
      return NextResponse.json(
        { ok: false, error: String(releaseData?.error || "ACE-Step 1.5 release_task failed."), releaseData },
        { status: 502 }
      );
    }

    const taskId = String(releaseData?.data?.task_id || releaseData?.task_id || "").trim();

    if (!taskId) {
      return NextResponse.json(
        { ok: false, error: "ACE-Step 1.5 did not return a task_id.", releaseData },
        { status: 502 }
      );
    }

    const result = await pollAceTask(taskId, Math.max(30000, Math.min(600000, Number(input.timeoutMs || 240000) || 240000)));
    const candidate = firstAudioCandidate(result);
    const audioUrl = absoluteAceAudioUrl(candidate);

    if (!audioUrl) {
      return NextResponse.json(
        { ok: false, error: "ACE-Step 1.5 completed but no downloadable audio URL was found.", taskId, result },
        { status: 502 }
      );
    }

    const audioResponse = await fetch(audioUrl, { cache: "no-store" });

    if (!audioResponse.ok) {
      return NextResponse.json(
        { ok: false, error: `Could not download ACE-Step 1.5 audio (${audioResponse.status}).`, audioUrl },
        { status: 502 }
      );
    }

    const ownerKey = safeSegment(owner.ownerKey || "local");
    const outputDir = path.join(OTG_DATA_ROOT, "edit-video", ownerKey, "ace-step-1.5-music");
    await ensureDir(outputDir);

    const safeTitle = safeSegment(input.title || "video_with_music");
    const audioPath = path.join(outputDir, `${safeTitle}_${Date.now()}_ace15.mp3`);
    const bytes = Buffer.from(await audioResponse.arrayBuffer());

    if (!bytes.length) {
      return NextResponse.json({ ok: false, error: "ACE-Step 1.5 audio download was empty." }, { status: 502 });
    }

    await fs.writeFile(audioPath, bytes);

    const outputUrl = fileUrlFor(audioPath);
    const fileName = path.basename(audioPath);

    return NextResponse.json({
      ok: true,
      provider: "ace-step-1.5",
      model: aceModelName(input.model),
      taskId,
      audioPath,
      audioUrl: outputUrl,
      musicPath: audioPath,
      musicUrl: outputUrl,
      url: outputUrl,
      path: audioPath,
      fileName,
      filename: fileName,
      title: input.title,
      durationSeconds: Math.max(10, Math.min(600, Number(input.durationSeconds || 30) || 30)),
      prompt: input.prompt,
      referenceAudioUsed: Boolean(
        input.referenceAudioFile ||
          input.referenceAudioPath ||
          input.referenceAudioUrl ||
          input.referenceAudioFileName ||
          input.referenceVideo?.fileName ||
          input.referenceVideo?.url ||
          input.referenceVideo?.path
      ),
    });
  } catch (error: any) {
    if (error instanceof SessionInvalidError) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    return NextResponse.json(
      { ok: false, error: error?.message || "ACE-Step 1.5 music generation failed." },
      { status: 500 }
    );
  }
}

