import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";

import { requireAdmin } from "@/app/api/admin/_requireAdmin";
import { ensureDir, readJsonSafe, safeJoin, writeJsonSafe } from "@/lib/paths";
import { runCmd } from "@/lib/ffmpeg";
import { voicesProfilesRoot, voicesUserIdFromAuth } from "@/lib/voicesPaths";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type CreateBody = { voiceId?: string; text?: string; language?: string };

function nowId(prefix: string): string {
  const rnd = Math.random().toString(16).slice(2, 10);
  return `${prefix}_${Date.now()}_${rnd}`;
}

export async function POST(req: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return NextResponse.json({ ok: false, error: admin.error }, { status: admin.status });
  }

  try {
    const body = (await req.json().catch(() => ({}))) as CreateBody;
    const voiceId = String(body.voiceId || "").trim();
    const text = String(body.text || "").trim();
    const language = String(body.language || "en").trim() || "en";
    if (!voiceId) return NextResponse.json({ ok: false, error: "Missing voiceId" }, { status: 400 });
    if (!text) return NextResponse.json({ ok: false, error: "Missing text" }, { status: 400 });

    const userId = voicesUserIdFromAuth(admin.email, admin.username);
    const profRoot = voicesProfilesRoot(userId);
    const voiceDir = safeJoin(profRoot, voiceId);
    const profilePath = safeJoin(voiceDir, "profile.json");
    if (!fs.existsSync(profilePath)) {
      return NextResponse.json({ ok: false, error: "Voice profile not found" }, { status: 404 });
    }

    const profile = readJsonSafe<any>(profilePath, null);
    if (!profile) return NextResponse.json({ ok: false, error: "Voice profile corrupt" }, { status: 500 });

    const samplesDir = safeJoin(voiceDir, "samples");
    const logsDir = safeJoin(voiceDir, "logs");
    ensureDir(samplesDir);
    ensureDir(logsDir);

    const py = (process.env.QWEN3TTS_PYTHON || "").trim();
    const enable = (process.env.QWEN3TTS_ENABLE_TTS || "").trim() !== "0";
    const script = path.join(process.cwd(), "scripts", "qwen3tts", "generate.py");
    if (!enable || !py || !fs.existsSync(script)) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Qwen3TTS is not configured. Set QWEN3TTS_PYTHON and ensure scripts/qwen3tts/generate.py exists.",
        },
        { status: 500 },
      );
    }

    const sampleId = nowId("s");
    const outWav = safeJoin(samplesDir, `${sampleId}.wav`);
    const logPath = safeJoin(logsDir, `qwen_tts_${sampleId}.log`);

    // Prefer reference audio when available.
    const ref = safeJoin(voiceDir, "source", "audio", "ref.wav");
    const args = [script, "--text", text, "--lang", language, "--out", outWav];
    if (fs.existsSync(ref)) {
      args.push("--ref", ref);
    }

    const r = await runCmd(py, args, { timeoutMs: 5 * 60 * 1000 });
    fs.writeFileSync(logPath, `${r.stdout}\n${r.stderr}`, "utf8");
    if (r.code !== 0) {
      const logRel = path.posix.join("users", userId, "profiles", voiceId, "logs", `qwen_tts_.log`);
      return NextResponse.json(
        {
          ok: false,
          error: "TTS generation failed. Check logs.",
          detail: (r.stderr || r.stdout || "").slice(-2000),
          logRel,
          logUrl: "/api/voices/file?rel=" + encodeURIComponent(logRel),
        },
        { status: 500 },
      );
    }

    profile.updatedAt = new Date().toISOString();
    profile.lastSample = { id: sampleId, rel: path.posix.join("samples", `${sampleId}.wav`) };
    writeJsonSafe(profilePath, profile);

    const rel = path.posix.join("users", userId, "profiles", voiceId, "samples", `${sampleId}.wav`);
    return NextResponse.json(
      {
        ok: true,
        sampleId,
        audioRel: rel,
        audioUrl: `/api/voices/file?rel=${encodeURIComponent(rel)}`,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Unknown error" }, { status: 500 });
  }
}
