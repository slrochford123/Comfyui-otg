export const H3_REFERENCE_VIDEO_CLIP_SECONDS = 5;

export function normalizeH3ReferenceVideoClip(
  sourceDurationSeconds: number,
  requestedStartSeconds: number,
) {
  if (!Number.isFinite(sourceDurationSeconds) || sourceDurationSeconds <= 0) {
    throw new Error("The selected reference video duration could not be determined.");
  }
  const durationSeconds = Math.min(
    H3_REFERENCE_VIDEO_CLIP_SECONDS,
    sourceDurationSeconds,
  );
  const maxStartSeconds = Math.max(0, sourceDurationSeconds - durationSeconds);
  const requested = Number.isFinite(requestedStartSeconds)
    ? requestedStartSeconds
    : 0;
  const startSeconds = Math.min(maxStartSeconds, Math.max(0, requested));
  return { startSeconds, durationSeconds, maxStartSeconds };
}

export function buildH3ReferenceVideoTrimCommand(input: {
  sourcePath: string;
  targetPath: string;
  sourceDurationSeconds: number;
  requestedStartSeconds: number;
}) {
  const clip = normalizeH3ReferenceVideoClip(
    input.sourceDurationSeconds,
    input.requestedStartSeconds,
  );
  return {
    clip,
    args: [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-ss",
      clip.startSeconds.toFixed(3),
      "-i",
      input.sourcePath,
      "-t",
      clip.durationSeconds.toFixed(3),
      "-map",
      "0:v:0",
      "-map",
      "0:a?",
      "-c:v",
      "libx264",
      "-preset",
      "medium",
      "-crf",
      "20",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-movflags",
      "+faststart",
      input.targetPath,
    ],
  };
}
