import { NextRequest, NextResponse } from "next/server";

import fs from "node:fs";

import { SessionInvalidError } from "@/lib/ownerKey";
import { requireSessionUser } from "@/lib/sessionUser";
import { getVoiceById, resolveVoicesFile } from "@/lib/voicesStudio";
import {
  deletePreset,
  getPresetById,
  listPresets,
  newPresetId,
  upsertPreset,
  type VoiceEmotion,
  type VoiceEmotionPreset,
} from "@/lib/voicesEmotions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type PostBody = {
  voiceId?: string;
  presetId?: string;
  emotion?: VoiceEmotion;
  label?: string;
  intensityTag?: number;
  refText?: string;
  refAudioRel?: string;
};

export async function GET(req: NextRequest) {
  try {
    const user = await requireSessionUser(req);
    const url = new URL(req.url);
    const voiceId = String(url.searchParams.get("voiceId") || "").trim();
    if (!voiceId) return NextResponse.json({ ok: false, error: "Missing voiceId" }, { status: 400 });

    const voice = getVoiceById(user.ownerKey, voiceId);
    if (!voice) return NextResponse.json({ ok: false, error: "Voice not found" }, { status: 404 });

    const presets = listPresets(user.ownerKey, voiceId);
    return NextResponse.json({ ok: true, voiceId, presets }, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    if (e instanceof SessionInvalidError) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ ok: false, error: e?.message || "error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireSessionUser(req);
    const body = (await req.json().catch(() => ({}))) as PostBody;
    const voiceId = String(body.voiceId || "").trim();
    if (!voiceId) return NextResponse.json({ ok: false, error: "Missing voiceId" }, { status: 400 });

    const voice = getVoiceById(user.ownerKey, voiceId);
    if (!voice) return NextResponse.json({ ok: false, error: "Voice not found" }, { status: 404 });

    const presetIdRaw = String(body.presetId || "").trim();
    const existing = presetIdRaw ? getPresetById(user.ownerKey, voiceId, presetIdRaw) : null;

    const now = new Date().toISOString();
    const preset: VoiceEmotionPreset = {
      presetId: existing?.presetId || presetIdRaw || newPresetId(user.ownerKey, voiceId),
      voiceId,
      emotion: (body.emotion || existing?.emotion || "custom") as any,
      label: String(body.label || existing?.label || "Preset").trim() || "Preset",
      intensityTag: typeof body.intensityTag === "number" ? body.intensityTag : existing?.intensityTag,
      refText: typeof body.refText === "string" ? body.refText : (existing?.refText || ""),
      refAudioRel: typeof body.refAudioRel === "string" ? body.refAudioRel : (existing?.refAudioRel || ""),
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };

    const saved = upsertPreset(user.ownerKey, preset);
    return NextResponse.json({ ok: true, preset: saved }, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    if (e instanceof SessionInvalidError) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ ok: false, error: e?.message || "error" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const user = await requireSessionUser(req);
    const url = new URL(req.url);
    const voiceId = String(url.searchParams.get("voiceId") || "").trim();
    const presetId = String(url.searchParams.get("presetId") || "").trim();
    if (!voiceId) return NextResponse.json({ ok: false, error: "Missing voiceId" }, { status: 400 });
    if (!presetId) return NextResponse.json({ ok: false, error: "Missing presetId" }, { status: 400 });

    const voice = getVoiceById(user.ownerKey, voiceId);
    if (!voice) return NextResponse.json({ ok: false, error: "Voice not found" }, { status: 404 });

    const preset = getPresetById(user.ownerKey, voiceId, presetId);
    const ok = deletePreset(user.ownerKey, voiceId, presetId);

    // best-effort remove file
    if (ok && preset?.refAudioRel) {
      try {
        // refAudioRel is always under voicesRoot
        const abs = resolveVoicesFile(preset.refAudioRel);
        if (abs && fs.existsSync(abs)) fs.rmSync(abs, { force: true });
      } catch {
        // ignore
      }
    }

    return NextResponse.json({ ok: true, deleted: ok, voiceId, presetId }, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    if (e instanceof SessionInvalidError) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ ok: false, error: e?.message || "error" }, { status: 500 });
  }
}
