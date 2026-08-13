import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

import { getGallerySourcesForRequest, safeGalleryName, writeMetaForFile } from "@/lib/gallery";
import { SessionInvalidError } from "@/lib/ownerKey";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

function cleanTitle(value: unknown, fallback = "final_assembly") {
  return String(value || fallback)
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]+/g, "_")
    .replace(/\s+/g, " ")
    .slice(0, 120)
    .trim() || fallback;
}

function uniqueTargetPath(dir: string, desiredName: string) {
  const ext = path.extname(desiredName) || ".mp4";
  const stem = path.basename(desiredName, ext) || "final_assembly";
  let candidate = path.join(dir, `${stem}${ext}`);
  let index = 2;

  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${stem}_${index}${ext}`);
    index += 1;
  }

  return candidate;
}

function isSupportedVideo(filePath: string) {
  return /\.(mp4|mov|m4v|webm)$/i.test(filePath);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await readJsonBody(req);
    const sourcePath = String(body?.videoPath || body?.assembledVideoPath || "").trim();
    const titleRaw = cleanTitle(body?.title || body?.sceneTitle || "final_assembly");

    if (!sourcePath || !path.isAbsolute(sourcePath)) {
      return NextResponse.json({ ok: false, error: "Missing absolute assembled video path." }, { status: 400 });
    }

    if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
      return NextResponse.json({ ok: false, error: "Assembled video file was not found." }, { status: 404 });
    }

    if (!isSupportedVideo(sourcePath)) {
      return NextResponse.json({ ok: false, error: "Only mp4, mov, m4v, and webm files can be added to Gallery." }, { status: 400 });
    }

    const { owner, sources } = await getGallerySourcesForRequest(req);
    const targetSource = sources.find((source) => source.scope === "user") || sources[0];
    if (!targetSource) {
      return NextResponse.json({ ok: false, error: "Gallery source not found." }, { status: 500 });
    }

    const desiredName = safeGalleryName(`${titleRaw.replace(/\.[a-z0-9]+$/i, "")}.mp4`);
    const targetPath = uniqueTargetPath(targetSource.dir, desiredName);

    await fsp.copyFile(sourcePath, targetPath);

    const stat = fs.statSync(targetPath);
    const savedName = path.basename(targetPath);
    const now = Date.now();

    const meta = writeMetaForFile(
      targetPath,
      {
        originalName: savedName,
        renamedName: savedName,
        sourceType: "production-assembly-final",
        requestKind: "production-assembly-add-to-gallery",
        mediaCategory: "edited-video",
        workflowId: "production/assembly",
        workflowTitle: "Production Assembly Final",
        submitPayload: {
          requestKind: "production-assembly-add-to-gallery",
          title: titleRaw,
          sceneId: String(body?.sceneId || ""),
          sceneTitle: String(body?.sceneTitle || titleRaw),
          sourceType: "production-assembly-final",
          sourceVideoPath: sourcePath,
          sourceVideoUrl: String(body?.videoUrl || body?.assembledVideoUrl || ""),
          videoPath: sourcePath,
          videoUrl: String(body?.videoUrl || body?.assembledVideoUrl || ""),
          exportPreset: String(body?.exportPreset || ""),
          hasBackgroundMusic: Boolean(body?.backgroundMusic),
          backgroundMusic: body?.backgroundMusic || null,
          sizeBytes: Number(stat.size || 0),
        },
        ownerKey: targetSource.ownerKey || owner.ownerKey,
        username: targetSource.username,
        deviceId: targetSource.deviceId,
        createdAt: stat.birthtimeMs || stat.mtimeMs || now,
        updatedAt: now,
      },
      targetSource,
    );

    return NextResponse.json({
      ok: true,
      fileName: savedName,
      name: savedName,
      source: targetSource.scope,
      url: `/api/gallery/file?name=${encodeURIComponent(savedName)}&scope=${targetSource.scope}`,
      galleryUrl: `/api/gallery/file?name=${encodeURIComponent(savedName)}&scope=${targetSource.scope}`,
      meta,
    });
  } catch (error: any) {
    if (error instanceof SessionInvalidError) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    return NextResponse.json(
      { ok: false, error: error?.message || "Add Assembly video to Gallery failed." },
      { status: 500 },
    );
  }
}
