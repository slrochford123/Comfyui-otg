import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

import { probeDurationSeconds, resolveFfmpegPath, resolveFfprobePath, runCmd } from "@/lib/ffmpeg";
import { ensureDir, OTG_DATA_ROOT, safeJoin, safeSegment } from "@/lib/paths";
import type { ProductionV2, ProductionV2AssemblyMusicTrack, ProductionV2Scene, ProductionV2SceneMediaVersion } from "@/lib/production/v2";

export const PRODUCTION_V2_MIN_TRIM_SECONDS = 0.25;
export const PRODUCTION_V2_OUTPUT_WIDTH = 1376;
export const PRODUCTION_V2_OUTPUT_HEIGHT = 768;
export const PRODUCTION_V2_OUTPUT_FPS = 24;

export type ProductionV2MediaProbe = {
  durationSeconds: number;
  width: number;
  height: number;
  hasAudio: boolean;
};

function clean(value: unknown) {
  return String(value ?? "").trim();
}

export function productionV2OwnerRoot(ownerKey: string) {
  return safeJoin(OTG_DATA_ROOT, "productions-v2", safeSegment(ownerKey));
}

export function productionV2Root(ownerKey: string, productionId: string) {
  return safeJoin(productionV2OwnerRoot(ownerKey), safeSegment(productionId));
}

export function productionV2SceneOutputRoot(ownerKey: string, productionId: string, sceneId: string) {
  const directory = safeJoin(productionV2Root(ownerKey, productionId), "scenes", safeSegment(sceneId), "versions");
  ensureDir(directory);
  return directory;
}

export function assertProductionV2OwnedFile(ownerKey: string, productionId: string, value: string) {
  const ownerProductionRoot = productionV2Root(ownerKey, productionId);
  const resolved = path.resolve(clean(value));
  const relative = path.relative(ownerProductionRoot, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative) || !fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    throw new Error("The selected Production media is missing or outside this owner-scoped Production.");
  }
  return resolved;
}

export function resolveProductionV2Version(production: ProductionV2, sceneId: string, versionId: string) {
  const scene = production.scenes.find((item) => item.id === sceneId);
  const version = scene?.mediaVersions.find((item) => item.id === versionId);
  if (!scene || !version) throw new Error("The selected Scene media version was not found.");
  return { scene, version };
}

export async function probeProductionV2Media(filePath: string): Promise<ProductionV2MediaProbe> {
  const result = await runCmd(resolveFfprobePath(), ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", filePath], { timeoutMs: 30_000 });
  if (result.code !== 0) throw new Error(`Could not inspect selected video: ${result.stderr || result.stdout}`);
  const parsed = JSON.parse(result.stdout || "{}") as { streams?: Array<Record<string, unknown>>; format?: Record<string, unknown> };
  const streams = Array.isArray(parsed.streams) ? parsed.streams : [];
  const video = streams.find((stream) => stream.codec_type === "video");
  if (!video) throw new Error("The selected media does not contain a video stream.");
  const duration = Number(video.duration || parsed.format?.duration || await probeDurationSeconds(filePath) || 0);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("The selected video duration could not be determined.");
  return {
    durationSeconds: duration,
    width: Math.max(1, Number(video.width || 0)),
    height: Math.max(1, Number(video.height || 0)),
    hasAudio: streams.some((stream) => stream.codec_type === "audio"),
  };
}

function outputPath(args: { ownerKey: string; productionId: string; sceneId: string; operation: string; extension?: string }) {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  return safeJoin(
    productionV2SceneOutputRoot(args.ownerKey, args.productionId, args.sceneId),
    `${safeSegment(args.operation)}-${stamp}${args.extension || ".mp4"}`,
  );
}

function requireFfmpegSuccess(result: Awaited<ReturnType<typeof runCmd>>, operation: string) {
  if (result.code !== 0) throw new Error(`${operation} failed: ${result.stderr || result.stdout}`);
}

export async function trimProductionV2Video(args: {
  ownerKey: string;
  productionId: string;
  sceneId: string;
  sourcePath: string;
  startSeconds: number;
  endSeconds: number;
}) {
  const probe = await probeProductionV2Media(args.sourcePath);
  const start = Number(args.startSeconds);
  const end = Number(args.endSeconds);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > probe.durationSeconds + 0.02 || end <= start) {
    throw new Error("Trim range must stay inside the source and end after the start point.");
  }
  if (end - start < PRODUCTION_V2_MIN_TRIM_SECONDS) throw new Error(`Trimmed video must be at least ${PRODUCTION_V2_MIN_TRIM_SECONDS} seconds.`);
  const target = outputPath({ ...args, operation: "ffmpeg-trim" });
  const command = [
    "-y", "-hide_banner", "-ss", start.toFixed(3), "-to", end.toFixed(3), "-i", args.sourcePath,
    "-map", "0:v:0", "-map", "0:a?", "-c:v", "libx264", "-preset", "medium", "-crf", "18",
    "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", target,
  ];
  requireFfmpegSuccess(await runCmd(resolveFfmpegPath(), command, { timeoutMs: 20 * 60_000 }), "FFmpeg trim");
  return { outputPath: target, probe: await probeProductionV2Media(target), startSeconds: start, endSeconds: end };
}

