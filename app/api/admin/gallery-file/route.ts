import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { NextRequest, NextResponse } from "next/server";

import { requireAdmin } from "@/app/api/admin/_requireAdmin";
import {
  adminGallerySourceById,
  contentTypeForAdminGalleryPath,
  deleteAdminGalleryFile,
  fetchRemoteAdminGalleryFile,
  isAdminGallerySourceId,
  resolveLocalAdminGalleryFile,
} from "@/lib/adminGallerySources";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: NextRequest) {
  return serve(request, false);
}

export async function HEAD(request: NextRequest) {
  return serve(request, true);
}

export async function DELETE(request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) return NextResponse.json({ ok: false, error: admin.error }, { status: admin.status });
  const sourceId = request.nextUrl.searchParams.get("source") || "";
  const rel = request.nextUrl.searchParams.get("rel") || "";
  if (!isAdminGallerySourceId(sourceId)) {
    return NextResponse.json({ ok: false, error: "Unknown admin gallery source." }, { status: 400 });
  }
  try {
    await deleteAdminGalleryFile(sourceId, rel);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to delete Admin Full Gallery file.";
    return NextResponse.json({ ok: false, error: message }, { status: 404 });
  }
}

async function serve(request: NextRequest, headOnly: boolean) {
  const admin = await requireAdmin();
  if (!admin.ok) return NextResponse.json({ ok: false, error: admin.error }, { status: admin.status });
  const sourceId = request.nextUrl.searchParams.get("source") || "";
  const rel = request.nextUrl.searchParams.get("rel") || "";
  if (!isAdminGallerySourceId(sourceId)) {
    return NextResponse.json({ ok: false, error: "Unknown admin gallery source." }, { status: 400 });
  }

  try {
    const source = adminGallerySourceById(sourceId);
    if (source.kind === "remote-agent") {
      const upstream = await fetchRemoteAdminGalleryFile(sourceId, rel, {
        method: headOnly ? "HEAD" : "GET",
        range: request.headers.get("range"),
      });
      const headers = proxyHeaders(upstream.headers, rel, request.nextUrl.searchParams.get("download") === "1");
      return new NextResponse(headOnly ? null : upstream.body, { status: upstream.status, headers });
    }

    const resolved = await resolveLocalAdminGalleryFile(sourceId, rel);
    const range = parseSingleRange(request.headers.get("range"), resolved.stat.size);
    if (range === "invalid") {
      return new NextResponse(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${resolved.stat.size}`, "Accept-Ranges": "bytes" },
      });
    }
    const start = range?.start ?? 0;
    const end = range?.end ?? resolved.stat.size - 1;
    const headers = localHeaders({
      contentType: contentTypeForAdminGalleryPath(resolved.path),
      fileName: path.basename(resolved.path),
      fileSize: resolved.stat.size,
      start,
      end,
      partial: Boolean(range),
      download: request.nextUrl.searchParams.get("download") === "1",
    });
    if (headOnly) return new NextResponse(null, { status: range ? 206 : 200, headers });
    const nodeStream = fs.createReadStream(resolved.path, { start, end });
    const body = Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;
    return new NextResponse(body, { status: range ? 206 : 200, headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load Admin Full Gallery file.";
    return NextResponse.json({ ok: false, error: message }, { status: 404 });
  }
}

function parseSingleRange(value: string | null, size: number): { start: number; end: number } | "invalid" | null {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || size <= 0) return "invalid";
  let start: number;
  let end: number;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isInteger(suffix) || suffix <= 0) return "invalid";
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
  }
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start >= size || end < start) return "invalid";
  return { start, end: Math.min(end, size - 1) };
}

function localHeaders(args: { contentType: string; fileName: string; fileSize: number; start: number; end: number; partial: boolean; download: boolean }) {
  const headers = new Headers({
    "Content-Type": args.contentType,
    "Content-Length": String(args.end - args.start + 1),
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-store, max-age=0",
    "X-Content-Type-Options": "nosniff",
  });
  if (args.partial) headers.set("Content-Range", `bytes ${args.start}-${args.end}/${args.fileSize}`);
  if (args.download) headers.set("Content-Disposition", `attachment; filename="${safeDispositionName(args.fileName)}"`);
  return headers;
}

function proxyHeaders(upstream: Headers, rel: string, download: boolean) {
  const headers = new Headers();
  for (const name of ["content-type", "content-length", "content-range", "accept-ranges", "last-modified", "etag"]) {
    const value = upstream.get(name);
    if (value) headers.set(name, value);
  }
  headers.set("Cache-Control", "private, no-store, max-age=0");
  headers.set("X-Content-Type-Options", "nosniff");
  if (download) headers.set("Content-Disposition", `attachment; filename="${safeDispositionName(path.posix.basename(rel))}"`);
  return headers;
}

function safeDispositionName(fileName: string) {
  return path.basename(fileName).replace(/["\r\n]/g, "_");
}
