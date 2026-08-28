import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

import { NextRequest, NextResponse } from "next/server";

import { getOwnerContext, SessionInvalidError } from "@/lib/ownerKey";
import { ensureDir, OTG_DATA_ROOT, safeJoin, safeSegment } from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const AUDIO_RE = /\.(wav|mp3|flac|m4a|aac|ogg)$/i;

function voiceGalleryRoot(ownerKey: string) {
  return path.join(OTG_DATA_ROOT, "voice_gallery", safeSegment(ownerKey || "local"));
}

function fileUrl(fileName: string) {
  return `/api/edit-video/extract-audio/file?name=${encodeURIComponent(fileName)}`;
}

export async function GET(req: NextRequest) {
  try {
    const owner = await getOwnerContext(req);
    const root = voiceGalleryRoot(owner.ownerKey);
    ensureDir(root);
    const entries = fs.readdirSync(root, { withFileTypes: true });
    const items = [];
    for (const entry of entries) {
      if (!entry.isFile() || !AUDIO_RE.test(entry.name)) continue;
      const full = safeJoin(root, entry.name);
      const stat = fs.statSync(full);
      let meta: any = {};
      const metaPath = `${full}.json`;
      if (fs.existsSync(metaPath)) {
        try { meta = JSON.parse(await fsp.readFile(metaPath, "utf8")); } catch { meta = {}; }
      }
      items.push({
        fileName: entry.name,
        url: fileUrl(entry.name),
        mode: meta.mode || (entry.name.toLowerCase().includes("enhance") ? "enhance" : "raw"),
        sourceVideoName: meta.sourceVideoName || "",
        durationSeconds: meta.durationSeconds || undefined,
        sizeBytes: stat.size,
        createdAt: meta.createdAt || new Date(stat.mtimeMs).toISOString(),
      });
    }
    items.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
    return NextResponse.json({ ok: true, root, items }, { headers: { "Cache-Control": "no-store" } });
  } catch (error: any) {
    if (error instanceof SessionInvalidError) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ ok: false, error: error?.message || "Voice gallery list failed" }, { status: 500 });
  }
}
