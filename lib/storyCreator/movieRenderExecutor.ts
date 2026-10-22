import fs from "node:fs";
import path from "node:path";

import { probeDurationSeconds, resolveFfmpegPath, resolveFfprobePath, runCmd } from "@/lib/ffmpeg";
import {
  getMovieRenderJob,
  movieRenderRoot,
  updateMovieRender,
} from "@/lib/storyCreator/movieEditor";
import type { MovieTimelineClip } from "@/lib/storyCreator/movieEditorTypes";

type ResolvedClip = MovieTimelineClip & { sourcePath: string | null };
type RenderManifest = {
  settings: { width: number; height: number; fps: number; musicDucking: boolean; loudnessTargetLufs: number };
  clips: ResolvedClip[];
  incomplete: boolean;
};

const active = new Set<string>();
const pending: Array<{ ownerKey: string; projectId: string; renderId: string }> = [];
let running = 0;
const MAX_CONCURRENT_MOVIE_RENDERS = 1;
const MAX_RENDER_BYTES_RESERVE = 2 * 1024 * 1024 * 1024;

function safeText(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'").replace(/%/g, "\\%").replace(/[\r\n]+/g, " ").slice(0, 500);
}

async function requireSuccess(args: string[], label: string, timeoutMs = 60 * 60_000) {
  const result = await runCmd(resolveFfmpegPath(), args, { timeoutMs });
  if (result.code !== 0) throw new Error(`${label} failed: ${(result.stderr || result.stdout).slice(-4_000)}`);
}

