import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getOwnerContext, SessionInvalidError } from "@/lib/ownerKey";
import { ensureDir } from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isMedia(name: string) {
  const ext = path.extname(name).toLowerCase();
  return [".png", ".jpg", ".jpeg", ".webp", ".gif", ".mp4", ".webm", ".mov"].includes(ext);
}

function favoritesDir(username: string | null, deviceId: string) {
  const root = path.join(process.cwd(), "data", username ? "user_favorites" : "device_favorites");
  return username ? path.join(root, username) : path.join(root, deviceId);
}

export async function POST(req: NextRequest) {
  try {
    const { deviceId, username } = await getOwnerContext(req);
    const url = new URL(req.url);
    const name = String(url.searchParams.get("name") || "").trim();
    if (!name) return NextResponse.json({ ok: false, error: "Missing name" }, { status: 400 });
    if (!isMedia(name)) return NextResponse.json({ ok: false, error: "Not a media file" }, { status: 400 });

    const dir = favoritesDir(username, deviceId);
    ensureDir(dir);
    const filePath = path.join(dir, path.basename(name));
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch {}
    }

    return NextResponse.json({ ok: true, name: path.basename(name) });
  } catch (e: any) {
    if (e instanceof SessionInvalidError) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ ok: false, error: e?.message || "Failed" }, { status: 500 });
  }
}
