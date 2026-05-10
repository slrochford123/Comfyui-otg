import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import fssync from "node:fs";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function contentTypeFromExt(ext: string): string {
  const e = ext.toLowerCase();
  if (e === ".png") return "image/png";
  if (e === ".jpg" || e === ".jpeg") return "image/jpeg";
  if (e === ".webp") return "image/webp";
  return "application/octet-stream";
}

function isWithin(base: string, target: string): boolean {
  const rel = path.relative(base, target);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const rawPath = (url.searchParams.get("path") || "").trim();
  if (!rawPath) return NextResponse.json({ ok: false, error: "Missing path" }, { status: 400 });

  const decoded = decodeURIComponent(rawPath);
  const resolved = path.resolve(decoded);
  const dataRoot = process.env.OTG_DATA_DIR || path.join(process.cwd(), "data");
  const inputRoot = path.resolve(path.join(dataRoot, "tmp", "angles_inputs"));
  const allowed = isWithin(inputRoot, resolved);
  if (!allowed) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  if (!fssync.existsSync(resolved)) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });

  const ext = path.extname(resolved);
  const ct = contentTypeFromExt(ext);
  if (!ct.startsWith("image/")) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });

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
