import fs from "node:fs";
import { Readable } from "node:stream";
import path from "node:path";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
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

  const ext = path.extname(name).toLowerCase();
  const contentType =
    ext === ".png" ? "image/png" :
    ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" :
    ext === ".webp" ? "image/webp" :
    ext === ".gif" ? "image/gif" :
    ext === ".mp4" ? "video/mp4" :
    ext === ".webm" ? "video/webm" :
    ext === ".mov" ? "video/quicktime" :
    "application/octet-stream";

  const stat = fs.statSync(filePath);
const size = stat.size || 0;
const range = req.headers.get("range");

if (range && contentType.startsWith("video/")) {
  const m = /^bytes=(\d+)-(\d*)$/i.exec(range);
  if (m) {
    const start = parseInt(m[1], 10);
    const end = m[2] ? parseInt(m[2], 10) : Math.min(start + 1024 * 1024 - 1, size - 1);
    const chunkSize = end - start + 1;
    const stream = fs.createReadStream(filePath, { start, end });
    const body = Readable.toWeb(stream);
    return new NextResponse(body as any, {
      status: 206,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(chunkSize),
        "Content-Range": `bytes ${start}-${end}/${size}`,
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-store",
      },
    });
  }
}

const buf = fs.readFileSync(filePath);
return new NextResponse(buf, {
  status: 200,
  headers: {
    "Content-Type": contentType,
    "Content-Length": String(buf.length),
    "Accept-Ranges": contentType.startsWith("video/") ? "bytes" : "none",
    "Cache-Control": "no-store",
  },
});
}
