import { NextRequest } from "next/server";
import fs from "node:fs";
import path from "node:path";

export const runtime = "nodejs";

const DEVICE_ROOT =
  process.env.OTG_DEVICE_OUTPUT_ROOT ||
  "C:/Users/SLRoc/comfy-controller/data/device_galleries";

function contentType(ext: string) {
  const e = ext.toLowerCase();
  if (e === ".png") return "image/png";
  if (e === ".jpg" || e === ".jpeg") return "image/jpeg";
  if (e === ".webp") return "image/webp";
  return "application/octet-stream";
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const deviceId = url.searchParams.get("deviceId");
  const rel = url.searchParams.get("rel");

  if (!deviceId || !rel) {
    return new Response("Missing deviceId or rel", { status: 400 });
  }

  // Block traversal
  const base = path.resolve(DEVICE_ROOT, deviceId);
  const abs = path.resolve(base, rel);
  if (!abs.startsWith(base)) {
    return new Response("Forbidden", { status: 403 });
  }

  if (!fs.existsSync(abs)) {
    return new Response("Not found", { status: 404 });
  }

  const buf = fs.readFileSync(abs);
  return new Response(buf, {
    headers: {
      "Content-Type": contentType(path.extname(abs)),
      "Cache-Control": "no-store",
    },
  });
}
