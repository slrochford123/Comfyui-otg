import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import fssync from "node:fs";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const DEFAULT_RANGE_BYTES = 8 * 1024 * 1024;
const DIRECT_FULL_READ_LIMIT_BYTES = 64 * 1024 * 1024;

type ByteRange = {
  start: number;
  end: number;
};

function previewMimeType(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === ".mp4" || ext === ".m4v") return "video/mp4";
  if (ext === ".webm") return "video/webm";
  if (ext === ".mov") return "video/quicktime";
  if (ext === ".mkv") return "video/x-matroska";
  if (ext === ".mp3") return "audio/mpeg";
  if (ext === ".wav") return "audio/wav";
  if (ext === ".m4a") return "audio/mp4";
  if (ext === ".aac") return "audio/aac";
  if (ext === ".ogg") return "audio/ogg";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";

  return "application/octet-stream";
}

function safeDecode(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function previewRoots() {
  const cwd = process.cwd();

  return Array.from(new Set([
    process.env.OTG_PREVIEW_DIR || "",
    process.env.OTG_OUTPUT_DIR || "",
    process.env.OTG_DATA_ROOT || "",
    process.env.COMFYUI_OUTPUT_DIR || "",
    process.env.COMFY_OUTPUT_DIR || "",
    path.join(cwd, "data", "preview"),
    path.join(cwd, "data", "previews"),
    path.join(cwd, "data", "output"),
    path.join(cwd, "data", "outputs"),
    path.join(cwd, "outputs"),
    path.join(cwd, "output"),
    path.join(cwd, "public"),
    path.join(cwd, "public", "preview"),
    path.join(cwd, "public", "previews"),
    path.join(cwd, "public", "outputs"),
    "C:\\AI\\OTG-Test2\\data",
    "C:\\AI\\OTG-Test2\\data\\outputs",
    "C:\\AI\\OTG-Test2\\outputs",
    "C:\\AI\\ComfyUI\\output",
    "C:\\AI\\ComfyUI_windows_portable\\ComfyUI\\output",
    "D:\\AI\\ComfyUI_windows_portable\\ComfyUI\\output",
  ].filter(Boolean).map((item) => path.resolve(item))));
}

function isAllowedAbsolutePath(filePath: string) {
  const resolved = path.resolve(filePath).toLowerCase();
  const roots = previewRoots().map((root) => root.toLowerCase());

  return (
    roots.some((root) => resolved === root || resolved.startsWith(root + path.sep)) ||
    resolved.startsWith("c:\\ai\\") ||
    resolved.startsWith("d:\\ai\\")
  );
}

async function fileExists(filePath: string) {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

async function walkForFile(root: string, baseName: string, maxDepth = 4) {
  const hits: string[] = [];
  const wanted = baseName.toLowerCase();

  if (!root || !fssync.existsSync(root)) return hits;

  const queue: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];

  while (queue.length && hits.length < 100) {
    const current = queue.shift();
    if (!current) continue;

    const entries = await fs.readdir(current.dir, { withFileTypes: true }).catch(() => []);

    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === ".next" || entry.name === "_otg_patch_backups") {
        continue;
      }

      const full = path.join(current.dir, entry.name);

      if (entry.isFile() && entry.name.toLowerCase() === wanted) {
        hits.push(full);
        continue;
      }

      if (entry.isDirectory() && current.depth < maxDepth) {
        queue.push({ dir: full, depth: current.depth + 1 });
      }
    }
  }

  return hits;
}

async function newestFile(paths: string[]) {
  const scored: Array<{ filePath: string; mtimeMs: number }> = [];

  for (const filePath of paths) {
    try {
      const stat = await fs.stat(filePath);
      if (stat.isFile()) {
        scored.push({ filePath, mtimeMs: stat.mtimeMs });
      }
    } catch {
      // Ignore stale candidate.
    }
  }

  scored.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return scored[0]?.filePath || "";
}

async function resolvePreviewFile(rawName: string) {
  const decoded = safeDecode(String(rawName || "")).replace(/\0/g, "").trim();

  if (!decoded) return "";

  if (path.isAbsolute(decoded) && isAllowedAbsolutePath(decoded) && await fileExists(decoded)) {
    return path.normalize(decoded);
  }

  const cleaned = decoded
    .replace(/\\/g, "/")
    .split("?")[0]
    .split("#")[0]
    .split("/")
    .filter((part) => part && part !== "." && part !== "..")
    .join("/");

  const baseName = path.basename(cleaned);
  if (!baseName) return "";

  const roots = previewRoots();
  const directCandidates: string[] = [];

  for (const root of roots) {
    directCandidates.push(path.join(root, cleaned));
    directCandidates.push(path.join(root, baseName));
  }

  const direct = await newestFile(directCandidates);
  if (direct) return direct;

  const recursiveHits: string[] = [];

  for (const root of roots) {
    recursiveHits.push(...await walkForFile(root, baseName));
  }

  return newestFile(recursiveHits);
}

