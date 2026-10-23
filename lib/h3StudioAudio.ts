import path from "node:path";
import { resolveFfmpegPath, runCmd } from "@/lib/ffmpeg";
import { probeVideoInfo } from "@/lib/videoFrame";
import type { H3StudioPlan } from "@/lib/h3StudioPlan";
/** Reference edits retain their real selected 2–10-second window; no source padding. */
export async function prepareH3StudioReferenceClip(source: string, start: number, duration: number, maxWidth: number, maxHeight: number, preserveAudio: boolean) {
  const info = await probeVideoInfo(source, { uploadedVideo: true });
  if (!info.durationSeconds || !info.width || !info.height || !Number.isFinite(start) || start < 0 || start + duration > info.durationSeconds + .05
    || info.durationSeconds > 20 * 60 || !Number.isFinite(duration) || duration < 2 || duration > 10) throw new Error("Choose a complete 2–10-second source window within a video no longer than 20 minutes.");
  const outputPath = path.join(path.dirname(source), `${path.parse(source).name}-studio-window.mp4`);
  const args = ["-nostdin", "-y", "-protocol_whitelist", "file,pipe", "-format_whitelist", "mov,matroska,webm", "-ss", String(start), "-i", source, "-t", String(duration), "-map", "0:v:0",
    "-vf", `scale=min(${maxWidth}\\,iw):min(${maxHeight}\\,ih):force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1,fps=24,format=yuv420p`,
    "-c:v", "libx264", "-preset", "fast", "-crf", "18"];
  if (preserveAudio) args.push("-map", "0:a?", "-c:a", "aac"); else args.push("-an");
  args.push("-movflags", "+faststart", outputPath);
  const result = await runCmd(resolveFfmpegPath(), args, { timeoutMs: 60_000 });
  if (result.code !== 0) throw new Error("The selected H3 source window could not be prepared.");
  const trimmed = await probeVideoInfo(outputPath);
  if (!trimmed.durationSeconds || Math.abs(trimmed.durationSeconds - duration) > .12) throw new Error("The prepared H3 source window has an invalid duration.");
  return { outputPath, startSeconds: start, durationSeconds: duration };
}
/** Source means the owner-scoped, already selected/trimmed source, never generated H3 audio. */
export async function finalizeH3StudioAudio(output: string, plan: H3StudioPlan, source?: string) {
  if (plan.audio === "original") {
    if (!source || !(await probeVideoInfo(source)).hasAudio) throw new Error("Original source audio is unavailable. Choose generated audio or mute explicitly.");
  }
  const target = path.join(path.dirname(output), "studio-duration-audio.mp4");
  const args = ["-nostdin", "-y", "-i", output];
  if (plan.audio === "original") args.push("-i", source!);
  args.push("-map", "0:v:0");
  if (plan.audio !== "mute") args.push("-map", plan.audio === "original" ? "1:a:0" : "0:a?");
  args.push("-t", String(plan.durationSeconds), "-c:v", "libx264", "-crf", "18", "-preset", "fast", "-pix_fmt", "yuv420p");
  if (plan.audio !== "mute") args.push("-c:a", "aac", "-af", `apad,atrim=duration=${plan.durationSeconds},asetpts=PTS-STARTPTS`);
  args.push("-movflags", "+faststart", target);
  const result = await runCmd(resolveFfmpegPath(), args, { timeoutMs: 60_000 });
  if (result.code !== 0) throw new Error("H3 video completed but its selected audio could not be finalized.");
  const probe = await probeVideoInfo(target);
  if (!probe.durationSeconds || Math.abs(probe.durationSeconds - plan.durationSeconds) > .12 || (plan.audio === "mute" && probe.hasAudio) || (plan.audio !== "mute" && !probe.hasAudio)) throw new Error("H3 output duration/audio verification failed.");
  return target;
}
