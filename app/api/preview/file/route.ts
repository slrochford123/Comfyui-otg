import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { getOwnerContext } from "@/lib/ownerKey";
import { getOwnerDirs, safeJoin } from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function buildEntityTag(stat: fs.Stats, full: string) {
  return `W/"${path.basename(full).replace(/[^A-Za-z0-9._-]/g, "_")}-${stat.size}-${Math.trunc(stat.mtimeMs)}"`;
}

function streamFile(full: string, start?: number, end?: number) {
  const stream = typeof start === "number" && typeof end === "number"
    ? fs.createReadStream(full, { start, end })
    : fs.createReadStream(full);
  return Readable.toWeb(stream as any) as any;
}

export async function GET(req: NextRequest) {
  const owner = await getOwnerContext(req as any);
  const dirs = getOwnerDirs(owner.ownerKey);

  const name = req.nextUrl.searchParams.get("name") || "";
  if (!name) return NextResponse.json({ ok: false, error: "missing name" }, { status: 400 });

  const full = safeJoin(dirs.preview, name);
  if (!full || !fs.existsSync(full)) {
    return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  }

  const ext = path.extname(full).toLowerCase();
  const mime =
    ext === ".png"
      ? "image/png"
      : ext === ".jpg" || ext === ".jpeg"
        ? "image/jpeg"
        : ext === ".webp"
          ? "image/webp"
          : ext === ".gif"
            ? "image/gif"
            : ext === ".mp4"
              ? "video/mp4"
              : ext === ".webm"
                ? "video/webm"
                : "application/octet-stream";

  const stat = fs.statSync(full);
  const size = stat.size || 0;
  const range = req.headers.get("range");
  const baseHeaders = {
    "Content-Type": mime,
    "Content-Length": String(size),
    "Last-Modified": new Date(stat.mtimeMs).toUTCString(),
    ETag: buildEntityTag(stat, full),
    "Accept-Ranges": mime.startsWith("video/") ? "bytes" : "none",
    "Cache-Control": "private, no-transform, max-age=86400, stale-while-revalidate=604800",
    "X-Content-Type-Options": "nosniff",
  };

  if (range && mime.startsWith("video/")) {
    const m = /^bytes=(\d+)-(\d*)$/i.exec(range);
    if (!m) {
      return new NextResponse(null, {
        status: 416,
        headers: {
          ...baseHeaders,
          "Content-Range": `bytes */${size}`,
          "Accept-Ranges": "bytes",
          "Content-Length": "0",
        },
      });
    }

    const start = parseInt(m[1], 10);
    const requestedEnd = m[2] ? parseInt(m[2], 10) : Math.min(start + 1024 * 1024 - 1, size - 1);

    if (!Number.isFinite(start) || start < 0 || start >= size) {
      return new NextResponse(null, {
        status: 416,
        headers: {
          ...baseHeaders,
          "Content-Range": `bytes */${size}`,
          "Accept-Ranges": "bytes",
          "Content-Length": "0",
        },
      });
    }

    const end = Math.min(Math.max(start, requestedEnd), size - 1);
    const chunkSize = end - start + 1;
    return new NextResponse(streamFile(full, start, end), {
      status: 206,
      headers: {
        ...baseHeaders,
        "Content-Length": String(chunkSize),
        "Content-Range": `bytes ${start}-${end}/${size}`,
        "Accept-Ranges": "bytes",
      },
    });
  }

  return new NextResponse(streamFile(full), { headers: baseHeaders });
}
