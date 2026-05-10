import fs from "node:fs";
import { NextRequest } from "next/server";

import { requireAdmin } from "@/app/api/admin/_requireAdmin";
import { mediaFileResponse } from "@/lib/mediaResponse";
import { OTG_VOICES_ROOT } from "@/lib/voicesPaths";
import { safeJoin } from "@/lib/paths";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return Response.json({ ok: false, error: admin.error }, { status: admin.status });
  }

  try {
    const url = new URL(req.url);
    const rel = (url.searchParams.get("rel") || "").trim();
    if (!rel) return Response.json({ ok: false, error: "Missing rel" }, { status: 400 });

    // rel is a posix-ish path under OTG_VOICES_ROOT.
    const safeRel = rel.replace(/\\/g, "/");
    const filePath = safeJoin(OTG_VOICES_ROOT, safeRel);

    if (!fs.existsSync(filePath)) return Response.json({ ok: false, error: "Not found" }, { status: 404 });
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return Response.json({ ok: false, error: "Not found" }, { status: 404 });

    return mediaFileResponse(req, filePath);
  } catch (e: any) {
    return Response.json({ ok: false, error: e?.message || "Unknown error" }, { status: 500 });
  }
}
