function getDeviceId(): string {
  if (typeof window === "undefined") return "desktop_default";
  return (
    localStorage.getItem("otg_device_id") ||
    sessionStorage.getItem("otg_device_id") ||
    "desktop_default"
  );
}

import { NextRequest } from "next/server";
import sharp from "sharp";
import { createHash } from "crypto";

export const runtime = "nodejs"; // sharp requires node runtime

function num(v: string | null, d: number, min: number, max: number) {
  const n = Number(v);
  if (!Number.isFinite(n)) return d;
  return Math.min(max, Math.max(min, n));
}

function isVideoFile(name: string) {
  return /\.(mp4|webm)$/i.test(name || "");
}

function makeEtag(parts: Record<string, any>) {
  const s = JSON.stringify(parts);
  const h = createHash("sha1").update(s).digest("hex");
  return `"${h}"`;
}

function conditional(req: NextRequest, etag: string) {
  const inm = req.headers.get("if-none-match");
  if (inm && inm === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag } });

  }
  return null;
}

export async function GET(req: NextRequest) {
  const u = new URL(req.url);

  const mode = (u.searchParams.get("mode") || "thumb") as "thumb" | "view" | "raw";
  const filename = u.searchParams.get("filename") || "";
  const subfolder = u.searchParams.get("subfolder") || "";
  const type = u.searchParams.get("type") || "output";

  if (!filename) return new Response("Missing filename", { status: 400 });

  // Base Comfy UI URL from env (must match your /api/comfy proxy).
  // If you already use COMFY_HOST/COMFY_BASE_URL elsewhere, keep it consistent.
  const base =
    process.env.COMFYUI_URL ||
    process.env.COMFY_BASE_URL ||
    process.env.COMFY_HOST ||
    "http://127.0.0.1:8188";

  const isThumb = mode === "thumb";
  const isRaw = mode === "raw";
  const isVideo = isVideoFile(filename);

  // NOTE: For videos, we never try to transcode thumbnails here (no ffmpeg).
  // We only proxy the raw file for fast streaming/download.
  if (isVideo || isRaw) {
    // Raw proxy (streaming)
    const view = new URL("/view", base);
    view.searchParams.set("filename", filename);
    if (subfolder) view.searchParams.set("subfolder", subfolder);
    if (type) view.searchParams.set("type", type);

    const etag = makeEtag({ mode: "raw", filename, subfolder, type });
    const maybe304 = conditional(req, etag);
    if (maybe304) return maybe304;

    // Forward Range for video seeking + faster downloads
    const headers: Record<string, string> = {};
    const range = req.headers.get("range");
    if (range) headers["range"] = range;

    const r = await fetch(view.toString(), { headers });
    if (!r.ok) return new Response(`ComfyUI /view failed: ${r.status}`, { status: 502 });

    const outHeaders = new Headers();
    outHeaders.set("Cache-Control", "public, max-age=604800, immutable");
    outHeaders.set("ETag", etag);

    // Pass through important headers for streaming
    const pass = ["content-type", "content-length", "accept-ranges", "content-range"];
    for (const k of pass) {
      const v = r.headers.get(k);
      if (v) outHeaders.set(k, v);
    }
    // Avoid any intermediary compression issues
    outHeaders.set("X-Content-Type-Options", "nosniff");

    return new Response(r.body, {
      status: r.status, // preserves 206 for ranged responses
      headers: outHeaders,
    });
  }

  // Thumb/View image pipeline (sharp -> webp)
  const w = num(u.searchParams.get("w"), isThumb ? 420 : 1280, 200, 2400);
  const q = num(u.searchParams.get("q"), isThumb ? 62 : 78, 35, 92);

  const etag = makeEtag({ mode, w, q, filename, subfolder, type });
  const maybe304 = conditional(req, etag);
  if (maybe304) return maybe304;

  const view = new URL("/view", base);
  view.searchParams.set("filename", filename);
  if (subfolder) view.searchParams.set("subfolder", subfolder);
  if (type) view.searchParams.set("type", type);

  const r = await fetch(view.toString());
  if (!r.ok) return new Response(`ComfyUI /view failed: ${r.status}`, { status: 502 });

  const input = Buffer.from(await r.arrayBuffer());

  let out: Buffer;
  try {
    out = await sharp(input)
      .rotate()
      .resize({ width: w, withoutEnlargement: true })
      .webp({ quality: q })
      .toBuffer();
  } catch (e: any) {
    return new Response(`sharp error: ${String(e?.message ?? e)}`, { status: 500 });
  }

  const cache = isThumb ? "public, max-age=31536000, immutable" : "public, max-age=604800";

  return new Response(new Uint8Array(out), {
    status: 200,
    headers: { "Content-Type": "image/webp",
      "Cache-Control": cache,
      ETag: etag,
      "X-Content-Type-Options": "nosniff",
 },
  });
}
