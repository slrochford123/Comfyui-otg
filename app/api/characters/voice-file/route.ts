import { promises as fs } from "node:fs";
import path from "node:path";

export const runtime = "nodejs";

const DATA_ROOT = path.resolve(process.cwd(), "data");

function isInside(parent: string, child: string) {
  const relative = path.relative(parent, child);
  return relative === "" || (!!relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

function contentTypeFor(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === ".wav") return "audio/wav";
  if (ext === ".mp3") return "audio/mpeg";
  if (ext === ".m4a") return "audio/mp4";
  if (ext === ".ogg") return "audio/ogg";
  if (ext === ".flac") return "audio/flac";

  return "application/octet-stream";
}

function parseRange(rangeHeader: string | null, size: number) {
  if (!rangeHeader) return null;

  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!match) return null;

  const startRaw = match[1];
  const endRaw = match[2];

  let start = startRaw ? Number(startRaw) : 0;
  let end = endRaw ? Number(endRaw) : size - 1;

  if (!startRaw && endRaw) {
    const suffixLength = Number(endRaw);
    start = Math.max(size - suffixLength, 0);
    end = size - 1;
  }

  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start < 0 || end < start || start >= size) return null;

  end = Math.min(end, size - 1);

  return { start, end };
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const rawPath = String(url.searchParams.get("path") || "").trim();

    if (!rawPath) {
      return Response.json({ ok: false, error: "Missing path query parameter." }, { status: 400 });
    }

    const normalized = rawPath.replace(/\\/g, "/").replace(/^\/+/, "");
    const absolutePath = path.resolve(DATA_ROOT, normalized);

    if (!isInside(DATA_ROOT, absolutePath)) {
      return Response.json({ ok: false, error: "Refusing to serve file outside data directory." }, { status: 403 });
    }

    const stat = await fs.stat(absolutePath).catch(() => null);

    if (!stat || !stat.isFile()) {
      return Response.json(
        {
          ok: false,
          error: "Voice file not found.",
          path: normalized,
          absolutePath,
        },
        { status: 404 },
      );
    }

    const size = stat.size;
    const contentType = contentTypeFor(absolutePath);
    const range = parseRange(request.headers.get("range"), size);

    if (range) {
      const handle = await fs.open(absolutePath, "r");
      try {
        const length = range.end - range.start + 1;
        const buffer = Buffer.alloc(length);
        await handle.read(buffer, 0, length, range.start);

        return new Response(buffer, {
          status: 206,
          headers: {
            "Content-Type": contentType,
            "Content-Length": String(length),
            "Content-Range": `bytes ${range.start}-${range.end}/${size}`,
            "Accept-Ranges": "bytes",
            "Cache-Control": "no-store",
          },
        });
      } finally {
        await handle.close();
      }
    }

    const bytes = await fs.readFile(absolutePath);

    return new Response(bytes, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(bytes.length),
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-store",
      },
    });
  } catch (error: any) {
    return Response.json(
      {
        ok: false,
        error: error?.message || String(error),
      },
      { status: 500 },
    );
  }
}
