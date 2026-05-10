import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { getOwnerContext, SessionInvalidError } from "@/lib/ownerKey";
import { OTG_DATA_ROOT, safeJoin, safeSegment } from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function editVideoJobRoot(ownerKey: string) {
  return path.join(OTG_DATA_ROOT, "edit_video_jobs", safeSegment(ownerKey || "local"));
}

function buildHeaders(args: { size: number; full: string; stat: fs.Stats; download: boolean }) {
  const etag = `W/\"${path.basename(args.full)}-${args.size}-${Math.trunc(args.stat.mtimeMs)}\"`;
  return {
    "Content-Type": "video/mp4",
    "Content-Length": String(args.size),
    "Cache-Control": "private, no-cache",
    "Last-Modified": new Date(args.stat.mtimeMs).toUTCString(),
    ETag: etag,
    "Accept-Ranges": "bytes",
    ...(args.download ? { "Content-Disposition": `attachment; filename=\"${path.basename(args.full)}\"` } : {}),
  };
}

export async function GET(req: NextRequest) {
  try {
    const owner = await getOwnerContext(req);
    const jobId = String(req.nextUrl.searchParams.get("jobId") || "").trim();
    const name = String(req.nextUrl.searchParams.get("name") || "stitched_video.mp4").trim();
    const download = req.nextUrl.searchParams.get("download") === "1";

    if (!jobId) {
      return NextResponse.json({ ok: false, error: "missing jobId" }, { status: 400 });
    }

    const jobRoot = editVideoJobRoot(owner.ownerKey);
    const full = safeJoin(jobRoot, jobId, path.basename(name));
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
      return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
    }

    const stat = fs.statSync(full);
    const size = stat.size || 0;
    const headers = buildHeaders({ size, full, stat, download });
    const range = req.headers.get("range");

    if (range) {
      const match = /^bytes=(\d+)-(\d*)$/i.exec(range);
      if (!match) {
        return new NextResponse(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${size}` } });
      }
      const start = parseInt(match[1], 10);
      const requestedEnd = match[2] ? parseInt(match[2], 10) : Math.min(start + 1024 * 1024 - 1, size - 1);
      if (!Number.isFinite(start) || start < 0 || start >= size) {
        return new NextResponse(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${size}` } });
      }
      const end = Math.min(Math.max(start, requestedEnd), size - 1);
      const stream = fs.createReadStream(full, { start, end });
      return new NextResponse(Readable.toWeb(stream as any) as any, {
        status: 206,
        headers: {
          ...headers,
          "Content-Length": String(end - start + 1),
          "Content-Range": `bytes ${start}-${end}/${size}`,
        },
      });
    }

    // OTG_DOWNLOAD_STABILITY: stream full-file downloads instead of buffering the entire video in memory.
    const fullStream = fs.createReadStream(full);
    return new NextResponse(Readable.toWeb(fullStream as any) as any, { status: 200, headers });
  } catch (error: any) {
    if (error instanceof SessionInvalidError) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ ok: false, error: error?.message || "File read failed" }, { status: 500 });
  }
}
