import { execFile } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

import { NextRequest, NextResponse } from "next/server";

import { getGallerySourcesForRequest, isVideoFile, resolveGalleryItemByName } from "@/lib/gallery";
import { getFfmpegVersion, resolveFfmpegPath, resolveFfprobePath, runCmd } from "@/lib/ffmpeg";
import { safeJoin, safeSegment, OTG_DATA_ROOT } from "@/lib/paths";
import { SessionInvalidError } from "@/lib/ownerKey";
import { isProductionFeatureEnabled, productionDisabledResponse } from "@/lib/production/featureGate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function routeError(error: string, status = 400, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ ok: false, error, ...extra }, { status });
}

function cleanSourceName(value: unknown) {
  return path.basename(String(value || "").trim());
}

function numberOr(value: unknown, fallback: number) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function clampSeconds(value: unknown, fallback: number) {
  const next = numberOr(value, fallback);
  return Math.max(0, Math.round(next * 1000) / 1000);
}

function sourceNameFromUrl(sourceUrl: string) {
  try {
    const parsed = new URL(sourceUrl, "http://localhost");
    const name = parsed.searchParams.get("name") || parsed.searchParams.get("fileName") || "";
    return cleanSourceName(name || parsed.pathname.split("/").pop() || "");
  } catch {
    return cleanSourceName(String(sourceUrl || "").split("?")[0]);
  }
}

function scopeFromUrl(sourceUrl: string) {
  try {
    const parsed = new URL(sourceUrl, "http://localhost");
    const scope = parsed.searchParams.get("scope");
    return scope === "user" || scope === "device" ? scope : null;
  } catch {
    return null;
  }
}

function whisperTimeoutMs(): number {
  const ms = Number(process.env.WHISPER_TIMEOUT_MS || 120000);
  return Number.isFinite(ms) && ms > 1000 ? ms : 120000;
}

function runExecFile(bin: string, args: string[], timeoutMs: number): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = execFile(bin, args, { timeout: timeoutMs, windowsHide: true }, (err, stdout, stderr) => {
      const execError = err as (Error & { killed?: boolean; code?: number | string }) | null;
      if (execError?.killed) {
        reject(new Error(`Process timed out after ${timeoutMs}ms`));
        return;
      }
      const code = execError?.code ?? 0;
      resolve({ code: typeof code === "number" ? code : 0, stdout: String(stdout || ""), stderr: String(stderr || "") });
    });
    child.on("error", reject);
  });
}

async function hasAudioStream(filePath: string) {
  const result = await runCmd(
    resolveFfprobePath(),
    ["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=codec_type", "-of", "csv=p=0", filePath],
    { timeoutMs: 15000 },
  );
  return result.code === 0 && result.stdout.toLowerCase().includes("audio");
}

async function postAudioToWhisperService(audioPath: string) {
  const baseUrl = String(process.env.WHISPER_URL || process.env.WHISPER_DUB_URL || process.env.WHISPER_SERVER_URL || "").replace(/\/+$/, "");
  if (!baseUrl) return "";

  const form = new FormData();
  const data = await fsp.readFile(audioPath);
  form.set("file", new Blob([new Uint8Array(data)], { type: "audio/wav" }), path.basename(audioPath));

  const response = await fetch(`${baseUrl}/transcribe`, { method: "POST", body: form });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.error || `Whisper service failed with HTTP ${response.status}.`);
  }

  return String(payload?.text || payload?.transcript || "").trim();
}

async function transcribeWithLocalWhisper(audioPath: string) {
  const py = (process.env.WHISPER_PYTHON || "python").trim() || "python";
  const model = (process.env.WHISPER_MODEL || "small").trim() || "small";
  const device = (process.env.WHISPER_DEVICE || "auto").trim() || "auto";
  const computeType = (process.env.WHISPER_COMPUTE_TYPE || "auto").trim() || "auto";
  const script = path.join(process.cwd(), "scripts", "whisper", "transcribe.py");

  const result = await runExecFile(
    py,
    [script, "--audio", audioPath, "--model", model, "--device", device, "--compute_type", computeType],
    whisperTimeoutMs(),
  );
  const raw = (result.stdout || "").trim();
  let parsed: { ok?: boolean; text?: string; error?: string } | null = null;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    parsed = null;
  }

  if (!parsed?.ok) {
    const detail = parsed?.error || result.stderr || raw || "Transcription failed.";
    throw new Error(String(detail).slice(0, 4000));
  }

  return String(parsed.text || "").trim();
}

