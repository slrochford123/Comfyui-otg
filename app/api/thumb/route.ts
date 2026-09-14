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
} from "@/lib/paths";
import { resolveFfmpegPath } from "@/lib/ffmpeg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

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

function sha1(input: string) {
  return crypto.createHash("sha1").update(input).digest("hex");
}

function svgFallback(label: string) {
  const safe = (label || "preview").replace(/[<>&"]/g, "");
  const svg =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
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

function ensureThumbWithFfmpeg(opts: {
  inputAbs: string;
  outputAbs: string;
  width: number;
  video: boolean;
}) {
  const { inputAbs, outputAbs, width, video } = opts;
  const ffmpeg = resolveFfmpegPath();
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
    try {
      fs.unlinkSync(outputAbs);
    } catch {}
    return { ok: false, err: (r.stderr || r.stdout || "ffmpeg failed").toString() };
  }
  return { ok: true };
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const collection = url.searchParams.get("collection") || "gallery";
    const name = url.searchParams.get("name") || "";
    const scopeHint = url.searchParams.get("scope");
    const w = clampInt(Number(url.searchParams.get("w") || "384"), 128, 1024);

    if (collection !== "gallery") {
      return new NextResponse(svgFallback("bad collection"), { status: 400, headers: { "Content-Type": "image/svg+xml" } });
    }
    if (!isSafeBasename(name)) {
      return new NextResponse(svgFallback("bad name"), { status: 400, headers: { "Content-Type": "image/svg+xml" } });
    }

    const { deviceId, username, scope } = await getOwnerContext(req);
    const effectiveScope = scopeHint === "user" || scopeHint === "device" ? scopeHint : scope;

    let dirCandidates: string[] = [];
    if (effectiveScope === "user" && username) {
      dirCandidates = [userGalleryDir(username)];
    } else {
      dirCandidates = [deviceGalleryDir(deviceId)];
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
