import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import { execFile } from "node:child_process";

import { SessionInvalidError } from "@/lib/ownerKey";
import { requireSessionUser } from "@/lib/sessionUser";
import { getVoiceById, resolveVoicesFile, upsertVoice } from "@/lib/voicesStudio";
import { getPresetById, upsertPreset } from "@/lib/voicesEmotions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type Body = { voiceId?: string; presetId?: string; language?: string };

function whisperTimeoutMs(): number {
  const ms = Number(process.env.WHISPER_TIMEOUT_MS || 120000);
  return Number.isFinite(ms) && ms > 1000 ? ms : 120000;
}

function runWhisper(py: string, script: string, args: string[], timeoutMs: number): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = execFile(py, [script, ...args], { timeout: timeoutMs, windowsHide: true }, (err, stdout, stderr) => {
      if (err && (err as any).killed) {
        return reject(new Error(`Whisper timed out after ${timeoutMs}ms`));
      }
      const code = (err as any)?.code ?? 0;
      resolve({ code: typeof code === "number" ? code : 0, stdout: String(stdout || ""), stderr: String(stderr || "") });
    });
    child.on("error", reject);
  });
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireSessionUser(req);
    const body = (await req.json().catch(() => ({}))) as Body;
    const voiceId = String(body.voiceId || "").trim();
    if (!voiceId) return NextResponse.json({ ok: false, error: "Missing voiceId" }, { status: 400 });

    const voice = getVoiceById(user.ownerKey, voiceId);
    if (!voice) return NextResponse.json({ ok: false, error: "Voice not found" }, { status: 404 });

    const presetId = String(body.presetId || "").trim();
    const preset = presetId ? getPresetById(user.ownerKey, voiceId, presetId) : null;

    const relToUse = preset?.refAudioRel || voice.refAudioRel;
    if (!relToUse) return NextResponse.json({ ok: false, error: "No reference audio uploaded" }, { status: 400 });

    const abs = resolveVoicesFile(relToUse);

    const py = (process.env.WHISPER_PYTHON || "python").trim() || "python";
    const model = (process.env.WHISPER_MODEL || "small").trim() || "small";
    const device = (process.env.WHISPER_DEVICE || "auto").trim() || "auto";
    const computeType = (process.env.WHISPER_COMPUTE_TYPE || "auto").trim() || "auto";

    const script = path.join(process.cwd(), "scripts", "whisper", "transcribe.py");

    const args: string[] = ["--audio", abs, "--model", model, "--device", device, "--compute_type", computeType];
    const lang = String(body.language || "").trim();
    if (lang) args.push("--language", lang);

    const r = await runWhisper(py, script, args, whisperTimeoutMs());
    const raw = (r.stdout || "").trim();

    let parsed: any = null;
    try {
      parsed = raw ? JSON.parse(raw) : null;
    } catch {
      parsed = null;
    }

    if (!parsed?.ok) {
      const msg = parsed?.error || r.stderr || raw || "Transcription failed";
      return NextResponse.json({ ok: false, error: msg.slice(0, 2000) }, { status: 500 });
    }

    const text = String(parsed.text || "").trim();

    if (preset) {
      const savedPreset = upsertPreset(user.ownerKey, { ...preset, refText: text });
      return NextResponse.json(
        { ok: true, text, preset: savedPreset },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    const saved = upsertVoice(user.ownerKey, { ...voice, refText: text });
    return NextResponse.json(
      { ok: true, text, voice: saved },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: any) {
    if (e instanceof SessionInvalidError) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ ok: false, error: e?.message || "error" }, { status: 500 });
  }
}
