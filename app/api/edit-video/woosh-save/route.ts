import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

import { getGallerySourcesForRequest, safeGalleryName, writeMetaForFile } from "@/lib/gallery";
import { OTG_DATA_ROOT, safeJoin, safeSegment } from "@/lib/paths";
import { SessionInvalidError } from "@/lib/ownerKey";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function editVideoJobRoot(ownerKey: string) {
  return path.join(OTG_DATA_ROOT, "edit_video_jobs", safeSegment(ownerKey || "local"));
}

async function readJsonBody(req: NextRequest): Promise<Record<string, any>> {
  try {
    const raw = await req.text();
    if (!raw.trim()) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function uniqueTargetPath(dir: string, desiredName: string) {
  const ext = path.extname(desiredName) || ".mp4";
  const stem = path.basename(desiredName, ext) || "woosh_sound_effects";
  let candidate = path.join(dir, `${stem}${ext}`);
  let index = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${stem}_${index}${ext}`);
    index += 1;
  }
  return candidate;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await readJsonBody(req);
    const jobId = String(body?.jobId || "").trim();
    const fileName = path.basename(String(body?.fileName || "woosh_sound_effects.mp4").trim());
    const titleRaw = String(body?.title || fileName || "woosh_sound_effects").trim();
    if (!jobId) return NextResponse.json({ ok: false, error: "missing jobId" }, { status: 400 });

    const { owner, sources } = await getGallerySourcesForRequest(req);
    const sourcePath = safeJoin(editVideoJobRoot(owner.ownerKey), jobId, fileName);
    if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
      return NextResponse.json({ ok: false, error: "source video not found" }, { status: 404 });
    }

    const targetSource = sources.find((source) => source.scope === "user") || sources[0];
    if (!targetSource) {
      return NextResponse.json({ ok: false, error: "gallery source not found" }, { status: 500 });
    }

    const desiredName = safeGalleryName(`${titleRaw.replace(/\.[a-z0-9]+$/i, "")}.mp4`);
    const targetPath = uniqueTargetPath(targetSource.dir, desiredName);
    await fsp.copyFile(sourcePath, targetPath);
    const stat = fs.statSync(targetPath);
    const savedName = path.basename(targetPath);

    const meta = writeMetaForFile(
      targetPath,
      {
        originalName: savedName,
        renamedName: savedName,
        sourceType: "edit-video-woosh-sfx",
        requestKind: "edit-video-woosh-sfx",
        mediaCategory: "edited-video",
        workflowId: "edit-video/woosh-sfx",
        workflowTitle: "Edit Video - Audio Editing - Sony Woosh Sound Effects",
        wooshSfx: {
          version: 1,
          operation: "video-to-sound-effects",
          videoName: String(body?.videoName || "Selected video"),
          prompt: String(body?.prompt || ""),
          model: String(body?.model || "vflow"),
          keepOriginalAudio: Boolean(body?.keepOriginalAudio),
          originalVolume: Number(body?.originalVolume || 0),
          sfxVolume: Number(body?.sfxVolume || 0),
          durationSeconds: Number(body?.durationSeconds || 0) || null,
          sizeBytes: Number(body?.sizeBytes || stat.size || 0) || stat.size,
        },
        submitPayload: {
          requestKind: "edit-video-woosh-sfx",
          sourceJobId: jobId,
          title: titleRaw,
          videoName: String(body?.videoName || "Selected video"),
          prompt: String(body?.prompt || ""),
          model: String(body?.model || "vflow"),
          keepOriginalAudio: Boolean(body?.keepOriginalAudio),
          originalVolume: Number(body?.originalVolume || 0),
          sfxVolume: Number(body?.sfxVolume || 0),
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
    });
  } catch (error: any) {
    if (error instanceof SessionInvalidError) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ ok: false, error: error?.message || "Save Sony Woosh result failed" }, { status: 500 });
  }
}
