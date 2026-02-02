import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getOwnerContext, SessionInvalidError } from "@/lib/ownerKey";
import { ensureDir } from "@/lib/paths";

export const runtime = "nodejs";

function isMedia(file: string) {
  const ext = path.extname(file).toLowerCase();
  return [".png", ".jpg", ".jpeg", ".webp", ".gif", ".mp4", ".webm", ".mov"].includes(ext);
}

function favoritesDir(username: string | null, deviceId: string) {
  const root = path.join(process.cwd(), "data", username ? "user_favorites" : "device_favorites");
  return username ? path.join(root, username) : path.join(root, deviceId);
}

export async function GET(req: NextRequest) {
  let deviceId: string;
  let ownerKey: string;
  let username: string | null;
  let scope: "user" | "device";
  try {
    ({ deviceId, ownerKey, username, scope } = await getOwnerContext(req));
  } catch (e: any) {
    if (e instanceof SessionInvalidError) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    throw e;
  }
  const dir = favoritesDir(username, deviceId);
  ensureDir(dir);

  const files = fs
    .readdirSync(dir)
    .filter(isMedia)
    .map((name) => {
      const abs = path.join(dir, name);
      let st: any;
      try { st = fs.statSync(abs); } catch { st = null; }
      return {
        name,
        url: `/api/favorites/file?name=${encodeURIComponent(name)}`,
        ts: st?.mtimeMs || 0,
        size: st?.size || 0,
      };
    })
    .sort((a, b) => (b.ts || 0) - (a.ts || 0));

  return NextResponse.json({ ok: true, scope, ownerKey, username: username || null, deviceId, files });
}
