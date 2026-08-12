import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import fssync from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import { NextRequest, NextResponse } from "next/server";

import { cookieName } from "@/lib/auth/cookies";
import { verifySession } from "@/lib/auth/jwt";
import { SessionInvalidError } from "@/lib/ownerKey";
import { safeDeviceId } from "@/lib/otgDevice";
import { resolveOwnerAlias } from "@/lib/ownerAlias";
import {
  productionAudioGalleryRoots,
  productionAudioProductionsRoot,
} from "@/lib/productionAudioSourcePaths";
import { OTG_DATA_ROOT, safeJoin, safeSegment } from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const execFileAsync = promisify(execFile);
const REPO_ROOT = process.cwd();
const GALLERY_PROFILE = process.env.OTG_GALLERY_PROFILE || "test_profile";
const CONFIGURED_GALLERY_DIR = process.env.OTG_GALLERY_DIR || "";
const COMFY_INPUT_DIR = process.env.OTG_COMFY_INPUT_DIR || "C:\\AI\\ComfyUI\\ComfyUI\\input";
const COMFY_OUTPUT_DIR = process.env.OTG_COMFY_OUTPUT_DIR || "C:\\AI\\ComfyUI\\ComfyUI\\output";
const FFMPEG_BIN = process.env.OTG_FFMPEG_BIN || process.env.FFMPEG_PATH || "ffmpeg";

function safeName(value: unknown, fallback = "clip") {
  const raw = String(value || fallback).trim();
  const base = path.basename(raw).replace(/[<>:"|?*\x00-\x1F]+/g, "_").trim();
  return base || fallback;
}

function fileNameFromUrl(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw, "http://local");
    return safeName(
      parsed.searchParams.get("name") ||
      parsed.searchParams.get("filename") ||
      parsed.searchParams.get("file") ||
      path.basename(parsed.pathname),
      "",
    );
  } catch {
    return safeName(raw, "");
  }
}

function isLikelyVideoName(value: unknown) {
  return /\.(mp4|mov|m4v|webm|mkv|avi)$/i.test(String(value || "").trim());
}

function safeUsername(raw: unknown) {
  const value = String(raw || "").trim();
  return /^[a-zA-Z0-9_-]{3,128}$/.test(value) ? value : "";
}

async function ownerKeyFromRequest(request: NextRequest) {
  const token = request.cookies.get(cookieName())?.value || "";
  if (token) {
    try {
      const payload: any = await verifySession(token);
      const username = safeUsername(payload?.username);
      if (username) return resolveOwnerAlias(username);
    } catch {
      throw new SessionInvalidError();
    }
  }

  const deviceId = safeDeviceId(
    request.headers.get("x-otg-device-id") ||
    request.nextUrl.searchParams.get("deviceId") ||
    "local",
  );
  return resolveOwnerAlias(deviceId);
}

async function exists(filePath: string) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function findRecursive(root: string, wantedFileName: string): Promise<string> {
  try {
    const rows = await fs.readdir(root, { withFileTypes: true });
    for (const row of rows) {
      const full = path.join(root, row.name);
      if (row.isFile() && row.name.toLowerCase() === wantedFileName.toLowerCase()) return full;
      if (row.isDirectory()) {
        const found = await findRecursive(full, wantedFileName);
        if (found) return found;
      }
    }
  } catch {
    return "";
  }
  return "";
}

function apiFilePathFromUrl(value: string) {
  try {
    const parsed = new URL(value, "http://local");
    if (parsed.pathname !== "/api/file") return "";
    const rawPath = String(parsed.searchParams.get("path") || "").trim();
    return rawPath ? path.resolve(rawPath) : "";
  } catch {
    return "";
  }
}

