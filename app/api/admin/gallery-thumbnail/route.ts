import { execFile } from "node:child_process";
import crypto from "node:crypto";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { NextRequest, NextResponse } from "next/server";

import { requireAdmin } from "@/app/api/admin/_requireAdmin";
import {
  adminGallerySourceById,
  fetchRemoteAdminGalleryFile,
  isAdminGallerySourceId,
  normalizeAdminGalleryRelPath,
  resolveLocalAdminGalleryFile,
} from "@/lib/adminGallerySources";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const execFileAsync = promisify(execFile);

const VIDEO_EXTENSIONS = new Set([".mp4", ".webm", ".mov", ".mkv"]);

const THUMBNAIL_CACHE_ROOT = path.join(
  os.tmpdir(),
  "otg-admin-gallery-thumbnail-cache"
);

const MAX_CONCURRENT_THUMBNAILS = 2;

let activeThumbnailJobs = 0;
const thumbnailWaiters: Array<() => void> = [];

async function withThumbnailSlot<T>(
  work: () => Promise<T>
): Promise<T> {
  if (activeThumbnailJobs >= MAX_CONCURRENT_THUMBNAILS) {
    await new Promise<void>((resolve) => {
      thumbnailWaiters.push(resolve);
    });
  }

  activeThumbnailJobs += 1;

  try {
    return await work();
  } finally {
    activeThumbnailJobs -= 1;
    thumbnailWaiters.shift()?.();
  }
}

async function existingThumbnail(filePath: string) {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
}

export async function GET(request: NextRequest) {
  const admin = await requireAdmin();

  if (!admin.ok) {
    return NextResponse.json(
      { ok: false, error: admin.error },
      { status: admin.status }
    );
  }

  const sourceId =
    request.nextUrl.searchParams.get("source") || "";

  const relValue =
    request.nextUrl.searchParams.get("rel") || "";

  const version =
    request.nextUrl.searchParams.get("v") || "";

  if (!isAdminGallerySourceId(sourceId)) {
    return NextResponse.json(
      {
        ok: false,
        error: "Unknown admin gallery source.",
      },
      { status: 400 }
    );
  }

  const rel = normalizeAdminGalleryRelPath(relValue);

  if (
    !rel ||
    !VIDEO_EXTENSIONS.has(
      path.extname(rel).toLowerCase()
    )
  ) {
    return NextResponse.json(
      {
        ok: false,
        error: "Invalid video gallery path.",
      },
      { status: 400 }
    );
  }

  const cacheKey = crypto
    .createHash("sha256")
    .update(`${sourceId}\0${rel}\0${version}`)
    .digest("hex");

  await fs.mkdir(
    THUMBNAIL_CACHE_ROOT,
    { recursive: true }
  );

  const cachePath = path.join(
    THUMBNAIL_CACHE_ROOT,
    `${cacheKey}.jpg`
  );

  try {
    if (!await existingThumbnail(cachePath)) {
      await withThumbnailSlot(async () => {
        if (await existingThumbnail(cachePath)) {
          return;
        }

        const unique =
          `${cacheKey}.${process.pid}.${Date.now()}`;

        const tempJpegPath = path.join(
          THUMBNAIL_CACHE_ROOT,
          `${unique}.tmp.jpg`
        );

        let temporaryVideoPath: string | null = null;

        try {
          const source =
            adminGallerySourceById(sourceId);

          let ffmpegInputPath: string;

          if (source.kind === "remote-agent") {
            const remote =
              await fetchRemoteAdminGalleryFile(
                sourceId,
                rel,
                { method: "GET" }
              );

            if (!remote.body) {
              throw new Error(
                "Remote gallery video returned no body."
              );
            }

            const extension =
              path.extname(rel).toLowerCase() || ".mp4";

            temporaryVideoPath = path.join(
              THUMBNAIL_CACHE_ROOT,
              `${unique}.input${extension}`
            );

            await pipeline(
              Readable.fromWeb(remote.body as any),
              createWriteStream(temporaryVideoPath)
            );

            ffmpegInputPath = temporaryVideoPath;
          } else {
            const resolved =
              await resolveLocalAdminGalleryFile(
                sourceId,
                rel
              );

            ffmpegInputPath = resolved.path;
          }

          await execFileAsync(
            process.env.FFMPEG_PATH || "ffmpeg",
            [
              "-hide_banner",
              "-loglevel",
              "error",
              "-ss",
              "0.10",
              "-i",
              ffmpegInputPath,
              "-frames:v",
              "1",
              "-vf",
              "scale='min(640,iw)':-2",
              "-q:v",
              "4",
              "-y",
              tempJpegPath,
            ],
            {
              timeout: 30_000,
              maxBuffer: 1024 * 1024,
            }
          );

          await fs.rename(
            tempJpegPath,
            cachePath
          );
        } finally {
          await fs.rm(
            tempJpegPath,
            { force: true }
          ).catch(() => {});

          if (temporaryVideoPath) {
            await fs.rm(
              temporaryVideoPath,
              { force: true }
            ).catch(() => {});
          }
        }
      });
    }

    const jpeg = await fs.readFile(cachePath);

    return new NextResponse(
      new Uint8Array(jpeg),
      {
        status: 200,
        headers: {
          "Content-Type": "image/jpeg",
          "Content-Length":
            String(jpeg.byteLength),
          "Cache-Control":
            "private, max-age=3600",
          "X-Content-Type-Options":
            "nosniff",
        },
      }
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unable to generate video thumbnail.";

    return NextResponse.json(
      { ok: false, error: message },
      { status: 404 }
    );
  }
}