export async function adjustProductionV2Volume(args: {
  ownerKey: string;
  productionId: string;
  sceneId: string;
  sourcePath: string;
  volumePercent: number;
}) {
  const probe = await probeProductionV2Media(args.sourcePath);
  if (!probe.hasAudio) throw new Error("The selected video has no audio stream to adjust.");
  const volumePercent = Number(args.volumePercent);
  if (!Number.isFinite(volumePercent) || volumePercent < 0 || volumePercent > 200) throw new Error("Clip volume must be between 0% and 200%.");
  const target = outputPath({ ...args, operation: "ffmpeg-volume" });
  const command = [
    "-y", "-hide_banner", "-i", args.sourcePath, "-map", "0:v:0", "-map", "0:a:0", "-c:v", "copy",
    "-af", `volume=${(volumePercent / 100).toFixed(4)}`, "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", target,
  ];
  requireFfmpegSuccess(await runCmd(resolveFfmpegPath(), command, { timeoutMs: 20 * 60_000 }), "FFmpeg volume adjustment");
  return { outputPath: target, probe: await probeProductionV2Media(target), volumePercent };
}

export function resolveProductionV2Demucs() {
  const python = clean(process.env.OTG_DEMUCS_PYTHON)
    || "/home/shawn-rochford/AI/LeVo2/.venv/bin/python";
  const runner = clean(process.env.OTG_DEMUCS_RUNNER)
    || "/home/shawn-rochford/AI/models/LeVo2/runtime/third_party/demucs/run.py";
  const modelDir = clean(
    process.env.OTG_DEMUCS_MODEL_DIR
    || process.env.OTG_DEMUCS_MODEL_REPO,
  ) || "/home/shawn-rochford/AI/models/LeVo2/runtime/third_party/demucs/ckpt";

  const parsedGpuId = Number(
    clean(process.env.OTG_DEMUCS_GPU_ID) || "0",
  );
  const gpuId = Number.isInteger(parsedGpuId) && parsedGpuId >= 0
    ? parsedGpuId
    : 0;

  let pythonReady = false;
  try {
    fs.accessSync(python, fs.constants.X_OK);
    pythonReady = fs.statSync(python).isFile();
  } catch {
    pythonReady = false;
  }

  const requiredFiles = [
    runner,
    path.join(modelDir, "htdemucs.pth"),
    path.join(modelDir, "htdemucs.yaml"),
  ];

  const filesReady = requiredFiles.every((candidate) => {
    try {
      return fs.statSync(candidate).isFile();
    } catch {
      return false;
    }
  });

  return {
    ready: pythonReady && filesReady,
    python,
    runner,
    modelDir,
    model: "htdemucs",
    gpuId,
    implementation: "levo2-native" as const,
  };
}