async function findSourceVideo(body: any, request: NextRequest, workDir: string) {
  const sourcePath = String(body.sourcePath || body.path || "").trim();
  const sourceUrl = String(body.sourceUrl || "").trim();
  const sourceUrlName = fileNameFromUrl(sourceUrl);
  const requestedNameRaw = String(body.sourceFileName || body.fileName || sourceUrlName || "").trim();
  const requestedNames = Array.from(new Set([
    requestedNameRaw,
    safeName(requestedNameRaw, ""),
    requestedNameRaw.replace(/^\d+_/, ""),
    safeName(requestedNameRaw.replace(/^\d+_/, ""), ""),
    sourceUrlName,
    safeName(sourceUrlName, ""),
  ].map((item) => String(item || "").trim()).filter(Boolean)));

  const ownerKey = await ownerKeyFromRequest(request);
  const galleryRoots = productionAudioGalleryRoots(ownerKey, {
    configuredGalleryDir: CONFIGURED_GALLERY_DIR,
    galleryProfile: GALLERY_PROFILE,
  });

  const apiFilePath = apiFilePathFromUrl(sourceUrl);
  const candidates: string[] = [];
  if (sourcePath && path.isAbsolute(sourcePath)) candidates.push(sourcePath);
  if (apiFilePath) candidates.push(apiFilePath);

  for (const name of requestedNames) {
    for (const galleryRoot of galleryRoots) {
      candidates.push(path.join(galleryRoot, name));
    }
    candidates.push(path.join(COMFY_OUTPUT_DIR, name));
    candidates.push(path.join(COMFY_INPUT_DIR, name));
  }

  for (const candidate of candidates) {
    if (await exists(candidate)) {
      if (!isLikelyVideoName(requestedNameRaw) || isLikelyVideoName(candidate)) return candidate;
    }
  }

  const productionRoot = productionAudioProductionsRoot();
  for (const name of requestedNames) {
    const found = await findRecursive(productionRoot, name);
    if (found && (!isLikelyVideoName(requestedNameRaw) || isLikelyVideoName(found))) return found;
  }

  if (sourceUrl) {
    const absoluteUrl = sourceUrl.startsWith("http://") || sourceUrl.startsWith("https://")
      ? sourceUrl
      : new URL(sourceUrl, request.nextUrl.origin).toString();
    const response = await fetch(absoluteUrl, {
      cache: "no-store",
      headers: { cookie: request.headers.get("cookie") || "" },
    });
    if (response.ok) {
      const arrayBuffer = await response.arrayBuffer();
      if (arrayBuffer.byteLength > 0) {
        const fallbackName = safeName(requestedNameRaw || fileNameFromUrl(sourceUrl), "source-clip.mp4");
        const downloadedPath = path.join(workDir, fallbackName);
        await fs.writeFile(downloadedPath, Buffer.from(arrayBuffer));
        return downloadedPath;
      }
    }
  }

  throw new Error(`Could not locate source clip "${requestedNameRaw || fileNameFromUrl(sourceUrl)}".`);
}

async function muxDubbedAudio(sourceVideoPath: string, dubbedAudioPath: string, outputPath: string) {
  await execFileAsync(
    FFMPEG_BIN,
    ["-y", "-i", sourceVideoPath, "-i", dubbedAudioPath, "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac", "-shortest", outputPath],
    { timeout: 10 * 60 * 1000, maxBuffer: 1024 * 1024 * 20, windowsHide: true },
  );
}

// OTG_AUDIO_STUDIO_SEGMENT_FIRST_DUB_V36BPW5
type AudioStudioVoiceSegmentV36BPW5 = {
  start: number;
  end: number;
};

type AudioStudioVoiceMappingV36BPW5 = {
  voiceId: string;
  characterId: string;
  voiceModelId: string;
  voicePath: string;
  voiceName: string;
  segments: AudioStudioVoiceSegmentV36BPW5[];
};

type AudioStudioRenderedSegmentV36BPW5 = {
  mapping: AudioStudioVoiceMappingV36BPW5;
  segment: AudioStudioVoiceSegmentV36BPW5;
  audioPath: string;
};

function normalizeSecondsV36BPW5(value: unknown) {
  const next = Number(value);
  return Number.isFinite(next) ? Math.max(0, Math.round(next * 1000) / 1000) : 0;
}

function normalizeSegmentsV36BPW5(value: unknown) {
  const rows = Array.isArray(value) ? value : [];
  return rows
    .map((segment: any) => {
      const start = normalizeSecondsV36BPW5(segment?.start ?? segment?.startSeconds ?? segment?.from ?? segment?.begin);
      const end = normalizeSecondsV36BPW5(segment?.end ?? segment?.endSeconds ?? segment?.to ?? segment?.stop);
      return end > start ? { start, end } : null;
    })
    .filter(Boolean) as AudioStudioVoiceSegmentV36BPW5[];
}

