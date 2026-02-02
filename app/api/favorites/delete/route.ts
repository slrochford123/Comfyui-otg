import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getOwnerContext, SessionInvalidError } from "@/lib/ownerKey";
import { ensureDir } from "@/lib/paths";
import { readState, resetState } from "@/lib/contentState";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeBaseName(name: string) {
  return path.basename(name || "");
}

// MUST match /api/favorites and /api/favorites/file behavior
function favoritesDir(username: string | null, deviceId: string) {
  const root = path.join(process.cwd(), "data", username ? "user_favorites" : "device_favorites");
  return username ? path.join(root, username) : path.join(root, deviceId);
}

export async function POST(req: NextRequest) {
  try {
    const { deviceId, username, ownerKey } = await getOwnerContext(req);

    const url = new URL(req.url);

    // Support query param or JSON body (deterministic)
    const body = (await req.json().catch(() => ({}))) as {
      filename?: string;
      name?: string;
      file?: string;
      id?: string;
    };

    const qp = safeBaseName(String(url.searchParams.get("name") || url.searchParams.get("filename") || url.searchParams.get("file") || ""));
    const filename = safeBaseName(body.filename || body.name || body.file || body.id || "") || qp;

    if (!filename) return NextResponse.json({ ok: false, error: "Missing filename" }, { status: 400 });

    const dir = favoritesDir(username, deviceId);
    ensureDir(dir);

    const abs = path.join(dir, filename);
    if (!fs.existsSync(abs)) {
      return NextResponse.json({ ok: false, error: "Not found", name: filename }, { status: 404 });
    }

    fs.unlinkSync(abs);

    // Convenience: if state is stuck as running, unlock it.
    try {
      const st = readState(ownerKey);
      if (st?.status === "running") resetState(ownerKey);
    } catch {}

    return NextResponse.json({ ok: true, name: filename });
  } catch (e: any) {
    if (e instanceof SessionInvalidError) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ ok: false, error: e?.message || "delete failed" }, { status: 500 });
  }
}
