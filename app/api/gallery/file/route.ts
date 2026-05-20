import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import fs from "node:fs/promises";
import { getGallerySourcesForRequest, resolveGalleryItemByName } from "@/lib/gallery";
import { SessionInvalidError } from "@/lib/ownerKey";
import { mediaFileResponse } from "@/lib/mediaResponse";

export const runtime = "nodejs";

const MEDIA_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".bmp",
  ".mp4",
  ".webm",
  ".mov",
  ".m4v",
  ".mp3",
  ".wav",
  ".m4a",
  ".ogg",
]);

function contentTypeFor(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  if (ext === ".bmp") return "image/bmp";
  if (ext === ".mp4" || ext === ".m4v") return "video/mp4";
  if (ext === ".webm") return "video/webm";
  if (ext === ".mov") return "video/quicktime";
  if (ext === ".mp3") return "audio/mpeg";
  if (ext === ".wav") return "audio/wav";
  if (ext === ".m4a") return "audio/mp4";
  if (ext === ".ogg") return "audio/ogg";

  return "application/octet-stream";
}

function safeBaseName(raw: string) {
  return path.basename(String(raw || "").trim());
}

async function fileExists(filePath: string) {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

function candidateRoots() {
  const roots = [
    process.env.OTG_DATA_DIR,
    process.env.DATA_DIR,
    path.join(process.cwd(), "data"),
    path.join(process.cwd(), "public"),
    path.join(process.cwd(), ".next"),
    "E:\\Renders\\ComfyUI",
    "E:\\Renders",
    "C:\\AI\\Comfyui\\output",
    "C:\\AI\\ComfyUI\\output",
    "C:\\AI\\Comfyui\\ComfyUI\\output",
    "C:\\AI\\ComfyUI\\ComfyUI\\output",
  ];

  return Array.from(
    new Set(
      roots
        .map((root) => String(root || "").trim())
        .filter(Boolean)
    )
  );
}

async function findByName(root: string, wantedName: string, maxFiles = 25000) {
  let checked = 0;
  const stack = [root];

  while (stack.length) {
    const current = stack.pop();
    if (!current) continue;

    let entries: Array<{
      name: string;
      isDirectory(): boolean;
      isFile(): boolean;
    }>;

    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);

      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }

      checked += 1;
      if (checked > maxFiles) return "";

      if (!entry.isFile()) continue;
      if (entry.name === wantedName) return fullPath;
    }
  }

  return "";
}

async function resolveGalleryFile(req: NextRequest) {
  const url = req.nextUrl;
  const directPath = String(url.searchParams.get("path") || "").trim();
  const rawName = String(url.searchParams.get("name") || "").trim();
  const scopeHint = String(url.searchParams.get("scope") || "").trim();

  if (directPath) {
    const normalized = path.normalize(directPath);
    const ext = path.extname(normalized).toLowerCase();

    if (MEDIA_EXTENSIONS.has(ext) && path.isAbsolute(normalized) && (await fileExists(normalized))) {
      return normalized;
    }
  }

  const wantedName = safeBaseName(rawName);

  if (!wantedName) return "";

  const wantedExt = path.extname(wantedName).toLowerCase();
  if (!MEDIA_EXTENSIONS.has(wantedExt)) return "";

  try {
    const { sources } = await getGallerySourcesForRequest(req);
    const item = resolveGalleryItemByName({ sources, name: wantedName, scopeHint });
    if (item?.path && (await fileExists(item.path))) {
      return item.path;
    }
  } catch (error) {
    if (error instanceof SessionInvalidError) throw error;
  }

  for (const root of candidateRoots()) {
    const directCandidate = path.join(root, wantedName);

    if (await fileExists(directCandidate)) {
      return directCandidate;
    }

    if (url.searchParams.get("legacySearch") !== "1") {
      continue;
    }

    const found = await findByName(root, wantedName);
    if (found) return found;
  }

  return "";
}

// GALLERY_FILE_STREAMING_FAST_PATH_V1

async function serveGalleryFile(req: NextRequest, method: "GET" | "HEAD") {
  let filePath = "";
  try {
    filePath = await resolveGalleryFile(req);
  } catch (error) {
    if (error instanceof SessionInvalidError) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    throw error;
  }

  if (!filePath) {
    return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  }

  const response = mediaFileResponse(req, filePath, {
    method,
    contentType: contentTypeFor(filePath),
    download: req.nextUrl.searchParams.get("download") === "1",
    fileName: path.basename(filePath),
    cacheControl: "private, no-transform, max-age=86400, stale-while-revalidate=604800",
  });
  response.headers.set("X-OTG-Resolved-File", path.basename(filePath));
  response.headers.set("X-OTG-File-Stream", "1");
  return response;
}

export async function GET(req: NextRequest) {
  return serveGalleryFile(req, "GET");
}

export async function HEAD(req: NextRequest) {
  return serveGalleryFile(req, "HEAD");
}
