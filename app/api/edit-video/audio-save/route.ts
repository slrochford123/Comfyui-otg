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
  const stem = path.basename(desiredName, ext) || "video_with_music";
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
    const body = await readJsonBody(req);
    const jobId = String(body?.jobId || "").trim();
    const fileName = path.basename(String(body?.fileName || "video_with_music.mp4").trim() || "video_with_music.mp4");
    const titleRaw = String(body?.title || "video_with_music").trim();

    if (!jobId) {
      return NextResponse.json({ ok: false, error: "missing jobId" }, { status: 400 });
    }

    const { owner, sources } = await getGallerySourcesForRequest(req);
    const jobRoot = editVideoJobRoot(owner.ownerKey);
    const sourcePath = safeJoin(jobRoot, jobId, fileName);
    if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
      return NextResponse.json({ ok: false, error: "audio-edited video not found" }, { status: 404 });
    }

    const targetSource = sources[0];
    const ext = path.extname(fileName).toLowerCase() || ".mp4";
    const safeTitle = safeGalleryName(titleRaw || "video_with_music") || "video_with_music";
    const targetPath = uniqueTargetPath(targetSource.dir, `${safeTitle}${ext}`);

    await fsp.copyFile(sourcePath, targetPath);
    const stat = fs.statSync(targetPath);
    const savedName = path.basename(targetPath);
    const meta = writeMetaForFile(
      targetPath,
      {
        originalName: savedName,
        renamedName: savedName,
        sourceType: "edit-video-audio-mix",
        requestKind: "edit-video-audio-mix",
        mediaCategory: "edited-video",
        workflowId: "edit-video/audio-mix",
        workflowTitle: "Edit Video - Audio Editing - Background Music",
        audioMix: {
          version: 1,
          operation: "background-music",
          videoName: String(body?.videoName || "Selected video"),
          musicName: String(body?.musicName || "Uploaded music"),
          keepOriginalAudio: Boolean(body?.keepOriginalAudio),
          videoVolume: Number(body?.videoVolume || 0),
          musicVolume: Number(body?.musicVolume || 0),
          loopMusic: Boolean(body?.loopMusic),
          durationSeconds: Number(body?.durationSeconds || 0) || null,
          sizeBytes: Number(body?.sizeBytes || stat.size || 0) || stat.size,
        },
        submitPayload: {
          requestKind: "edit-video-audio-mix",
          sourceJobId: jobId,
          title: titleRaw,
          videoName: String(body?.videoName || "Selected video"),
          musicName: String(body?.musicName || "Uploaded music"),
          keepOriginalAudio: Boolean(body?.keepOriginalAudio),
          videoVolume: Number(body?.videoVolume || 0),
          musicVolume: Number(body?.musicVolume || 0),
          loopMusic: Boolean(body?.loopMusic),
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
    return NextResponse.json({ ok: false, error: error?.message || "Save to Gallery failed" }, { status: 500 });
  }
}
