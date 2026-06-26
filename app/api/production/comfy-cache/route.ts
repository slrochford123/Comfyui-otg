import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import path from "path";
import { promises as fs } from "fs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CACHE_ROOT = path.join(process.cwd(), "data", "production-assets", "comfy-cache");

function safeSegment(value: string, fallback: string) {
  const cleaned = String(value || "")
    .replace(/\\/g, "/")
    .split("/")
    .filter(Boolean)
    .join("_")
    .replace(/[^a-zA-Z0-9_.-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 180);
  return cleaned || fallback;
}

function contentTypeForName(name: string) {
  const lower = name.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".mp4")) return "video/mp4";
  if (lower.endsWith(".webm")) return "video/webm";
  return "application/octet-stream";
}

async function fileExists(filePath: string) {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

function upstreamComfyViewUrl(request: NextRequest) {
  const url = new URL(request.url);
  const src = String(url.searchParams.get("src") || "").trim();
  const origin = url.origin;

  if (src) {
    try {
      const parsed = new URL(src, origin);
      const lowerPath = parsed.pathname.toLowerCase();
      if (lowerPath.includes("/api/comfy/view") || lowerPath.endsWith("/view") || lowerPath.endsWith("/view/")) {
        return `${origin}/api/comfy/view${parsed.search}`;
      }
      if (parsed.searchParams.get("filename")) {
        const params = new URLSearchParams();
        params.set("filename", parsed.searchParams.get("filename") || "");
        params.set("type", parsed.searchParams.get("type") || "output");
        params.set("subfolder", parsed.searchParams.get("subfolder") || "");
        return `${origin}/api/comfy/view?${params.toString()}`;
      }
    } catch {
      if (/^\/?view\?/i.test(src) || src.includes("view?filename=")) {
        const query = src.slice(src.indexOf("?") + 1);
        return `${origin}/api/comfy/view?${query}`;
      }
    }
  }

  const filename = String(url.searchParams.get("filename") || "").trim();
  if (!filename) return "";

  const params = new URLSearchParams();
  params.set("filename", filename);
  params.set("type", String(url.searchParams.get("type") || "output"));
  params.set("subfolder", String(url.searchParams.get("subfolder") || ""));
  return `${origin}/api/comfy/view?${params.toString()}`;
}

function cacheIdentity(request: NextRequest) {
  const url = new URL(request.url);
  const src = String(url.searchParams.get("src") || "").trim();
  const filename = String(url.searchParams.get("filename") || "").trim();

  let source = src;
  let name = filename;

  if (src) {
    try {
      const parsed = new URL(src, url.origin);
      name = parsed.searchParams.get("filename") || path.basename(parsed.pathname) || filename;
      source = `${parsed.pathname}?${parsed.searchParams.toString()}`;
    } catch {
      const match = src.match(/[?&]filename=([^&]+)/i);
      if (match) name = decodeURIComponent(match[1]);
      source = src;
    }
  }

  name = safeSegment(name || "comfy-output.bin", "comfy-output.bin");
  const hash = crypto.createHash("sha1").update(source || name).digest("hex").slice(0, 16);
  return {
    name,
    filePath: path.join(CACHE_ROOT, hash, name),
  };
}

export async function GET(request: NextRequest) {
  const upstream = upstreamComfyViewUrl(request);
  const cache = cacheIdentity(request);

  if (!upstream) {
    return NextResponse.json({ ok: false, error: "Missing Comfy view filename/src." }, { status: 400 });
  }

  if (await fileExists(cache.filePath)) {
    const bytes = await fs.readFile(cache.filePath);
    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "content-type": contentTypeForName(cache.name),
        "cache-control": "public, max-age=31536000, immutable",
        "x-otg-asset-cache": "hit",
      },
    });
  }

  const upstreamResponse = await fetch(upstream, { cache: "no-store" });

  if (!upstreamResponse.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: `Comfy source image is not available and no repo cached copy exists (${upstreamResponse.status}).`,
        upstreamStatus: upstreamResponse.status,
      },
      { status: upstreamResponse.status || 502 },
    );
  }

  const bytes = Buffer.from(await upstreamResponse.arrayBuffer());
  await fs.mkdir(path.dirname(cache.filePath), { recursive: true });
  await fs.writeFile(cache.filePath, bytes);

  return new NextResponse(bytes, {
    status: 200,
    headers: {
      "content-type": upstreamResponse.headers.get("content-type") || contentTypeForName(cache.name),
      "cache-control": "public, max-age=31536000, immutable",
      "x-otg-asset-cache": "stored",
      "x-otg-asset-cache-path": path.relative(process.cwd(), cache.filePath),
    },
  });
}
