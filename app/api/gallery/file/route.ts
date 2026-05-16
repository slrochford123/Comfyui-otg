import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import fs from "node:fs/promises";

export const runtime = "nodejs";

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"]);

function contentTypeFor(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  if (ext === ".bmp") return "image/bmp";

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

  if (directPath) {
    const normalized = path.normalize(directPath);
    const ext = path.extname(normalized).toLowerCase();

    if (IMAGE_EXTENSIONS.has(ext) && path.isAbsolute(normalized) && (await fileExists(normalized))) {
      return normalized;
    }
  }

  const wantedName = safeBaseName(rawName);

  if (!wantedName) return "";

  const wantedExt = path.extname(wantedName).toLowerCase();
  if (!IMAGE_EXTENSIONS.has(wantedExt)) return "";

  for (const root of candidateRoots()) {
    const directCandidate = path.join(root, wantedName);

    if (await fileExists(directCandidate)) {
      return directCandidate;
    }

    const found = await findByName(root, wantedName);
    if (found) return found;
  }

  return "";
}

// GALLERY_FILE_SERVING_FALLBACK_PATCH

export async function GET(req: NextRequest) {
  const filePath = await resolveGalleryFile(req);

  if (!filePath) {
    return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  }

  const bytes = await fs.readFile(filePath);

  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": contentTypeFor(filePath),
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-OTG-Resolved-File": path.basename(filePath),
    },
  });
}