export async function removeProductionV2BackgroundMusic(args: {
  ownerKey: string;
  productionId: string;
  sceneId: string;
  sourcePath: string;
}) {
  const probe = await probeProductionV2Media(args.sourcePath);
  if (!probe.hasAudio) {
    throw new Error(
      "The selected video has no mixed audio to separate.",
    );
  }

  const dependency = resolveProductionV2Demucs();
  if (!dependency.ready) {
    throw new Error(
      "Background Music Removal is unavailable because "
      + "the local LeVo2 Demucs dependency is not ready.",
    );
  }

  const workDir = safeJoin(
    productionV2SceneOutputRoot(
      args.ownerKey,
      args.productionId,
      args.sceneId,
    ),
    `demucs-${Date.now()}`,
  );
  ensureDir(workDir);

  const audioPath = safeJoin(workDir, "source.wav");

  requireFfmpegSuccess(
    await runCmd(
      resolveFfmpegPath(),
      [
        "-y",
        "-hide_banner",
        "-i",
        args.sourcePath,
        "-map",
        "0:a:0",
        "-ar",
        "44100",
        "-ac",
        "2",
        audioPath,
      ],
      { timeoutMs: 10 * 60_000 },
    ),
    "Audio extraction",
  );

  const inputJson = safeJoin(workDir, "input.jsonl");
  const outputJson = safeJoin(workDir, "output.jsonl");

  await fsp.writeFile(
    inputJson,
    `${JSON.stringify({
      idx: "production-v2",
      path: audioPath,
    })}\n`,
    "utf8",
  );

  const demucs = await runCmd(
    dependency.python,
    [
      dependency.runner,
      "-m",
      dependency.modelDir,
      "-d",
      workDir,
      "-j",
      inputJson,
      "-o",
      outputJson,
      "-gid",
      String(dependency.gpuId),
    ],
    { timeoutMs: 45 * 60_000 },
  );

  if (demucs.code !== 0) {
    throw new Error(
      `LeVo2 Demucs source separation failed: ${
        demucs.stderr || demucs.stdout
      }`,
    );
  }

  if (!fs.existsSync(outputJson)) {
    throw new Error(
      "LeVo2 Demucs completed without producing its result manifest.",
    );
  }

  const lines = (await fsp.readFile(outputJson, "utf8"))
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) {
    throw new Error(
      "LeVo2 Demucs completed without returning a separated vocal stem.",
    );
  }

  let result: Record<string, unknown>;
  try {
    result = JSON.parse(lines[0]) as Record<string, unknown>;
  } catch {
    throw new Error(
      "LeVo2 Demucs returned an invalid separation result manifest.",
    );
  }

  const vocalPathValue = clean(result.vocal_path);
  if (!vocalPathValue) {
    throw new Error(
      "LeVo2 Demucs completed without returning a vocal stem path.",
    );
  }

  const vocalsPath = path.resolve(vocalPathValue);
  const relativeVocalPath = path.relative(workDir, vocalsPath);

  if (
    !relativeVocalPath
    || relativeVocalPath.startsWith("..")
    || path.isAbsolute(relativeVocalPath)
    || !fs.existsSync(vocalsPath)
    || !fs.statSync(vocalsPath).isFile()
  ) {
    throw new Error(
      "LeVo2 Demucs returned a missing or invalid vocal stem.",
    );
  }

  const target = outputPath({
    ...args,
    operation: "demucs-remove-music",
  });

  requireFfmpegSuccess(
    await runCmd(
      resolveFfmpegPath(),
      [
        "-y",
        "-hide_banner",
        "-i",
        args.sourcePath,
        "-i",
        vocalsPath,
        "-map",
        "0:v:0",
        "-map",
        "1:a:0",
        "-c:v",
        "copy",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-ar",
        "48000",
        "-ac",
        "2",
        "-movflags",
        "+faststart",
        target,
      ],
      { timeoutMs: 20 * 60_000 },
    ),
    "FFmpeg music-removal remux",
  );

  return {
    outputPath: target,
    probe: await probeProductionV2Media(target),
    model: dependency.model,
  };
}

async function normalizeAssemblyClip(sourcePath: string, target: string) {
  const probe = await probeProductionV2Media(sourcePath);
  const args = ["-y", "-hide_banner", "-i", sourcePath];
  if (!probe.hasAudio) args.push("-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000");
  args.push(
    "-map", "0:v:0", "-map", probe.hasAudio ? "0:a:0" : "1:a:0", "-vf",
    `scale=${PRODUCTION_V2_OUTPUT_WIDTH}:${PRODUCTION_V2_OUTPUT_HEIGHT}:force_original_aspect_ratio=decrease,pad=${PRODUCTION_V2_OUTPUT_WIDTH}:${PRODUCTION_V2_OUTPUT_HEIGHT}:(ow-iw)/2:(oh-ih)/2:color=black,fps=${PRODUCTION_V2_OUTPUT_FPS},format=yuv420p`,
    "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2", "-shortest", "-movflags", "+faststart", target,
  );
  requireFfmpegSuccess(await runCmd(resolveFfmpegPath(), args, { timeoutMs: 30 * 60_000 }), "Assembly clip normalization");
}

