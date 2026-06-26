import { NextRequest, NextResponse } from "next/server";
import { spawn } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REPO_ROOT = process.cwd();
const MUSIC_DIR = path.join(REPO_ROOT, "data", "production", "assembly-music");
const OUTPUT_DIR = path.join(REPO_ROOT, "data", "production", "assembly-music-output");

function safeName(value: unknown, fallback = "assembly_music_mix") {
  const clean = String(value || "")
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]+/g, "_")
    .replace(/\s+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
  return clean || fallback;
}

function clampVolume(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0.3;
  return Math.max(0, Math.min(1, numeric));
}

// OTG_ASSEMBLY_MUSIC_START_STOP_MIX_V36BPW16C
// OTG_ASSEMBLY_MUSIC_FADE_ADD_UNDO_MIX_V36BPW17
function clampSeconds(value: unknown, min: number, max: number) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return min;
  return Math.max(min, Math.min(max, numeric));
}

function resolveFfmpegPath() {
  return String(process.env.FFMPEG_PATH || process.env.OTG_FFMPEG_PATH || "ffmpeg");
}

function resolveFfprobePath() {
  return String(process.env.FFPROBE_PATH || process.env.OTG_FFPROBE_PATH || "ffprobe");
}

function runCommand(command: string, args: string[], timeoutMs = 600_000) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${path.basename(command)} timed out.`));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${path.basename(command)} failed with exit ${code}: ${stderr || stdout}`));
    });
  });
}

async function ffprobeJson(filePath: string) {
  const { stdout } = await runCommand(resolveFfprobePath(), [
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_streams",
    "-show_format",
    filePath,
  ], 120_000);
  return JSON.parse(stdout || "{}");
}

async function mediaInfo(filePath: string) {
  try {
    const data = await ffprobeJson(filePath);
    const streams = Array.isArray(data?.streams) ? data.streams : [];
    const duration = Number(data?.format?.duration || streams.find((stream: any) => Number(stream?.duration))?.duration || 0);
    return {
      durationSeconds: Number.isFinite(duration) && duration > 0 ? duration : 30,
      hasAudio: streams.some((stream: any) => String(stream?.codec_type || "") === "audio"),
    };
  } catch {
    return { durationSeconds: 30, hasAudio: true };
  }
}