async function transcribeAudio(audioPath: string) {
  const serviceText = await postAudioToWhisperService(audioPath);
  if (serviceText) return { text: serviceText, engine: "whisper-service" };

  const localText = await transcribeWithLocalWhisper(audioPath);
  if (localText) return { text: localText, engine: "local-whisper" };

  throw new Error("Whisper returned an empty transcript for this clip range.");
}

export async function POST(req: NextRequest) {
  if (!isProductionFeatureEnabled()) return productionDisabledResponse();

  try {
    const ffmpegVersion = await getFfmpegVersion();
    if (!ffmpegVersion) {
      return routeError("ffmpeg not available. Range transcript requires FFmpeg audio extraction.", 500, {
        hint: "Set OTG_FFMPEG_PATH and OTG_FFPROBE_PATH, or install ffmpeg in a standard path.",
      });
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") return routeError("JSON body is required.");

    const sourceUrl = String(body.sourceUrl || "").trim();
    const sourceFileName = cleanSourceName(body.sourceFileName) || sourceNameFromUrl(sourceUrl);
    const startSeconds = clampSeconds(body.startSeconds, 0);
    const endSeconds = clampSeconds(body.endSeconds, startSeconds + 1);
    const durationSeconds = Math.round(Math.max(0, endSeconds - startSeconds) * 1000) / 1000;

    if (!sourceFileName || !isVideoFile(sourceFileName)) return routeError("A video source file is required.");
    if (durationSeconds <= 0.05) return routeError("Transcript end time must be greater than start time.");

    const { owner, sources } = await getGallerySourcesForRequest(req);
    const sourceItem = resolveGalleryItemByName({
      sources,
      name: sourceFileName,
      scopeHint: scopeFromUrl(sourceUrl),
    });

    if (!sourceItem || sourceItem.kind !== "video") {
      return routeError("Source clip was not found in the current gallery.", 404, { sourceFileName });
    }
    if (!fs.existsSync(sourceItem.path) || !fs.statSync(sourceItem.path).isFile()) {
      return routeError("Source clip file is missing on disk.", 404, { sourceFileName });
    }
    if (!(await hasAudioStream(sourceItem.path))) {
      return routeError("Selected clip has no audio stream to transcribe.", 400, { sourceFileName });
    }

    const jobsRoot = path.join(OTG_DATA_ROOT, "production_edit_transcript_jobs", safeSegment(owner.ownerKey || "local"));
    const jobId = `transcript-${Date.now()}`;
    const jobDir = safeJoin(jobsRoot, jobId);
    fs.mkdirSync(jobDir, { recursive: true });

    const audioPath = safeJoin(jobDir, "range.wav");
    const extractResult = await runCmd(
      resolveFfmpegPath(),
      [
        "-y",
        "-hide_banner",
        "-ss",
        String(startSeconds),
        "-t",
        String(durationSeconds),
        "-i",
        sourceItem.path,
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-c:a",
        "pcm_s16le",
        audioPath,
      ],
      { timeoutMs: 5 * 60 * 1000 },
    );

    if (extractResult.code !== 0 || !fs.existsSync(audioPath) || fs.statSync(audioPath).size <= 0) {
      return routeError("FFmpeg could not extract audio for this range.", 500, {
        detail: (extractResult.stderr || extractResult.stdout || "").slice(-3000),
      });
    }

    const transcript = await transcribeAudio(audioPath);
    await fsp.writeFile(safeJoin(jobDir, "transcript.txt"), transcript.text, "utf8");

    return NextResponse.json({
      ok: true,
      jobId,
      text: transcript.text,
      engine: transcript.engine,
      sourceFileName,
      startSeconds,
      endSeconds,
      durationSeconds,
      ffmpeg: { version: ffmpegVersion },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error: unknown) {
    if (error instanceof SessionInvalidError) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Transcript failed." }, { status: 500 });
  }
}
