import { NextRequest } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { OTG_DEVICE_OUTPUT_ROOT, safeJoin, contentTypeForExt } from "../_lib/paths";
import { getDeviceId } from "../_lib/device";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const deviceId = getDeviceId(req);
  const url = new URL(req.url);
  const rel = url.searchParams.get("rel");
  if (!rel) return new Response("Missing rel", { status: 400 });

  let abs: string;
  try {
    abs = safeJoin(OTG_DEVICE_OUTPUT_ROOT, deviceId, rel);
  } catch {
    return new Response("Forbidden", { status: 403 });
  }

  if (!fs.existsSync(abs)) return new Response("Not found", { status: 404 });

  const ext = path.extname(abs);
  const buf = fs.readFileSync(abs);
  return new Response(buf, {
    headers: {
      "Content-Type": contentTypeForExt(ext),
      "Cache-Control": "no-store",
    },
  });
}
