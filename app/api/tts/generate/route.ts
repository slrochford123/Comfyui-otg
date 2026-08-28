import { NextRequest, NextResponse } from "next/server";
import path from "node:path";

import { resolveVoiceComfyBaseUrl } from "@/app/api/_lib/comfyTarget";
import { SessionInvalidError } from "@/lib/ownerKey";
import { requireSessionUser } from "@/lib/sessionUser";
import { fetchComfyViewBytes, readWorkflowJson, submitWorkflow, uploadFileToComfy, waitForAudio } from "@/lib/comfyVoices";
import { getVoiceById, resolveVoicesFile, voicesOutputsDir, writeBinaryFile, upsertVoice } from "@/lib/voicesStudio";
import { getPresetById } from "@/lib/voicesEmotions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type Body = {
  voiceId?: string;
  presetId?: string;
  text?: string;
  speed?: number;
  pitch?: number;
  format?: string;
};

function maxTextLen(): number {
  const n = Number(process.env.TTS_MAX_TEXT_LEN || process.env.VOICES_MAX_TEXT_LEN || 500);
  if (!Number.isFinite(n) || n <= 0) return 500;
  return Math.min(5000, n);
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireSessionUser(req);
    const body = (await req.json().catch(() => ({}))) as Body;

    const voiceId = String(body.voiceId || "").trim();
    const text = String(body.text || "").trim();

    if (!voiceId) return NextResponse.json({ ok: false, error: "Missing voiceId" }, { status: 400 });
    if (!text) return NextResponse.json({ ok: false, error: "Missing text" }, { status: 400 });
    if (text.length > maxTextLen()) {
      return NextResponse.json({ ok: false, error: `Text too long (max ${maxTextLen()} chars)` }, { status: 400 });
    }

    const voice = getVoiceById(user.ownerKey, voiceId);
    if (!voice) return NextResponse.json({ ok: false, error: "Voice not found" }, { status: 404 });

    const presetId = String(body.presetId || "").trim();
    const preset = presetId ? getPresetById(user.ownerKey, voiceId, presetId) : null;

    const refAudioRel = preset?.refAudioRel || voice.refAudioRel;
    const refText = preset?.refText ?? voice.refText;

    if (!refAudioRel) return NextResponse.json({ ok: false, error: "Voice has no reference audio" }, { status: 400 });

    const { baseUrl } = await resolveVoiceComfyBaseUrl();

    const refAbs = resolveVoicesFile(refAudioRel);
    const comfyRefName = await uploadFileToComfy(refAbs, "image", baseUrl);

    const tmpl = await readWorkflowJson("internal/voices/voice_clone.json");
    const workflow = JSON.parse(JSON.stringify(tmpl));

    if (workflow?.["71"]?.inputs) {
      workflow["71"].inputs.audio = comfyRefName;
      workflow["71"].inputs.audioUI = "";
    }
    if (workflow?.["80"]?.inputs) workflow["80"].inputs.value = String(refText || "");
    if (workflow?.["78"]?.inputs) workflow["78"].inputs.value = text;

    const clientId = req.headers.get("x-otg-device-id") || "otg_voices";
    const promptId = await submitWorkflow(workflow, String(clientId), baseUrl);

    const out = await waitForAudio(promptId, 180_000, baseUrl);
    const bytes = await fetchComfyViewBytes(out, baseUrl);

    const ext = path.extname(out.filename || "") || ".flac";
    const outName = `tts_${Date.now()}${ext}`;
    const absOut = path.join(voicesOutputsDir(voiceId), outName);
    writeBinaryFile(absOut, bytes);

    upsertVoice(user.ownerKey, { ...voice, updatedAt: new Date().toISOString() } as any);

    const bust = `v=${Date.now()}`;
    const audioUrl = `/api/file?path=${encodeURIComponent(absOut)}&${bust}`;

    return NextResponse.json(
      {
        ok: true,
        promptId,
        audioUrl,
        previewUrl: audioUrl,
        audioPath: absOut,
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
