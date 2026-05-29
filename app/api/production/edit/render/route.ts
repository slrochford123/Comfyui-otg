import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";

import { getGallerySourcesForRequest, isVideoFile, resolveGalleryItemByName, writeMetaForFile } from "@/lib/gallery";
import { getFfmpegVersion, probeDurationSeconds, resolveFfmpegPath, resolveFfprobePath, runCmd } from "@/lib/ffmpeg";
import { safeGalleryName } from "@/lib/gallery";
import { safeJoin, safeSegment } from "@/lib/paths";
import { SessionInvalidError } from "@/lib/ownerKey";
import { isProductionFeatureEnabled, productionDisabledResponse } from "@/lib/production/featureGate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type EditRenderManifestInput = {
  trim?: {
    startSeconds?: unknown;
    endSeconds?: unknown;
  };
  trimStartSeconds?: unknown;
  trimEndSeconds?: unknown;
  playbackRate?: unknown;
  expandMode?: unknown;
  sourceFileName?: unknown;
  audioPolicy?: {
    mode?: unknown;
    originalVolume?: unknown;
    replacementAudioUrl?: unknown;
    replacementAudioFileName?: unknown;
    replacementVolume?: unknown;
  };
  audioCleanup?: {
    muteOriginal?: unknown;
    reduceOriginalVolume?: unknown;
    originalVolume?: unknown;
  };
  music?: {
    enabled?: unknown;
    source?: unknown;
    prompt?: unknown;
    audioUrl?: unknown;
    audioFileName?: unknown;
    startSeconds?: unknown;
    endSeconds?: unknown;
    volume?: unknown;
    fadeInSec?: unknown;
    fadeOutSec?: unknown;
    duckUnderDialogue?: unknown;
  };
  sfxSegments?: Array<{
    id?: unknown;
    mode?: unknown;
    label?: unknown;
    prompt?: unknown;
    audioUrl?: unknown;
    audioFileName?: unknown;
    startSeconds?: unknown;
    durationSeconds?: unknown;
    volume?: unknown;
    fadeInSec?: unknown;
    fadeOutSec?: unknown;
  }>;
  voiceSegments?: Array<{
    id?: unknown;
    character?: unknown;
    voice?: unknown;
    audioUrl?: unknown;
    audioFileName?: unknown;
    startSeconds?: unknown;
    endSeconds?: unknown;
    text?: unknown;
    mode?: unknown;
    volume?: unknown;
  }>;
};

type AudioPolicy = {
  mode: "keep_original" | "mute_original" | "reduce_original" | "replace_original";
  originalVolume: number;
  replacementAudioUrl: string;
  replacementAudioFileName: string;
  replacementVolume: number;
};

type VoiceSegment = {
  id: string;
  character: string;
  voice: string;
  audioUrl: string;
  audioFileName: string;
  audioPath: string;
  startSeconds: number;
  endSeconds: number;
  mode: "replace_original" | "mix_over_original" | "mute_original_range" | "keep_original";
  volume: number;
};

type MusicLayer = {
  enabled: boolean;
  source: "none" | "generate" | "library" | "upload";
  prompt: string;
  audioUrl: string;
  audioFileName: string;
  audioPath: string;
  startSeconds: number;
  endSeconds: number;
  volume: number;
  fadeInSec: number;
  fadeOutSec: number;
  duckUnderDialogue: boolean;
};

type SfxSegment = {
  id: string;
  mode: "timed" | "full_clip";
  label: string;
  prompt: string;
  audioUrl: string;
  audioFileName: string;
  audioPath: string;
  startSeconds: number;
  durationSeconds: number;
  volume: number;
  fadeInSec: number;
  fadeOutSec: number;
};

type ExpandMode = "none" | "freeze_start" | "freeze_end" | "slow_down";

const AUDIO_EXTENSIONS = new Set([".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac"]);

function cleanSourceName(value: unknown) {
  return path.basename(String(value || "").trim());
}

function isAudioFileName(value: string) {
  return AUDIO_EXTENSIONS.has(path.extname(String(value || "").toLowerCase()));
}

