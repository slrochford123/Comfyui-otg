import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { ensureDir } from "@/lib/paths";
import { resolveFfmpegPath, resolveFfprobePath, runCmd } from "@/lib/ffmpeg";

export type VideoProbeInfo = {
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  codec: string | null;
};

function toFiniteNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export async function probeVideoInfo(filePath: string): Promise<VideoProbeInfo> {
  const ffprobe = resolveFfprobePath();
  const result = await runCmd(
    ffprobe,
    [
      "-v",
      "error",
      "-print_format",
      "json",
      "-show_streams",
      "-show_format",
      filePath,
    ],
    { timeoutMs: 20000 },
  );

  if (result.code !== 0) {
    throw new Error(result.stderr || result.stdout || "ffprobe failed");
  }

  const parsed = JSON.parse(result.stdout || "{}");
  const streams = Array.isArray(parsed?.streams) ? parsed.streams : [];
  const videoStream = streams.find((stream: any) => String(stream?.codec_type || "").toLowerCase() === "video") || null;
  const durationSeconds = toFiniteNumber(parsed?.format?.duration) ?? toFiniteNumber(videoStream?.duration) ?? null;
  const width = toFiniteNumber(videoStream?.width);
  const height = toFiniteNumber(videoStream?.height);
  const codec = videoStream?.codec_name ? String(videoStream.codec_name) : null;

  return {
    durationSeconds,
    width,
    height,
    codec,
  };
}

export function deriveOrientation(width: number | null, height: number | null): "portrait" | "landscape" | "square" | "unknown" {
  if (!width || !height) return "unknown";
  if (width === height) return "square";
  return width > height ? "landscape" : "portrait";
}

export function buildTailFrameName(inputPath: string): string {
  const stat = fs.statSync(inputPath);
  const key = `${path.resolve(inputPath)}|${stat.size}|${stat.mtimeMs}`;
  return `extend_tail_${createHash("sha1").update(key).digest("hex")}.jpg`;
}

export async function extractTailFrameToImage(args: {
  inputPath: string;
  outputPath: string;
  seekSeconds?: number;
}): Promise<{ outputPath: string; usedSeconds: number }> {
  const { inputPath, outputPath } = args;
  ensureDir(path.dirname(outputPath));

  const probe = await probeVideoInfo(inputPath);
  const duration = probe.durationSeconds ?? 0;
  const usedSeconds = Number.isFinite(args.seekSeconds)
    ? Math.max(0, Number(args.seekSeconds))
    : duration > 0.25
      ? Math.max(0, duration - 0.12)
      : 0;

  const ffmpeg = resolveFfmpegPath();
  const ff = await runCmd(
    ffmpeg,
    [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-ss",
      usedSeconds.toFixed(3),
      "-i",
      inputPath,
      "-frames:v",
      "1",
      "-q:v",
      "2",
      outputPath,
    ],
    { timeoutMs: 30000 },
  );

  if (ff.code !== 0 || !fs.existsSync(outputPath)) {
    throw new Error(ff.stderr || ff.stdout || "ffmpeg tail-frame extraction failed");
  }

  return { outputPath, usedSeconds };
}
