import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { resolveFfmpegPath, resolveFfprobePath, runCmd } from "@/lib/ffmpeg";

/**
 * VHS eagerly materializes its lazy AUDIO output on some ComfyUI versions,
 * even for a silent video. Give that loader a temporary silent soundtrack,
 * without modifying the owner's source or the final original-audio remux.
 */
export async function withH3BodySwapUploadVideo<T>(
  sourcePath: string,
  upload: (videoPath: string) => Promise<T>,
): Promise<T> {
  const probe = await runCmd(resolveFfprobePath(), [
    "-v", "error", "-select_streams", "a:0",
    "-show_entries", "stream=codec_type:format=duration", "-of", "json", sourcePath,
  ], { timeoutMs: 15_000 });
  if (probe.code !== 0) throw new Error("Could not inspect Body Swap source-video audio.");
  let info: { streams?: Array<{ codec_type?: string }>; format?: { duration?: string } };
  try { info = JSON.parse(probe.stdout); }
  catch { throw new Error("Invalid Body Swap source-video audio metadata."); }
  if (!info || !Array.isArray(info.streams)) throw new Error("Invalid Body Swap source-video audio metadata.");
  if (info.streams.some((stream) => stream.codec_type === "audio")) return upload(sourcePath);

  const duration = Number(info.format?.duration);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("Could not determine silent Body Swap source-video duration.");
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), "otg-h3-body-swap-audio-"));
  const target = path.join(directory, "source-with-silent-audio.mp4");
  try {
    const result = await runCmd(resolveFfmpegPath(), [
      "-nostdin", "-hide_banner", "-loglevel", "error", "-n",
      "-i", sourcePath, "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo",
      "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy",
      "-c:a", "aac", "-b:a", "64k", "-t", String(duration),
      "-shortest", "-movflags", "+faststart", target,
    ], { timeoutMs: 3 * 60_000 });
    if (result.code !== 0 || !(await fsp.stat(target)).size) {
      throw new Error("Could not prepare silent Body Swap video for the ComfyUI loader.");
    }
    return await upload(target);
  } finally {
    // Only these helper-owned temporary paths; never touch the source.
    await fsp.rm(target, { force: true }).catch(() => undefined);
    await fsp.rmdir(directory).catch(() => undefined);
  }
}