function resolveExistingPath(primary: unknown, fallbackDir: string, fallbackName: unknown) {
  const direct = String(primary || "").trim();
  if (direct && path.isAbsolute(direct) && fs.existsSync(direct)) return direct;

  const fileName = safeName(fallbackName || "");
  if (fileName) {
    const candidate = path.join(fallbackDir, path.basename(fileName));
    if (fs.existsSync(candidate)) return candidate;
  }

  return "";
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const name = safeName(url.searchParams.get("name") || "");
  if (!name) return NextResponse.json({ ok: false, error: "Missing video name." }, { status: 400 });

  const filePath = path.join(OUTPUT_DIR, path.basename(name));
  if (!fs.existsSync(filePath)) return NextResponse.json({ ok: false, error: "Mixed video not found." }, { status: 404 });

  const bytes = await fsp.readFile(filePath);
  const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return new Response(body, {
    headers: {
      "Content-Type": "video/mp4",
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": "no-store",
    },
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    const videoPath = resolveExistingPath(body?.videoPath, "", "");
    const musicPath = resolveExistingPath(body?.musicPath || body?.audioPath, MUSIC_DIR, body?.musicFileName || body?.audioFileName);

    if (!videoPath) return NextResponse.json({ ok: false, error: "Assembled video path was not found." }, { status: 400 });
    if (!musicPath) return NextResponse.json({ ok: false, error: "Generated music path was not found." }, { status: 400 });

    await fsp.mkdir(OUTPUT_DIR, { recursive: true });

    const musicVolume = clampVolume(body?.musicVolume ?? body?.volume);
    const info = await mediaInfo(videoPath);
    const durationSeconds = Math.max(1, Math.min(3600, info.durationSeconds || 30));
    const startSeconds = clampSeconds(body?.musicStartSeconds ?? body?.startSeconds ?? 0, 0, durationSeconds);
    const requestedEndSeconds = body?.musicEndSeconds ?? body?.endSeconds ?? durationSeconds;
    const endSeconds = Math.max(startSeconds + 0.25, clampSeconds(requestedEndSeconds, startSeconds + 0.25, durationSeconds));
    const musicDurationSeconds = Math.max(0.25, endSeconds - startSeconds);
    const delayMs = Math.max(0, Math.round(startSeconds * 1000));
    const fadeInSeconds = Math.min(musicDurationSeconds / 2, clampSeconds(body?.fadeInSeconds ?? body?.musicFadeInSeconds ?? 0, 0, 60));
    const fadeOutSeconds = Math.min(musicDurationSeconds / 2, clampSeconds(body?.fadeOutSeconds ?? body?.musicFadeOutSeconds ?? 0, 0, 60));
    const fadeOutStartSeconds = Math.max(0, musicDurationSeconds - fadeOutSeconds);
    const outputName = `${safeName(body?.productionId || "assembly")}_with_music_${Date.now()}.mp4`;
    const outputPath = path.join(OUTPUT_DIR, outputName);
    const ffmpeg = resolveFfmpegPath();

    const fadeFilters = `${fadeInSeconds > 0 ? `,afade=t=in:st=0:d=${fadeInSeconds}` : ""}${fadeOutSeconds > 0 ? `,afade=t=out:st=${fadeOutStartSeconds}:d=${fadeOutSeconds}` : ""}`;
    const musicFilter = `[1:a]volume=${musicVolume},atrim=0:${musicDurationSeconds},asetpts=PTS-STARTPTS${fadeFilters},adelay=${delayMs}|${delayMs}[music]`;
    const args = info.hasAudio
      ? [
          "-y",
          "-hide_banner",
          "-i",
          videoPath,
          "-stream_loop",
          "-1",
          "-i",
          musicPath,
          "-filter_complex",
          `[0:a]volume=1[base];${musicFilter};[base][music]amix=inputs=2:duration=first:dropout_transition=0,alimiter=limit=0.95[aout]`,
          "-map",
          "0:v:0",
          "-map",
          "[aout]",
          "-c:v",
          "copy",
          "-c:a",
          "aac",
          "-b:a",
          "192k",
          "-shortest",
          outputPath,
        ]
      : [
          "-y",
          "-hide_banner",
          "-i",
          videoPath,
          "-stream_loop",
          "-1",
          "-i",
          musicPath,
          "-f",
          "lavfi",
          "-t",
          String(durationSeconds),
          "-i",
          "anullsrc=channel_layout=stereo:sample_rate=48000",
          "-filter_complex",
          `[2:a]volume=1[base];${musicFilter};[base][music]amix=inputs=2:duration=first:dropout_transition=0,alimiter=limit=0.95[aout]`,
          "-map",
          "0:v:0",
          "-map",
          "[aout]",
          "-c:v",
          "copy",
          "-c:a",
          "aac",
          "-b:a",
          "192k",
          "-shortest",
          outputPath,
        ];

    await runCommand(ffmpeg, args);
    const stat = await fsp.stat(outputPath);

    return NextResponse.json({
      ok: true,
      videoPath: outputPath,
      videoFileName: outputName,
      videoUrl: `/api/production/assembly-music-mix?name=${encodeURIComponent(outputName)}`,
      musicPath,
      musicVolume,
      musicStartSeconds: startSeconds,
      musicEndSeconds: endSeconds,
      musicDurationSeconds,
      fadeInSeconds,
      fadeOutSeconds,
      durationSeconds,
      sizeBytes: stat.size,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Background music mix failed." },
      { status: 500 },
    );
  }
}
