// OTG_VOICE_TEXT_TO_SPEECH_INDEXTTS2_V1

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

import { NextRequest, NextResponse } from "next/server";

import { getGallerySourcesForRequest, safeGalleryName, writeMetaForFile } from "@/lib/gallery";
import { getOwnerContext, SessionInvalidError } from "@/lib/ownerKey";
import { OTG_DATA_ROOT, safeJoin, safeSegment } from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function ownerTtsRoot(ownerKey: string) {
  return path.join(OTG_DATA_ROOT, "voice_tts_jobs", safeSegment(ownerKey || "local"));
}

async function readJson(req: NextRequest) {
  try { return await req.json(); } catch { return {}; }
}

function uniqueTargetPath(dir: string, desiredName: string) {
  const ext = path.extname(desiredName) || ".wav";
  const stem = path.basename(desiredName, ext) || "character_tts";
  let candidate = path.join(dir, `${stem}${ext}`);
  let index = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${stem}_${index}${ext}`);
    index += 1;
  }
  return candidate;
}

export async function POST(req: NextRequest) {
  try {
    const owner = await getOwnerContext(req);
    const body = await readJson(req);
    const jobId = String(body?.jobId || "").trim();
    const fileName = path.basename(String(body?.fileName || "character_tts.wav"));
    const title = safeGalleryName(String(body?.title || path.basename(fileName, path.extname(fileName)) || "character_tts")) || "character_tts";
    if (!jobId) return NextResponse.json({ ok: false, error: "missing jobId" }, { status: 400 });

    const sourcePath = safeJoin(ownerTtsRoot(owner.ownerKey), jobId, fileName);
    if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) return NextResponse.json({ ok: false, error: "TTS audio not found" }, { status: 404 });

    const { sources } = await getGallerySourcesForRequest(req);
    const targetSource = sources[0];
    const targetPath = uniqueTargetPath(targetSource.dir, `${title}${path.extname(fileName) || ".wav"}`);
    await fsp.copyFile(sourcePath, targetPath);
    const stat = await fsp.stat(targetPath);
    const savedName = path.basename(targetPath);
    const sidecar = fs.existsSync(`${sourcePath}.json`) ? JSON.parse(await fsp.readFile(`${sourcePath}.json`, "utf8")) : {};

    const meta = writeMetaForFile(targetPath, {
      originalName: savedName,
      renamedName: savedName,
      sourceType: "voice-text-to-speech",
      requestKind: "voice-text-to-speech",
      mediaCategory: "audio",
      workflowId: "voice/tts/indextts2",
      workflowTitle: "Voice Dubbing - Text-to-Speech - IndexTTS2",
      voiceTts: {
        version: 1,
        operation: "text-to-speech",
        engine: String(body?.engine || sidecar.engine || "indextts2"),
        modelName: String(body?.modelName || sidecar.modelName || ""),
        emotion: String(body?.emotion || sidecar.emotion || ""),
        language: String(body?.language || sidecar.language || "en"),
        sizeBytes: stat.size,
      },
      submitPayload: {
        requestKind: "voice-text-to-speech",
        sourceJobId: jobId,
        title,
        engine: String(body?.engine || sidecar.engine || "indextts2"),
        modelName: String(body?.modelName || sidecar.modelName || ""),
      },
      ownerKey: targetSource.ownerKey,
      username: targetSource.username,
      deviceId: targetSource.deviceId,
      createdAt: stat.birthtimeMs || stat.mtimeMs || Date.now(),
      updatedAt: Date.now(),
    }, targetSource);

    return NextResponse.json({
      ok: true,
      fileName: savedName,
      name: savedName,
      source: targetSource.scope,
      url: `/api/gallery/file?name=${encodeURIComponent(savedName)}&scope=${targetSource.scope}`,
      meta,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error: any) {
    if (error instanceof SessionInvalidError) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ ok: false, error: error?.message || "Save TTS audio failed" }, { status: 500 });
  }
}