function numberOr(value: unknown, fallback: number) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function clampSeconds(value: unknown, fallback: number) {
  const next = numberOr(value, fallback);
  return Math.max(0, Math.round(next * 1000) / 1000);
}

function formatFilterNumber(value: number) {
  if (!Number.isFinite(value)) return "1";
  return String(Math.round(value * 1000000) / 1000000);
}

function normalizeExpandMode(value: unknown): ExpandMode {
  const raw = String(value || "none").trim();
  if (raw === "none" || raw === "freeze_start" || raw === "freeze_end" || raw === "slow_down") return raw;
  return "none";
}

function atempoFilterChain(playbackRate: number) {
  if (!Number.isFinite(playbackRate) || playbackRate <= 0) {
    throw new Error("playbackRate must be greater than 0.");
  }

  const filters: string[] = [];
  let remaining = playbackRate;

  while (remaining < 0.5) {
    filters.push("atempo=0.5");
    remaining /= 0.5;
  }

  while (remaining > 100) {
    filters.push("atempo=100");
    remaining /= 100;
  }

  filters.push(`atempo=${formatFilterNumber(remaining)}`);
  return filters.join(",");
}

function fadeFilterParts(durationSeconds: number, fadeInSec: number, fadeOutSec: number) {
  const filters: string[] = [];
  const safeDuration = Math.max(0.01, durationSeconds);
  const safeFadeIn = Math.min(safeDuration, clampSeconds(fadeInSec, 0));
  const safeFadeOut = Math.min(safeDuration, clampSeconds(fadeOutSec, 0));

  if (safeFadeIn > 0.001) {
    filters.push(`afade=t=in:st=0:d=${safeFadeIn}`);
  }
  if (safeFadeOut > 0.001) {
    filters.push(`afade=t=out:st=${Math.max(0, safeDuration - safeFadeOut)}:d=${safeFadeOut}`);
  }

  return filters;
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

function sourceNameFromUrl(sourceUrl: string) {
  try {
    const parsed = new URL(sourceUrl, "http://localhost");
    const name = parsed.searchParams.get("name") || parsed.searchParams.get("fileName") || "";
    return cleanSourceName(name || parsed.pathname.split("/").pop() || "");
  } catch {
    return cleanSourceName(String(sourceUrl || "").split("?")[0]);
  }
}

function outputNameFor(sceneId: string, clipIndex: number) {
  const scenePart = safeGalleryName(safeSegment(sceneId || "scene")).replace(/\.+$/g, "") || "scene";
  const clipPart = Math.max(0, Math.floor(numberOr(clipIndex, 0))) + 1;
  return `${scenePart}_clip_${clipPart}_edited_trim_${Date.now()}.mp4`;
}

function normalizeAudioPolicy(manifest: EditRenderManifestInput): AudioPolicy {
  const raw = manifest.audioPolicy || {};
  const rawMode = String(raw.mode || "").trim();
  const legacy = manifest.audioCleanup || {};
  const originalVolume = Math.max(0, Math.min(1, numberOr(raw.originalVolume ?? legacy.originalVolume, 1)));

  let mode: AudioPolicy["mode"] = "keep_original";
  if (rawMode === "mute_original" || rawMode === "reduce_original" || rawMode === "replace_original" || rawMode === "keep_original") {
    mode = rawMode;
  } else if (legacy.muteOriginal) {
    mode = "mute_original";
  } else if (legacy.reduceOriginalVolume || originalVolume < 0.999) {
    mode = "reduce_original";
  }

  return {
    mode,
    originalVolume,
    replacementAudioUrl: String(raw.replacementAudioUrl || "").trim(),
    replacementAudioFileName: cleanSourceName(raw.replacementAudioFileName),
    replacementVolume: Math.max(0, Math.min(2, numberOr(raw.replacementVolume, 1))),
  };
}

function audioNameFromUrl(sourceUrl: string) {
  try {
    const parsed = new URL(sourceUrl, "http://localhost");
    const name = parsed.searchParams.get("name") || parsed.searchParams.get("fileName") || "";
    return cleanSourceName(name || parsed.pathname.split("/").pop() || "");
  } catch {
    return cleanSourceName(String(sourceUrl || "").split("?")[0]);
  }
}

function normalizeVoiceMode(value: unknown): VoiceSegment["mode"] {
  const raw = String(value || "").trim();
  if (raw === "replace_original" || raw === "mix_over_original" || raw === "mute_original_range" || raw === "keep_original") return raw;
  if (raw === "replace") return "replace_original";
  if (raw === "overlay") return "mix_over_original";
  return "mix_over_original";
}

function resolveAudioPathFromGallery(sources: Awaited<ReturnType<typeof getGallerySourcesForRequest>>["sources"], fileName: string) {
  const baseName = cleanSourceName(fileName);
  if (!baseName || !isAudioFileName(baseName)) return "";

  for (const source of sources) {
    try {
      const candidate = safeJoin(source.dir, baseName);
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    } catch {
      // Try the next source.
    }
  }

  return "";
}

async function hasAudioStream(filePath: string) {
  const result = await runCmd(
    resolveFfprobePath(),
    ["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=codec_type", "-of", "csv=p=0", filePath],
    { timeoutMs: 15000 },
  );
  return result.code === 0 && result.stdout.toLowerCase().includes("audio");
}

function normalizeVoiceSegments(
  manifest: EditRenderManifestInput,
  sources: Awaited<ReturnType<typeof getGallerySourcesForRequest>>["sources"],
  durationSeconds: number,
): VoiceSegment[] {
  const rawSegments = Array.isArray(manifest.voiceSegments) ? manifest.voiceSegments : [];
  const segments: VoiceSegment[] = [];

  rawSegments.forEach((segment, index) => {
    const audioFileName = cleanSourceName(segment.audioFileName) || audioNameFromUrl(String(segment.audioUrl || ""));
    const audioPath = resolveAudioPathFromGallery(sources, audioFileName);
    if (!audioPath) return;

    const startSeconds = Math.min(durationSeconds, clampSeconds(segment.startSeconds, 0));
    const endSeconds = Math.min(durationSeconds, clampSeconds(segment.endSeconds, Math.min(durationSeconds, startSeconds + 1)));
    if (endSeconds <= startSeconds + 0.01) return;

    segments.push({
      id: String(segment.id || `voice_${index}`),
      character: String(segment.character || ""),
      voice: String(segment.voice || ""),
      audioUrl: String(segment.audioUrl || ""),
      audioFileName,
      audioPath,
      startSeconds,
      endSeconds,
      mode: normalizeVoiceMode(segment.mode),
      volume: Math.max(0, Math.min(2, numberOr(segment.volume, 1))),
    });
  });

  return segments;
}

function normalizeMusicLayer(
  manifest: EditRenderManifestInput,
  sources: Awaited<ReturnType<typeof getGallerySourcesForRequest>>["sources"],
  durationSeconds: number,
): MusicLayer {
  const raw = manifest.music || {};
  const rawSource = String(raw.source || "none").trim();
  const source: MusicLayer["source"] =
    rawSource === "generate" || rawSource === "library" || rawSource === "upload" ? rawSource : "none";
  const enabled = Boolean(raw.enabled) && source !== "none";
  const audioFileName = cleanSourceName(raw.audioFileName) || audioNameFromUrl(String(raw.audioUrl || ""));
  const startSeconds = Math.min(durationSeconds, clampSeconds(raw.startSeconds, 0));
  const endSeconds = Math.min(durationSeconds, clampSeconds(raw.endSeconds, durationSeconds));

  return {
    enabled,
    source,
    prompt: String(raw.prompt || ""),
    audioUrl: String(raw.audioUrl || ""),
    audioFileName,
    audioPath: enabled ? resolveAudioPathFromGallery(sources, audioFileName) : "",
    startSeconds,
    endSeconds,
    volume: Math.max(0, Math.min(2, numberOr(raw.volume, 0.35))),
    fadeInSec: clampSeconds(raw.fadeInSec, 0),
    fadeOutSec: clampSeconds(raw.fadeOutSec, 0),
    duckUnderDialogue: raw.duckUnderDialogue !== false,
  };
}

function normalizeSfxSegments(
  manifest: EditRenderManifestInput,
  sources: Awaited<ReturnType<typeof getGallerySourcesForRequest>>["sources"],
  durationSeconds: number,
): SfxSegment[] {
  const rawSegments = Array.isArray(manifest.sfxSegments) ? manifest.sfxSegments : [];
  const segments: SfxSegment[] = [];

  rawSegments.forEach((segment, index) => {
    const audioFileName = cleanSourceName(segment.audioFileName) || audioNameFromUrl(String(segment.audioUrl || ""));
    const audioPath = resolveAudioPathFromGallery(sources, audioFileName);
    if (!audioPath) return;

    const mode = segment.mode === "full_clip" ? "full_clip" : "timed";
    const startSeconds = mode === "full_clip" ? 0 : Math.min(durationSeconds, clampSeconds(segment.startSeconds, 0));
    const duration = mode === "full_clip" ? durationSeconds : Math.min(durationSeconds - startSeconds, clampSeconds(segment.durationSeconds, 1));
    if (duration <= 0.01) return;

    segments.push({
      id: String(segment.id || `sfx_${index}`),
      mode,
      label: String(segment.label || `SFX ${index + 1}`),
      prompt: String(segment.prompt || ""),
      audioUrl: String(segment.audioUrl || ""),
      audioFileName,
      audioPath,
      startSeconds,
      durationSeconds: duration,
      volume: Math.max(0, Math.min(2, numberOr(segment.volume, 1))),
      fadeInSec: clampSeconds(segment.fadeInSec, 0),
      fadeOutSec: clampSeconds(segment.fadeOutSec, 0),
    });
  });

  return segments;
}

function routeError(error: string, status = 400, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ ok: false, error, ...extra }, { status });
}

