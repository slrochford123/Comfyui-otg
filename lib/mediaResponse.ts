import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";

import { NextRequest, NextResponse } from "next/server";

type ByteRange = { start: number; end: number };

export function contentTypeForMedia(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  if (ext === ".mp4") return "video/mp4";
  if (ext === ".webm") return "video/webm";
  if (ext === ".mov") return "video/quicktime";
  if (ext === ".mkv") return "video/x-matroska";
  if (ext === ".mp3") return "audio/mpeg";
  if (ext === ".wav") return "audio/wav";
  if (ext === ".m4a" || ext === ".aac") return "audio/mp4";
  if (ext === ".flac") return "audio/flac";
  if (ext === ".ogg") return "audio/ogg";
  if (ext === ".glb") return "model/gltf-binary";
  return "application/octet-stream";
}

function buildEntityTag(stat: fs.Stats, filePath: string) {
  const name = path.basename(filePath).replace(/[^A-Za-z0-9._-]/g, "_");
  return `W/"${name}-${stat.size}-${Math.trunc(stat.mtimeMs)}"`;
}

function parseRange(rangeHeader: string | null, size: number): ByteRange | null | "invalid" {
  if (!rangeHeader) return null;
  const value = rangeHeader.trim();
  if (!value.toLowerCase().startsWith("bytes=")) return "invalid";

  const spec = value.slice(6).trim();
  if (!spec || spec.includes(",")) return "invalid";

  const [rawStart, rawEnd] = spec.split("-", 2);
  if (rawStart === undefined || rawEnd === undefined) return "invalid";

  if (rawStart === "") {
    const suffixLength = Number.parseInt(rawEnd, 10);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return "invalid";
    return { start: Math.max(size - suffixLength, 0), end: Math.max(size - 1, 0) };
  }

  const start = Number.parseInt(rawStart, 10);
  if (!Number.isFinite(start) || start < 0 || start >= size) return "invalid";

  const end = rawEnd ? Number.parseInt(rawEnd, 10) : size - 1;
  if (!Number.isFinite(end) || end < start) return "invalid";

  return { start, end: Math.min(end, size - 1) };
}

// OTG_MEDIA_STREAM_ABORT_SAFE_V1
function streamFile(filePath: string, start?: number, end?: number) {
  const stream = typeof start === "number" && typeof end === "number"
    ? fs.createReadStream(filePath, { start, end })
    : fs.createReadStream(filePath);

  return new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;

      const closeSafely = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          // Client already closed the media request.
        }
      };

      stream.on("data", (chunk) => {
        if (closed) return;
        try {
          controller.enqueue(chunk instanceof Uint8Array ? chunk : Buffer.from(chunk));
        } catch {
          closed = true;
          stream.destroy();
        }
      });

      stream.on("end", closeSafely);
      stream.on("error", (error) => {
        if (closed) return;
        closed = true;
        try {
          controller.error(error);
        } catch {
          // Client already closed the media request.
        }
      });
    },
    cancel() {
      stream.destroy();
    },
  }) as any;
}

function isFresh(req: NextRequest, etag: string, stat: fs.Stats) {
  const inm = req.headers.get("if-none-match");
  if (inm && inm.trim() === etag) return true;

  const ims = req.headers.get("if-modified-since");
  if (!ims) return false;
  const since = Date.parse(ims);
  return Number.isFinite(since) && Math.trunc(stat.mtimeMs) <= since;
}

export function mediaFileResponse(
  req: NextRequest,
  filePath: string,
  options: {
    download?: boolean;
    fileName?: string;
    method?: "GET" | "HEAD";
    contentType?: string;
    cacheControl?: string;
  } = {}
) {
  const stat = fs.statSync(filePath);
  const size = stat.size || 0;
  const contentType = options.contentType || contentTypeForMedia(filePath);
  const etag = buildEntityTag(stat, filePath);
  const downloadName = (options.fileName || path.basename(filePath)).replace(/["\\\r\n]/g, "_");
  const cacheControl = options.download
    ? "private, no-transform, max-age=0"
    : options.cacheControl || "private, no-transform, max-age=86400, stale-while-revalidate=604800";
  const headers: Record<string, string> = {
    "Content-Type": contentType,
    "Content-Length": String(size),
    "Cache-Control": cacheControl,
    "Last-Modified": new Date(stat.mtimeMs).toUTCString(),
    ETag: etag,
    "Accept-Ranges": "bytes",
    "X-Content-Type-Options": "nosniff",
  };

  if (options.download) {
    headers["Content-Disposition"] = `attachment; filename="${downloadName}"`;
    headers["Content-Transfer-Encoding"] = "binary";
  }

  const method = options.method || "GET";
  const range = req.headers.get("range");

  if (!range && !options.download && isFresh(req, etag, stat)) {
    return new NextResponse(null, { status: 304, headers });
  }

  if (size <= 0) {
    return new NextResponse(method === "HEAD" ? null : new Uint8Array(), { status: 200, headers });
  }

  const parsed = parseRange(range, size);
  if (parsed === "invalid") {
    return new NextResponse(null, {
      status: 416,
      headers: {
        ...headers,
        "Content-Length": "0",
        "Content-Range": `bytes */${size}`,
      },
    });
  }

  if (parsed) {
    const chunkSize = parsed.end - parsed.start + 1;
    return new NextResponse(method === "HEAD" ? null : streamFile(filePath, parsed.start, parsed.end), {
      status: 206,
      headers: {
        ...headers,
        "Content-Length": String(chunkSize),
        "Content-Range": `bytes ${parsed.start}-${parsed.end}/${size}`,
      },
    });
  }

  return new NextResponse(method === "HEAD" ? null : streamFile(filePath), { status: 200, headers });
}
