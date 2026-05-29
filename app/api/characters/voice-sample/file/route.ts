import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { mediaFileResponse } from "@/lib/mediaResponse";

export const runtime = "nodejs";

function dataRoot() {
  return path.resolve(String(process.env.OTG_DATA_DIR || path.join(process.cwd(), "data")));
}

function isSafeSegment(value: string) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return false;
  if (trimmed.includes("..")) return false;
  if (trimmed.includes("/") || trimmed.includes("\\")) return false;
  return /^[a-zA-Z0-9._-]+$/.test(trimmed);
}

function jsonError(error: string, status = 400) {
  return NextResponse.json(
    { ok: false, error },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

type VoiceSamplePathResult =
  | { ok: true; samplePath: string; fileName: VoiceSampleFileName }
  | { ok: false; error: string; status: number };

type VoiceSampleFileName = "sample.wav" | "fx.wav" | "sample.mp3" | "sample.m4a" | "sample.flac" | "sample.ogg";

const ALLOWED_SAMPLE_FILES = new Set<VoiceSampleFileName>([
  "sample.wav",
  "fx.wav",
  "sample.mp3",
  "sample.m4a",
  "sample.flac",
  "sample.ogg",
]);

const CONTENT_TYPES: Record<VoiceSampleFileName, string> = {
  "sample.wav": "audio/wav",
  "fx.wav": "audio/wav",
  "sample.mp3": "audio/mpeg",
  "sample.m4a": "audio/mp4",
  "sample.flac": "audio/flac",
  "sample.ogg": "audio/ogg",
};

async function fileExists(filePath: string) {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

function resolveVoiceSamplePath(req: NextRequest): VoiceSamplePathResult {
  const owner = String(req.nextUrl.searchParams.get("owner") || "").trim();
  const characterId = String(req.nextUrl.searchParams.get("characterId") || "").trim();
  const jobId = String(req.nextUrl.searchParams.get("jobId") || "").trim();
  const fileName = String(req.nextUrl.searchParams.get("file") || "sample.wav").trim();

  if (!isSafeSegment(owner)) {
    return { ok: false, error: "Invalid owner.", status: 400 };
  }

  if (!isSafeSegment(characterId)) {
    return { ok: false, error: "Invalid characterId.", status: 400 };
  }

  if (!isSafeSegment(jobId)) {
    return { ok: false, error: "Invalid jobId.", status: 400 };
  }

  if (!ALLOWED_SAMPLE_FILES.has(fileName as VoiceSampleFileName)) {
    return { ok: false, error: "Invalid voice sample file.", status: 400 };
  }

  const root = dataRoot();
  const voiceSamplesRoot = path.join(root, "characters", owner, "voice-samples");
  const safeFileName = fileName as VoiceSampleFileName;
  const samplePath = path.join(voiceSamplesRoot, characterId, jobId, safeFileName);
  const resolvedSamplePath = path.resolve(samplePath);

  if (!resolvedSamplePath.startsWith(path.resolve(voiceSamplesRoot) + path.sep)) {
    return { ok: false, error: "Invalid voice sample path.", status: 400 };
  }

  return { ok: true, samplePath: resolvedSamplePath, fileName: safeFileName };
}

async function serveVoiceSample(req: NextRequest, method: "GET" | "HEAD") {
  const resolved = resolveVoiceSamplePath(req);

  if (!resolved.ok) {
    return jsonError(resolved.error, resolved.status);
  }

  if (!(await fileExists(resolved.samplePath))) {
    return jsonError("Voice sample not found.", 404);
  }

  const response = mediaFileResponse(req, resolved.samplePath, {
    method,
    contentType: CONTENT_TYPES[resolved.fileName],
    download: req.nextUrl.searchParams.get("download") === "1",
    fileName: resolved.fileName,
    cacheControl: "private, no-store",
  });

  response.headers.set("X-OTG-Voice-Sample-File", "1");
  response.headers.set("X-OTG-Resolved-File", resolved.fileName);

  return response;
}

export async function GET(req: NextRequest) {
  return serveVoiceSample(req, "GET");
}

export async function HEAD(req: NextRequest) {
  return serveVoiceSample(req, "HEAD");
}
