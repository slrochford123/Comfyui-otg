import { NextRequest, NextResponse } from "next/server";

import fs from "node:fs";

import { SessionInvalidError } from "@/lib/ownerKey";
import { requireSessionUser } from "@/lib/sessionUser";
import { safeJoin, safeSegment } from "@/lib/paths";
import {

  getVoiceById,
  loadVoicesLibrary,
  voicesRoot,
  deleteVoice,
  newVoiceId,
  resolveVoicesFile,
  upsertVoice,
  type VoiceStudioEntry,
  type VoiceStudioType,
} from "@/lib/voicesStudio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type PostBody = {
  voiceId?: string;
  name?: string;
  tags?: string[];
  type?: VoiceStudioType;
  refText?: string;
  refAudioRel?: string;
  refVideoRel?: string;
};

function cleanTags(tags: any): string[] {
  if (!Array.isArray(tags)) return [];
  return tags
    .map((t) => String(t || "").trim())
    .filter(Boolean)
    .slice(0, 12);
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireSessionUser(req);
    const lib = loadVoicesLibrary(user.ownerKey);

    const ttsMax = (() => {
      const n = Number(process.env.TTS_MAX_TEXT_LEN || 500);
      if (!Number.isFinite(n) || n <= 0) return 500;
      return Math.min(5000, n);
    })();

    const scriptMax = (() => {
      const n = Number(process.env.VOICES_MAX_TEXT_LEN || 2000);
      if (!Number.isFinite(n) || n <= 0) return 2000;
      return Math.min(15000, n);
    })();

    const maxUploadMb = (() => {
      const mb = Number(process.env.VOICES_MAX_UPLOAD_MB || 25);
      if (!Number.isFinite(mb) || mb <= 0) return 25;
      return Math.min(200, mb);
    })();

    const voices = lib.voices.map((v) => {
      const abs = v.refAudioRel ? resolveVoicesFile(v.refAudioRel) : "";
      const refAudioUrl = abs ? `/api/file?path=${encodeURIComponent(abs)}` : "";
      return { ...v, refAudioUrl };
    });

    return NextResponse.json(
      { ok: true, voices, limits: { ttsMaxTextLen: ttsMax, scriptMaxTextLen: scriptMax, maxUploadMb } },
      { headers: { "Cache-Control": "no-store" } }
    );
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
    if (!voiceId) {
      return NextResponse.json({ ok: false, error: "Missing voiceId" }, { status: 400 });
    }

    const v = getVoiceById(user.ownerKey, voiceId);
    if (!v) {
      return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    }

    const deleted = deleteVoice(user.ownerKey, voiceId);

    // Best-effort cleanup: remove samples/<voiceId>/ and outputs/<voiceId>/
    try {
      const root = voicesRoot();
      const sid = safeSegment(voiceId);
      const samplesDir = safeJoin(root, "samples", sid);
      const outputsDir = safeJoin(root, "outputs", sid);
      fs.rmSync(samplesDir, { recursive: true, force: true });
      fs.rmSync(outputsDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }

    return NextResponse.json({ ok: true, deleted, voiceId }, { headers: { "Cache-Control": "no-store" } });
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

    const voiceIdRaw = String(body.voiceId || "").trim();
    const name = String(body.name || "").trim();
    const type = (body.type as VoiceStudioType) || (voiceIdRaw ? (getVoiceById(user.ownerKey, voiceIdRaw)?.type || "cloned") : "cloned");

    if (!voiceIdRaw && !name) {
      return NextResponse.json({ ok: false, error: "Missing name" }, { status: 400 });
    }

    const existing = voiceIdRaw ? getVoiceById(user.ownerKey, voiceIdRaw) : null;
    const now = new Date().toISOString();

    const entry: VoiceStudioEntry = {
      voiceId: existing?.voiceId || (voiceIdRaw || newVoiceId(user.ownerKey)),
      name: name || existing?.name || "Untitled",
      tags: cleanTags(body.tags ?? existing?.tags ?? []),
      type,
      refText: typeof body.refText === "string" ? body.refText : (existing?.refText || ""),
      refAudioRel: typeof body.refAudioRel === "string" ? body.refAudioRel : (existing?.refAudioRel || ""),
      refVideoRel: typeof body.refVideoRel === "string" ? body.refVideoRel : existing?.refVideoRel,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };

    const saved = upsertVoice(user.ownerKey, entry);
    return NextResponse.json({ ok: true, voice: saved }, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    if (e instanceof SessionInvalidError) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ ok: false, error: e?.message || "error" }, { status: 500 });
  }
}
