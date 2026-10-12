import fs from "node:fs";
import path from "node:path";

import { resolveFfmpegPath, runCmd } from "@/lib/ffmpeg";
import { ensureDir, safeSegment } from "@/lib/paths";
import { probeVideoInfo } from "@/lib/videoFrame";

export const H3_REFERENCE_VIDEO_MIN_CLIP_SECONDS = 5;
export const H3_REFERENCE_VIDEO_DEFAULT_CLIP_SECONDS = 5;
export const H3_REFERENCE_VIDEO_MAX_CLIP_SECONDS = 120;
export const H3_REFERENCE_VIDEO_CLIP_SECONDS = H3_REFERENCE_VIDEO_DEFAULT_CLIP_SECONDS;
export const H3_REFERENCE_VIDEO_MAX_FPS = 24;
export const H3_REFERENCE_VIDEO_MAX_WIDTH = 1376;
export const H3_REFERENCE_VIDEO_MAX_HEIGHT = 768;
export const H3_REFERENCE_VIDEO_DURATION_TOLERANCE_SECONDS = 0.08;

function finiteNumber(value: unknown, fallback = 0) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

export function normalizeH3ReferenceVideoClipDuration(value: unknown, sourceDurationSeconds?: number | null) {
  const sourceDuration = finiteNumber(sourceDurationSeconds, H3_REFERENCE_VIDEO_MAX_CLIP_SECONDS);
  const sourceLimit =
    sourceDuration > 0
      ? Math.min(sourceDuration, H3_REFERENCE_VIDEO_MAX_CLIP_SECONDS)
      : H3_REFERENCE_VIDEO_MAX_CLIP_SECONDS;
  return Math.min(
    Math.max(
      finiteNumber(value, H3_REFERENCE_VIDEO_DEFAULT_CLIP_SECONDS),
      H3_REFERENCE_VIDEO_MIN_CLIP_SECONDS,
    ),
    Math.max(H3_REFERENCE_VIDEO_MIN_CLIP_SECONDS, sourceLimit),
  );
}

export async function trimH3ReferenceVideoClip(args: {
  inputPath: string;
  outputDir: string;
  outputPrefix: string;
  startSeconds: number;
  durationSeconds?: number;
  includeAudio?: boolean;
  maxWidth?: number;
  maxHeight?: number;
}) {
  const inputPath = path.resolve(args.inputPath);
  const outputDir = path.resolve(args.outputDir);
  ensureDir(outputDir);

  const info = await probeVideoInfo(inputPath);
  const duration = finiteNumber(info.durationSeconds, 0);

  if (duration < H3_REFERENCE_VIDEO_MIN_CLIP_SECONDS - 0.05) {
    throw new Error(
      `Reference video must be at least ${H3_REFERENCE_VIDEO_MIN_CLIP_SECONDS} seconds long.`,
    );
  }

  const clipDuration = normalizeH3ReferenceVideoClipDuration(args.durationSeconds, duration);
  const maxStart = Math.max(0, duration - clipDuration);
  const startSeconds = Math.min(
    Math.max(0, finiteNumber(args.startSeconds, 0)),
    maxStart,
  );
  const maxWidth =
    Math.max(
      2,
      Math.floor(
        finiteNumber(
          args.maxWidth,
          H3_REFERENCE_VIDEO_MAX_WIDTH,
        ),
      ),
    );
  const maxHeight =
    Math.max(
      2,
      Math.floor(
        finiteNumber(
          args.maxHeight,
          H3_REFERENCE_VIDEO_MAX_HEIGHT,
        ),
      ),
    );
  const videoFilter =
    [
      `scale=min(${maxWidth}\\,iw):min(${maxHeight}\\,ih):force_original_aspect_ratio=decrease:force_divisible_by=2`,
      "setsar=1",
      `fps=${H3_REFERENCE_VIDEO_MAX_FPS}`,
      "format=yuv420p",
    ].join(",");

  const outputPath = path.join(
    outputDir,
    `${safeSegment(args.outputPrefix || "h3-reference-video")}_${startSeconds.toFixed(2).replace(".", "p")}_${clipDuration.toFixed(2).replace(".", "p")}s.mp4`,
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
    clipDuration.toFixed(3),
    "-map",
    "0:v:0",
    "-vf",
    videoFilter,
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
      || "Could not prepare the H3 reference video clip.",
    );
  }

  const outputInfo =
    await probeVideoInfo(
      outputPath,
    );

  if (
    !outputInfo.width
    || !outputInfo.height
  ) {
    throw new Error(
      "The prepared H3 reference clip has no decodable video stream.",
    );
  }

  if (
    outputInfo.width > maxWidth
    || outputInfo.height > maxHeight
  ) {
    throw new Error(
      `The prepared H3 reference clip exceeded ${maxWidth}x${maxHeight}.`,
    );
  }

  if (
    outputInfo.fps
    && outputInfo.fps
      > H3_REFERENCE_VIDEO_MAX_FPS + 0.5
  ) {
    throw new Error(
      `The prepared H3 reference clip exceeded ${H3_REFERENCE_VIDEO_MAX_FPS} fps.`,
    );
  }

  if (
    outputInfo.durationSeconds
    && outputInfo.durationSeconds
      > clipDuration
        + H3_REFERENCE_VIDEO_DURATION_TOLERANCE_SECONDS
  ) {
    throw new Error(
      `The prepared H3 reference clip exceeded ${clipDuration} seconds.`,
    );
  }

  return {
    outputPath,
    startSeconds,
    durationSeconds: clipDuration,
    sourceDurationSeconds: duration,
    width:
      outputInfo.width,
    height:
      outputInfo.height,
    fps:
      outputInfo.fps,
  };
}

