import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { resolveFfmpegPath } from "@/lib/ffmpeg";
import { mediaFileResponse } from "@/lib/mediaResponse";
import { ensureDir, OTG_DATA_ROOT, safeSegment } from "@/lib/paths";

function cachedThumbnailPath(inputPath: string, namespace: string) {
  const stat = fs.statSync(inputPath);
  const key = crypto
    .createHash("sha1")
    .update(`${inputPath}|${stat.mtimeMs}|${stat.size}|768`)
    .digest("hex");
  const directory = path.join(
    OTG_DATA_ROOT,
    "thumbs",
    safeSegment(namespace),
  );
  ensureDir(directory);
  return path.join(directory, `${key}.webp`);
}

export function videoThumbnailResponse(
  req: NextRequest,
  inputPath: string,
  options: { namespace: string; method?: "GET" | "HEAD" },
) {
  const thumbnailPath = cachedThumbnailPath(inputPath, options.namespace);
  if (!fs.existsSync(thumbnailPath)) {
    const temporaryPath = `${thumbnailPath}.${process.pid}-${crypto.randomUUID()}.tmp.webp`;
    try {
      const result = spawnSync(
        resolveFfmpegPath(),
        [
          "-y",
          "-hide_banner",
          "-loglevel",
          "error",
          "-ss",
          "0.5",
          "-i",
          inputPath,
          "-vframes",
          "1",
          "-vf",
          "scale=768:-2:flags=lanczos",
          "-c:v",
          "libwebp",
          "-quality",
          "78",
          temporaryPath,
        ],
        { windowsHide: true },
      );
      if (result.status !== 0 || !fs.existsSync(temporaryPath)) {
        return NextResponse.json(
          { ok: false, error: "Could not create the video thumbnail." },
          { status: 500 },
        );
      }
      fs.renameSync(temporaryPath, thumbnailPath);
    } finally {
      fs.rmSync(temporaryPath, { force: true });
    }
  }

  return mediaFileResponse(req, thumbnailPath, {
    method: options.method,
    contentType: "image/webp",
    cacheControl: "private, max-age=31536000, immutable",
  });
}
