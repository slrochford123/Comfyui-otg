import { constants } from "node:fs";
import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { SessionInvalidError } from "@/lib/ownerKey";
import { productionAudioOwner, productionAudioMediaReadable, ProductionAudioAccessError } from "@/lib/productionAudioAccess";
import { safeSegment } from "@/lib/paths";
import { runtimePath, voicePython } from "@/lib/runtime/configPaths";
import { assertSameOrigin, RequestError } from "@/lib/routeSecurity";
import { requireStorageHeadroom } from "@/lib/storageAdmission";
import { confidenceInWords, correctionWords, extractCorrectionLine, extractCorrectionSoundtrack, separateCorrectionSoundtrack, transcribeCorrectionLines, type MixSource } from "@/lib/fixVoicesAudio";
import { labelBlockedVoiceIntervals } from "@/lib/fixVoicesDsp";
import { resolveSavedH3CorrectionVoice } from "@/lib/h3CharacterVoicesServer";
import { assertFixVoicesTest, correctionCastPlan, correctionMediaUrl, reopenCorrectionPreview, resolveCorrectionSource, verifiedCorrectionVoice, writeCorrectionRecord } from "@/lib/fixVoicesSession";
import { acquireAuxiliary3090, AuxiliaryGpuBusyError } from "@/lib/workers/auxiliary3090Lease";
import {
  productionAudioAnalysisRoot,
  productionAudioGalleryRoots,
  productionAudioProductionsRoot,
} from "@/lib/productionAudioSourcePaths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const execFileAsync = promisify(execFile);
const REPO_ROOT = process.cwd();

const GALLERY_PROFILE = process.env.OTG_GALLERY_PROFILE || "test_profile";
const CONFIGURED_GALLERY_DIR = process.env.OTG_GALLERY_DIR || "";

const COMFY_INPUT_DIR =
  process.env.OTG_COMFY_INPUT_DIR ||
  runtimePath("comfyui", "input");

const COMFY_OUTPUT_DIR =
  process.env.OTG_COMFY_OUTPUT_DIR ||
  runtimePath("comfyui", "output");

const ANALYSIS_ROOT =
  process.env.OTG_AUDIO_ANALYSIS_DIR ||
  productionAudioAnalysisRoot();

const FFMPEG_BIN = process.env.OTG_FFMPEG_BIN || "ffmpeg";
const FFPROBE_BIN = process.env.OTG_FFPROBE_BIN || "ffprobe";
const PYTHON_BIN =
  process.env.OTG_AUDIO_ANALYSIS_PYTHON ||
  voicePython("demucs");
const DEMUCS_MODEL = process.env.OTG_DEMUCS_MODEL || "htdemucs";
const LOCAL_DIARIZATION_PYTHON =
  process.env.OTG_SPEAKER_DIARIZATION_PYTHON ||
  runtimePath("voice-dubbing", "diarization-venv", "bin", "python");
const LOCAL_DIARIZATION_SCRIPT =
  process.env.OTG_SPEAKER_DIARIZATION_SCRIPT ||
  path.join(REPO_ROOT, "scripts", "voice", "pyannote_diarize.py");
const LOCAL_DIARIZATION_MODEL =
  process.env.OTG_SPEAKER_DIARIZATION_MODEL ||
  runtimePath("voice-dubbing", "models", "pyannote-community-1");
const LOCAL_DIARIZATION_DEVICE = process.env.OTG_SPEAKER_DIARIZATION_DEVICE || "cuda";
const SPEAKER_DIARIZATION_URL = String(
  process.env.OTG_SPEAKER_DIARIZATION_URL ||
    process.env.SPEAKER_DIARIZATION_URL ||
    ""
).trim();
const SPEAKER_DIARIZATION_TIMEOUT_MS = Math.max(
  30_000,
  Number(process.env.OTG_SPEAKER_DIARIZATION_TIMEOUT_MS || 10 * 60 * 1000)
);

type SpeechSegment = {
  start: number;
  end: number;
  speakerId?: string;
  text?: string;
  blockedReason?: string;
};

type DetectedVoiceLane = {
  id: string;
  label: string;
  status: string;
  description: string;
  segments: SpeechSegment[];
  segmentCount: number;
  totalSpeechSeconds: number;
  confidence: string;
  samplePath?: string;
  sampleUrl?: string;
  suggestedTargetVoiceId?: string;
  suggestedTargetVoiceName?: string;
  suggestedCharacterId?: string;
  needsCharacterConfirmation?: boolean;
};

type DemucsResult = {
  vocalsPath: string;
  backgroundPath: string;
};

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
      ""
    );
  } catch {
    return safeName(raw, "");
  }
}

