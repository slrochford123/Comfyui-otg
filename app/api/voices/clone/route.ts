import fs from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";

import { requireAdmin } from "@/app/api/admin/_requireAdmin";
import { ensureDir, safeJoin, safeSegment, writeJsonSafe } from "@/lib/paths";
import { voicesExtractionsRoot, voicesProfilesRoot, voicesUserIdFromAuth } from "@/lib/voicesPaths";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type CloneBody = {
  // Preferred (current UI)
  extractId?: string;
  displayName?: string;
  // Back-compat (older UI)
  audioId?: string;
  characterName?: string;
};

function safeDisplayName(name: string) {
  return name
    .trim()
    .replace(/[^\w\- ]+/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 60);
}

function nowId(prefix: string): string {
  const rnd = Math.random().toString(16).slice(2, 10);
  return `${prefix}_${Date.now()}_${rnd}`;
}

function legacyAudioPath(audioId: string) {
  const dataRoot = process.env.OTG_DATA_DIR
    ? path.resolve(process.env.OTG_DATA_DIR)
    : path.resolve(process.cwd(), "data");
  return path.join(dataRoot, "voices", "audio", `${audioId}.wav`);
}

/**
 * Creates a catalog voice from an extracted clip.
 *
 * Output is compatible with the existing Qwen3TTS "profiles" layout:
 *  OTG_DATA_ROOT/voices/users/<userId>/profiles/<voiceId>/{profile.json, source/audio/ref.wav}
 */
export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return NextResponse.json({ ok: false, error: admin.error }, { status: admin.status });
  }

  try {
    const body = (await req.json().catch(() => ({}))) as CloneBody;
    const extractId = String(body.extractId ?? body.audioId ?? "").trim();
    const displayNameRaw = String(body.displayName ?? body.characterName ?? "").trim();

    if (!extractId) {
      return NextResponse.json({ ok: false, error: "Missing extractId" }, { status: 400 });
    }
    if (!displayNameRaw) {
      return NextResponse.json({ ok: false, error: "Missing displayName" }, { status: 400 });
    }

    const displayName = safeDisplayName(displayNameRaw);
    if (!displayName) {
      return NextResponse.json({ ok: false, error: "Invalid displayName" }, { status: 400 });
    }

    const userId = voicesUserIdFromAuth(admin.email, admin.username);
    const exRoot = voicesExtractionsRoot(userId);
    const exDir = safeJoin(exRoot, safeSegment(extractId));
    const exWav = safeJoin(exDir, "audio_24k_mono.wav");
    const src = fs.existsSync(exWav) ? exWav : legacyAudioPath(extractId);
    if (!fs.existsSync(src)) {
      return NextResponse.json({ ok: false, error: "Source audio not found" }, { status: 404 });
    }

    const voiceId = nowId("v");
    const profRoot = voicesProfilesRoot(userId);
    const voiceDir = safeJoin(profRoot, voiceId);
    const sourceAudioDir = safeJoin(voiceDir, "source", "audio");
    ensureDir(sourceAudioDir);

    // Qwen3TTS reference audio
    const refWav = safeJoin(sourceAudioDir, "ref.wav");
    fs.copyFileSync(src, refWav);

    const profile = {
      voiceId,
      displayName,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      source: { type: "extraction", extractId },
      qwen: { status: "ready" },
    };
    writeJsonSafe(safeJoin(voiceDir, "profile.json"), profile);

    return NextResponse.json(
      { ok: true, voiceId, displayName },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Clone failed" }, { status: 500 });
  }
}
