import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import fs from "node:fs";
import { execFile } from "node:child_process";
import { requireSessionUser } from "@/lib/sessionUser";
import { hasValidWorkerToken } from "@/lib/jobs/workerAuth";
import {
  openAIEnabled,
  transcribeOpenAIAudio,
} from "@/lib/openai/provider";
import {
  listStoryAssets,
  listStoryBibleEntities,
  listStoryBibleFacts,
} from "@/lib/storyCreator/store";

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

const BASE_TRANSCRIPTION_VOCABULARY = [
  "Atheria",
  "Atherians",
  "Jorog",
  "Zeltroi",
  "Kodakai",
  "Delnai",
  "Nives",
  "H3",
  "LoRA",
  "Scene Hunter",
  "SLR Studios",
];

function splitVocabulary(value: string) {
  return value
    .split(/[,\n]/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

function storyProjectVocabulary(ownerKey: string, projectId: string) {
  if (!projectId) return [];
  try {
    const terms = new Set<string>();
    for (const entity of listStoryBibleEntities({ ownerKey, projectId })) {
      if (entity.name) terms.add(entity.name);
    }
    for (const asset of listStoryAssets({ ownerKey, projectId })) {
      if (asset.name) terms.add(asset.name);
    }
    for (const fact of listStoryBibleFacts({ ownerKey, projectId, includeSuperseded: false })) {
      for (const token of fact.valueText.match(/\b[A-Z][A-Za-z0-9'-]{2,}\b/g) || []) {
        terms.add(token);
      }
    }
    return Array.from(terms);
  } catch {
    return [];
  }
}

function buildTranscriptionPrompt(input: {
  context: string;
  vocabulary: string[];
}) {
  const vocabulary = Array.from(
    new Set([...BASE_TRANSCRIPTION_VOCABULARY, ...input.vocabulary].filter(Boolean)),
  ).slice(0, 100);
  return [
    "Transcribe the user's speech verbatim in English. Do not summarize, rewrite, invent missing words, or turn the speech into a prompt.",
    "Preserve unusual fantasy names, model names, product terms, and user commands exactly when audible.",
    vocabulary.length ? `Vocabulary hints: ${vocabulary.join(", ")}.` : "",
    input.context ? `Context: ${input.context}` : "",
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 1800);
}

export async function POST(req: NextRequest) {
  try {
    const workerRequest = hasValidWorkerToken(req);
    const workerOwner = String(req.headers.get("x-otg-owner-key") || "").trim();
    if (workerRequest && !/^[a-zA-Z0-9_-]{3,128}$/.test(workerOwner)) {
      return NextResponse.json({ ok: false, error: "Missing or invalid worker owner." }, { status: 400 });
    }
    let user: { ownerKey: string };
    if (workerRequest) {
      user = { ownerKey: workerOwner };
    } else {
      try { user = await requireSessionUser(req); }
      catch { return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 }); }
    }
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

    const buf = Buffer.from(await file.arrayBuffer());
    // Dataset verification is a credentialed local-worker operation, not a
    // browser request for paid transcription. Never send a training batch to
    // the paid provider or expose project vocabulary through worker requests.
    if (!workerRequest && openAIEnabled()) {
      try {
        const context = String(form.get("context") || "").trim();
        const projectId = String(form.get("projectId") || "").trim();
        const clientMimeType = String(form.get("clientMimeType") || "").trim();
        const chunkCount = Number(form.get("chunkCount") || 0) || 0;
        const language = String(form.get("language") || "en").trim() || "en";
        const clientDurationSeconds = Number(form.get("durationSeconds") || 0) || 0;
        const vocabulary = [
          ...splitVocabulary(String(form.get("vocabulary") || "")),
          ...storyProjectVocabulary(user.ownerKey, projectId),
        ];
        const diagnostics = {
          uploadedBytes: buf.length,
          fileName: safeBasename(file.name || "microphone.webm"),
          mimeType: file.type || clientMimeType || "audio/webm",
          clientMimeType: clientMimeType || null,
          clientDurationSeconds,
          chunkCount,
          language,
          vocabularyHintCount: Array.from(new Set([...BASE_TRANSCRIPTION_VOCABULARY, ...vocabulary])).length,
        };
        const transcript = await transcribeOpenAIAudio({
          ownerKey: user.ownerKey,
          projectId: projectId || undefined,
          audio: buf,
          fileName: file.name || "microphone.webm",
          mimeType: file.type || clientMimeType || "audio/webm",
          prompt: buildTranscriptionPrompt({ context, vocabulary }),
          language,
          audioSeconds: clientDurationSeconds,
        });

        if (!transcript.text) {
          throw new Error("OpenAI returned an empty transcript.");
        }

        return NextResponse.json(
          {
            ok: true,
            text: transcript.text,
            transcript: transcript.text,
            provider: "openai",
            usage: transcript.usage,
            diagnostics,
          },
          { headers: { "Cache-Control": "no-store" } },
        );
      } catch (error) {
        if (process.env.OPENAI_TRANSCRIBE_FALLBACK_LOCAL === "0") {
          throw error;
        }
      }
    }

    const otgDir = process.env.OTG_DATA_DIR || path.join(process.cwd(), "data");
    const tmpDir = path.join(otgDir, "tmp", "olama_ai");
    ensureDir(tmpDir);

    const base = safeBasename(file.name);
    const id = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const inPath = path.join(tmpDir, `${id}_${base}`);
    const wavPath = path.join(tmpDir, `${id}.wav`);

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
    return NextResponse.json(
      {
        ok: true,
        text,
        transcript: text,
        provider: "local-whisper",
        diagnostics: {
          uploadedBytes: buf.length,
          fileName: safeBasename(file.name || "microphone.webm"),
          mimeType: file.type || "audio/webm",
          clientDurationSeconds: Number(form.get("durationSeconds") || 0) || 0,
          chunkCount: Number(form.get("chunkCount") || 0) || 0,
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Transcription failed", detail: String(e?.message || e) },
      { status: 500 },
    );
  }
}
