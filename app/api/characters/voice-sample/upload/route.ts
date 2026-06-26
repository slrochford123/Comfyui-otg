import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";

import { getOwnerContext, SessionInvalidError } from "@/lib/ownerKey";
import { ensureDir, OTG_DATA_ROOT, safeJoin, safeSegment } from "@/lib/paths";
import { hasValidWorkerToken } from "@/lib/jobs/workerAuth";
import { isSafeVoiceSampleUploadSegment } from "@/lib/characters/voiceSampleUpload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set([".wav", ".mp3", ".m4a", ".flac", ".ogg"]);
const ALLOWED_MIME_PREFIXES = ["audio/"];
const ALLOWED_MIME_TYPES = new Set(["application/octet-stream"]);

function jsonError(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status, headers: { "Cache-Control": "no-store" } });
}

function sampleUrlFor(ownerKey: string, characterId: string, uploadId: string, fileName: string) {
  return `/api/characters/voice-sample/file?owner=${encodeURIComponent(ownerKey)}&characterId=${encodeURIComponent(characterId)}&jobId=${encodeURIComponent(uploadId)}&file=${encodeURIComponent(fileName)}`;
}

function extensionForFile(file: File) {
  const ext = path.extname(String(file.name || "").toLowerCase());
  if (ALLOWED_EXTENSIONS.has(ext)) return ext;
  return "";
}

function isAllowedMime(file: File) {
  const type = String(file.type || "").toLowerCase();
  if (!type) return true;
  return ALLOWED_MIME_PREFIXES.some((prefix) => type.startsWith(prefix)) || ALLOWED_MIME_TYPES.has(type);
}

async function resolveOwnerKey(req: NextRequest): Promise<string> {
  if (hasValidWorkerToken(req)) {
    const workerOwnerKey = String(req.headers.get("x-otg-owner-key") || "").trim();
    if (!isSafeVoiceSampleUploadSegment(workerOwnerKey)) throw new Error("Missing or invalid x-otg-owner-key for worker upload.");
    return workerOwnerKey;
  }
  try {
    const { ownerKey } = await getOwnerContext(req);
    return ownerKey;
  } catch (error) {
    if (error instanceof SessionInvalidError) throw error;
    const headerDeviceId = req.headers.get("x-otg-device-id") || req.headers.get("x-device-id") || "local";
    return safeSegment(headerDeviceId || "local");
  }
}
export async function POST(req: NextRequest) {
  try {
    const workerUpload = hasValidWorkerToken(req);
    const ownerKey = await resolveOwnerKey(req);
    const form = await req.formData();
    const rawCharacterId = String(form.get("characterId") || "character").trim();
    const rawJobId = String(form.get("jobId") || "").trim();
    const provider = String(form.get("provider") || (workerUpload ? "qwen3" : "uploaded")).trim();
    const adapter = String(form.get("adapter") || (workerUpload ? "windows_voice_design" : "uploaded_voice")).trim();
    const file = form.get("file");

    if (workerUpload && !isSafeVoiceSampleUploadSegment(rawCharacterId)) {
      return jsonError("characterId is required and must be a safe path segment.");
    }
    if (workerUpload && !isSafeVoiceSampleUploadSegment(rawJobId)) return jsonError("jobId is required and must be a safe path segment for worker upload.");
    if (!(file instanceof File)) return jsonError("Audio file is required.");
    if (file.size <= 0) return jsonError("Audio file is empty.");
    if (file.size > MAX_UPLOAD_BYTES) return jsonError("Audio file is too large. Maximum size is 50 MB.", 413);
    if (!isAllowedMime(file)) return jsonError("Unsupported audio MIME type.");

    const ext = extensionForFile(file);
    if (!ext) return jsonError("Unsupported audio extension. Use wav, mp3, m4a, flac, or ogg.");

    const ownerSegment = safeSegment(ownerKey || "local");
    const characterId = safeSegment(rawCharacterId);
    if (!characterId) return jsonError("characterId is required.");
    const uploadId = workerUpload ? safeSegment(rawJobId) : `uploaded_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const fileName = workerUpload ? (provider === "ltx" || provider === "unnatural_ltx" ? "sample.mp3" : "sample.wav") : `sample${ext}`;
    const voiceSamplesRoot = path.join(OTG_DATA_ROOT, "characters", ownerSegment, "voice-samples");
    const outputDir = safeJoin(voiceSamplesRoot, characterId, uploadId);
    const samplePath = safeJoin(outputDir, fileName);
    ensureDir(outputDir);

    const bytes = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(samplePath, bytes);

    return NextResponse.json({
      ok: true,
      samplePath,
      sampleUrl: sampleUrlFor(ownerSegment, characterId, uploadId, fileName),
      provider,
      adapter,
      mock: false,
      uploadId,
      jobId: uploadId,
      fileName,
      outputBytes: bytes.length,
    });
  } catch (error) {
    if (error instanceof SessionInvalidError) return jsonError("Unauthorized", 401);
    return jsonError(error instanceof Error ? error.message : "Voice upload failed.", 500);
  }
}
