import chokidar from "chokidar";
import type { FSWatcher } from "chokidar";
import path from "node:path";
import fs from "node:fs";
import { deviceGalleryDir } from "@/lib/paths";

let watcher: FSWatcher | null = null;
let startedForDeviceId: string | null = null;

// Output watcher is OFF by default.
//
// Why:
// - ComfyUI can write multiple files per single job (batch size > 1, multi-output graphs).
// - Blindly copying every created file into the Gallery makes the UI look "duplicated".
//
// Preferred OTG flow for "one job -> one output":
// - Studio polls POST /api/gallery/sync while a job is running.
// - When complete, OTG fetches the single canonical output from ComfyUI history/view.
//
// If you *really* want filesystem watching (advanced / debugging), enable it explicitly:
//   OTG_ENABLE_OUTPUT_WATCHER=1
// and OTG will still debounce rapid bursts to avoid duplicates.

let lastCopyAtMs = 0;

function ensureDir(p: string) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function isMediaFile(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  return [".png", ".jpg", ".jpeg", ".webp", ".gif", ".mp4", ".webm", ".mov"].includes(ext);
}

function safeCopy(src: string, dstDir: string) {
  ensureDir(dstDir);
  const base = path.basename(src);
  const dst = path.join(dstDir, base);

  // Avoid copying if already present (same size)
  try {
    if (fs.existsSync(dst)) {
      const a = fs.statSync(src);
      const b = fs.statSync(dst);
      if (a.size === b.size) return;
    }
  } catch {
    // ignore
  }

  fs.copyFileSync(src, dst);
}

/**
 * Watches COMFY_OUTPUT_DIR (recursively) and copies newly created media files
 * into OTG's device gallery folder for the given deviceId.
 */
export function ensureOutputWatcherStarted(deviceId: string) {
  const outputDir = process.env.COMFY_OUTPUT_DIR;
  if (!outputDir) return;

  // Explicit opt-in only.
  if (String(process.env.OTG_ENABLE_OUTPUT_WATCHER || "").trim() !== "1") return;

  // If watcher is already running for this deviceId, do nothing.
  if (watcher && startedForDeviceId === deviceId) return;

  // If watcher exists but for a different deviceId, restart it.
  if (watcher) {
    try {
      watcher.close();
    } catch {
      // ignore
    }
    watcher = null;
    startedForDeviceId = null;
  }

  const destDir = deviceGalleryDir(deviceId);
  ensureDir(destDir);

  watcher = chokidar.watch(outputDir, {
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 700,
      pollInterval: 100,
    },
  });

  const onFile = (filePath: string) => {
    try {
      if (!isMediaFile(filePath)) return;

      // Debounce: ComfyUI can emit many files very quickly for a single run.
      // Keep the first file of a burst and ignore the rest.
      const now = Date.now();
      if (now - lastCopyAtMs < 2500) return;

      safeCopy(filePath, destDir);
      lastCopyAtMs = now;
    } catch (e) {
      console.error("[outputWatcher] copy failed:", e);
    }
  };

  watcher.on("add", onFile);
  watcher.on("change", onFile);
  watcher.on("error", (err) => console.error("[outputWatcher] watcher error:", err));

  startedForDeviceId = deviceId;
}
