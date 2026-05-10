import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { mediaFileResponse } from "@/lib/mediaResponse";
import { getOwnerContext, SessionInvalidError } from "@/lib/ownerKey";
import { ensureDir } from "@/lib/paths";

export const runtime = "nodejs";

function favoritesDir(username: string | null, deviceId: string) {
  const root = path.join(process.cwd(), "data", username ? "user_favorites" : "device_favorites");
  return username ? path.join(root, username) : path.join(root, deviceId);
}

function safeBaseName(name: string) {
  return path.basename(name || "");
}

const ALLOWED_MEDIA_EXTS = new Set([".png",".jpg",".jpeg",".webp",".gif",".mp4",".webm",".mov",".mkv"]);
function isAllowedMediaName(name: string) {
  const ext = path.extname(name).toLowerCase();
  return ALLOWED_MEDIA_EXTS.has(ext);
}

export async function GET(req: NextRequest) {
  let deviceId: string;
  let username: string | null;
  try {
    ({ deviceId, username } = await getOwnerContext(req));
  } catch (e: any) {
    if (e instanceof SessionInvalidError) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    throw e;
  }
  const url = new URL(req.url);
  const name = safeBaseName(url.searchParams.get("name") || "");
  if (!name) return NextResponse.json({ ok: false, error: "Missing name" }, { status: 400 });

  const dir = favoritesDir(username, deviceId);
  ensureDir(dir);
  const filePath = path.join(dir, name);

  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }

  if (!isAllowedMediaName(name) || !fs.statSync(filePath).isFile()) {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }

  return mediaFileResponse(req, filePath);
}
