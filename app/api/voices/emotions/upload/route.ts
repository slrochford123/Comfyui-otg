import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import fs from "node:fs";

import { SessionInvalidError } from "@/lib/ownerKey";
import { requireSessionUser } from "@/lib/sessionUser";
import { ensureDir, safeJoin, safeSegment } from "@/lib/paths";
import { getVoiceById, voicesSamplesDir, writeBinaryFile } from "@/lib/voicesStudio";
import { getPresetById, newPresetId, upsertPreset, type VoiceEmotion } from "@/lib/voicesEmotions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const MAX_MB = 50;

function safeExt(filename: string): string {
  const ext = path.extname(filename || "").toLowerCase();
  if ([".wav", ".mp3", ".m4a", ".flac", ".aac", ".ogg", ".webm", ".mp4"].includes(ext)) return ext;
  return ".wav";
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireSessionUser(req);
    const form = await req.formData();

    const voiceId = String(form.get("voiceId") || "").trim();
    const presetIdRaw = String(form.get("presetId") || "").trim();
    const emotion = String(form.get("emotion") || "custom").trim() as VoiceEmotion;
    const label = String(form.get("label") || "").trim();
    const intensityTag = Number(form.get("intensityTag") || 0);
    const file = form.get("file") as File | null;

    if (!voiceId) return NextResponse.json({ ok: false, error: "Missing voiceId" }, { status: 400 });
    if (!file) return NextResponse.json({ ok: false, error: "Missing file" }, { status: 400 });

    const voice = getVoiceById(user.ownerKey, voiceId);
    if (!voice) return NextResponse.json({ ok: false, error: "Voice not found" }, { status: 404 });

    const sizeMb = Number(file.size || 0) / (1024 * 1024);
    if (sizeMb > MAX_MB) {
      return NextResponse.json({ ok: false, error: `File too large (max ${MAX_MB} MB)` }, { status: 400 });
    }

    const existing = presetIdRaw ? getPresetById(user.ownerKey, voiceId, presetIdRaw) : null;
    const presetId = existing?.presetId || presetIdRaw || newPresetId(user.ownerKey, voiceId);

    const buf = Buffer.from(await file.arrayBuffer());
    const ext = safeExt(file.name);

    const base = voicesSamplesDir(voiceId);
    const emoDir = safeJoin(base, "emotions", safeSegment(emotion || "custom"));
    ensureDir(emoDir);

    const outName = `preset_${Date.now()}${ext}`;
    const abs = safeJoin(emoDir, outName);
    writeBinaryFile(abs, buf);

    const rel = path.posix.join("samples", safeSegment(voiceId), "emotions", safeSegment(emotion || "custom"), outName);

    const saved = upsertPreset(user.ownerKey, {
      presetId,
      voiceId,
      emotion: (emotion || "custom") as any,
      label: label || existing?.label || `${emotion}`,
      intensityTag: Number.isFinite(intensityTag) && intensityTag > 0 ? intensityTag : existing?.intensityTag,
      refText: existing?.refText || "",
      refAudioRel: rel,
      createdAt: existing?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    return NextResponse.json(
      {
        ok: true,
        preset: saved,
        audioUrl: `/api/file?path=${encodeURIComponent(abs)}`,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: any) {
    if (e instanceof SessionInvalidError) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ ok: false, error: e?.message || "error" }, { status: 500 });
  }
}