function segmentsForDetectedVoiceV36BPW5(body: any, voiceId: string) {
  const voices = Array.isArray(body?.audioClipAnalysis?.voices) ? body.audioClipAnalysis.voices : [];
  const found = voices.find((voice: any, index: number) => (
    String(voice?.id || voice?.voiceId || voice?.speakerId || `speaker_${index + 1}`).trim() === voiceId
  ));
  return normalizeSegmentsV36BPW5(found?.segments);
}

function normalizeVoiceMappingsV36BPW5(body: any) {
  const rawMappings = Array.isArray(body?.voiceMappings) ? body.voiceMappings : [];
  const normalized = rawMappings
    .map((mapping: any, index: number) => {
      const voiceId = String(mapping?.voiceId || mapping?.mappedVoiceId || mapping?.speakerId || `speaker_${index + 1}`).trim();
      const voicePath = String(mapping?.voicePath || mapping?.voice_path || "").trim();
      if (!voiceId || !voicePath) return null;
      const explicitSegments = normalizeSegmentsV36BPW5(mapping?.segments);
      return {
        voiceId,
        characterId: String(mapping?.characterId || "").trim(),
        voiceModelId: String(mapping?.voiceModelId || mapping?.targetVoiceId || "").trim(),
        voicePath,
        voiceName: String(mapping?.voiceName || mapping?.targetVoiceName || "").trim(),
        segments: explicitSegments.length ? explicitSegments : segmentsForDetectedVoiceV36BPW5(body, voiceId),
      };
    })
    .filter(Boolean) as AudioStudioVoiceMappingV36BPW5[];

  if (normalized.length) return normalized;

  const fallbackVoicePath = String(body?.voicePath || body?.voice_path || "").trim();
  if (!fallbackVoicePath) return [];

  return [{
    voiceId: String(body?.mappedVoiceId || "speaker_1"),
    characterId: String(body?.characterId || ""),
    voiceModelId: String(body?.voiceModelId || ""),
    voicePath: fallbackVoicePath,
    voiceName: "",
    segments: [],
  }];
}

async function extractAudioSegmentV36BPW5(sourceVideoPath: string, segment: AudioStudioVoiceSegmentV36BPW5, outputPath: string) {
  const duration = Math.max(0.05, segment.end - segment.start);
  await execFileAsync(
    FFMPEG_BIN,
    [
      "-y",
      "-ss",
      String(segment.start),
      "-t",
      String(duration),
      "-i",
      sourceVideoPath,
      "-vn",
      "-ac",
      "1",
      "-ar",
      "44100",
      "-c:a",
      "pcm_s16le",
      outputPath,
    ],
    { timeout: 10 * 60 * 1000, maxBuffer: 1024 * 1024 * 20, windowsHide: true },
  );
}

async function runVoiceDubForSegmentV36BPW5(request: NextRequest, segmentPath: string, voicePath: string, title: string, engine: string) {
  const segmentBytes = await fs.readFile(segmentPath);
  const form = new FormData();
  form.append("performance_audio", new Blob([new Uint8Array(segmentBytes)], { type: "audio/wav" }), path.basename(segmentPath));
  form.append("voice_path", voicePath);
  form.append("engine", engine || "auto");
  form.append("title", title);

  const dubResponse = await fetch(new URL("/api/voice/dub", request.nextUrl.origin), {
    method: "POST",
    body: form,
    headers: { cookie: request.headers.get("cookie") || "" },
    cache: "no-store",
  });

  const dubJson = await dubResponse.json().catch(() => null);
  if (!dubResponse.ok || !dubJson?.ok) {
    throw new Error(dubJson?.error || `Voice dub failed (${dubResponse.status}).`);
  }

  const dubbedAudioPath = String(dubJson.audioPath || "").trim();
  if (!dubbedAudioPath || !fssync.existsSync(dubbedAudioPath)) {
    throw new Error("Voice dub completed but did not return a readable dubbed audio file.");
  }

  return { audioPath: dubbedAudioPath, dub: dubJson };
}

