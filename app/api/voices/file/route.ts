import fs from "node:fs";
import path from "node:path";

import { requireAdmin } from "@/app/api/admin/_requireAdmin";
import { OTG_VOICES_ROOT } from "@/lib/voicesPaths";
import { safeJoin } from "@/lib/paths";

function getMime(filename: string) {
  const ext = path.extname(filename).toLowerCase();
  switch (ext) {
    case ".wav":
      return "audio/wav";
    case ".mp3":
      return "audio/mpeg";
    case ".mp4":
      return "video/mp4";
    case ".webm":
      return "video/webm";
    case ".mov":
      return "video/quicktime";
    case ".json":
      return "application/json";
    case ".log":
      return "text/plain";
    case ".txt":
      return "text/plain";
    default:
      return "application/octet-stream";
  }
}

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return Response.json({ ok: false, error: admin.error }, { status: admin.status });
  }

  try {
    const url = new URL(req.url);
    const rel = (url.searchParams.get("rel") || "").trim();
    if (!rel) return Response.json({ ok: false, error: "Missing rel" }, { status: 400 });

    // rel is a posix-ish path under OTG_VOICES_ROOT.
    const safeRel = rel.replace(/\\/g, "/");
    const filePath = safeJoin(OTG_VOICES_ROOT, safeRel);

    if (!fs.existsSync(filePath)) return Response.json({ ok: false, error: "Not found" }, { status: 404 });
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return Response.json({ ok: false, error: "Not found" }, { status: 404 });

    const buf = fs.readFileSync(filePath);
    const headers = new Headers();
    headers.set("Content-Type", getMime(filePath));
    headers.set("Content-Length", String(buf.byteLength));
    headers.set("Cache-Control", "no-store");
    return new Response(buf, { status: 200, headers });
  } catch (e: any) {
    return Response.json({ ok: false, error: e?.message || "Unknown error" }, { status: 500 });
  }
}