function escapeConcatPath(value: string) {
  return value.replace(/'/g, "'\\''");
}


function sceneVersionAlreadyContainsAssemblySfx(
  production: ProductionV2,
  sceneId: string,
  versionId: string,
  sfxMediaPath: string,
) {
  const scene = production.scenes.find((item) => item.id === sceneId);
  if (!scene) return false;
  const byId = new Map(scene.mediaVersions.map((version) => [version.id, version]));
  const seen = new Set<string>();
  let currentId: string | null = versionId;
  while (currentId && !seen.has(currentId)) {
    seen.add(currentId);
    const version = byId.get(currentId);
    if (!version) break;
    if (
      version.sourceOperation === "woosh-vflow-sfx"
      && version.metadata?.rawSfxAudioPath === sfxMediaPath
    ) {
      return true;
    }
    currentId = version.parentVersionId;
  }
  return false;
}

export async function renderProductionV2Assembly(args: {
  ownerKey: string;
  production: ProductionV2;
  clipSources: Array<{ scene: ProductionV2Scene; version: ProductionV2SceneMediaVersion; sourcePath: string }>;
  musicTracks: Array<ProductionV2AssemblyMusicTrack & { sourcePath: string }>;
  sfxTracks: Array<ProductionV2["assembly"]["sfxTracks"][number] & { sourcePath: string }>;
}) {
  if (!args.clipSources.length) throw new Error("Assembly requires at least one Scene media version.");
  const assemblyRoot = safeJoin(productionV2Root(args.ownerKey, args.production.id), "assembly", `render-${Date.now()}`);
  ensureDir(assemblyRoot);
  const normalized: string[] = [];
  const sceneWindows = new Map<string, { startSeconds: number; durationSeconds: number }>();
  let sceneCursor = 0;
  for (let index = 0; index < args.clipSources.length; index += 1) {
    const target = safeJoin(assemblyRoot, `clip-${String(index + 1).padStart(2, "0")}.mp4`);
    await normalizeAssemblyClip(args.clipSources[index].sourcePath, target);
    const normalizedProbe = await probeProductionV2Media(target);
    if (!normalizedProbe.durationSeconds) throw new Error("An Assembly Scene duration could not be determined.");
    sceneWindows.set(args.clipSources[index].scene.id, {
      startSeconds: sceneCursor,
      durationSeconds: normalizedProbe.durationSeconds,
    });
    sceneCursor += normalizedProbe.durationSeconds;
    normalized.push(target);
  }
  const concatList = safeJoin(assemblyRoot, "concat.txt");
  await fsp.writeFile(concatList, normalized.map((file) => `file '${escapeConcatPath(file)}'`).join("\n") + "\n", "utf8");
  const joined = safeJoin(assemblyRoot, "joined.mp4");
  requireFfmpegSuccess(await runCmd(resolveFfmpegPath(), ["-y", "-hide_banner", "-f", "concat", "-safe", "0", "-i", concatList, "-c", "copy", joined], { timeoutMs: 30 * 60_000 }), "Assembly concatenation");
  const joinedProbe = await probeProductionV2Media(joined);
  const totalDuration = joinedProbe.durationSeconds;
  if (!totalDuration) throw new Error("The assembled Production duration could not be determined.");
  const target = safeJoin(assemblyRoot, "final-production.mp4");
  const command: string[] = ["-y", "-hide_banner", "-i", joined];
  args.musicTracks.forEach((track) => command.push("-i", track.sourcePath));
  args.sfxTracks.forEach((track) => command.push("-i", track.sourcePath));
  const sfxInputBase = 1 + args.musicTracks.length;
  const filters: string[] = [];
  const videoFilters: string[] = [];
  const audioFilters: string[] = [];
  if (args.production.assembly.fadeIn.enabled && args.production.assembly.fadeIn.durationSeconds > 0) {
    const duration = Math.min(totalDuration, args.production.assembly.fadeIn.durationSeconds);
    videoFilters.push(`fade=t=in:st=0:d=${duration.toFixed(3)}`);
    audioFilters.push(`afade=t=in:st=0:d=${duration.toFixed(3)}`);
  }
  if (args.production.assembly.fadeOut.enabled && args.production.assembly.fadeOut.durationSeconds > 0) {
    const duration = Math.min(totalDuration, args.production.assembly.fadeOut.durationSeconds);
    const start = Math.max(0, totalDuration - duration);
    videoFilters.push(`fade=t=out:st=${start.toFixed(3)}:d=${duration.toFixed(3)}`);
    audioFilters.push(`afade=t=out:st=${start.toFixed(3)}:d=${duration.toFixed(3)}`);
  }
  filters.push(`[0:v]setpts=PTS-STARTPTS${videoFilters.length ? `,${videoFilters.join(",")}` : ""}[v]`);
  filters.push(`[0:a]asetpts=PTS-STARTPTS,apad,atrim=duration=${totalDuration.toFixed(3)}${audioFilters.length ? `,${audioFilters.join(",")}` : ""}[base]`);
  const mixInputs = ["[base]"];
  args.musicTracks.forEach((track, index) => {
    const start = Math.max(0, track.startSeconds);
    const end = Math.min(totalDuration, track.endSeconds ?? totalDuration);
    const duration = Math.max(0.01, end - start);
    const chain = [`atrim=start=0:end=${duration.toFixed(3)}`, "asetpts=PTS-STARTPTS", "aresample=48000", `volume=${track.volume.toFixed(4)}`];
    if (track.fadeInSeconds > 0) chain.push(`afade=t=in:st=0:d=${Math.min(duration, track.fadeInSeconds).toFixed(3)}`);
    if (track.fadeOutSeconds > 0) {
      const fadeDuration = Math.min(duration, track.fadeOutSeconds);
      chain.push(`afade=t=out:st=${Math.max(0, duration - fadeDuration).toFixed(3)}:d=${fadeDuration.toFixed(3)}`);
    }
    chain.push(`adelay=${Math.round(start * 1000)}|${Math.round(start * 1000)}`);
    filters.push(`[${index + 1}:a]${chain.join(",")},apad,atrim=duration=${totalDuration.toFixed(3)}[music${index}]`);
    mixInputs.push(`[music${index}]`);
  });
  args.sfxTracks.forEach((track, index) => {
    const sceneWindow = sceneWindows.get(track.sceneId);
    if (!sceneWindow) throw new Error("Assembly SFX track refers to a Scene that is not present in the final Assembly.");
    const selectedClip = args.clipSources.find((clip) => clip.scene.id === track.sceneId);
    if (!selectedClip) throw new Error("Assembly SFX Scene source could not be resolved.");

    // A Woosh audio-edit child already contains this exact generated WAV.
    // Do not mix it a second time if that child, or one of its descendants,
    // is explicitly selected as the Assembly source.
    if (
      sceneVersionAlreadyContainsAssemblySfx(
        args.production,
        track.sceneId,
        selectedClip.version.id,
        track.sourcePath,
      )
    ) {
      return;
    }

    const relativeStart = Math.max(0, Math.min(sceneWindow.durationSeconds, track.startSeconds));
    const relativeEnd = Math.min(
      sceneWindow.durationSeconds,
      track.endSeconds ?? sceneWindow.durationSeconds,
    );
    if (relativeEnd <= relativeStart) throw new Error("Assembly SFX end time must be greater than its start time.");
    const duration = relativeEnd - relativeStart;
    const timelineStart = sceneWindow.startSeconds + relativeStart;
    const inputIndex = sfxInputBase + index;
    const chain = [
      `atrim=start=0:end=${duration.toFixed(3)}`,
      "asetpts=PTS-STARTPTS",
      "aresample=48000",
      `volume=${track.volume.toFixed(4)}`,
      `adelay=${Math.round(timelineStart * 1000)}|${Math.round(timelineStart * 1000)}`,
    ];
    filters.push(
      `[${inputIndex}:a]${chain.join(",")},apad,atrim=duration=${totalDuration.toFixed(3)}[sfx${index}]`,
    );
    mixInputs.push(`[sfx${index}]`);
  });

  filters.push(`${mixInputs.join("")}amix=inputs=${mixInputs.length}:duration=longest:dropout_transition=2,atrim=duration=${totalDuration.toFixed(3)},asetpts=PTS-STARTPTS[a]`);
  command.push("-filter_complex", filters.join(";"), "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", target);
  requireFfmpegSuccess(await runCmd(resolveFfmpegPath(), command, { timeoutMs: 60 * 60_000 }), "Final Assembly render");
  return { outputPath: target, probe: await probeProductionV2Media(target) };
}
