import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { getOwnerContext, SessionInvalidError } from "@/lib/ownerKey";
import { getOwnerDirs, safeJoin } from "@/lib/paths";

export const runtime = "nodejs";

const COMFY_BASE_URL =
  (process.env.COMFY_BASE_URL || process.env.COMFY_URL || "http://127.0.0.1:8188").replace(/\/+$/, "");

export async function POST(req: NextRequest) {
  try {
    const owner = await getOwnerContext(req);
    const body = await req.json().catch(() => ({} as any));
    const name = String(body?.name || "");
    const source = String(body?.source || "gallery");

    if (!name) return NextResponse.json({ ok: false, error: "missing_name" }, { status: 400 });

    const { userGalleryDir, userFavoritesDir } = getOwnerDirs(owner.ownerKey);
    const base = source === "favorites" ? userFavoritesDir : userGalleryDir;

    const full = safeJoin(base, name);
    if (!full || !fs.existsSync(full)) {
      return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
    }

    const buf = fs.readFileSync(full);
    const filename = path.basename(full);

    const form = new FormData();
    form.append("image", new Blob([buf]), filename);

    const r = await fetch(`${COMFY_BASE_URL}/upload/image`, { method: "POST", body: form as any });
    const text = await r.text();

    if (!r.ok) {
      return NextResponse.json({ ok: false, upstreamStatus: r.status, text }, { status: 502 });
    }

    let json: any = null;
    try { json = JSON.parse(text); } catch { json = { raw: text }; }
    return NextResponse.json({ ok: true, upload: json });
  } catch (e: any) {
    if (e instanceof SessionInvalidError) {
      return NextResponse.json({ ok: false, error: "session" }, { status: 401 });
    }
    return NextResponse.json({ ok: false, error: e?.message || "error" }, { status: 500 });
  }
}
