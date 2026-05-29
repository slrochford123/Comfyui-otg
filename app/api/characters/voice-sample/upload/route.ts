import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";

import { getOwnerContext, SessionInvalidError } from "@/lib/ownerKey";
import { ensureDir, OTG_DATA_ROOT, safeJoin, safeSegment } from "@/lib/paths";

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
    const ownerKey = await resolveOwnerKey(req);
    const form = await req.formData();
    const characterId = safeSegment(String(form.get("characterId") || "character"));
    const file = form.get("file");

    if (!characterId) return jsonError("characterId is required.");
    if (!(file instanceof File)) return jsonError("Audio file is required.");
    if (file.size <= 0) return jsonError("Audio file is empty.");
    if (file.size > MAX_UPLOAD_BYTES) return jsonError("Audio file is too large. Maximum size is 50 MB.", 413);
    if (!isAllowedMime(file)) return jsonError("Unsupported audio MIME type.");

    const ext = extensionForFile(file);
    if (!ext) return jsonError("Unsupported audio extension. Use wav, mp3, m4a, flac, or ogg.");

    const ownerSegment = safeSegment(ownerKey || "local");
    const uploadId = `uploaded_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const fileName = `sample${ext}`;
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
      provider: "uploaded",
      adapter: "uploaded_voice",
      mock: false,
      uploadId,
      fileName,
      outputBytes: bytes.length,
    });
  } catch (error) {
    if (error instanceof SessionInvalidError) return jsonError("Unauthorized", 401);
    return jsonError(error instanceof Error ? error.message : "Voice upload failed.", 500);
  }
}
