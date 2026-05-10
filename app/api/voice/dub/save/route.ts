import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

import { NextRequest, NextResponse } from "next/server";

import { getGallerySourcesForRequest, safeGalleryName, writeMetaForFile } from "@/lib/gallery";
import { getOwnerContext, SessionInvalidError } from "@/lib/ownerKey";
import { OTG_DATA_ROOT, safeJoin, safeSegment } from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function ownerJobRoot(ownerKey: string) {
  return path.join(OTG_DATA_ROOT, "voice_dub_jobs", safeSegment(ownerKey || "local"));
}

async function readJson(req: NextRequest) {
  try { return await req.json(); } catch { return {}; }
}

function uniqueTargetPath(dir: string, desiredName: string) {
  const ext = path.extname(desiredName) || ".wav";
  const stem = path.basename(desiredName, ext) || "voice_dub";
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
    const fileName = path.basename(String(body?.fileName || "voice_dub.wav"));
    const title = safeGalleryName(String(body?.title || path.basename(fileName, path.extname(fileName)) || "voice_dub")) || "voice_dub";
    if (!jobId) return NextResponse.json({ ok: false, error: "missing jobId" }, { status: 400 });

    const sourcePath = safeJoin(ownerJobRoot(owner.ownerKey), jobId, fileName);
    if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
      return NextResponse.json({ ok: false, error: "Dubbed audio not found" }, { status: 404 });
    }

    const { sources } = await getGallerySourcesForRequest(req);
    const targetSource = sources[0];
    const targetPath = uniqueTargetPath(targetSource.dir, `${title}${path.extname(fileName) || ".wav"}`);
    await fsp.copyFile(sourcePath, targetPath);
    const stat = await fsp.stat(targetPath);
    const savedName = path.basename(targetPath);
    const sidecar = fs.existsSync(`${sourcePath}.json`) ? JSON.parse(await fsp.readFile(`${sourcePath}.json`, "utf8")) : {};

    const meta = writeMetaForFile(
      targetPath,
      {
        originalName: savedName,
        renamedName: savedName,
        sourceType: "voice-dubbing",
        requestKind: "voice-dubbing",
        mediaCategory: "audio",
        workflowId: "voice/dub",
        workflowTitle: "Edit Video - Audio Editing - Voice Dubbing",
        voiceDub: {
          version: 1,
          operation: "voice-dubbing",
          engine: String(body?.engine || sidecar.engine || ""),
          modelName: String(body?.modelName || sidecar.modelName || ""),
          pitch: Number(sidecar.pitch || 0),
          sizeBytes: stat.size,
        },
        submitPayload: {
          requestKind: "voice-dubbing",
          sourceJobId: jobId,
          title,
          engine: String(body?.engine || sidecar.engine || ""),
          modelName: String(body?.modelName || sidecar.modelName || ""),
        },
        ownerKey: targetSource.ownerKey,
        username: targetSource.username,
        deviceId: targetSource.deviceId,
        createdAt: stat.birthtimeMs || stat.mtimeMs || Date.now(),
        updatedAt: Date.now(),
      },
      targetSource,
    );

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
    return NextResponse.json({ ok: false, error: error?.message || "Save voice dub failed" }, { status: 500 });
  }
}
