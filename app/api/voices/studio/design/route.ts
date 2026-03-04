import { NextRequest, NextResponse } from "next/server";
import path from "node:path";

import { resolveComfyBaseUrl } from "@/app/api/_lib/comfyTarget";
import { SessionInvalidError } from "@/lib/ownerKey";
import { requireSessionUser } from "@/lib/sessionUser";
import { fetchComfyViewBytes, readWorkflowJson, submitWorkflow, waitForAudio } from "@/lib/comfyVoices";
import { getVoiceById, newVoiceId, upsertVoice, voicesOutputsDir, writeBinaryFile, type VoiceStudioEntry } from "@/lib/voicesStudio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type Body = {
  voiceId?: string;
  name?: string;
  tags?: string[];
  description?: string; // voice description/instructions
  text?: string; // sample line to speak
};

function cleanTags(tags: any): string[] {
  if (!Array.isArray(tags)) return [];
  return tags.map((t) => String(t || "").trim()).filter(Boolean).slice(0, 12);
}

function maxTextLen(): number {
  const n = Number(process.env.TTS_MAX_TEXT_LEN || process.env.VOICES_MAX_TEXT_LEN || 500);
  if (!Number.isFinite(n) || n <= 0) return 500;
  return Math.min(5000, n);
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireSessionUser(req);
    const body = (await req.json().catch(() => ({}))) as Body;

    const name = String(body.name || "").trim();
    const description = String(body.description || "").trim();
    const sampleText = String(body.text || "").trim();

    if (!name) return NextResponse.json({ ok: false, error: "Missing name" }, { status: 400 });
    if (!description) return NextResponse.json({ ok: false, error: "Missing description" }, { status: 400 });
    if (!sampleText) return NextResponse.json({ ok: false, error: "Missing text" }, { status: 400 });
    if (sampleText.length > maxTextLen()) {
      return NextResponse.json({ ok: false, error: `Text too long (max ${maxTextLen()} chars)` }, { status: 400 });
    }

    const voiceIdRaw = String(body.voiceId || "").trim();
    const existing = voiceIdRaw ? getVoiceById(user.ownerKey, voiceIdRaw) : null;

    const voiceId = existing?.voiceId || voiceIdRaw || newVoiceId(user.ownerKey);
    const now = new Date().toISOString();

    const baseEntry: VoiceStudioEntry = {
      voiceId,
      name,
      tags: cleanTags(body.tags),
      type: "created",
      refText: existing?.refText || "",
      refAudioRel: existing?.refAudioRel || "",
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };

    // Ensure it exists in library before running.
    const savedBase = upsertVoice(user.ownerKey, baseEntry);

    const { baseUrl } = await resolveComfyBaseUrl();

    const tmpl = await readWorkflowJson("internal/voices/voice_creation.json");
    const workflow = JSON.parse(JSON.stringify(tmpl));

    if (workflow?.["77"]?.inputs) workflow["77"].inputs.value = description;
    if (workflow?.["76"]?.inputs) workflow["76"].inputs.value = sampleText;

    const clientId = req.headers.get("x-otg-device-id") || "otg_voices";
    const promptId = await submitWorkflow(workflow, String(clientId), baseUrl);

    const out = await waitForAudio(promptId, 240_000, baseUrl);
    const bytes = await fetchComfyViewBytes(out, baseUrl);

    const ext = path.extname(out.filename || "") || ".flac";
    const outName = `design_ref_${Date.now()}${ext}`;
    const absOut = path.join(voicesOutputsDir(voiceId), outName);
    writeBinaryFile(absOut, bytes);

    const rel = path.posix.join("outputs", voiceId, outName);

    const final = upsertVoice(user.ownerKey, {
      ...savedBase,
      refAudioRel: rel,
      refText: sampleText,
      updatedAt: new Date().toISOString(),
    });

    return NextResponse.json(
      {
        ok: true,
        promptId,
        voice: final,
        audioUrl: `/api/file?path=${encodeURIComponent(absOut)}`,
        comfyBaseUrl: baseUrl,
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
