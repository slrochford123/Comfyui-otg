import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";

import { getOwnerContext, SessionInvalidError } from "@/lib/ownerKey";
import {
  OTG_DATA_ROOT,
  deviceGalleryDir,
  userGalleryDir,
  ensureDir,
  safeJoin,
  safeSegment,
} from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type Collection = "gallery" | "favorites";

function clampInt(n: number, min: number, max: number) {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function isSafeBasename(name: string) {
  if (!name) return false;
  const base = path.basename(name);
  if (base !== name) return false;
  if (name.includes("..")) return false;
  if (name.includes("/") || name.includes("\\")) return false;
  return true;
}

function isVideo(name: string) {
  const n = name.toLowerCase();
  return n.endsWith(".mp4") || n.endsWith(".webm") || n.endsWith(".mov") || n.endsWith(".mkv");
}

function guessFavoritesDirLegacy(username: string | null, deviceId: string) {
  // Back-compat with older favorites route that used <repo>/data
  const root = path.join(process.cwd(), "data", username ? "user_favorites" : "device_favorites");
  return username ? path.join(root, username) : path.join(root, deviceId);
}

function favoritesDirDataRoot(username: string | null, deviceId: string) {
  const root = path.join(OTG_DATA_ROOT, username ? "user_favorites" : "device_favorites");
  return username ? path.join(root, safeSegment(username)) : path.join(root, safeSegment(deviceId));
}

function sha1(input: string) {
  return crypto.createHash("sha1").update(input).digest("hex");
}

function svgFallback(label: string) {
  const safe = (label || "preview").replace(/[<>&"]/g, "");
  const svg = `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">\n` +
    `  <defs>\n` +
    `    <linearGradient id="g" x1="0" x2="1" y1="0" y2="1">\n` +
    `      <stop offset="0" stop-color="#1b1b22"/>\n` +
    `      <stop offset="1" stop-color="#2b2b3a"/>\n` +
    `    </linearGradient>\n` +
    `  </defs>\n` +
    `  <rect x="0" y="0" width="640" height="360" fill="url(#g)"/>\n` +
    `  <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="rgba(255,255,255,0.78)" font-family="system-ui, -apple-system, Segoe UI, Roboto" font-size="18">${safe}</text>\n` +
    `</svg>`;
  return svg;
}

function getFfmpegPath() {
  return process.env.FFMPEG_PATH || process.env.OTG_FFMPEG_PATH || "ffmpeg";
}

function ensureThumbWithFfmpeg(opts: {
  inputAbs: string;
  outputAbs: string;
  width: number;
  video: boolean;
}) {
  const { inputAbs, outputAbs, width, video } = opts;
  const ffmpeg = getFfmpegPath();
  ensureDir(path.dirname(outputAbs));

  const vf = `scale=${width}:-2:flags=lanczos`;
  const args = [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    ...(video ? ["-ss", "0.5"] : []),
    "-i",
    inputAbs,
    "-vframes",
    "1",
    "-vf",
    vf,
    "-c:v",
    "libwebp",
    "-quality",
    "75",
    outputAbs,
  ];

  const r = spawnSync(ffmpeg, args, { windowsHide: true });
  if (r.status !== 0) {
    try { fs.unlinkSync(outputAbs); } catch {}
    return { ok: false, err: (r.stderr || r.stdout || "ffmpeg failed").toString() };
  }
  return { ok: true };
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const collection = (url.searchParams.get("collection") || "gallery") as Collection;
    const name = url.searchParams.get("name") || "";
    const w = clampInt(Number(url.searchParams.get("w") || "384"), 128, 1024);

    if (collection !== "gallery" && collection !== "favorites") {
      return new NextResponse(svgFallback("bad collection"), { status: 400, headers: { "Content-Type": "image/svg+xml" } });
    }
    if (!isSafeBasename(name)) {
      return new NextResponse(svgFallback("bad name"), { status: 400, headers: { "Content-Type": "image/svg+xml" } });
    }

    const { deviceId, username, scope } = await getOwnerContext(req);

    let dirCandidates: string[] = [];
    if (collection === "gallery") {
      const dir = scope === "user" && username ? userGalleryDir(username) : deviceGalleryDir(deviceId);
      dirCandidates = [dir];
    } else {
      const d1 = favoritesDirDataRoot(scope === "user" ? username : null, deviceId);
      const d2 = guessFavoritesDirLegacy(scope === "user" ? username : null, deviceId);
      dirCandidates = [d1, d2];
    }

    let inputAbs: string | null = null;
    for (const d of dirCandidates) {
      try {
        const p = safeJoin(d, name);
        if (fs.existsSync(p)) {
          inputAbs = p;
          break;
        }
      } catch {}
    }
    if (!inputAbs) {
      return new NextResponse(svgFallback("missing"), { status: 404, headers: { "Content-Type": "image/svg+xml" } });
    }

    const st = fs.statSync(inputAbs);
    const cacheDir = path.join(OTG_DATA_ROOT, "thumbs");
    ensureDir(cacheDir);
    const key = `${inputAbs}|${st.mtimeMs}|${st.size}|${w}`;
    const outAbs = path.join(cacheDir, `${sha1(key)}.webp`);

    if (!fs.existsSync(outAbs)) {
      const r = ensureThumbWithFfmpeg({ inputAbs, outputAbs: outAbs, width: w, video: isVideo(name) });
      if (!r.ok) {
        return new NextResponse(svgFallback("thumb failed"), {
          status: 200,
          headers: { "Content-Type": "image/svg+xml", "X-OTG-Thumb-Error": "1" },
        });
      }
    }

    const buf = fs.readFileSync(outAbs);
    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type": "image/webp",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (e: any) {
    if (e instanceof SessionInvalidError) {
      return new NextResponse(svgFallback("unauthorized"), { status: 401, headers: { "Content-Type": "image/svg+xml" } });
    }
    return new NextResponse(svgFallback("error"), { status: 200, headers: { "Content-Type": "image/svg+xml" } });
  }
}