async function probe(filePath: string) {
  const result = await runCmd(resolveFfprobePath(), ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", filePath], { timeoutMs: 30_000 });
  if (result.code !== 0) throw new Error(`Could not inspect rendered media: ${(result.stderr || result.stdout).slice(-2_000)}`);
  const parsed = JSON.parse(result.stdout || "{}") as { streams?: Array<Record<string, unknown>>; format?: Record<string, unknown> };
  const streams = parsed.streams || [];
  return {
    durationSeconds: Number(parsed.format?.duration || 0),
    hasVideo: streams.some((item) => item.codec_type === "video"),
    hasAudio: streams.some((item) => item.codec_type === "audio"),
    width: Number(streams.find((item) => item.codec_type === "video")?.width || 0),
    height: Number(streams.find((item) => item.codec_type === "video")?.height || 0),
  };
}

function checkDisk(root: string) {
  const stats = fs.statfsSync(root);
  const free = Number(stats.bavail) * Number(stats.bsize);
  if (free < MAX_RENDER_BYTES_RESERVE) throw new Error("Movie render requires at least 2 GB of free disk space.");
}

async function normalizeVisual(clip: ResolvedClip, outputPath: string, settings: RenderManifest["settings"]) {
  const duration = Math.max(0.1, clip.durationSeconds);
  if (clip.kind === "title") {
    const text = safeText(clip.titleText || clip.label);
    await requireSuccess([
      "-y", "-hide_banner", "-f", "lavfi", "-i", `color=c=black:s=${settings.width}x${settings.height}:r=${settings.fps}:d=${duration.toFixed(3)}`,
      "-vf", `drawtext=text='${text}':fontcolor=white:fontsize=h/16:x=(w-text_w)/2:y=(h-text_h)/2:line_spacing=12`,
      "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart", outputPath,
    ], "Title render");
    return;
  }
  if (!clip.sourcePath) throw new Error(`${clip.label} has no source file.`);
  const fit = clip.fit === "cover"
    ? `scale=${settings.width}:${settings.height}:force_original_aspect_ratio=increase,crop=${settings.width}:${settings.height}`
    : `scale=${settings.width}:${settings.height}:force_original_aspect_ratio=decrease,pad=${settings.width}:${settings.height}:(ow-iw)/2:(oh-ih)/2:black`;
  const filters = [fit, `fps=${settings.fps}`, "setsar=1", "format=yuv420p"];
  if (clip.transitionIn === "fade" || clip.transitionIn === "fade-black") filters.push(`fade=t=in:st=0:d=${clip.transitionDurationSeconds.toFixed(3)}`);
  if (clip.transitionOut === "fade" || clip.transitionOut === "fade-black") filters.push(`fade=t=out:st=${Math.max(0, duration - clip.transitionDurationSeconds).toFixed(3)}:d=${clip.transitionDurationSeconds.toFixed(3)}`);
  await requireSuccess([
    "-y", "-hide_banner", "-ss", clip.sourceInSeconds.toFixed(3), "-t", duration.toFixed(3), "-i", clip.sourcePath,
    "-vf", filters.join(","), "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart", outputPath,
  ], "Video normalization");
}

async function concatPair(current: string, next: string, output: string, transition: MovieTimelineClip["transitionIn"], transitionDuration: number) {
  if (transition !== "crossfade") {
    const listPath = `${output}.txt`;
    fs.writeFileSync(listPath, `file '${current.replace(/'/g, "'\\''")}'\nfile '${next.replace(/'/g, "'\\''")}'\n`, { mode: 0o600 });
    await requireSuccess(["-y", "-hide_banner", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", "-movflags", "+faststart", output], "Video concatenation");
    return;
  }
  const currentDuration = Number(await probeDurationSeconds(current) || 0);
  const nextDuration = Number(await probeDurationSeconds(next) || 0);
  const duration = Math.min(Math.max(0.1, transitionDuration), currentDuration / 2, nextDuration / 2);
  const offset = Math.max(0, currentDuration - duration);
  await requireSuccess([
    "-y", "-hide_banner", "-i", current, "-i", next,
    "-filter_complex", `[0:v][1:v]xfade=transition=fade:duration=${duration.toFixed(3)}:offset=${offset.toFixed(3)}[v]`,
    "-map", "[v]", "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart", output,
  ], "Video crossfade");
}

async function addAudio(videoPath: string, clips: ResolvedClip[], outputPath: string, settings: RenderManifest["settings"]) {
  const videoDuration = Number(await probeDurationSeconds(videoPath) || 0);
  const sources: Array<{ path: string; clip: ResolvedClip; role: string; sourceOffset: number; duration: number; timelineStart: number }> = [];
  for (const clip of clips) {
    if (clip.kind === "audio" && clip.sourcePath && !clip.muted) sources.push({ path: clip.sourcePath, clip, role: clip.audioRole || "sound-effect", sourceOffset: clip.sourceInSeconds, duration: clip.durationSeconds, timelineStart: clip.timelineStartSeconds });
    if (clip.kind === "video" && clip.sourcePath && clip.keepOriginalAudio && !clip.muted) sources.push({ path: clip.sourcePath, clip, role: "original", sourceOffset: clip.sourceInSeconds, duration: clip.durationSeconds, timelineStart: clip.timelineStartSeconds });
  }
  if (!sources.length) {
    await requireSuccess(["-y", "-hide_banner", "-i", videoPath, "-f", "lavfi", "-t", videoDuration.toFixed(3), "-i", "anullsrc=channel_layout=stereo:sample_rate=48000", "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", outputPath], "Silent audio master");
    return;
  }
  const args = ["-y", "-hide_banner", "-i", videoPath];
  for (const source of sources) args.push("-i", source.path);
  const filters: string[] = [];
  const labels: string[] = [];
  const hasDialogue = sources.some((source) => source.role === "dialogue" || source.role === "narration");
  sources.forEach((source, index) => {
    const clip = source.clip;
    let gain = Math.pow(10, clip.gainDb / 20);
    if (settings.musicDucking && hasDialogue && source.role === "music") gain *= 0.35;
    const chain = [
      `atrim=start=${source.sourceOffset.toFixed(3)}:duration=${source.duration.toFixed(3)}`,
      "asetpts=PTS-STARTPTS", "aresample=48000", "aformat=sample_fmts=fltp:channel_layouts=stereo",
      `volume=${gain.toFixed(6)}`,
    ];
    if (clip.fadeInSeconds > 0) chain.push(`afade=t=in:st=0:d=${clip.fadeInSeconds.toFixed(3)}`);
    if (clip.fadeOutSeconds > 0) chain.push(`afade=t=out:st=${Math.max(0, source.duration - clip.fadeOutSeconds).toFixed(3)}:d=${clip.fadeOutSeconds.toFixed(3)}`);
    const delay = Math.round(source.timelineStart * 1000);
    chain.push(`adelay=${delay}|${delay}`);
    filters.push(`[${index + 1}:a:0]${chain.join(",")}[a${index}]`);
    labels.push(`[a${index}]`);
  });
  filters.push(`${labels.join("")}amix=inputs=${labels.length}:duration=longest:dropout_transition=0,alimiter=limit=0.95,loudnorm=I=${settings.loudnessTargetLufs}:TP=-1.5:LRA=11,atrim=duration=${videoDuration.toFixed(3)}[mix]`);
  args.push("-filter_complex", filters.join(";"), "-map", "0:v:0", "-map", "[mix]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", outputPath);
  await requireSuccess(args, "Audio mix");
}

export async function executeMovieRender(input: { ownerKey: string; projectId: string; renderId: string }) {
  const job = getMovieRenderJob(input);
  const manifest = job.manifest as unknown as RenderManifest;
  const root = movieRenderRoot(input.ownerKey, input.projectId, input.renderId);
  checkDisk(root);
  const work = path.join(root, "work"); fs.mkdirSync(work, { recursive: true, mode: 0o700 });
  updateMovieRender({ ...input, status: "running", progress: 5, stage: "normalizing-sources" });
  try {
    const visuals = manifest.clips.filter((clip) => clip.kind === "video" || clip.kind === "title").sort((a, b) => a.order - b.order);
    const normalized: string[] = [];
    for (let index = 0; index < visuals.length; index += 1) {
      const output = path.join(work, `visual-${String(index).padStart(4, "0")}.mp4`);
      await normalizeVisual(visuals[index], output, manifest.settings); normalized.push(output);
      updateMovieRender({ ...input, status: "running", progress: 8 + Math.round(((index + 1) / visuals.length) * 42), stage: "normalizing-sources" });
    }
    let current = normalized[0];
    for (let index = 1; index < normalized.length; index += 1) {
      const output = path.join(work, `joined-${String(index).padStart(4, "0")}.mp4`);
      await concatPair(current, normalized[index], output, visuals[index].transitionIn, visuals[index].transitionDurationSeconds);
      current = output;
      updateMovieRender({ ...input, status: "running", progress: 50 + Math.round((index / Math.max(1, normalized.length - 1)) * 25), stage: "assembling-video" });
    }
    const partial = path.join(root, "movie.partial.mp4"), final = path.join(root, "movie.mp4");
    updateMovieRender({ ...input, status: "running", progress: 78, stage: "mixing-audio" });
    await addAudio(current, manifest.clips, partial, manifest.settings);
    const result = await probe(partial);
    if (!result.hasVideo || !result.hasAudio || result.durationSeconds <= 0 || result.width !== manifest.settings.width || result.height !== manifest.settings.height) throw new Error("Rendered movie failed final media verification.");
    fs.renameSync(partial, final);
    fs.rmSync(work, { recursive: true, force: true });
    return updateMovieRender({ ...input, status: "completed", progress: 100, stage: "verified", outputPath: final });
  } catch (error) {
    return updateMovieRender({ ...input, status: "failed", progress: 0, stage: "failed", error: error instanceof Error ? error.message : String(error) });
  }
}

function pumpMovieRenderQueue() {
  while (running < MAX_CONCURRENT_MOVIE_RENDERS && pending.length) {
    const input = pending.shift()!;
    const status = getMovieRenderJob(input).status;
    if (status === "canceled") { active.delete(input.renderId); continue; }
    running += 1;
    void executeMovieRender(input).finally(() => {
      running -= 1;
      active.delete(input.renderId);
      pumpMovieRenderQueue();
    });
  }
}

export function dispatchMovieRender(input: { ownerKey: string; projectId: string; renderId: string }) {
  if (active.has(input.renderId)) return;
  active.add(input.renderId);
  pending.push(input);
  pumpMovieRenderQueue();
}
