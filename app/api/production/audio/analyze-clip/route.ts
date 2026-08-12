import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { cookieName } from "@/lib/auth/cookies";
import { verifySession } from "@/lib/auth/jwt";
import { safeDeviceId } from "@/lib/otgDevice";
import { resolveOwnerAlias } from "@/lib/ownerAlias";
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
  "C:\\AI\\ComfyUI\\ComfyUI\\input";

const COMFY_OUTPUT_DIR =
  process.env.OTG_COMFY_OUTPUT_DIR ||
  "C:\\AI\\ComfyUI\\ComfyUI\\output";

const ANALYSIS_ROOT =
  process.env.OTG_AUDIO_ANALYSIS_DIR ||
  productionAudioAnalysisRoot();

const FFMPEG_BIN = process.env.OTG_FFMPEG_BIN || "ffmpeg";
const FFPROBE_BIN = process.env.OTG_FFPROBE_BIN || "ffprobe";
const PYTHON_BIN = process.env.OTG_AUDIO_ANALYSIS_PYTHON || "python";
const DEMUCS_MODEL = process.env.OTG_DEMUCS_MODEL || "htdemucs";
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
      // Source discovery can still use the device-scoped fallback.
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

    const response = await fetch(absoluteUrl, { cache: "no-store" });

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

  throw new Error(
    `Could not locate source clip "${requestedNameRaw || fileNameFromUrl(sourceUrl)}". Tried exact gallery filename, decoded URL filename, Comfy output/input, and gallery URL fetch.`
  );
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

async function tryDemucs(sourcePath: string, workDir: string) {
  if (process.env.OTG_DEMUCS_ENABLED === "0") return "";

  const demucsOut = path.join(workDir, "demucs");
  await fs.mkdir(demucsOut, { recursive: true });

  try {
    await execFileAsync(
      PYTHON_BIN,
      ["-m", "demucs", "-n", DEMUCS_MODEL, "--two-stems", "vocals", "-o", demucsOut, sourcePath],
      { timeout: 30 * 60 * 1000, maxBuffer: 1024 * 1024 * 40, windowsHide: true }
    );

    return await findRecursive(demucsOut, "vocals.wav");
  } catch {
    return "";
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

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const runId = `audio_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const workDir = path.join(ANALYSIS_ROOT, runId);
    await fs.mkdir(workDir, { recursive: true });

    const sourcePath = await findSourceVideo(body, request, workDir);
    const duration = await durationSeconds(sourcePath);

    const extractedWav = path.join(workDir, "source_mono_16k.wav");
    await extractMonoWav(sourcePath, extractedWav);

    const demucsVocals = await tryDemucs(sourcePath, workDir);
    const analysisWav = demucsVocals || extractedWav;
    const expectedSpeakerCount = clampExpectedSpeakerCount(
      body.expectedSpeakerCount ?? body.speakerCount ?? body.maxSpeakers
    );
    const externalVoices = await tryExternalDiarization(analysisWav, duration, expectedSpeakerCount, workDir);
    const segments = externalVoices ? [] : await detectSpeechSegments(analysisWav, duration);

    const totalSpeechSeconds = Math.round(
      (externalVoices
        ? externalVoices.flatMap((voice) => voice.segments)
        : segments
      ).reduce((sum, segment) => sum + Math.max(0, segment.end - segment.start), 0) * 100
    ) / 100;

    const voices = externalVoices || buildEstimatedSpeakerLanes(
      segments,
      totalSpeechSeconds,
      Boolean(demucsVocals),
      expectedSpeakerCount
    );

    const result = {
      ok: true,
      runId,
      sourceFileName: safeName(body.sourceFileName || fileNameFromUrl(body.sourceUrl), path.basename(sourcePath)),
      durationSeconds: duration,
      separation: {
        tool: demucsVocals ? "demucs" : "ffmpeg_audio_extract",
        dialogueStemPath: analysisWav,
        demucsAvailable: Boolean(demucsVocals),
      },
      diarization: {
        tool: externalVoices ? "external_speaker_diarization" : "silencedetect_estimated_speaker_lanes",
        expectedSpeakerCount,
        note: externalVoices
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
    return NextResponse.json(
      {
        ok: false,
        error: error?.message || "Analyze Clip Audio failed.",
      },
      { status: 500 }
    );
  }
}
