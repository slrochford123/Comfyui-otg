import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

function sanitizeFilename(name: string) {
  const trimmed = String(name || "").trim();
  const fallback = "download.bin";
  const base = trimmed || fallback;
  return base.replace(/[\r\n\\/:*?"<>|]+/g, "_");
}

function getContentType(ext: string) {
  switch (ext) {
    case ".glb":
      return "model/gltf-binary";
    case ".gltf":
      return "model/gltf+json";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".mp4":
      return "video/mp4";
    case ".json":
      return "application/json; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

function uniqueStrings(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const raw = String(value || "").trim();
    if (!raw) continue;
    const key = process.platform === "win32" ? raw.toLowerCase() : raw;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(raw);
  }
  return out;
}

function configuredExtraAllowedRoots(dataRoot: string) {
  const envRoots = String(process.env.OTG_GALLERY_IMPORT_ROOTS || "")
    .split(/[;\n,]+/)
    .map((v) => v.trim())
    .filter(Boolean);

  return uniqueStrings([
    process.env.COMFY_OUTPUT_DIR || null,
    process.env.ADMIN_GALLERY_ROOT || null,
    ...envRoots,
    "E:/Renders/ComfyUI",
  ])
    .map((p) => path.resolve(p))
    .filter((p) => p && p !== path.resolve(dataRoot));
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const requestedPath = url.searchParams.get("path");

    if (!requestedPath) {
      return NextResponse.json({ ok: false, error: "Missing path" }, { status: 400 });
    }

    const resolved = path.resolve(requestedPath);

    const dataRoot = process.env.OTG_DATA_DIR || path.join(process.cwd(), "data");

    const allowedRoots = [
      dataRoot,
      path.join(dataRoot, "tmp"),
      path.join(dataRoot, "tmp", "angles_models"),
      path.join(dataRoot, "tmp", "angles_uploads"),
      path.join(dataRoot, "tmp", "angles_bridge"),
      ...configuredExtraAllowedRoots(dataRoot),
    ].map((p) => path.resolve(p));

    const allowed = allowedRoots.some((root) => {
      const rel = path.relative(root, resolved);
      return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
    });

    if (!allowed) {
      return NextResponse.json(
        { ok: false, error: "Forbidden", detail: { resolved } },
        { status: 403 }
      );
    }

    if (!fs.existsSync(resolved)) {
      return NextResponse.json({ ok: false, error: "File not found" }, { status: 404 });
    }

    const stat = fs.statSync(resolved);
    if (!stat.isFile()) {
      return NextResponse.json({ ok: false, error: "Not a file" }, { status: 400 });
    }

    const fileBuffer = fs.readFileSync(resolved);
    const ext = path.extname(resolved).toLowerCase();
    const contentType = getContentType(ext);
    const fileName = sanitizeFilename(path.basename(resolved));
    const encodedFileName = encodeURIComponent(fileName);

    return new NextResponse(fileBuffer, {
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(fileBuffer.byteLength),
        "Content-Disposition": `inline; filename="${fileName}"; filename*=UTF-8''${encodedFileName}`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-store",
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || "Unknown error" },
      { status: 500 }
    );
  }
}
