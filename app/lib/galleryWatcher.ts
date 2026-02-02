import fs from "fs";
import path from "path";

/**
 * Gallery watcher (lightweight)
 * - Ensures base folders exist
 * - Does NOT need fs.watch; outputWatcher writes index.json
 */
let started = false;

function getDataDir() {
  return process.env.OTG_DATA_DIR
    ? path.resolve(process.env.OTG_DATA_DIR)
    : path.resolve(process.cwd(), "data");
}

export function ensureGalleryWatcher(deviceId = "local") {
  if (started) return;
  started = true;

  const dataDir = getDataDir();
  const galleryDir = path.join(dataDir, "gallery", deviceId);
  const filesDir = path.join(galleryDir, "files");
  const indexPath = path.join(galleryDir, "index.json");

  fs.mkdirSync(filesDir, { recursive: true });
  if (!fs.existsSync(indexPath)) {
    fs.writeFileSync(indexPath, "[]", "utf8");
  }
}
