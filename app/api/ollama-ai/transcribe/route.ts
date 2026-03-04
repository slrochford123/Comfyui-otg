import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import fs from "node:fs";
import { execFile } from "node:child_process";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function whisperTimeoutMs(): number {
  const ms = Number(process.env.WHISPER_TIMEOUT_MS || 120000);
  return Number.isFinite(ms) && ms > 1000 ? ms : 120000;
}

function ffmpegPath(): string {
  return (process.env.FFMPEG_PATH || process.env.OTG_FFMPEG_PATH || "ffmpeg").trim() || "ffmpeg";
}

function runExecFile(bin: string, args: string[], timeoutMs: number): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = execFile(bin, args, { timeout: timeoutMs, windowsHide: true }, (err, stdout, stderr) => {
      if (err && (err as any).killed) {
        return reject(new Error(`Process timed out after ${timeoutMs}ms`));
      }
      const code = (err as any)?.code ?? 0;
      resolve({ code: typeof code === "number" ? code : 0, stdout: String(stdout || ""), stderr: String(stderr || "") });
    });
    child.on("error", reject);
  });
}

function ensureDir(p: string) {
  fs.mkdirSync(p, { recursive: true });
}

function safeBasename(name: string) {
  const base = path.basename(name || "audio");
  return base.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "audio.webm";
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("audio");
    if (!(file instanceof File)) {
      return NextResponse.json({ ok: false, error: "Missing audio file" }, { status: 400 });
    }

    // Basic size limit (default 12MB)
    const maxBytes = Number(process.env.OLAMA_AI_MAX_AUDIO_BYTES || 12 * 1024 * 1024);
    if (Number.isFinite(maxBytes) && maxBytes > 0 && file.size > maxBytes) {
      return NextResponse.json({ ok: false, error: `Audio too large (${file.size} bytes)` }, { status: 413 });
    }

    const otgDir = process.env.OTG_DATA_DIR || path.join(process.cwd(), "data");
    const tmpDir = path.join(otgDir, "tmp", "olama_ai");
    ensureDir(tmpDir);

    const base = safeBasename(file.name);
    const id = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const inPath = path.join(tmpDir, `${id}_${base}`);
    const wavPath = path.join(tmpDir, `${id}.wav`);

    const buf = Buffer.from(await file.arrayBuffer());
    fs.writeFileSync(inPath, buf);

    // Normalize audio with ffmpeg for Whisper reliability.
    // - mono, 16kHz, PCM s16le
    const ff = ffmpegPath();
    const ffArgs = [
      "-y",
      "-i",
      inPath,
      "-ac",
      "1",
      "-ar",
      "16000",
      "-c:a",
      "pcm_s16le",
      wavPath,
    ];
    let ffDetail: string | null = null;
    const ffRes = await runExecFile(ff, ffArgs, whisperTimeoutMs()).catch((e) => {
      ffDetail = String(e?.message || e);
      return { code: 1, stdout: "", stderr: ffDetail };
    });
    if (ffRes.code !== 0 || !fs.existsSync(wavPath)) {
      // fallback: attempt to run Whisper on the original file
      // (some setups can decode directly)
      ffDetail = ffDetail || ffRes.stderr || ffRes.stdout || "ffmpeg failed";
    }

    const audioForWhisper = fs.existsSync(wavPath) ? wavPath : inPath;

    const py = (process.env.WHISPER_PYTHON || "python").trim() || "python";
    const model = (process.env.WHISPER_MODEL || "small").trim() || "small";
    const device = (process.env.WHISPER_DEVICE || "auto").trim() || "auto";
    const computeType = (process.env.WHISPER_COMPUTE_TYPE || "auto").trim() || "auto";

    const script = path.join(process.cwd(), "scripts", "whisper", "transcribe.py");
    const args: string[] = ["--audio", audioForWhisper, "--model", model, "--device", device, "--compute_type", computeType];

    const w = await runExecFile(py, [script, ...args], whisperTimeoutMs());
    const raw = (w.stdout || "").trim();
    let parsed: any = null;
    try {
      parsed = raw ? JSON.parse(raw) : null;
    } catch {
      parsed = null;
    }

    // Cleanup best-effort
    try {
      fs.rmSync(inPath, { force: true });
      fs.rmSync(wavPath, { force: true });
    } catch {
      // ignore
    }

    if (!parsed?.ok) {
      const msg = parsed?.error || w.stderr || raw || "Transcription failed";
      const hint = [
        "Server requirements:",
        "- ffmpeg on PATH (or set FFMPEG_PATH / OTG_FFMPEG_PATH)",
        "- python with faster-whisper installed (pip install faster-whisper)",
        "- scripts/whisper/transcribe.py must be present on the server",
      ].join("\n");
      return NextResponse.json(
        {
          ok: false,
          error: "Transcription failed",
          detail: String(msg).slice(0, 4000),
          ffmpeg: ffDetail ? String(ffDetail).slice(0, 2000) : null,
          hint,
        },
        { status: 500 },
      );
    }

    const text = String(parsed.text || "").trim();
    return NextResponse.json({ ok: true, text }, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Transcription failed", detail: String(e?.message || e) },
      { status: 500 },
    );
  }
}
