import fs from "node:fs";
import path from "node:path";

import { resolveFfmpegPath, runCmd } from "@/lib/ffmpeg";
import { ensureDir, safeSegment } from "@/lib/paths";
import { probeVideoInfo } from "@/lib/videoFrame";

export const H3_REFERENCE_VIDEO_CLIP_SECONDS = 5;

function finiteNumber(value: unknown, fallback = 0) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

export async function trimH3ReferenceVideoClip(args: {
  inputPath: string;
  outputDir: string;
  outputPrefix: string;
  startSeconds: number;
  includeAudio?: boolean;
}) {
  const inputPath = path.resolve(args.inputPath);
  const outputDir = path.resolve(args.outputDir);
  ensureDir(outputDir);

  const info = await probeVideoInfo(inputPath);
  const duration = finiteNumber(info.durationSeconds, 0);

  if (duration < H3_REFERENCE_VIDEO_CLIP_SECONDS - 0.05) {
    throw new Error(
      `Reference video must be at least ${H3_REFERENCE_VIDEO_CLIP_SECONDS} seconds long.`,
    );
  }

  const maxStart = Math.max(0, duration - H3_REFERENCE_VIDEO_CLIP_SECONDS);
  const startSeconds = Math.min(
    Math.max(0, finiteNumber(args.startSeconds, 0)),
    maxStart,
  );

  const outputPath = path.join(
    outputDir,
    `${safeSegment(args.outputPrefix || "h3-reference-video")}_${startSeconds.toFixed(2).replace(".", "p")}_5s.mp4`,
  );

  const ffmpeg = resolveFfmpegPath();
  const ffmpegArgs = [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-ss",
    startSeconds.toFixed(3),
    "-i",
    inputPath,
    "-t",
    H3_REFERENCE_VIDEO_CLIP_SECONDS.toFixed(3),
    "-map",
    "0:v:0",
    ...(args.includeAudio === false ? [] : ["-map", "0:a:0?"]),
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "18",
    "-pix_fmt",
    "yuv420p",
    ...(args.includeAudio === false ? ["-an"] : ["-c:a", "aac", "-b:a", "192k"]),
    "-movflags",
    "+faststart",
    outputPath,
  ];

  const result = await runCmd(ffmpeg, ffmpegArgs, {
    timeoutMs: 5 * 60_000,
  });

  if (
    result.code !== 0
    || !fs.existsSync(outputPath)
    || fs.statSync(outputPath).size < 1
  ) {
    throw new Error(
      result.stderr
      || result.stdout
      || "Could not prepare the 5-second H3 reference video clip.",
    );
  }

  return {
    outputPath,
    startSeconds,
    durationSeconds: H3_REFERENCE_VIDEO_CLIP_SECONDS,
    sourceDurationSeconds: duration,
  };
}
