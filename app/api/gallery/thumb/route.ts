import { NextResponse } from "next/server";
import path from "node:path";
import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import sharp from "sharp";

const execFileAsync = promisify(execFile);

function getCookieFromHeader(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(";").map((c) => c.trim());
  for (const p of parts) {
    if (p.startsWith(name + "=")) return decodeURIComponent(p.slice(name.length + 1));
  }
  return null;
}

function decodeJwtPayload(token: string | null): any | null {
  if (!token) return null;
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const pad = "=".repeat((4 - (b64.length % 4)) % 4);
    const json = Buffer.from(b64 + pad, "base64").toString("utf8");
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function safeName(name: string) {
  if (!name) return "";
  if (name.includes("..") || name.includes("/") || name.includes("\\")) return "";
  return name;
}

function isVideo(name: string) {
  const n = name.toLowerCase();
  return n.endsWith(".mp4") || n.endsWith(".webm") || n.endsWith(".mov");
}

async function fileExists(p: string) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const nameRaw = url.searchParams.get("name") || "";
  const name = safeName(nameRaw);
  if (!name) return NextResponse.json({ ok: false, error: "bad_name" }, { status: 400 });

  const cookieName = process.env.AUTH_COOKIE_NAME || "otg_session";
  const token = getCookieFromHeader(req.headers.get("cookie"), cookieName);
  const payload = decodeJwtPayload(token);

  const ownerKey = payload?.sub || payload?.userId || payload?.email || payload?.username || "";
  if (!ownerKey) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const GALLERY_BASE =
    process.env.OTG_DEVICE_OUTPUT_ROOT ||
    process.env.OTG_GALLERY_BASE ||
    "/mnt/otg_gallery/data/device_galleries";

  const ownerDir = path.join(GALLERY_BASE, ownerKey);
  const mediaPath = path.join(ownerDir, name);
  if (!(await fileExists(mediaPath))) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }

  const thumbsDir = path.join(ownerDir, ".thumbs");
  await fs.mkdir(thumbsDir, { recursive: true });

  const thumbPath = path.join(thumbsDir, name + (isVideo(name) ? ".jpg" : ".webp"));

  // Serve cached
  if (await fileExists(thumbPath)) {
    const b = await fs.readFile(thumbPath);
    const body = new Uint8Array(b);
    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": isVideo(name) ? "image/jpeg" : "image/webp",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  }

  // Create image thumb
  if (!isVideo(name)) {
    const out = await sharp(mediaPath)
      .rotate()
      .resize({ width: 320, withoutEnlargement: true })
      .webp({ quality: 70 })
      .toBuffer();

    await fs.writeFile(thumbPath, out);

    const body = new Uint8Array(out);
    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": "image/webp",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  }

  // Create video poster (first frame)
  try {
    await execFileAsync("ffmpeg", [
      "-y",
      "-ss",
      "0",
      "-i",
      mediaPath,
      "-frames:v",
      "1",
      "-vf",
      "scale=320:-1",
      "-q:v",
      "6",
      thumbPath,
    ]);
  } catch {
    return NextResponse.json({ ok: false, error: "thumb_failed" }, { status: 500 });
  }

  const b = await fs.readFile(thumbPath);
  const body = new Uint8Array(b);
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
