// OTG_VOICE_TEXT_TO_SPEECH_INDEXTTS2_V1

import fs from "node:fs";
import path from "node:path";

import { NextRequest, NextResponse } from "next/server";

import { mediaFileResponse } from "@/lib/mediaResponse";
import { getOwnerContext, SessionInvalidError } from "@/lib/ownerKey";
import { OTG_DATA_ROOT, safeJoin, safeSegment } from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function ownerTtsRoot(ownerKey: string) {
  return path.join(OTG_DATA_ROOT, "voice_tts_jobs", safeSegment(ownerKey || "local"));
}

export async function GET(req: NextRequest) {
  try {
    const owner = await getOwnerContext(req);
    const jobId = String(req.nextUrl.searchParams.get("jobId") || "").trim();
    const name = path.basename(String(req.nextUrl.searchParams.get("name") || "character_tts.wav"));
    const download = req.nextUrl.searchParams.get("download") === "1";
    if (!jobId) return NextResponse.json({ ok: false, error: "missing jobId" }, { status: 400 });

    const full = safeJoin(ownerTtsRoot(owner.ownerKey), jobId, name);
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });

    return mediaFileResponse(req, full, { download, fileName: name });
  } catch (error: any) {
    if (error instanceof SessionInvalidError) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ ok: false, error: error?.message || "TTS audio read failed" }, { status: 500 });
  }
}