// OTG_PRODUCTION_EDIT_TRIM_RENDER_V1
// OTG_PRODUCTION_EDIT_AUDIO_CLEANUP_V1
// OTG_PRODUCTION_EDIT_VOICE_SEGMENTS_V1
// OTG_PRODUCTION_EDIT_MUSIC_LAYER_V1
// OTG_PRODUCTION_EDIT_SFX_SEGMENTS_V1
export async function POST(req: NextRequest) {
  if (!isProductionFeatureEnabled()) return productionDisabledResponse();

  try {
    const ffmpegVersion = await getFfmpegVersion();
    if (!ffmpegVersion) {
      return routeError(
        "ffmpeg not available. Manifest save can still be used, but trim rendering requires FFmpeg.",
        500,
        { hint: "Set OTG_FFMPEG_PATH and OTG_FFPROBE_PATH, or install ffmpeg in a standard path." },
      );
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return routeError("JSON body is required.");
    }

    const sceneId = String(body.sceneId || "").trim();
    const clipIndex = Math.max(0, Math.floor(numberOr(body.clipIndex, 0)));
    const sourceUrl = String(body.sourceUrl || "").trim();
    const manifest = (body.manifest && typeof body.manifest === "object" ? body.manifest : {}) as EditRenderManifestInput;
    const playbackRate = numberOr(manifest.playbackRate, 1);
    const expandMode = normalizeExpandMode(manifest.expandMode);
    const audioPolicy = normalizeAudioPolicy(manifest);

    if (!sceneId) return routeError("sceneId is required.");
    if (!sourceUrl && !manifest.sourceFileName) return routeError("sourceUrl or manifest.sourceFileName is required.");
    if (!Number.isFinite(playbackRate) || playbackRate <= 0) {
      return routeError("playbackRate must be greater than 0.");
    }
    if (expandMode === "freeze_start" || expandMode === "freeze_end") {
      return routeError("Freeze start/end expand modes are not supported by this render path yet. Use expandMode none or slow_down.");
    }
    if (expandMode === "slow_down" && playbackRate >= 1) {
      return routeError("Slow down expand mode requires playbackRate below 1.");
    }
    if (expandMode === "none" && Math.abs(playbackRate - 1) > 0.001) {
      return routeError("Playback rate changes require expandMode slow_down.");
    }

    const sourceFileName =
      cleanSourceName(manifest.sourceFileName) ||
      cleanSourceName(body.sourceFileName) ||
      sourceNameFromUrl(sourceUrl);
    if (!sourceFileName || !isVideoFile(sourceFileName)) {
      return routeError("A video source file is required.");
    }

    const { owner, sources } = await getGallerySourcesForRequest(req);
    const sourceItem = resolveGalleryItemByName({
      sources,
      name: sourceFileName,
      scopeHint: scopeFromUrl(sourceUrl),
    });

    if (!sourceItem || sourceItem.kind !== "video") {
      return routeError("Source clip was not found in the current gallery.", 404, { sourceFileName });
    }

    const sourcePath = sourceItem.path;
    if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
      return routeError("Source clip file is missing on disk.", 404, { sourceFileName });
    }

    const sourceDuration = (await probeDurationSeconds(sourcePath)) || 0;
    const startSeconds = clampSeconds(manifest.trim?.startSeconds ?? manifest.trimStartSeconds, 0);
    const requestedEnd = manifest.trim?.endSeconds ?? manifest.trimEndSeconds;
    const fallbackEnd = sourceDuration > 0 ? sourceDuration : Math.max(startSeconds + 0.1, 4);
    const endSeconds = clampSeconds(requestedEnd, fallbackEnd);
    const effectiveEnd = sourceDuration > 0 ? Math.min(endSeconds, sourceDuration) : endSeconds;
    const durationSeconds = Math.round(Math.max(0, effectiveEnd - startSeconds) * 1000) / 1000;

    if (startSeconds < 0) {
      return routeError("Trim startSeconds must be greater than or equal to 0.");
    }
    if (durationSeconds <= 0.05) {
      return routeError("Trim end must be greater than trim start.");
    }
    if (sourceDuration > 0 && endSeconds > sourceDuration + 0.05) {
      return routeError("Trim end is beyond the source video duration.", 400, { sourceDuration, endSeconds });
    }

    const timingScale = expandMode === "slow_down" ? 1 / playbackRate : 1;
    const renderDurationSeconds = Math.round(durationSeconds * timingScale * 1000) / 1000;
    const usesSlowDown = expandMode === "slow_down" && Math.abs(playbackRate - 1) > 0.001;
    const setPtsScale = formatFilterNumber(timingScale);
    const atempoChain = usesSlowDown ? atempoFilterChain(playbackRate) : "";

    const outputName = outputNameFor(sceneId, clipIndex);
    const outputPath = safeJoin(sourceItem.scope === "user" || sourceItem.scope === "device" ? sourceItem.path ? path.dirname(sourceItem.path) : sources[0].dir : sources[0].dir, outputName);
    const ffmpeg = resolveFfmpegPath();
    const sourceHasAudio = await hasAudioStream(sourcePath);
    const replacementAudioName = audioPolicy.replacementAudioFileName || audioNameFromUrl(audioPolicy.replacementAudioUrl);
    const replacementAudioPath = audioPolicy.mode === "replace_original"
      ? resolveAudioPathFromGallery(sources, replacementAudioName)
      : "";
    const voiceSegments = normalizeVoiceSegments(manifest, sources, renderDurationSeconds);
    const musicLayer = normalizeMusicLayer(manifest, sources, renderDurationSeconds);
    const sfxSegments = normalizeSfxSegments(manifest, sources, renderDurationSeconds);

    if (audioPolicy.mode === "replace_original" && !replacementAudioPath) {
      return routeError("Replacement audio file was not found in the current gallery.", 404, { replacementAudioFileName: replacementAudioName });
    }
    if (musicLayer.enabled && musicLayer.endSeconds <= musicLayer.startSeconds + 0.01) {
      return routeError("Music end must be greater than music start.");
    }
    if (musicLayer.enabled && !musicLayer.audioPath) {
      return routeError("Music audio file was not found in the current gallery.", 404, {
        musicAudioFileName: musicLayer.audioFileName,
        musicSource: musicLayer.source,
      });
    }
    const unresolvedSfxSegments = (Array.isArray(manifest.sfxSegments) ? manifest.sfxSegments : []).filter((segment) => {
      const audioFileName = cleanSourceName(segment.audioFileName) || audioNameFromUrl(String(segment.audioUrl || ""));
      return audioFileName && !resolveAudioPathFromGallery(sources, audioFileName);
    });
    if (unresolvedSfxSegments.length) {
      return routeError("One or more SFX audio files were not found in the current gallery.", 404, {
        sfxAudioFileNames: unresolvedSfxSegments.map((segment) => cleanSourceName(segment.audioFileName) || audioNameFromUrl(String(segment.audioUrl || ""))),
      });
    }

    const ffmpegArgs = [
      "-y",
      "-hide_banner",
      "-ss",
      String(startSeconds),
      "-t",
      String(durationSeconds),
      "-i",
      sourcePath,
    ];

    let nextInputIndex = 1;
    let replacementInputIndex = -1;
    if (replacementAudioPath) {
      ffmpegArgs.push("-i", replacementAudioPath);
      replacementInputIndex = nextInputIndex;
      nextInputIndex += 1;
    }

    const needsSilentBase = audioPolicy.mode === "mute_original" || (!sourceHasAudio && audioPolicy.mode !== "replace_original");
    let silentInputIndex = -1;
    if (needsSilentBase) {
      ffmpegArgs.push(
        "-f",
        "lavfi",
        "-t",
        String(renderDurationSeconds),
        "-i",
        "anullsrc=channel_layout=stereo:sample_rate=48000",
      );
      silentInputIndex = nextInputIndex;
      nextInputIndex += 1;
    }

    const voiceInputIndexes: number[] = [];
    for (const segment of voiceSegments) {
      ffmpegArgs.push("-i", segment.audioPath);
      voiceInputIndexes.push(nextInputIndex);
      nextInputIndex += 1;
    }

    let musicInputIndex = -1;
    if (musicLayer.enabled && musicLayer.audioPath) {
      ffmpegArgs.push("-i", musicLayer.audioPath);
      musicInputIndex = nextInputIndex;
      nextInputIndex += 1;
    }

    const sfxInputIndexes: number[] = [];
    for (const segment of sfxSegments) {
      ffmpegArgs.push("-i", segment.audioPath);
      sfxInputIndexes.push(nextInputIndex);
      nextInputIndex += 1;
    }

    const filterParts: string[] = [];
    filterParts.push(`[0:v]setpts=${setPtsScale}*(PTS-STARTPTS),format=yuv420p[edited_video]`);

    const useComplexAudio = usesSlowDown || voiceSegments.length > 0 || musicLayer.enabled || sfxSegments.length > 0;
    let outputHasAudio = useComplexAudio;
    let directAudioMap = "";
    let baseInput = "";
    let baseVolume = 1;

    if (audioPolicy.mode === "mute_original") {
      baseInput = `[${silentInputIndex}:a]`;
      baseVolume = 1;
      outputHasAudio = true;
    } else if (audioPolicy.mode === "replace_original") {
      baseInput = `[${replacementInputIndex}:a]`;
      baseVolume = audioPolicy.replacementVolume;
      outputHasAudio = true;
    } else if (sourceHasAudio) {
      baseInput = "[0:a]";
      baseVolume = audioPolicy.mode === "reduce_original" ? audioPolicy.originalVolume : 1;
      outputHasAudio = true;
    } else if (silentInputIndex >= 0) {
      baseInput = `[${silentInputIndex}:a]`;
      baseVolume = 1;
      outputHasAudio = true;
    }

    if (useComplexAudio) {
      let baseFilter = baseInput
        ? `${baseInput}atrim=0:${baseInput === "[0:a]" ? durationSeconds : renderDurationSeconds},asetpts=PTS-STARTPTS`
        : "";
      if (usesSlowDown && baseInput === "[0:a]") {
        baseFilter += `,${atempoChain}`;
      }
      if (baseFilter) {
        baseFilter += `,volume=${baseVolume}`;
      }
      voiceSegments.forEach((segment) => {
        if (segment.mode === "replace_original" || segment.mode === "mute_original_range") {
          baseFilter += `,volume=volume=0:enable='between(t,${segment.startSeconds},${segment.endSeconds})'`;
        }
      });
      baseFilter += "[base_audio]";

      const mixInputs: string[] = [];
      if (baseInput) {
        filterParts.push(baseFilter);
        mixInputs.push("[base_audio]");
      }

      voiceSegments.forEach((segment, index) => {
        const segmentDuration = Math.max(0.01, segment.endSeconds - segment.startSeconds);
        const delayMs = Math.max(0, Math.round(segment.startSeconds * 1000));
        const inputIndex = voiceInputIndexes[index];
        const label = `voice_${index}`;
        filterParts.push(
          `[${inputIndex}:a]atrim=0:${segmentDuration},asetpts=PTS-STARTPTS,volume=${segment.volume},adelay=${delayMs}|${delayMs}[${label}]`
        );
        mixInputs.push(`[${label}]`);
      });

      if (musicLayer.enabled && musicInputIndex >= 0) {
        const musicDuration = Math.max(0.01, musicLayer.endSeconds - musicLayer.startSeconds);
        const musicDelayMs = Math.max(0, Math.round(musicLayer.startSeconds * 1000));
        let musicFilter = `[${musicInputIndex}:a]atrim=0:${musicDuration},asetpts=PTS-STARTPTS,volume=${musicLayer.volume}`;
        const musicFades = fadeFilterParts(musicDuration, musicLayer.fadeInSec, musicLayer.fadeOutSec);
        if (musicFades.length) {
          musicFilter += `,${musicFades.join(",")}`;
        }
        if (musicLayer.duckUnderDialogue) {
          voiceSegments.forEach((segment) => {
            musicFilter += `,volume=volume=0.35:enable='between(t,${Math.max(0, segment.startSeconds - musicLayer.startSeconds)},${Math.max(0, segment.endSeconds - musicLayer.startSeconds)})'`;
          });
        }
        musicFilter += `,adelay=${musicDelayMs}|${musicDelayMs}[music_audio]`;
        filterParts.push(musicFilter);
        mixInputs.push("[music_audio]");
      }

      sfxSegments.forEach((segment, index) => {
        const delayMs = Math.max(0, Math.round(segment.startSeconds * 1000));
        const inputIndex = sfxInputIndexes[index];
        const label = `sfx_${index}`;
        const sfxFades = fadeFilterParts(segment.durationSeconds, segment.fadeInSec, segment.fadeOutSec);
        filterParts.push(
          `[${inputIndex}:a]atrim=0:${segment.durationSeconds},asetpts=PTS-STARTPTS,volume=${segment.volume}${sfxFades.length ? `,${sfxFades.join(",")}` : ""},adelay=${delayMs}|${delayMs}[${label}]`
        );
        mixInputs.push(`[${label}]`);
      });

      if (mixInputs.length) {
        filterParts.push(`${mixInputs.join("")}amix=inputs=${mixInputs.length}:duration=first:dropout_transition=0,atrim=0:${renderDurationSeconds},asetpts=PTS-STARTPTS[mixed_audio]`);
        ffmpegArgs.push("-filter_complex", filterParts.join(";"), "-map", "[edited_video]", "-map", "[mixed_audio]");
      } else {
        outputHasAudio = false;
        ffmpegArgs.push("-filter_complex", filterParts.join(";"), "-map", "[edited_video]", "-an");
      }
    } else if (audioPolicy.mode === "mute_original") {
      ffmpegArgs.push("-filter_complex", filterParts.join(";"), "-map", "[edited_video]", "-an");
      outputHasAudio = false;
    } else if (audioPolicy.mode === "replace_original") {
      directAudioMap = `${replacementInputIndex}:a:0`;
      outputHasAudio = true;
      if (Math.abs(audioPolicy.replacementVolume - 1) > 0.001) {
        ffmpegArgs.push("-filter:a", `volume=${audioPolicy.replacementVolume}`);
      }
    } else if (sourceHasAudio) {
      directAudioMap = "0:a:0";
      outputHasAudio = true;
      if (audioPolicy.mode === "reduce_original") {
        ffmpegArgs.push("-filter:a", `volume=${audioPolicy.originalVolume}`);
      }
    } else {
      ffmpegArgs.push("-filter_complex", filterParts.join(";"), "-map", "[edited_video]", "-an");
    }

    if (directAudioMap) {
      ffmpegArgs.push("-filter_complex", filterParts.join(";"), "-map", "[edited_video]", "-map", directAudioMap);
    }

    ffmpegArgs.push(
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "18",
      "-pix_fmt",
      "yuv420p",
    );

    if (outputHasAudio) {
      ffmpegArgs.push("-c:a", "aac", "-b:a", "192k");
    }

    ffmpegArgs.push("-movflags", "+faststart", "-shortest", outputPath);

    const result = await runCmd(
      ffmpeg,
      ffmpegArgs,
      { timeoutMs: 10 * 60 * 1000 },
    );

    if (result.code !== 0) {
      return routeError("FFmpeg trim render failed.", 500, { detail: (result.stderr || result.stdout || "").slice(-3000) });
    }

    if (!fs.existsSync(outputPath)) {
      return routeError("Trim render failed: output file was not created.", 500);
    }

    writeMetaForFile(
      outputPath,
      {
        originalName: outputName,
        renamedName: outputName,
        sourceType: "production-edit-trim-render",
        requestKind: "production-edit-trim-render",
        ownerKey: owner.ownerKey,
        username: owner.username,
        deviceId: owner.deviceId,
        videoEdit: {
          sceneId,
          clipIndex,
          sourceFileName,
          trim: { startSeconds, endSeconds: effectiveEnd },
          sourceTrimDurationSeconds: durationSeconds,
          renderedDurationSeconds: renderDurationSeconds,
          playbackRate,
          expandMode,
          ffmpegTiming: {
            videoFilter: `setpts=${setPtsScale}*(PTS-STARTPTS)`,
            audioFilter: usesSlowDown ? atempoChain : "",
          },
          audioPolicy: {
            ...audioPolicy,
            replacementAudioFileName: replacementAudioName || "",
          },
          voiceSegments: voiceSegments.map((segment) => ({
            id: segment.id,
            character: segment.character,
            voice: segment.voice,
            audioFileName: segment.audioFileName,
            startSeconds: segment.startSeconds,
            endSeconds: segment.endSeconds,
            mode: segment.mode,
            volume: segment.volume,
          })),
          music: {
            enabled: musicLayer.enabled,
            source: musicLayer.source,
            prompt: musicLayer.prompt,
            audioFileName: musicLayer.audioFileName,
            startSeconds: musicLayer.startSeconds,
            endSeconds: musicLayer.endSeconds,
            volume: musicLayer.volume,
            fadeInSec: musicLayer.fadeInSec,
            fadeOutSec: musicLayer.fadeOutSec,
            duckUnderDialogue: musicLayer.duckUnderDialogue,
          },
          sfxSegments: sfxSegments.map((segment) => ({
            id: segment.id,
            mode: segment.mode,
            label: segment.label,
            prompt: segment.prompt,
            audioFileName: segment.audioFileName,
            startSeconds: segment.startSeconds,
            durationSeconds: segment.durationSeconds,
            volume: segment.volume,
            fadeInSec: segment.fadeInSec,
            fadeOutSec: segment.fadeOutSec,
          })),
        },
      },
      sourceItem.scope === "user" || sourceItem.scope === "device"
        ? sources.find((source) => source.scope === sourceItem.scope)
        : sources[0],
    );

    const editedUrl = `/api/gallery/file?name=${encodeURIComponent(outputName)}&scope=${sourceItem.scope}&v=${Date.now()}`;
    return NextResponse.json({
      ok: true,
      editedUrl,
      editedFileName: outputName,
      durationSeconds: renderDurationSeconds,
      sourceTrimDurationSeconds: durationSeconds,
      sourceFileName,
      ffmpeg: { version: ffmpegVersion },
    });
  } catch (error: unknown) {
    if (error instanceof SessionInvalidError) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Edit render failed." }, { status: 500 });
  }
}
