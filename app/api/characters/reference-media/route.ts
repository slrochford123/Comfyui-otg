import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { resolveFfmpegPath, runCmd } from "@/lib/ffmpeg";
import { getOwnerContext, SessionInvalidError } from "@/lib/ownerKey";
import { OTG_DATA_ROOT, ensureDir, safeSegment } from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AUDIO_EXTS = new Set([".wav", ".mp3", ".m4a", ".aac", ".ogg", ".flac", ".wma", ".opus"]);
const VIDEO_EXTS = new Set([".mp4", ".mov", ".webm", ".mkv", ".avi", ".m4v"]);

function fileUrlFor(absPath: string) {
  return `/api/file?path=${encodeURIComponent(absPath)}`;
}

function detectMediaType(file: File): "audio" | "video" {
  const mime = String(file.type || "").toLowerCase();
  const ext = path.extname(String(file.name || "")).toLowerCase();
  if (mime.startsWith("audio/") || AUDIO_EXTS.has(ext)) return "audio";
  if (mime.startsWith("video/") || VIDEO_EXTS.has(ext)) return "video";
  throw new Error("Unsupported file type. Upload a short audio clip or video.");
}

function safeInputExt(file: File, mediaType: "audio" | "video") {
  const ext = path.extname(String(file.name || "")).toLowerCase();
  if (mediaType === "audio") {
    return AUDIO_EXTS.has(ext) ? ext : ".wav";
  }
  return VIDEO_EXTS.has(ext) ? ext : ".mp4";
}

export async function POST(req: NextRequest) {
  let tempAudioSourcePath = "";
  try {
    const { ownerKey } = await getOwnerContext(req);
    const form = await req.formData();
    const file = form.get("media") || form.get("audio") || form.get("video") || form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ ok: false, error: "Missing media file" }, { status: 400 });
    }

    const mediaType = detectMediaType(file);
    const ownerDir = path.join(OTG_DATA_ROOT, "uploads", "characters", safeSegment(ownerKey));
    ensureDir(ownerDir);

    const id = crypto.randomUUID();
    const inputExt = safeInputExt(file, mediaType);
    const normalizedAudioPath = path.join(ownerDir, `character_reference_audio_${id}.wav`);
    const introVideoPath = mediaType === "video" ? path.join(ownerDir, `character_intro_video_${id}${inputExt}`) : "";
    tempAudioSourcePath = mediaType === "audio" ? path.join(ownerDir, `character_reference_audio_source_${id}${inputExt}`) : "";
    const sourcePath = mediaType === "video" ? introVideoPath : tempAudioSourcePath;

    const buf = Buffer.from(await file.arrayBuffer());
    await fsp.writeFile(sourcePath, buf);

    const ffmpeg = resolveFfmpegPath();
    const args = [
      "-y",
      "-i",
      sourcePath,
      "-vn",
      "-acodec",
      "pcm_s16le",
      "-ar",
      "24000",
      "-ac",
      "1",
      normalizedAudioPath,
    ];
    const result = await runCmd(ffmpeg, args, { timeoutMs: 180000 });
    if (result.code !== 0) {
      return NextResponse.json(
        {
          ok: false,
          error: "ffmpeg failed while building the character reference audio asset",
          detail: (result.stderr || result.stdout || "").trim() || undefined,
        },
        { status: 500 },
      );
    }

    if (!fs.existsSync(normalizedAudioPath)) {
      return NextResponse.json({ ok: false, error: "Reference audio extraction failed" }, { status: 500 });
    }

    if (mediaType === "audio" && tempAudioSourcePath) {
      try {
        await fsp.unlink(tempAudioSourcePath);
      } catch {
        // ignore cleanup failure for temporary audio sources
      }
      tempAudioSourcePath = "";
    }

    return NextResponse.json({
      ok: true,
      mediaType,
      originalFileName: file.name || (mediaType === "video" ? "reference-video" : "reference-audio"),
      introVideoPath: introVideoPath || undefined,
      introVideoUrl: introVideoPath ? fileUrlFor(introVideoPath) : undefined,
      referenceAudioPath: normalizedAudioPath,
      referenceAudioUrl: fileUrlFor(normalizedAudioPath),
    });
  } catch (e: any) {
    if (tempAudioSourcePath) {
      try {
        await fsp.unlink(tempAudioSourcePath);
      } catch {
        // ignore cleanup failure
      }
    }
    if (e instanceof SessionInvalidError) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ ok: false, error: e?.message || "Reference media upload failed" }, { status: 500 });
  }
}
