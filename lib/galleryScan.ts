import fs from "node:fs";
import path from "node:path";

export type GalleryItem = {
  id: string;
  filename: string;
  mtimeMs: number;
  size: number;
  url: string; // served via /api/gallery/file
};

const IMG_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tiff", ".tif"]);
const VID_EXT = new Set([".mp4", ".webm", ".mov", ".mkv", ".avi"]);

export function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

function isMedia(file: string) {
  const ext = path.extname(file).toLowerCase();
  return IMG_EXT.has(ext) || VID_EXT.has(ext);
}

export function listGalleryItems(deviceId: string, dir: string, limit = 200): GalleryItem[] {
  if (!fs.existsSync(dir)) return [];

  const files = fs.readdirSync(dir);
  const items: GalleryItem[] = [];

  for (const f of files) {
    const full = path.join(dir, f);
    try {
      const st = fs.statSync(full);
      if (!st.isFile()) continue;
      if (!isMedia(f)) continue;

      items.push({
        id: f,
        filename: f,
        mtimeMs: st.mtimeMs,
        size: st.size,
        // NOTE: the file route expects `name=`. Keep `filename` on the
        // object for convenience, but generate a URL that works.
        url: `/api/gallery/file?deviceId=${encodeURIComponent(deviceId)}&name=${encodeURIComponent(f)}`
      });
    } catch {
      // ignore
    }
  }

  items.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return items.slice(0, limit);
}