export async function extractH3ReferenceVideoPromptFrame(args: {
  inputPath: string;
  outputDir: string;
  outputPrefix: string;
  startSeconds: number;
  durationSeconds?: number;
}) {
  const inputPath = path.resolve(args.inputPath);
  const outputDir = path.resolve(args.outputDir);
  ensureDir(outputDir);

  const info = await probeVideoInfo(inputPath);
  const duration = finiteNumber(info.durationSeconds, 0);

  if (duration < H3_REFERENCE_VIDEO_MIN_CLIP_SECONDS - 0.05) {
    throw new Error(
      `Reference video must be at least ${H3_REFERENCE_VIDEO_MIN_CLIP_SECONDS} seconds long.`,
    );
  }

  const clipDuration = normalizeH3ReferenceVideoClipDuration(args.durationSeconds, duration);
  const maxStart = Math.max(0, duration - clipDuration);
  const startSeconds = Math.min(
    Math.max(0, finiteNumber(args.startSeconds, 0)),
    maxStart,
  );

  const outputPath = path.join(
    outputDir,
    `${safeSegment(args.outputPrefix || "h3-reference-video")}_prompt_frame_${startSeconds.toFixed(2).replace(".", "p")}.jpg`,
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
    "-frames:v",
    "1",
    "-vf",
    [
      "scale=min(768\\,iw):min(768\\,ih):force_original_aspect_ratio=decrease",
      "setsar=1",
    ].join(","),
    "-q:v",
    "3",
    outputPath,
  ];

  const result = await runCmd(ffmpeg, ffmpegArgs, {
    timeoutMs: 90_000,
  });

  if (
    result.code !== 0
    || !fs.existsSync(outputPath)
    || fs.statSync(outputPath).size < 1
  ) {
    throw new Error(
      result.stderr
      || result.stdout
      || "Could not extract a prompt-builder frame from the H3 reference video.",
    );
  }

  return {
    outputPath,
    startSeconds,
    durationSeconds:
      clipDuration,
    sourceDurationSeconds:
      duration,
  };
}