function isLikelyVideoName(value: unknown) {
  return /\.(mp4|mov|m4v|webm|mkv|avi)$/i.test(String(value || "").trim());
}

async function ownerKeyFromRequest(request: NextRequest) {
  return productionAudioOwner(request);
}

async function exists(filePath: string) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function findSourceVideo(body: any, request: NextRequest, workDir: string) {
  const sourcePath = String(body.sourcePath || body.path || "").trim();
  const sourceUrl = String(body.sourceUrl || "").trim();
  const sourceUrlName = fileNameFromUrl(sourceUrl);

  const requestedNameRaw = String(
    body.sourceFileName ||
    body.fileName ||
    sourceUrlName ||
    ""
  ).trim();

  const requestedNameVariants = [
    requestedNameRaw,
    safeName(requestedNameRaw, ""),
    requestedNameRaw.replace(/^\d+_/, ""),
    safeName(requestedNameRaw.replace(/^\d+_/, ""), ""),
  ];

  // Audio Studio clips can have a stale Comfy view URL like filename=file.
  // When the UI has a concrete video filename, do not let that generic image URL win.
  if (!requestedNameRaw || isLikelyVideoName(sourceUrlName)) {
    requestedNameVariants.push(sourceUrlName, safeName(sourceUrlName, ""));
  }

  const requestedNames = Array.from(
    new Set(
      requestedNameVariants
        .map((item) => String(item || "").trim())
        .filter(Boolean)
    )
  );

  const ownerKey = await ownerKeyFromRequest(request);
  const galleryRoots = productionAudioGalleryRoots(ownerKey, {
    configuredGalleryDir: CONFIGURED_GALLERY_DIR,
    galleryProfile: GALLERY_PROFILE,
  });

  const candidates: string[] = [];

  if (sourcePath && path.isAbsolute(sourcePath)) candidates.push(sourcePath);

  for (const name of requestedNames) {
    for (const galleryRoot of galleryRoots) {
      candidates.push(path.join(galleryRoot, name));
    }
    candidates.push(path.join(REPO_ROOT, "public", "gallery", name));
    candidates.push(path.join(REPO_ROOT, "public", "outputs", name));
    candidates.push(path.join(REPO_ROOT, "outputs", name));
    candidates.push(path.join(REPO_ROOT, "data", "gallery", name));
    candidates.push(path.join(REPO_ROOT, "data", "outputs", name));
    candidates.push(path.join(COMFY_OUTPUT_DIR, name));
    candidates.push(path.join(COMFY_INPUT_DIR, name));
  }

  for (const candidate of candidates) {
    if (await exists(candidate) && await productionAudioMediaReadable(request, candidate)) {
      if (!isLikelyVideoName(requestedNameRaw) || isLikelyVideoName(candidate)) return candidate;
    }
  }

  const productionRoot = path.join(productionAudioProductionsRoot(), safeSegment(ownerKey));
  for (const name of requestedNames) {
    const found = await findRecursive(productionRoot, name);
    if (found && await productionAudioMediaReadable(request, found) && (!isLikelyVideoName(requestedNameRaw) || isLikelyVideoName(found))) return found;
  }

  throw new ProductionAudioAccessError();
}

