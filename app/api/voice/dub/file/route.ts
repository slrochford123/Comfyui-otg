import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";

import { NextRequest, NextResponse } from "next/server";

import { getOwnerContext, SessionInvalidError } from "@/lib/ownerKey";
import { OTG_DATA_ROOT, safeJoin, safeSegment } from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function ownerJobRoot(ownerKey: string) {
  return path.join(OTG_DATA_ROOT, "voice_dub_jobs", safeSegment(ownerKey || "local"));
}

function contentType(name: string) {
  const ext = path.extname(name).toLowerCase();
  if (ext === ".mp3") return "audio/mpeg";
  if (ext === ".m4a") return "audio/mp4";
  if (ext === ".ogg") return "audio/ogg";
  if (ext === ".flac") return "audio/flac";
  return "audio/wav";
}

export async function GET(req: NextRequest) {
  try {
    const owner = await getOwnerContext(req);
    const jobId = String(req.nextUrl.searchParams.get("jobId") || "").trim();
    const name = path.basename(String(req.nextUrl.searchParams.get("name") || "voice_dub.wav"));
    const download = req.nextUrl.searchParams.get("download") === "1";
    if (!jobId) return NextResponse.json({ ok: false, error: "missing jobId" }, { status: 400 });

    const full = safeJoin(ownerJobRoot(owner.ownerKey), jobId, name);
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
      return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
    }

    const stat = fs.statSync(full);
    const size = stat.size || 0;
    const range = req.headers.get("range");
    const baseHeaders = {
      "Content-Type": contentType(name),
      "Cache-Control": "private, no-cache",
      "Accept-Ranges": "bytes",
      "Last-Modified": new Date(stat.mtimeMs).toUTCString(),
      ...(download ? { "Content-Disposition": `attachment; filename="${name}"` } : {}),
    };

    if (range) {
      const match = /^bytes=(\d+)-(\d*)$/i.exec(range);
      if (!match) return new NextResponse(null, { status: 416, headers: { ...baseHeaders, "Content-Range": `bytes */${size}` } });
      const start = parseInt(match[1], 10);
      const requestedEnd = match[2] ? parseInt(match[2], 10) : Math.min(start + 1024 * 1024 - 1, size - 1);
      if (!Number.isFinite(start) || start < 0 || start >= size) {
        return new NextResponse(null, { status: 416, headers: { ...baseHeaders, "Content-Range": `bytes */${size}` } });
      }
      const end = Math.min(Math.max(start, requestedEnd), size - 1);
      const stream = fs.createReadStream(full, { start, end });
      return new NextResponse(Readable.toWeb(stream as any) as any, {
        status: 206,
        headers: { ...baseHeaders, "Content-Length": String(end - start + 1), "Content-Range": `bytes ${start}-${end}/${size}` },
      });
    }

    const stream = fs.createReadStream(full);
    return new NextResponse(Readable.toWeb(stream as any) as any, { status: 200, headers: { ...baseHeaders, "Content-Length": String(size) } });
  } catch (error: any) {
    if (error instanceof SessionInvalidError) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ ok: false, error: error?.message || "Audio file read failed" }, { status: 500 });
  }
}
