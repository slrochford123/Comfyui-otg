import path from "node:path";
import fs from "node:fs";
import { getDeviceGalleriesRoot } from "@/lib/paths";

export const runtime = "nodejs";

function safeExists(p: string) {
  try {
    return !!p && fs.existsSync(p);
  } catch {
    return false;
  }
}

function isMediaFile(p: string) {
  const ext = path.extname(p).toLowerCase();
  return [".png", ".jpg", ".jpeg", ".webp", ".gif", ".mp4", ".webm", ".mov"].includes(ext);
}

function listMediaFilesRecursive(dir: string, out: string[] = []): string[] {
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }

  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      listMediaFilesRecursive(full, out);
    } else if (e.isFile() && isMediaFile(full)) {
      out.push(full);
    }
  }
  return out;
}

export async function GET() {
  // IMPORTANT: This endpoint must not depend on deviceId.
  // The output watcher is started per-device when /api/comfy submits a job.

  const outputDir = process.env.COMFY_OUTPUT_DIR || "";
  const outputDirExists = safeExists(outputDir);

  const galleriesRoot = getDeviceGalleriesRoot();
  const galleriesRootExists = safeExists(galleriesRoot);

  const localGalleryDir = path.join(galleriesRoot, "local");
  const localGalleryExists = safeExists(localGalleryDir);

  const localMediaFiles = localGalleryExists ? listMediaFilesRecursive(localGalleryDir) : [];

  return Response.json({
    ok: true,
    runtime,
    OTG_DATA_DIR: process.env.OTG_DATA_DIR || null,
    COMFY_BASE_URL: process.env.COMFY_BASE_URL || process.env.COMFY_URL || null,
    COMFY_OUTPUT_DIR: outputDir || null,
    COMFY_OUTPUT_DIR_exists: outputDirExists,
    galleryRoot: galleriesRoot,
    galleryRoot_exists: galleriesRootExists,
    localGalleryDir,
    localGalleryDir_exists: localGalleryExists,
    localFiles_count: localMediaFiles.length,
    localFiles_latest: localMediaFiles
      .map((p) => {
        try {
          const st = fs.statSync(p);
          return { p, mtimeMs: st.mtimeMs, size: st.size };
        } catch {
          return { p, mtimeMs: 0, size: 0 };
        }
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
      .slice(0, 5),
  });
}
