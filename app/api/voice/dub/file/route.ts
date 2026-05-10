import fs from "node:fs";
import path from "node:path";

import { NextRequest, NextResponse } from "next/server";

import { mediaFileResponse } from "@/lib/mediaResponse";
import { getOwnerContext, SessionInvalidError } from "@/lib/ownerKey";
import { OTG_DATA_ROOT, safeJoin, safeSegment } from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function ownerJobRoot(ownerKey: string) {
  return path.join(OTG_DATA_ROOT, "voice_dub_jobs", safeSegment(ownerKey || "local"));
}

export async function GET(req: NextRequest) {
  try {
    const owner = await getOwnerContext(req);
    const jobId = String(req.nextUrl.searchParams.get("jobId") || "").trim();
    const name = path.basename(String(req.nextUrl.searchParams.get("name") || "voice_dub.wav"));
    const download = req.nextUrl.searchParams.get("download") === "1";
    if (!jobId) return NextResponse.json({ ok: false, error: "missing jobId" }, { status: 400 });

    const full = safeJoin(ownerJobRoot(owner.ownerKey), jobId, name);
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
      return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
    }

    return mediaFileResponse(req, full, { download, fileName: name });
  } catch (error: any) {
    if (error instanceof SessionInvalidError) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ ok: false, error: error?.message || "Audio file read failed" }, { status: 500 });
  }
}
