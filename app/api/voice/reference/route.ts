import path from "node:path";
import fs from "node:fs/promises";

import { NextRequest, NextResponse } from "next/server";

import { SessionInvalidError } from "@/lib/ownerKey";
import { requireSessionUser } from "@/lib/sessionUser";
import {
  newVoiceId,
  upsertVoice,
  voicesSamplesDir,
  type VoiceStudioEntry,
} from "@/lib/voicesStudio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const AUDIO_EXTENSIONS = /\.(wav|mp3|m4a|aac|ogg|flac|webm)$/i;

function maxUploadBytes() {
  const mb = Number(process.env.VOICES_MAX_UPLOAD_MB || 25);
  return (Number.isFinite(mb) && mb > 0 ? Math.min(200, mb) : 25) * 1024 * 1024;
}

function cleanName(value: unknown) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9._ -]+/g, "_")
    .replace(/\s+/g, " ")
    .slice(0, 100);
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireSessionUser(request);
    const form = await request.formData();
    const file = form.get("file");
    if (!file || typeof (file as any).arrayBuffer !== "function") {
      return NextResponse.json({ ok: false, error: "Choose a clean voice sample first." }, { status: 400 });
    }

    const audioFile = file as File;
    const fileName = String(audioFile.name || "reference.wav");
    const size = Number((audioFile as any).size || 0);
    if (!Number.isFinite(size) || size <= 0) {
      return NextResponse.json({ ok: false, error: "The voice sample is empty." }, { status: 400 });
    }
    if (size > maxUploadBytes()) {
      return NextResponse.json({ ok: false, error: "The voice sample is too large." }, { status: 413 });
    }
    if (!AUDIO_EXTENSIONS.test(fileName)) {
      return NextResponse.json({ ok: false, error: "Use WAV, MP3, M4A, AAC, OGG, FLAC, or WEBM audio." }, { status: 415 });
    }

    const voiceId = newVoiceId(user.ownerKey);
    const dir = voicesSamplesDir(voiceId);
    const extension = path.extname(fileName).toLowerCase() || ".wav";
    const storedName = `reference${extension}`;
    const absolutePath = path.join(dir, storedName);
    await fs.writeFile(absolutePath, Buffer.from(await audioFile.arrayBuffer()));

    const now = new Date().toISOString();
    const entry: VoiceStudioEntry = {
      voiceId,
      name: cleanName(form.get("name")) || "Quick Reference Voice",
      tags: ["reference", "seed-vc"],
      type: "cloned",
      refText: String(form.get("refText") || "").trim(),
      refAudioRel: path.posix.join("samples", voiceId, storedName),
      createdAt: now,
      updatedAt: now,
    };
    const saved = upsertVoice(user.ownerKey, entry);

    return NextResponse.json({
      ok: true,
      voice: saved,
      message: "Reference voice added. It is ready for Preserve Performance conversion.",
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error: any) {
    if (error instanceof SessionInvalidError) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ ok: false, error: error?.message || "Reference voice upload failed." }, { status: 500 });
  }
}