async function durationSeconds(filePath: string) {
  try {
    const { stdout } = await execFileAsync(
      FFPROBE_BIN,
      ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", filePath],
      { timeout: 30000, windowsHide: true }
    );

    const value = Number(String(stdout || "").trim());
    return Number.isFinite(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
}

async function extractMonoWav(sourcePath: string, wavPath: string) {
  await execFileAsync(
    FFMPEG_BIN,
    ["-y", "-i", sourcePath, "-vn", "-ac", "1", "-ar", "16000", "-sample_fmt", "s16", wavPath],
    { timeout: 10 * 60 * 1000, maxBuffer: 1024 * 1024 * 20, windowsHide: true }
  );
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

async function tryDemucs(sourcePath: string, workDir: string): Promise<DemucsResult | null> {
  if (process.env.OTG_DEMUCS_ENABLED === "0") return null;

  const demucsOut = path.join(workDir, "demucs");
  await fs.mkdir(demucsOut, { recursive: true });

  try {
    await execFileAsync(
      PYTHON_BIN,
      ["-m", "demucs", "-n", DEMUCS_MODEL, "--two-stems", "vocals", "-o", demucsOut, sourcePath],
      { timeout: 30 * 60 * 1000, maxBuffer: 1024 * 1024 * 40, windowsHide: true }
    );

    const vocalsPath = await findRecursive(demucsOut, "vocals.wav");
    const backgroundPath =
      (await findRecursive(demucsOut, "no_vocals.wav")) ||
      (await findRecursive(demucsOut, "instrumental.wav")) ||
      (await findRecursive(demucsOut, "accompaniment.wav"));
    return vocalsPath ? { vocalsPath, backgroundPath } : null;
  } catch {
    return null;
  }
}

function fileUrl(filePath: string) {
  return filePath ? `/api/file?path=${encodeURIComponent(filePath)}&v=${Date.now()}` : "";
}

async function extractVoiceLaneSamples(voices: DetectedVoiceLane[], analysisWav: string, workDir: string) {
  await fs.mkdir(path.join(workDir, "voice_samples"), { recursive: true });

  for (const voice of voices) {
    const firstSegment = voice.segments.find((segment) => !segment.blockedReason && segment.end > segment.start) || voice.segments[0];
    if (!firstSegment) continue;

    const start = Math.max(0, firstSegment.start);
    const duration = Math.max(0.25, Math.min(6, firstSegment.end - firstSegment.start));
    const samplePath = path.join(workDir, "voice_samples", `${safeName(voice.id, "speaker")}_sample.wav`);

    try {
      await execFileAsync(
        FFMPEG_BIN,
        ["-y", "-ss", String(start), "-t", String(duration), "-i", analysisWav, "-vn", "-ac", "1", "-ar", "16000", "-sample_fmt", "s16", samplePath],
        { timeout: 2 * 60 * 1000, maxBuffer: 1024 * 1024 * 10, windowsHide: true }
      );
      if (await exists(samplePath)) {
        voice.samplePath = samplePath;
        voice.sampleUrl = fileUrl(samplePath);
      }
    } catch {
      // The lane remains usable even when sample extraction fails.
    }
  }
}

function speechSegmentsFromSilenceLog(stderr: string, duration: number) {
  const events: Array<{ type: "start" | "end"; time: number }> = [];
  const lines = String(stderr || "").split(/\r?\n/g);

  for (const line of lines) {
    const start = line.match(/silence_start:\s*([0-9.]+)/i);
    if (start) {
      events.push({ type: "start", time: Number(start[1]) });
      continue;
    }

    const end = line.match(/silence_end:\s*([0-9.]+)/i);
    if (end) {
      events.push({ type: "end", time: Number(end[1]) });
    }
  }

  if (!Number.isFinite(duration) || duration <= 0) duration = 0;

  if (!events.length) {
    return duration > 0 ? [{ start: 0, end: Math.round(duration * 100) / 100 }] : [];
  }

  const segments: Array<{ start: number; end: number }> = [];
  let cursor = 0;

  for (const event of events) {
    if (event.type === "start") {
      const end = Math.max(cursor, event.time);
      if (end - cursor >= 0.25) {
        segments.push({
          start: Math.round(cursor * 100) / 100,
          end: Math.round(end * 100) / 100,
        });
      }
    } else {
      cursor = Math.max(cursor, event.time);
    }
  }

  if (duration > cursor && duration - cursor >= 0.25) {
    segments.push({
      start: Math.round(cursor * 100) / 100,
      end: Math.round(duration * 100) / 100,
    });
  }

  return segments;
}

async function detectSpeechSegments(wavPath: string, duration: number) {
  try {
    const result = await execFileAsync(
      FFMPEG_BIN,
      ["-hide_banner", "-nostats", "-i", wavPath, "-af", "silencedetect=noise=-35dB:d=0.25", "-f", "null", "-"],
      { timeout: 5 * 60 * 1000, maxBuffer: 1024 * 1024 * 20, windowsHide: true }
    );

    return speechSegmentsFromSilenceLog(result.stderr || "", duration);
  } catch (error: any) {
    const stderr = String(error?.stderr || "");
    const segments = speechSegmentsFromSilenceLog(stderr, duration);
    return segments.length ? segments : duration > 0 ? [{ start: 0, end: Math.round(duration * 100) / 100 }] : [];
  }
}

function clampExpectedSpeakerCount(value: unknown) {
  const count = Number(value);
  if (!Number.isFinite(count) || count <= 0) return 0;
  return Math.min(5, Math.max(1, Math.round(count)));
}

function normalizedSeconds(value: unknown) {
  const seconds = Number(value);
  return Number.isFinite(seconds) ? Math.max(0, Math.round(seconds * 100) / 100) : 0;
}

function normalizeExternalSegment(raw: any, fallbackSpeakerId: string, duration: number): SpeechSegment | null {
  const start = normalizedSeconds(raw?.start ?? raw?.startSeconds ?? raw?.begin ?? raw?.from);
  const end = normalizedSeconds(raw?.end ?? raw?.endSeconds ?? raw?.stop ?? raw?.to);
  if (end <= start) return null;

  const speakerId = String(
    raw?.speakerId ||
      raw?.speaker_id ||
      raw?.speaker ||
      raw?.label ||
      fallbackSpeakerId ||
      "speaker_1"
  ).trim() || "speaker_1";

  return {
    start,
    end: duration > 0 ? Math.min(end, Math.round(duration * 100) / 100) : end,
    speakerId,
    text: String(raw?.text || raw?.transcript || "").trim() || undefined,
  };
}

function voiceLanesFromSegments(
  segments: SpeechSegment[],
  confidence: string,
  descriptionPrefix: string
): DetectedVoiceLane[] {
  const grouped = new Map<string, SpeechSegment[]>();

  for (const segment of segments) {
    const speakerId = String(segment.speakerId || "speaker_1").trim() || "speaker_1";
    const next = grouped.get(speakerId) || [];
    next.push({ ...segment, speakerId });
    grouped.set(speakerId, next);
  }

  return Array.from(grouped.entries()).map(([speakerId, speakerSegments], index) => {
    const speechSeconds = Math.round(
      speakerSegments.reduce((sum, segment) => sum + Math.max(0, segment.end - segment.start), 0) * 100
    ) / 100;

    return {
      id: speakerId || `speaker_${index + 1}`,
      label: `Voice ${index + 1}`,
      status: "detected",
      description: `${descriptionPrefix} ${index + 1}.`,
      segments: speakerSegments,
      segmentCount: speakerSegments.length,
      totalSpeechSeconds: speechSeconds,
      confidence,
    };
  });
}

function normalizeExternalDiarizationPayload(payload: any, duration: number): DetectedVoiceLane[] {
  const voiceRows = Array.isArray(payload?.voices)
    ? payload.voices
    : Array.isArray(payload?.speakers)
      ? payload.speakers
      : [];

  if (voiceRows.length) {
    const lanes = voiceRows.map((voice: any, index: number) => {
      const fallbackSpeakerId = String(
        voice?.id ||
          voice?.speakerId ||
          voice?.speaker_id ||
          voice?.speaker ||
          `speaker_${index + 1}`
      ).trim();
      const segments = Array.isArray(voice?.segments)
        ? voice.segments
            .map((segment: any) => normalizeExternalSegment(segment, fallbackSpeakerId, duration))
            .filter(Boolean) as SpeechSegment[]
        : [];
      const speechSeconds = Math.round(
        segments.reduce((sum, segment) => sum + Math.max(0, segment.end - segment.start), 0) * 100
      ) / 100;

      return {
        id: fallbackSpeakerId || `speaker_${index + 1}`,
        label: String(voice?.label || voice?.name || `Voice ${index + 1}`).trim() || `Voice ${index + 1}`,
        status: "detected",
        description: String(voice?.description || `Diarized dialogue speaker ${index + 1}.`).trim(),
        segments,
        segmentCount: segments.length,
        totalSpeechSeconds: speechSeconds,
        confidence: String(voice?.confidence || "external_diarization").trim() || "external_diarization",
      };
    }).filter((voice: DetectedVoiceLane) => voice.segmentCount > 0);

    if (lanes.length) return lanes;
  }

  const flatSegments = Array.isArray(payload?.segments)
    ? payload.segments
    : Array.isArray(payload?.diarization)
      ? payload.diarization
      : [];
  const normalizedSegments = flatSegments
    .map((segment: any) => normalizeExternalSegment(segment, "speaker_1", duration))
    .filter(Boolean) as SpeechSegment[];

  return voiceLanesFromSegments(normalizedSegments, "external_diarization", "Diarized dialogue speaker");
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function tryExternalDiarization(
  wavPath: string,
  duration: number,
  expectedSpeakerCount: number,
  workDir: string
) {
  if (!SPEAKER_DIARIZATION_URL) return null;

  try {
    const audioBytes = await fs.readFile(wavPath);
    const form = new FormData();
    form.set("audio", new Blob([new Uint8Array(audioBytes)], { type: "audio/wav" }), path.basename(wavPath));
    form.set("maxSpeakers", String(expectedSpeakerCount || 5));
    if (expectedSpeakerCount > 0) form.set("speakerCount", String(expectedSpeakerCount));

    const response = await fetchWithTimeout(
      SPEAKER_DIARIZATION_URL,
      { method: "POST", body: form },
      SPEAKER_DIARIZATION_TIMEOUT_MS
    );
    const payload = await response.json().catch(() => ({}));
    await fs.writeFile(path.join(workDir, "external_diarization.json"), JSON.stringify(payload, null, 2), "utf8");
    if (!response.ok || payload?.ok === false) return null;

    const voices = normalizeExternalDiarizationPayload(payload, duration);
    return voices.length ? voices : null;
  } catch (error: any) {
    await fs.writeFile(
      path.join(workDir, "external_diarization_error.txt"),
      String(error?.message || error || "External diarization failed"),
      "utf8"
    ).catch(() => undefined);
    return null;
  }
}

async function tryLocalDiarization(
  wavPath: string,
  duration: number,
  expectedSpeakerCount: number,
  workDir: string,
  cpuOnly = false,
) {
  if (process.env.OTG_LOCAL_SPEAKER_DIARIZATION_ENABLED === "0") return null;
  if (!(await exists(LOCAL_DIARIZATION_PYTHON)) || !(await exists(LOCAL_DIARIZATION_SCRIPT)) || !(await exists(LOCAL_DIARIZATION_MODEL))) {
    return null;
  }

  try {
    const result = await execFileAsync(
      LOCAL_DIARIZATION_PYTHON,
      [
        LOCAL_DIARIZATION_SCRIPT,
        "--audio", wavPath,
        "--model", LOCAL_DIARIZATION_MODEL,
        "--device", cpuOnly ? "cpu" : LOCAL_DIARIZATION_DEVICE,
        ...(expectedSpeakerCount > 0 ? ["--min-speakers", String(expectedSpeakerCount)] : []),
        "--max-speakers", String(expectedSpeakerCount || 5),
      ],
      {
        timeout: SPEAKER_DIARIZATION_TIMEOUT_MS,
        maxBuffer: 1024 * 1024 * 20,
        windowsHide: true,
        env: {...process.env, ...(cpuOnly ? { CUDA_VISIBLE_DEVICES: "" } : {}), HF_HUB_OFFLINE: "1", TRANSFORMERS_OFFLINE: "1", PYANNOTE_METRICS_ENABLED: "false"},
      },
    );
    const lines = String(result.stdout || "").trim().split(/\r?\n/g).filter(Boolean);
    const payload = lines.length ? JSON.parse(lines[lines.length - 1]) : {};
    await fs.writeFile(path.join(workDir, "local_diarization.json"), JSON.stringify(payload, null, 2), "utf8");
    if (payload?.ok !== true || !Array.isArray(payload.segments)) return null;
    const voices = normalizeExternalDiarizationPayload(payload, duration);
    return voices.length ? voices : null;
  } catch (error: any) {
    await fs.writeFile(
      path.join(workDir, "local_diarization_error.txt"),
      String(error?.stderr || error?.message || error || "Local diarization failed"),
      "utf8",
    ).catch(() => undefined);
    return null;
  }
}

function buildEstimatedSpeakerLanes(
  segments: Array<{ start: number; end: number }>,
  totalSpeechSeconds: number,
  usedDemucs: boolean,
  expectedSpeakerCount = 0
) {
  if (!segments.length) return [];

  const speakerCount = expectedSpeakerCount > 0
    ? Math.min(5, Math.max(1, expectedSpeakerCount))
    : segments.length <= 1
      ? 1
      : Math.min(5, Math.max(2, Math.ceil(segments.length / 2)));

  return Array.from({ length: speakerCount }, (_unused, speakerIndex) => {
    const speakerSegments = segments
      .filter((_segment, segmentIndex) => segmentIndex % speakerCount === speakerIndex)
      .map((segment) => ({
        ...segment,
        speakerId: `speaker_${speakerIndex + 1}`,
      }));
    const speechSeconds = Math.round(
      speakerSegments.reduce((sum, segment) => sum + Math.max(0, segment.end - segment.start), 0) * 100
    ) / 100;

    return {
      id: `speaker_${speakerIndex + 1}`,
      label: `Voice ${speakerIndex + 1}`,
      status: "detected",
      description: expectedSpeakerCount > 0
        ? `Estimated dialogue speaker ${speakerIndex + 1} using requested ${speakerCount}-voice split.`
        : usedDemucs
          ? `Estimated dialogue speaker ${speakerIndex + 1} from Demucs vocal stem.`
          : `Estimated dialogue speaker ${speakerIndex + 1} from extracted clip audio.`,
      segments: speakerSegments,
      segmentCount: speakerSegments.length,
      totalSpeechSeconds: speechSeconds,
      confidence: speakerCount === 1 ? "single_voice_estimate" : "multi_voice_estimate",
    };
  }).filter((voice) => voice.segmentCount > 0 || totalSpeechSeconds > 0);
}

async function matchH3CorrectionCues(
  plan: NonNullable<Awaited<ReturnType<typeof correctionCastPlan>>>,
  speech: string, voices: DetectedVoiceLane[], splitLanes: boolean, workDir: string, signal: AbortSignal,
) {
  const rows = voices.flatMap(voice => voice.segments.map((segment, index) => ({voice, segment, index})));
  if (!rows.length || rows.length > 24) {
    for (const voice of voices) for (const segment of voice.segments) {
      segment.blockedReason ||= "Too many speech cues to verify safely.";
    }
    return voices;
  }
  const clear = rows.filter(({segment}) => !segment.blockedReason);
  const files = await Promise.all(clear.map(async ({segment}, index) => {
    const file = path.join(workDir, `match-${index}.wav`);
    await extractCorrectionLine(speech, segment, file);
    return file;
  }));
  const transcripts = files.length ? await transcribeCorrectionLines(files, signal).catch(() => []) : [];
  const candidates = new Map<SpeechSegment, {characterId: string; lineId: string}>();
  for (const [index, {segment}] of clear.entries()) {
    const words = transcripts[index];
    const spoken = words && confidenceInWords(words) ? correctionWords(words.map(word => word.text).join(" ")) : "";
    if (!spoken) continue;
    segment.text = words.map(word => word.text).join(" ");
    const matches = plan.events.filter(event => correctionWords(event.wordText) === spoken
      && (event.startSeconds === undefined || segment.end + 0.55 >= event.startSeconds)
      && (event.endSeconds === undefined || segment.start - 0.55 <= event.endSeconds));
    if (matches.length === 1) candidates.set(segment, matches[0]);
  }
  const identity = new Map<SpeechSegment, string>();
  for (const [segment, cue] of candidates) {
    if ([...candidates.values()].filter(match => match.lineId === cue.lineId).length === 1) {
      identity.set(segment, cue.characterId);
    }
  }
  // A detector group can merge non-overlapping turns. Review those turns
  // individually, and never offer a combined interval with unknown boundaries.
  return voices.flatMap((voice): DetectedVoiceLane[] => {
    const known = new Set(voice.segments.map(segment => identity.get(segment)).filter(Boolean));
    const allMatched = voice.segments.every(segment => segment.blockedReason || identity.has(segment));
    if (!splitLanes && allMatched && known.size === 1) {
      return [{...voice, suggestedCharacterId: [...known][0]}];
    }
    return voice.segments.map((segment, index) => {
      const character = identity.get(segment);
      const unresolvedMerged = (splitLanes || known.size > 1) && !character;
      const blockedReason = segment.blockedReason || (unresolvedMerged ? "This speech cue could not be separated reliably." : undefined);
      return {...voice, id: `${voice.id}-cue-${index + 1}`, label: "Speaker cue", segmentCount: 1,
        totalSpeechSeconds: segment.end - segment.start, segments: [{...segment, blockedReason}],
        suggestedCharacterId: character, needsCharacterConfirmation: !blockedReason};
    });
  });
}

export async function GET(request: NextRequest) {
  try { await assertFixVoicesTest(request); }
  catch { return new NextResponse(null, {status: 404, headers: {"Cache-Control": "private, no-store"}}); }
  return new NextResponse(null, {status: 204, headers: {"Cache-Control": "private, no-store"}});
}

export async function POST(request: NextRequest) {
  let releaseGpu:(()=>void)|undefined;
  let failedFixVoicesDir = "";
  try {
    const ownerKey = await productionAudioOwner(request);
    assertSameOrigin(request);
    const runId = `audio-${randomUUID()}`;
    const workDir = path.join(ANALYSIS_ROOT, safeSegment(ownerKey), runId);
    const contentType = String(request.headers.get("content-type") || "").toLowerCase();
    let body: any = {};
    let uploadedVideo: File | null = null;

    if (contentType.includes("multipart/form-data")) {
      if (Number(request.headers.get("content-length")) > 97 * 1024 * 1024) throw new RequestError("Upload a video under 96 MB.", 413);
      const form = await request.formData();
      const candidate = form.get("video") || form.get("file");
      if (candidate && typeof (candidate as any).arrayBuffer === "function") {
        uploadedVideo = candidate as File;
      }
      body = {
        sourceFileName: uploadedVideo?.name || "uploaded-video.mp4",
        expectedSpeakerCount: form.get("expectedSpeakerCount") || form.get("speakerCount") || "",
        fixVoices: form.get("fixVoices") === "true" || form.get("fixVoices") === "1",
      };
    } else {
      body = await request.json();
    }

    const fixVoices = body?.fixVoices === true;
    if (fixVoices) {
      await assertFixVoicesTest(request);
      failedFixVoicesDir = workDir;
    }
    await fs.mkdir(workDir, { recursive: true, mode: 0o700 });
    let sourcePath = "";
    let sourceJobId: string | undefined;
    let contentMode: "nsfw" | undefined;
    if (uploadedVideo) {
      const size = Number((uploadedVideo as any).size || 0);
      if (!Number.isFinite(size) || size <= 0) {
        return NextResponse.json({ ok: false, error: "Uploaded video is empty." }, { status: 400 });
      }
      if (fixVoices && size > 96 * 1024 * 1024) throw new RequestError("Upload a video under 96 MB.", 413);
      const fileName = safeName(uploadedVideo.name || "uploaded-video.mp4", "uploaded-video.mp4");
      sourcePath = path.join(workDir, fixVoices ? `source${path.extname(fileName).toLowerCase() || ".mp4"}` : fileName);
      if (fixVoices) requireStorageHeadroom(workDir, size);
      await fs.writeFile(sourcePath, Buffer.from(await uploadedVideo.arrayBuffer()), {flag: "wx", mode: 0o600});
    } else if (fixVoices) {
      const source = await resolveCorrectionSource(request, ownerKey, body);
      if (source.savedPreviewId) {
        const restored = await reopenCorrectionPreview(request, ownerKey, source.savedPreviewId, source.file);
        await fs.rmdir(workDir);
        failedFixVoicesDir = "";
        return NextResponse.json(restored, {headers: {"Cache-Control": "private, no-store"}});
      }
      sourceJobId = source.sourceJobId;
      contentMode = source.contentMode;
      body.sourceFileName = source.name;
      sourcePath = path.join(workDir, `source${path.extname(source.name).toLowerCase() || ".mp4"}`);
      requireStorageHeadroom(workDir, (await fs.stat(source.file)).size);
      await fs.copyFile(source.file, sourcePath, constants.COPYFILE_EXCL);
    } else {
      sourcePath = await findSourceVideo(body, request, workDir);
    }
    if(contentMode==="nsfw")await fs.writeFile(path.join(workDir,".nsfw-media"),"1",{mode:0o600});
    const soundtrack = fixVoices ? await extractCorrectionSoundtrack(sourcePath, workDir, true) : null;
    const duration = soundtrack?.duration ?? await durationSeconds(sourcePath);
    let mixSource: MixSource | null = null;
    const warnings: string[] = [];
    if (soundtrack) {
      try { mixSource = await separateCorrectionSoundtrack(soundtrack, workDir, request.signal); }
      catch { warnings.push("Isolated dialogue is unavailable for this clip. The original audio was kept."); }
    }
    const extractedWav = path.join(workDir, "source_mono_16k.wav");
    await extractMonoWav(mixSource?.speech || soundtrack?.original || sourcePath, extractedWav);

    // The unified TEST handoff must not start the legacy Demucs/diarization
    // chain outside the same physical-GPU admission domain as voice tools.
    if(!fixVoices && process.env.OTG_ENV==="test"&&process.env.OTG_AUDIO_EDITING_ENABLED==="1")
      releaseGpu=await acquireAuxiliary3090(`audio-analysis:${ownerKey}:${runId}`);
    const demucs = fixVoices ? null : await tryDemucs(sourcePath, workDir);
    const analysisWav = demucs?.vocalsPath || extractedWav;
    const expectedSpeakerCount = fixVoices ? 0 : clampExpectedSpeakerCount(
      body.expectedSpeakerCount ?? body.speakerCount ?? body.maxSpeakers
    );
    const localVoices = await tryLocalDiarization(analysisWav, duration, expectedSpeakerCount, workDir, fixVoices);
    const externalVoices = localVoices || (fixVoices ? null : await tryExternalDiarization(analysisWav, duration, expectedSpeakerCount, workDir));
    const segments = externalVoices ? [] : await detectSpeechSegments(analysisWav, duration);

    const totalSpeechSeconds = Math.round(
      (externalVoices
        ? externalVoices.flatMap((voice) => voice.segments)
        : segments
      ).reduce((sum, segment) => sum + Math.max(0, segment.end - segment.start), 0) * 100
    ) / 100;

    const voices: DetectedVoiceLane[] = externalVoices || buildEstimatedSpeakerLanes(
      segments,
      totalSpeechSeconds,
      Boolean(demucs?.vocalsPath),
      expectedSpeakerCount
    );

    if (fixVoices) {
      if (!localVoices) warnings.push("Speakers could not be identified reliably. Listen to the original or try a clearer clip.");
      const castPlan = await correctionCastPlan(ownerKey, sourceJobId,request);
      const expectedCastSpeakers = new Set(castPlan?.events.filter(event => (
        event.wordText.trim() && castPlan.bindings.some(binding => binding.characterId === event.characterId)
      )).map(event => event.characterId)).size;
      const detectedSpeakerCount = localVoices?.length || 0;
      const castCountMismatch = Boolean(detectedSpeakerCount && expectedCastSpeakers && detectedSpeakerCount !== expectedCastSpeakers);
      if (castCountMismatch) warnings.push("Some speakers need confirmation. Play the cue before choosing a character.");
      const overlapFound = labelBlockedVoiceIntervals(voices, Boolean(localVoices), duration);
      if (overlapFound) warnings.push("Intervals with overlapping speakers will keep their original audio.");
      const matched = localVoices && mixSource && castPlan?.events.length
        ? await matchH3CorrectionCues(castPlan, mixSource.speech, voices, castCountMismatch, workDir, request.signal)
        : voices;
      const voiceTargets = castPlan ? (await Promise.all(castPlan.bindings.map(async member => {
        const pinned = castPlan.voiceTargets.find(target => target.characterId === member.characterId);
        return pinned ? verifiedCorrectionVoice(request, pinned)
          : resolveSavedH3CorrectionVoice(request, ownerKey, member.characterId).catch(() => null);
      }))).filter(target => !!target) : [];
      const cast = castPlan?.bindings.map(member => {
        const target = voiceTargets.find(entry => entry.characterId === member.characterId);
        return {characterId: member.characterId, name: member.name, voiceId: target?.modelId, voiceName: target?.sample.name};
      });
      for (const lane of matched) {
        const character = cast?.find(member => member.characterId === lane.suggestedCharacterId);
        if (!character) continue;
        if (!lane.needsCharacterConfirmation) lane.label = character.name;
        lane.suggestedTargetVoiceId = character.voiceId;
        lane.suggestedTargetVoiceName = character.voiceName;
      }
      await extractVoiceLaneSamples(matched, analysisWav, workDir);
      const sourceFileName = safeName(body.sourceFileName, path.basename(sourcePath));
      const mixReady = Boolean(mixSource && localVoices && matched.some(voice => voice.segments.some(segment => !segment.blockedReason)));
      await writeCorrectionRecord(ownerKey, runId, "analysis", {sourcePath, sourceFileName, sourceJobId, contentMode, durationSeconds: duration, mixSource,
        voices: matched, cast, voiceTargets, mixReady, warnings});
      failedFixVoicesDir = "";
      return NextResponse.json({ok: true, analysisId: runId, sourceJobId, sourceVideoUrl: correctionMediaUrl(sourcePath), sourceFileName, durationSeconds: duration,
        voices: matched.map(({samplePath: _samplePath, ...voice}) => voice), cast, mixReady, warnings}, {headers: {"Cache-Control": "private, no-store"}});
    }
    await extractVoiceLaneSamples(voices, analysisWav, workDir);

    const result = {
      ok: true,
      runId,
      sourcePath,
      sourceFileName: safeName(body.sourceFileName || fileNameFromUrl(body.sourceUrl), path.basename(sourcePath)),
      durationSeconds: duration,
      separation: {
        tool: demucs?.vocalsPath ? "demucs" : "ffmpeg_audio_extract",
        dialogueStemPath: analysisWav,
        backgroundStemPath: demucs?.backgroundPath || "",
        demucsAvailable: Boolean(demucs?.vocalsPath),
        backgroundStemAvailable: Boolean(demucs?.backgroundPath),
      },
      diarization: {
        tool: localVoices
          ? "local_pyannote_community_1"
          : externalVoices
            ? "external_speaker_diarization"
            : "silencedetect_estimated_speaker_lanes",
        expectedSpeakerCount,
        note: localVoices
          ? "Local pyannote Community-1 diarization returned voice lanes from the dialogue stem."
          : externalVoices
          ? "External speaker diarization returned voice lanes from the dialogue stem."
          : expectedSpeakerCount > 0
            ? `Fallback speaker-lane estimation is active with a requested ${expectedSpeakerCount}-voice split. For best speaker identity separation, connect OTG_SPEAKER_DIARIZATION_URL.`
            : voices.length > 1
              ? "Fallback speaker-lane estimation is active. Speech ranges are split into Voice lanes until a true diarization backend is connected."
              : "Fallback voice activity detection is active. One dialogue voice lane was detected.",
      },
      voices,
      createdAt: new Date().toISOString(),
    };

    await fs.writeFile(path.join(workDir, "analysis.json"), JSON.stringify(result, null, 2), "utf8");

    return NextResponse.json(result);
  } catch (error: any) {
    if (error instanceof RequestError) return NextResponse.json({ok:false,error:error.message},{status:error.status});
    if (error instanceof AuxiliaryGpuBusyError) return NextResponse.json({ok:false,error:error.message},{status:409});
    if (error instanceof SessionInvalidError) return NextResponse.json({ok:false,error:"Unauthorized"},{status:401});
    if (error instanceof ProductionAudioAccessError) return NextResponse.json({ok:false,error:error.message},{status:404});
    return NextResponse.json(
      {
        ok: false,
        error: error?.message || "Analyze Clip Audio failed.",
      },
      { status: 500 }
    );
  } finally {
    releaseGpu?.();
    if (failedFixVoicesDir) await fs.rm(failedFixVoicesDir, {recursive: true, force: true}).catch(() => undefined);
  }
}
