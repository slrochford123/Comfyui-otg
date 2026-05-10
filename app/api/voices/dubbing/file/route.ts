import fs from "node:fs";

import { NextRequest, NextResponse } from "next/server";

import { mediaFileResponse } from "@/lib/mediaResponse";
import { SessionInvalidError } from "@/lib/ownerKey";
import { requireSessionUser } from "@/lib/sessionUser";
import { ownerPrefix, resolveVoicesFile } from "@/lib/voicesStudio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: NextRequest) {
  try {
    const user = await requireSessionUser(req);
    const rel = String(new URL(req.url).searchParams.get("rel") || "").trim().replace(/\\/g, "/");
    if (!rel) return NextResponse.json({ ok: false, error: "Missing rel" }, { status: 400 });

    const expectedPrefix = `dubbing/${ownerPrefix(user.ownerKey)}/`;
    if (!rel.startsWith(expectedPrefix)) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }

    const abs = resolveVoicesFile(rel);
    if (!fs.existsSync(abs)) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    const stat = fs.statSync(abs);
    if (!stat.isFile()) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });

    return mediaFileResponse(req, abs);
  } catch (e: any) {
    if (e instanceof SessionInvalidError) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ ok: false, error: e?.message || "error" }, { status: 500 });
  }
}
