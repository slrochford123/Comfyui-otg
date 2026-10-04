import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { mediaFileResponse, contentTypeForMedia } from "@/lib/mediaResponse";
import { getOwnerContext, SessionInvalidError } from "@/lib/ownerKey";
import { OTG_DATA_ROOT, deviceGalleryDir, getOwnerDirs, safeSegment, userGalleryDir } from "@/lib/paths";

function sanitizeFilename(name: string) {
  const trimmed = String(name || "").trim();
  const fallback = "download.bin";
  const base = trimmed || fallback;
  return base.replace(/[\r\n\\/:*?"<>|]+/g, "_");
}

function isInsideRoot(root: string, candidate: string) {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  const relative = path.relative(resolvedRoot, resolvedCandidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function ownerAllowedRoots(owner: Awaited<ReturnType<typeof getOwnerContext>>) {
  const ownerSafe = safeSegment(owner.ownerKey || "local");
  const roots = [
    getOwnerDirs(owner.ownerKey).inbox,
    getOwnerDirs(owner.ownerKey).gallery,
    getOwnerDirs(owner.ownerKey).preview,
    owner.username ? userGalleryDir(owner.username) : deviceGalleryDir(owner.deviceId),
    path.join(OTG_DATA_ROOT, "assets", ownerSafe),
    path.join(OTG_DATA_ROOT, "backgrounds", ownerSafe),
    path.join(OTG_DATA_ROOT, "characters", ownerSafe),
    path.join(OTG_DATA_ROOT, "edit-video", ownerSafe),
    path.join(OTG_DATA_ROOT, "edit_video", "music", ownerSafe),
    path.join(OTG_DATA_ROOT, "edit_video_jobs", ownerSafe),
    path.join(OTG_DATA_ROOT, "edit_video_dub_voice_jobs", ownerSafe),
    path.join(OTG_DATA_ROOT, "extract_audio_jobs", ownerSafe),
    path.join(OTG_DATA_ROOT, "h3-direct", ownerSafe),
    path.join(OTG_DATA_ROOT, "production_storyboard_sync", ownerSafe),
    path.join(OTG_DATA_ROOT, "productions", ownerSafe),
    path.join(OTG_DATA_ROOT, "productions-v2", ownerSafe),
    path.join(OTG_DATA_ROOT, "uploads", "characters", ownerSafe),
    path.join(OTG_DATA_ROOT, "uploads", "voices", ownerSafe),
    path.join(OTG_DATA_ROOT, "voice_dub_jobs", ownerSafe),
    path.join(OTG_DATA_ROOT, "voice_gallery", ownerSafe),
    path.join(OTG_DATA_ROOT, "voice_tts_jobs", ownerSafe),
    path.join(OTG_DATA_ROOT, "voices", "users", ownerSafe),
    path.join(OTG_DATA_ROOT, "worker-artifacts", ownerSafe),
  ];

  return Array.from(new Set(roots.map((root) => path.resolve(root))));
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const requestedPath = url.searchParams.get("path");

    if (!requestedPath) {
      return NextResponse.json({ ok: false, error: "Missing path" }, { status: 400 });
    }

    const resolved = path.resolve(requestedPath);
    const owner = await getOwnerContext(req);
    const allowed = ownerAllowedRoots(owner).some((root) => isInsideRoot(root, resolved));

    if (!allowed) {
      return NextResponse.json(
        { ok: false, error: "Forbidden", detail: { resolved } },
        { status: 403 }
      );
    }

    if (!fs.existsSync(resolved)) {
      return NextResponse.json({ ok: false, error: "File not found" }, { status: 404 });
    }

    const stat = fs.statSync(resolved);
    if (!stat.isFile()) {
      return NextResponse.json({ ok: false, error: "Not a file" }, { status: 400 });
    }

    const fileName = sanitizeFilename(path.basename(resolved));
    return mediaFileResponse(req, resolved, {
      fileName,
      contentType: contentTypeForMedia(resolved),
    });
  } catch (err: any) {
    if (err instanceof SessionInvalidError) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json(
      { ok: false, error: err?.message || "Unknown error" },
      { status: 500 }
    );
  }
}
