
import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

import { getGallerySourcesForRequest, safeGalleryName, writeMetaForFile } from "@/lib/gallery";
import { warmGalleryThumb } from "@/lib/galleryThumbs";
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
  const stem = path.basename(desiredName, ext) || "ltx_edit_anything";
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
    const fileName = path.basename(String(body?.fileName || "ltx_edit_anything.mp4").trim() || "ltx_edit_anything.mp4");
    const titleRaw = String(body?.title || "ltx_edit_anything").trim();

    if (!jobId) return NextResponse.json({ ok: false, error: "missing jobId" }, { status: 400 });

    const { owner, sources } = await getGallerySourcesForRequest(req);
    const jobRoot = editVideoJobRoot(owner.ownerKey);
    const sourcePath = safeJoin(jobRoot, jobId, fileName);
    if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
      return NextResponse.json({ ok: false, error: "edited video not found" }, { status: 404 });
    }

    const targetSource = sources[0];
    const ext = path.extname(fileName).toLowerCase() || ".mp4";
    const safeTitle = safeGalleryName(titleRaw || "ltx_edit_anything") || "ltx_edit_anything";
    const targetPath = uniqueTargetPath(targetSource.dir, `${safeTitle}${ext}`);
    const task = String(body?.task || "add");
    const useVideoReasoning = Boolean(body?.useVideoReasoning);
    const isObscura = task === "obscura_remova";

    await fsp.copyFile(sourcePath, targetPath);
    warmGalleryThumb(targetPath, 768);
    warmGalleryThumb(targetPath, 512);
    const stat = fs.statSync(targetPath);
    const savedName = path.basename(targetPath);
    const meta = writeMetaForFile(
      targetPath,
      {
        originalName: savedName,
        renamedName: savedName,
        sourceType: isObscura ? "edit-video-obscura-remova" : "edit-video-ltx-edit-anything",
        requestKind: isObscura ? "edit-video-obscura-remova" : "edit-video-ltx-edit-anything",
        workflowId: isObscura ? "internal/edit-video/ltx23_edit_anything+obscura_remova" : "internal/edit-video/ltx23_edit_anything",
        workflowTitle: isObscura ? "Edit Video - Obscura Remova" : "Edit Video - LTX 2.3 Edit Anything",
        editVideo: {
          version: 1,
          operation: isObscura ? "obscura-remova" : "ltx-edit-anything",
          task,
          useVideoReasoning,
          obscuraStrength: isObscura ? body?.obscuraStrength ?? null : null,
        },
        submitPayload: {
          requestKind: isObscura ? "edit-video-obscura-remova" : "edit-video-ltx-edit-anything",
          sourceJobId: jobId,
          title: titleRaw,
          sourceVideoName: body?.sourceVideoName || "Selected video",
          task,
          instruction: body?.instruction || "",
          negativePrompt: body?.negativePrompt || "",
          durationSeconds: body?.durationSeconds || null,
          fps: body?.fps || null,
          longerSide: body?.longerSide || null,
          useVideoReasoning,
          obscuraStrength: isObscura ? body?.obscuraStrength ?? null : null,
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
