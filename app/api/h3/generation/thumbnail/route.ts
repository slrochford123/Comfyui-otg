import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { resolveFfmpegPath } from "@/lib/ffmpeg";
import { getH3DirectJob } from "@/lib/h3DirectJobs";
import { mediaFileResponse } from "@/lib/mediaResponse";
import { getOwnerContext, SessionInvalidError } from "@/lib/ownerKey";
import { ensureDir, OTG_DATA_ROOT } from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function thumbnailPathFor(inputPath: string) {
  const stat = fs.statSync(inputPath);
  const key = crypto
    .createHash("sha1")
    .update(`${inputPath}|${stat.mtimeMs}|${stat.size}|768`)
    .digest("hex");
  const thumbnailDir = path.join(OTG_DATA_ROOT, "thumbs", "h3-direct");
  ensureDir(thumbnailDir);
  return path.join(thumbnailDir, `${key}.webp`);
}

export async function GET(req: NextRequest) {
  try {
    const { ownerKey } = await getOwnerContext(req);
    const jobId = String(req.nextUrl.searchParams.get("jobId") || "").trim();
    const job = jobId ? await getH3DirectJob(ownerKey, jobId) : null;
    if (!job?.outputPath || job.status !== "completed") {
      return NextResponse.json({ ok: false, error: "Generated H3 video not found." }, { status: 404 });
    }

    const resolved = path.resolve(job.outputPath);
    const allowedRoot = path.resolve(OTG_DATA_ROOT);
    if (resolved !== allowedRoot && !resolved.startsWith(`${allowedRoot}${path.sep}`)) {
      return NextResponse.json({ ok: false, error: "Generated H3 video path is outside the data root." }, { status: 403 });
    }

    const thumbnailPath = thumbnailPathFor(resolved);
    if (!fs.existsSync(thumbnailPath)) {
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
          resolved,
          "-vframes",
          "1",
          "-vf",
          "scale=768:-2:flags=lanczos",
          "-c:v",
          "libwebp",
          "-quality",
          "78",
          thumbnailPath,
        ],
        { windowsHide: true },
      );
      if (result.status !== 0 || !fs.existsSync(thumbnailPath)) {
        fs.rmSync(thumbnailPath, { force: true });
        return NextResponse.json({ ok: false, error: "Could not create the H3 thumbnail." }, { status: 500 });
      }
    }

    return mediaFileResponse(req, thumbnailPath, {
      contentType: "image/webp",
      cacheControl: "private, max-age=31536000, immutable",
    });
  } catch (error) {
    if (error instanceof SessionInvalidError) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Could not read the H3 thumbnail." },
      { status: 500 },
    );
  }
}
