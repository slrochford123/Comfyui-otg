import fs from "node:fs";
import path from "node:path";

import { NextRequest, NextResponse } from "next/server";

import { SessionInvalidError } from "@/lib/ownerKey";
import { requireSessionUser } from "@/lib/sessionUser";
import { ownerPrefix, resolveVoicesFile } from "@/lib/voicesStudio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function getMime(filename: string) {
  const ext = path.extname(filename).toLowerCase();
  switch (ext) {
    case ".wav":
      return "audio/wav";
    case ".mp3":
      return "audio/mpeg";
    case ".ogg":
      return "audio/ogg";
    case ".webm":
      return "audio/webm";
    default:
      return "application/octet-stream";
  }
}

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

    const buf = fs.readFileSync(abs);
    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type": getMime(abs),
        "Content-Length": String(buf.byteLength),
        "Cache-Control": "no-store",
      },
    });
  } catch (e: any) {
    if (e instanceof SessionInvalidError) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ ok: false, error: e?.message || "error" }, { status: 500 });
  }
}
