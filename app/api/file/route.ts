import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import fssync from "node:fs";
import path from "node:path";
import { getOwnerContext, SessionInvalidError } from "@/lib/ownerKey";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function contentTypeFromExt(ext: string): string {
  const e = ext.toLowerCase();
  if (e === ".png") return "image/png";
  if (e === ".jpg" || e === ".jpeg") return "image/jpeg";
  if (e === ".webp") return "image/webp";
  if (e === ".gif") return "image/gif";
  if (e === ".glb") return "model/gltf-binary";
  return "application/octet-stream";
}

function isWithin(base: string, target: string): boolean {
  const rel = path.relative(base, target);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

export async function GET(req: NextRequest) {
  // Require a valid session (same auth model as the rest of the app).
  try {
    await getOwnerContext(req);
  } catch (e: any) {
    if (e instanceof SessionInvalidError) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    throw e;
  }

  const url = new URL(req.url);
  const rawPath = (url.searchParams.get("path") || "").trim();
  if (!rawPath) return NextResponse.json({ ok: false, error: "Missing path" }, { status: 400 });

  const decoded = decodeURIComponent(rawPath);
  const resolved = path.resolve(decoded);

  const dataRoot = process.env.OTG_DATA_DIR || path.join(process.cwd(), "data");
  const storyboardRoot = path.resolve(path.join(dataRoot, "uploads", "storyboard"));
  const anglesPreviewRoot = path.resolve(path.join(dataRoot, "tmp", "angles_preview"));

  const allowed = isWithin(storyboardRoot, resolved) || isWithin(anglesPreviewRoot, resolved);
  if (!allowed) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  if (!fssync.existsSync(resolved)) {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }

  const ext = path.extname(resolved);
  const ct = contentTypeFromExt(ext);
  if (!(ct.startsWith("image/") || ct.startsWith("model/"))) {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }

  const buf = await fs.readFile(resolved);
  return new NextResponse(buf, {
    status: 200,
    headers: {
      "Content-Type": ct,
      "Content-Length": String(buf.byteLength),
      "Cache-Control": "no-store",
    },
  });
}