import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

import { ensureDir, OTG_DATA_ROOT } from "@/lib/paths";
import { resolveFfmpegPath } from "@/lib/ffmpeg";

function isVideoPath(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  return ext === ".mp4" || ext === ".webm" || ext === ".mov" || ext === ".mkv";
}

function sha1(input: string) {
  return crypto.createHash("sha1").update(input).digest("hex");
}

export function galleryThumbPath(inputAbs: string, width: number) {
  const st = fs.statSync(inputAbs);
  const cacheDir = path.join(OTG_DATA_ROOT, "thumbs");
  ensureDir(cacheDir);
  const key = `${inputAbs}|${st.mtimeMs}|${st.size}|${width}`;
  return path.join(cacheDir, `${sha1(key)}.webp`);
}

export function warmGalleryThumb(inputAbs: string, width = 768) {
  try {
    if (!fs.existsSync(inputAbs) || !fs.statSync(inputAbs).isFile()) return;
    const outputAbs = galleryThumbPath(inputAbs, width);
    if (fs.existsSync(outputAbs)) return;

    const ffmpeg = resolveFfmpegPath();
    const args = [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      ...(isVideoPath(inputAbs) ? ["-ss", "0.5"] : []),
      "-i",
      inputAbs,
      "-vframes",
      "1",
      "-vf",
      `scale=${width}:-2:flags=lanczos`,
      "-c:v",
      "libwebp",
      "-quality",
      "75",
      outputAbs,
    ];

    const child = spawn(ffmpeg, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
  } catch {
    // Thumbnail warmup is best-effort and must never block saves.
  }
}