function parseRange(rangeHeader: string | null, size: number): ByteRange | null {
  if (!rangeHeader || !rangeHeader.startsWith("bytes=")) return null;

  const value = rangeHeader.slice("bytes=".length).split(",")[0]?.trim() || "";
  const [startRaw, endRaw] = value.split("-");

  if (startRaw === "" && endRaw) {
    const suffixLength = Number(endRaw);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return null;

    const start = Math.max(0, size - suffixLength);
    return { start, end: size - 1 };
  }

  const start = Number(startRaw);
  if (!Number.isFinite(start) || start < 0 || start >= size) return null;

  const requestedEnd = endRaw ? Number(endRaw) : start + DEFAULT_RANGE_BYTES - 1;
  const end = Math.min(size - 1, Number.isFinite(requestedEnd) ? requestedEnd : start + DEFAULT_RANGE_BYTES - 1);

  if (end < start) return null;

  return { start, end };
}

async function readByteRange(filePath: string, start: number, end: number) {
  const length = end - start + 1;
  const handle = await fs.open(filePath, "r");

  try {
    const buffer = Buffer.allocUnsafe(length);
    const result = await handle.read(buffer, 0, length, start);
    const chunk = buffer.subarray(0, result.bytesRead);
    return new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  } finally {
    await handle.close().catch(() => undefined);
  }
}

function commonHeaders(filePath: string, size: number) {
  return {
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-store, no-cache, must-revalidate",
    "Content-Type": previewMimeType(filePath),
    "Content-Disposition": `inline; filename="${path.basename(filePath).replace(/"/g, "")}"`,
    "X-Content-Type-Options": "nosniff",
    "X-OTG-Preview-File-Route": "buffered-range-v1",
    "X-OTG-Preview-File-Size": String(size),
  };
}

export async function GET(req: NextRequest) {
  try {
    const name =
      req.nextUrl.searchParams.get("name") ||
      req.nextUrl.searchParams.get("file") ||
      req.nextUrl.searchParams.get("path") ||
      "";

    const filePath = await resolvePreviewFile(name);

    if (!filePath) {
      return NextResponse.json(
        {
          ok: false,
          error: "Preview file not found.",
          name,
          searchedRoots: previewRoots(),
        },
        { status: 404 }
      );
    }

    const stat = await fs.stat(filePath);
    const size = stat.size;

    if (!size) {
      return new NextResponse(null, {
        status: 204,
        headers: commonHeaders(filePath, size),
      });
    }

    const rangeHeader = req.headers.get("range");
    const range = parseRange(rangeHeader, size);

    if (rangeHeader && !range) {
      return new NextResponse(null, {
        status: 416,
        headers: {
          ...commonHeaders(filePath, size),
          "Content-Range": `bytes */${size}`,
        },
      });
    }

    /*
      OTG_PREVIEW_FILE_RANGE_CONTROLLER_CLOSED_FIX_V1:
      Do not use a custom ReadableStream controller here. Browsers cancel and
      reopen video range requests aggressively; a custom controller can throw
      ERR_INVALID_STATE when it enqueues after close. Returning fixed byte
      buffers for 206 responses avoids that crash.
    */
    if (range || size > DIRECT_FULL_READ_LIMIT_BYTES) {
      const start = range?.start ?? 0;
      const end = range?.end ?? Math.min(size - 1, DEFAULT_RANGE_BYTES - 1);
      const body = await readByteRange(filePath, start, end);

      return new NextResponse(body, {
        status: 206,
        headers: {
          ...commonHeaders(filePath, size),
          "Content-Length": String(body.byteLength),
          "Content-Range": `bytes ${start}-${end}/${size}`,
        },
      });
    }

    const full = await fs.readFile(filePath);
    const body = new Uint8Array(full.buffer, full.byteOffset, full.byteLength);

    return new NextResponse(body, {
      status: 200,
      headers: {
        ...commonHeaders(filePath, size),
        "Content-Length": String(body.byteLength),
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error: error?.message || "Preview file request failed.",
      },
      { status: 500 }
    );
  }
}

export async function HEAD(req: NextRequest) {
  const name =
    req.nextUrl.searchParams.get("name") ||
    req.nextUrl.searchParams.get("file") ||
    req.nextUrl.searchParams.get("path") ||
    "";

  const filePath = await resolvePreviewFile(name);

  if (!filePath) {
    return new NextResponse(null, { status: 404 });
  }

  const stat = await fs.stat(filePath);

  return new NextResponse(null, {
    status: 200,
    headers: {
      ...commonHeaders(filePath, stat.size),
      "Content-Length": String(stat.size),
    },
  });
}
