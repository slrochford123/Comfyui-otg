import fs from "node:fs";
import path from "node:path";

import { NextRequest, NextResponse } from "next/server";

import { mediaFileResponse } from "@/lib/mediaResponse";
import { getOwnerContext, SessionInvalidError } from "@/lib/ownerKey";
import { OTG_DATA_ROOT, safeJoin, safeSegment } from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function voiceGalleryRoot(ownerKey: string) {
  return path.join(OTG_DATA_ROOT, "voice_gallery", safeSegment(ownerKey || "local"));
}

export async function GET(req: NextRequest) {
  try {
    const owner = await getOwnerContext(req);
    const url = new URL(req.url);
    const name = path.basename(String(url.searchParams.get("name") || ""));
    if (!name) return NextResponse.json({ ok: false, error: "Missing name." }, { status: 400 });
    const filePath = safeJoin(voiceGalleryRoot(owner.ownerKey), name);
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      return NextResponse.json({ ok: false, error: "Not found." }, { status: 404 });
    }
    const download = url.searchParams.get("download") === "1" || url.searchParams.get("download") === "true";
    return mediaFileResponse(req, filePath, { download, fileName: name });
  } catch (error: any) {
    if (error instanceof SessionInvalidError) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ ok: false, error: error?.message || "File read failed" }, { status: 500 });
  }
}