function ffmpegEscapePathV36BPW5(value: string) {
  return value.replace(/\\/g, "/").replace(/'/g, "\\'");
}

async function mixRenderedSegmentsV36BPW5(
  sourceVideoPath: string,
  renderedSegments: AudioStudioRenderedSegmentV36BPW5[],
  outputPath: string,
) {
  if (!renderedSegments.length) throw new Error("No dubbed speaker segments were generated.");

  // OTG_AUDIO_STUDIO_PRESERVE_SOURCE_BED_V36BPW6
  // OTG_AUDIO_STUDIO_REMOVE_DOUBLED_ORIGINAL_VOICE_V36BPW7
  // Preserve the original bed outside mapped dialogue, but remove the original bed during mapped
  // dubbed segments so the source voice does not double against the replacement voice.
  // This is the natural preview setting. True music/SFX preservation under replaced dialogue
  // still needs a later Demucs/UVR vocal-separation pass.
  const sourceBedVolumeRaw = Number(process.env.OTG_AUDIO_STUDIO_SOURCE_BED_VOLUME ?? 1);
  const mappedDialogueBedVolumeRaw = Number(process.env.OTG_AUDIO_STUDIO_MAPPED_DIALOGUE_BED_VOLUME ?? 0);
  // OTG_AUDIO_STUDIO_DUBBED_VOICE_GAIN_V36BPW8
  // Segment voice conversion often returns quieter audio than the original clip bed.
  // Boost the dubbed segments before mixing and apply a limiter after the final mix.
  const dubbedVoiceVolumeRaw = Number(process.env.OTG_AUDIO_STUDIO_DUBBED_VOICE_VOLUME ?? 1.8);
  const sourceBedVolume = Number.isFinite(sourceBedVolumeRaw) ? Math.max(0, Math.min(2, sourceBedVolumeRaw)) : 1;
  const duckedSourceBedVolume = Number.isFinite(mappedDialogueBedVolumeRaw) ? Math.max(0, Math.min(1, mappedDialogueBedVolumeRaw)) : 0;
  const dubbedVoiceVolume = Number.isFinite(dubbedVoiceVolumeRaw) ? Math.max(0.25, Math.min(4, dubbedVoiceVolumeRaw)) : 1.8;

  const args = ["-y", "-i", sourceVideoPath];
  for (const rendered of renderedSegments) args.push("-i", rendered.audioPath);

  let sourceBedFilter = `[0:a]volume=${sourceBedVolume}`;
  for (const rendered of renderedSegments) {
    if (rendered.segment.end > rendered.segment.start) {
      sourceBedFilter += `,volume=enable='between(t,${rendered.segment.start},${rendered.segment.end})':volume=${duckedSourceBedVolume}`;
    }
  }

  const filters: string[] = [`${sourceBedFilter}[base]`];
  const labels: string[] = ["[base]"];

  renderedSegments.forEach((rendered, index) => {
    const inputIndex = index + 1;
    const duration = Math.max(0.05, rendered.segment.end - rendered.segment.start);
    const delayMs = Math.max(0, Math.round(rendered.segment.start * 1000));
    const label = `seg${index}`;
    filters.push(`[${inputIndex}:a]atrim=0:${duration},asetpts=PTS-STARTPTS,volume=${dubbedVoiceVolume},adelay=${delayMs}|${delayMs}[${label}]`);
    labels.push(`[${label}]`);
  });

  filters.push(`${labels.join("")}amix=inputs=${labels.length}:duration=longest:dropout_transition=0,alimiter=limit=0.95[outa]`);

  await execFileAsync(
    FFMPEG_BIN,
    [...args, "-filter_complex", filters.join(";"), "-map", "[outa]", "-c:a", "aac", "-b:a", "192k", outputPath],
    { timeout: 20 * 60 * 1000, maxBuffer: 1024 * 1024 * 40, windowsHide: true },
  );
}
async function renderSegmentFirstDubV36BPW5(
  request: NextRequest,
  sourceVideoPath: string,
  voiceMappings: AudioStudioVoiceMappingV36BPW5[],
  workDir: string,
  runId: string,
  body: any,
) {
  const renderedSegments: AudioStudioRenderedSegmentV36BPW5[] = [];
  const baseTitle = safeName(body.title || "audio_studio_dub", "audio_studio_dub");

  for (const [mappingIndex, mapping] of voiceMappings.entries()) {
    if (!mapping.segments.length && voiceMappings.length > 1) {
      throw new Error(`Detected ${mapping.voiceId} has no diarization segments. Re-analyze the clip before starting multi-voice dub.`);
    }

    const segments = mapping.segments.length
      ? mapping.segments
      : [{ start: 0, end: 0 }];

    for (const [segmentIndex, rawSegment] of segments.entries()) {
      const segment = rawSegment.end > rawSegment.start
        ? rawSegment
        : { start: 0, end: 60 * 60 };

      const segmentPath = safeJoin(
        workDir,
        `${safeSegment(mapping.voiceId || `speaker_${mappingIndex + 1}`)}_${String(segmentIndex + 1).padStart(3, "0")}.wav`,
      );

      if (rawSegment.end > rawSegment.start) {
        await extractAudioSegmentV36BPW5(sourceVideoPath, rawSegment, segmentPath);
      } else {
        await execFileAsync(
          FFMPEG_BIN,
          ["-y", "-i", sourceVideoPath, "-vn", "-ac", "1", "-ar", "44100", "-c:a", "pcm_s16le", segmentPath],
          { timeout: 10 * 60 * 1000, maxBuffer: 1024 * 1024 * 20, windowsHide: true },
        );
      }

      const dubbed = await runVoiceDubForSegmentV36BPW5(
        request,
        segmentPath,
        mapping.voicePath,
        `${baseTitle}_${safeSegment(mapping.voiceId || `speaker_${mappingIndex + 1}`)}_${String(segmentIndex + 1).padStart(3, "0")}_${runId}`,
        String(body.engine || "auto"),
      );

      renderedSegments.push({
        mapping,
        segment: rawSegment.end > rawSegment.start ? rawSegment : { start: 0, end: 60 * 60 },
        audioPath: dubbed.audioPath,
      });
    }
  }

  const dubbedAudioPath = safeJoin(workDir, "segment_first_dubbed_audio.m4a");
  await mixRenderedSegmentsV36BPW5(sourceVideoPath, renderedSegments, dubbedAudioPath);

  return { dubbedAudioPath, renderedSegments };
}

export async function POST(request: NextRequest) {
  try {
    const ownerKey = await ownerKeyFromRequest(request);
    const body = await request.json();
    const voiceMappings = normalizeVoiceMappingsV36BPW5(body);
    if (!voiceMappings.length) {
      return NextResponse.json({ ok: false, error: "Map at least one detected voice lane to a usable character voice model before starting dub." }, { status: 400 });
    }

    const runId = `audio-dub-${Date.now()}`;
    const workDir = path.join(OTG_DATA_ROOT, "production_audio_dub_previews", safeSegment(ownerKey || "local"), runId);
    await fs.mkdir(workDir, { recursive: true });

    const sourceVideoPath = await findSourceVideo(body, request, workDir);
    const { dubbedAudioPath, renderedSegments } = await renderSegmentFirstDubV36BPW5(
      request,
      sourceVideoPath,
      voiceMappings,
      workDir,
      runId,
      body,
    );

    const previewPath = safeJoin(workDir, `${safeName(body.title || "dubbed-preview", "dubbed-preview")}.mp4`);
    await muxDubbedAudio(sourceVideoPath, dubbedAudioPath, previewPath);

    return NextResponse.json({
      ok: true,
      runId,
      sourceVideoPath,
      dubbedAudioPath,
      previewVideoPath: previewPath,
      previewVideoUrl: `/api/file?path=${encodeURIComponent(previewPath)}&v=${Date.now()}`,
      voiceMappings: voiceMappings.map((mapping) => ({
        voiceId: mapping.voiceId,
        characterId: mapping.characterId,
        voiceModelId: mapping.voiceModelId,
        voicePath: mapping.voicePath,
        segmentCount: mapping.segments.length,
      })),
      renderedSegments: renderedSegments.map((rendered) => ({
        voiceId: rendered.mapping.voiceId,
        characterId: rendered.mapping.characterId,
        start: rendered.segment.start,
        end: rendered.segment.end,
        audioPath: rendered.audioPath,
      })),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error: any) {
    if (error instanceof SessionInvalidError) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ ok: false, error: error?.message || "Audio Studio dub preview failed." }, { status: 500 });
  }
}