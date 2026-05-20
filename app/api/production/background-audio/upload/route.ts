import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";

import { getOwnerContext, SessionInvalidError } from "@/lib/ownerKey";
import { OTG_DATA_ROOT, ensureDir, safeSegment } from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const AUDIO_EXT_RE = /\.(mp3|wav|m4a|aac|ogg|flac|webm)$/i;

function safeAudioFileName(name: string) {
  const base = path.basename(String(name || "background_audio").replace(/\\/g, "/"));
  const cleaned = base.replace(/[^a-zA-Z0-9._ -]/g, "_").replace(/\s+/g, " ").trim();
  const fallback = `background_audio_${Date.now()}.mp3`;
  return AUDIO_EXT_RE.test(cleaned) ? cleaned : fallback;
}

function fileUrlFor(absPath: string) {
  return `/api/file?path=${encodeURIComponent(absPath)}`;
}

export async function POST(req: NextRequest) {
  try {
    const owner = await getOwnerContext(req);
    const form = await req.formData();

    const file = form.get("file") as any;
    const productionId = safeSegment(String(form.get("productionId") || "production").trim() || "production");

    if (!file || typeof file.arrayBuffer !== "function") {
      return NextResponse.json({ ok: false, error: "Audio file is required." }, { status: 400 });
    }

    const originalName = safeAudioFileName(String(file.name || `background_audio_${Date.now()}.mp3`));
    if (!AUDIO_EXT_RE.test(originalName)) {
      return NextResponse.json({ ok: false, error: "Unsupported audio type. Use mp3, wav, m4a, aac, ogg, flac, or webm." }, { status: 400 });
    }

    const dir = path.join(
      OTG_DATA_ROOT,
      "productions",
      safeSegment(owner.ownerKey || "local"),
      productionId,
      "background-audio"
    );

    await ensureDir(dir);

    const savedName = `bg_${Date.now()}_${safeSegment(originalName)}`;
    const audioPath = path.join(dir, savedName);

    const buffer = Buffer.from(await file.arrayBuffer());
    if (!buffer.length) {
      return NextResponse.json({ ok: false, error: "Uploaded audio file was empty." }, { status: 400 });
    }

    await fs.writeFile(audioPath, buffer);

    return NextResponse.json({
      ok: true,
      audioPath,
      audioUrl: fileUrlFor(audioPath),
      fileName: savedName,
      originalFileName: originalName,
    });
  } catch (error: any) {
    if (error instanceof SessionInvalidError) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    return NextResponse.json({ ok: false, error: error?.message || "Audio upload failed." }, { status: 500 });
  }
}
