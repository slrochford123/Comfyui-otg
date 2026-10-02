import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";

import { NextRequest, NextResponse } from "next/server";

import { requireAdmin } from "@/app/api/admin/_requireAdmin";
import {
  adminGallerySourceById,
  fetchRemoteAdminGalleryFile,
  isAdminGallerySourceId,
  mediaKindForName,
  normalizeAdminGalleryRelPath,
  resolveLocalAdminGalleryFile,
} from "@/lib/adminGallerySources";
import { resolveFfmpegPath, runCmd } from "@/lib/ffmpeg";
import { mediaFileResponse } from "@/lib/mediaResponse";
import { ensureDir, OTG_DATA_ROOT } from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const THUMBNAIL_WIDTH = 768;

export async function GET(request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) return NextResponse.json({ ok: false, error: admin.error }, { status: admin.status });

  const sourceId = request.nextUrl.searchParams.get("source") || "";
  const rel = normalizeAdminGalleryRelPath(request.nextUrl.searchParams.get("rel") || "");
  const version = String(request.nextUrl.searchParams.get("v") || "").slice(0, 80);
  if (!isAdminGallerySourceId(sourceId) || !rel || mediaKindForName(rel) !== "video") {
    return NextResponse.json({ ok: false, error: "Unknown source or invalid video path." }, { status: 400 });
  }

  const thumbnailDir = path.join(OTG_DATA_ROOT, "thumbs", "admin-gallery");
  ensureDir(thumbnailDir);
  const key = crypto
    .createHash("sha256")
    .update(`${sourceId}|${rel}|${version}|${THUMBNAIL_WIDTH}`)
    .digest("hex");
  const thumbnailPath = path.join(thumbnailDir, `${key}.webp`);

  try {
    if (!fs.existsSync(thumbnailPath)) {
      await createThumbnail(sourceId, rel, thumbnailDir, thumbnailPath);
    }
    return mediaFileResponse(request, thumbnailPath, {
      contentType: "image/webp",
      cacheControl: "private, max-age=31536000, immutable",
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Could not create the Admin Gallery thumbnail." },
      { status: 500 },
    );
  }
}

async function createThumbnail(
  sourceId: "comfy-3090" | "comfy-5060",
  rel: string,
  thumbnailDir: string,
  thumbnailPath: string,
) {
  const source = adminGallerySourceById(sourceId);
  const unique = crypto.randomUUID();
  const inputPath = source.kind === "local"
    ? (await resolveLocalAdminGalleryFile(sourceId, rel)).path
    : path.join(thumbnailDir, `${unique}${path.extname(rel).toLowerCase() || ".video"}`);
  const outputPath = path.join(thumbnailDir, `${unique}.webp`);
  const removeInput = source.kind === "remote-agent";

  try {
    if (removeInput) {
      const upstream = await fetchRemoteAdminGalleryFile(sourceId, rel);
      if (!upstream.body) throw new Error("Remote gallery video returned an empty body.");
      await pipeline(
        Readable.fromWeb(upstream.body as unknown as NodeReadableStream),
        fs.createWriteStream(inputPath, { flags: "wx" }),
      );
    }

    const result = await runCmd(
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
        `scale=${THUMBNAIL_WIDTH}:-2:flags=lanczos`,
        "-c:v",
        "libwebp",
        "-quality",
        "78",
        outputPath,
      ],
      { timeoutMs: 60_000 },
    );
    if (result.code !== 0 || !fs.existsSync(outputPath)) {
      throw new Error("Could not extract a frame from the Admin Gallery video.");
    }
    fs.renameSync(outputPath, thumbnailPath);
  } finally {
    if (removeInput) fs.rmSync(inputPath, { force: true });
    fs.rmSync(outputPath, { force: true });
  }
}
