import { NextRequest, NextResponse } from "next/server";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import fssync from "node:fs";
import path from "node:path";

export const runtime = "nodejs";

const OTG_DATA_ROOT = path.resolve(process.env.OTG_DATA_ROOT || path.join(process.cwd(), "data"));

const INDEX_TTS_ROOT = path.resolve(process.env.INDEX_TTS_ROOT || "C:\\AI\\voices\\IndexTTS2");
const INDEX_TTS_PYTHON = path.resolve(process.env.INDEX_TTS_PYTHON || "C:\\AI\\voices\\IndexTTS2\\.venv\\Scripts\\python.exe");
const INDEX_TTS_BRIDGE = path.resolve(process.env.INDEX_TTS_BRIDGE || "C:\\AI\\voices\\VoiceLab\\scripts\\indextts2_voicelab_smoke.py");
const INDEX_TTS_REFERENCE_WAV = path.resolve(process.env.INDEX_TTS_REFERENCE_WAV || "C:\\AI\\voices\\VoiceLab\\samples\\input\\jorog_reference.wav");
const PREVIEW_TIMEOUT_MS = Math.max(60_000, Number(process.env.INDEX_TTS_PREVIEW_TIMEOUT_MS || 5 * 60 * 1000));

const QWEN_TTS_ROOT = path.resolve(process.env.QWEN_TTS_ROOT || "C:\\AI\\voices\\qwen 3");
const QWEN_TTS_PYTHON = path.resolve(process.env.QWEN_TTS_PYTHON || "C:\\Users\\SLRoc\\miniconda3\\envs\\qwen3tts-repair\\python.exe");
const QWEN_TTS_SITE_PACKAGES = path.resolve(process.env.QWEN_TTS_SITE_PACKAGES || "C:\\AI\\voices\\qwen 3\\qwen3tts-env\\Lib\\site-packages");
const QWEN_TTS_BRIDGE = path.resolve(process.env.QWEN_TTS_BRIDGE || path.join(process.cwd(), "scripts", "qwen3_voice_design_preview.py"));
const QWEN_TTS_MODEL_ID = String(process.env.QWEN_TTS_MODEL_ID || "Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign");
const QWEN_PREVIEW_TIMEOUT_MS = Math.max(60_000, Number(process.env.QWEN_TTS_PREVIEW_TIMEOUT_MS || 10 * 60 * 1000));

function safeSegment(value: unknown) {
  const cleaned = String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);

  return cleaned || "character";
}

function ownerKeyFromRequest(req: NextRequest) {
  return safeSegment(req.headers.get("x-otg-device-id") || "web_characters_builder");
}

function fileUrlFor(absPath: string) {
  const rel = path.relative(OTG_DATA_ROOT, absPath).replace(/\\/g, "/");
  return "/api/gallery/file?name=" + encodeURIComponent(rel);
}

async function requireFile(filePath: string, label: string) {
  const stat = await fs.stat(filePath).catch(() => null);
  if (!stat?.isFile()) {
    throw new Error(label + " not found: " + filePath);
  }
}

async function requireDir(dirPath: string, label: string) {
  const stat = await fs.stat(dirPath).catch(() => null);
  if (!stat?.isDirectory()) {
    throw new Error(label + " not found: " + dirPath);
  }
}

function runIndexTts(args: {
  paramsPath: string;
  stdoutPath: string;
  stderrPath: string;
}) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(
      INDEX_TTS_PYTHON,
      [
        INDEX_TTS_BRIDGE,
        "--params-json",
        args.paramsPath,
        "--stdout-log",
        args.stdoutPath,
        "--stderr-log",
        args.stderrPath,
      ],
      {
        cwd: INDEX_TTS_ROOT,
        windowsHide: true,
        stdio: "ignore",
      },
    );

    const timeout = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // ignore
      }
      reject(new Error("IndexTTS2 preview timed out."));
    }, PREVIEW_TIMEOUT_MS);

    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    child.on("exit", async (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve();
        return;
      }

      const stderr = await fs.readFile(args.stderrPath, "utf8").catch(() => "");
      const stdout = await fs.readFile(args.stdoutPath, "utf8").catch(() => "");
      reject(new Error(("IndexTTS2 preview failed with exit code " + code + ".\n" + stderr + "\n" + stdout).trim()));
    });
  });
}

function runQwenTts(args: {
  paramsPath: string;
  stdoutPath: string;
  stderrPath: string;
}) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(
      QWEN_TTS_PYTHON,
      [
        QWEN_TTS_BRIDGE,
        "--params-json",
        args.paramsPath,
        "--stdout-log",
        args.stdoutPath,
        "--stderr-log",
        args.stderrPath,
      ],
      {
        cwd: QWEN_TTS_ROOT,
        windowsHide: true,
        stdio: "ignore",
        env: {
          ...process.env,
          PYTHONPATH: QWEN_TTS_SITE_PACKAGES,
          HF_HUB_DISABLE_SYMLINKS_WARNING: "1",
        },
      },
    );

    const timeout = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // ignore
      }
      reject(new Error("Qwen3-TTS preview timed out."));
    }, QWEN_PREVIEW_TIMEOUT_MS);

    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    child.on("exit", async (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve();
        return;
      }

      const stderr = await fs.readFile(args.stderrPath, "utf8").catch(() => "");
      const stdout = await fs.readFile(args.stdoutPath, "utf8").catch(() => "");
      reject(new Error(("Qwen3-TTS preview failed with exit code " + code + ".\n" + stderr + "\n" + stdout).trim()));
    });
  });
}

function extractQwenDesignRecord(voiceSettings: any) {
  return (
    voiceSettings?.qwenVoiceDesignRecord ||
    voiceSettings?.qwenVoiceDesign?.qwenVoiceDesignRecord ||
    null
  );
}

function normalizeQwenLanguage(value: unknown) {
  const raw = String(value || "english").trim().toLowerCase();
  const map: Record<string, string> = {
    en: "english",
    eng: "english",
    english: "english",
    zh: "chinese",
    cn: "chinese",
    chinese: "chinese",
    fr: "french",
    french: "french",
    de: "german",
    german: "german",
    it: "italian",
    italian: "italian",
    ja: "japanese",
    jp: "japanese",
    japanese: "japanese",
    ko: "korean",
    korean: "korean",
    pt: "portuguese",
    portuguese: "portuguese",
    ru: "russian",
    russian: "russian",
    es: "spanish",
    spanish: "spanish",
    auto: "auto",
  };
  return map[raw] || raw || "english";
}

function voiceEmotionPrompt(voiceSettings: any) {
  const age = String(voiceSettings?.voiceAge || "teen");
  const gender = String(voiceSettings?.genderExpression || "male");
  const pitch = String(voiceSettings?.pitch || "medium");
  const resonance = String(voiceSettings?.resonance || "balanced");
  const energy = String(voiceSettings?.energy || "medium");
  const texture = String(voiceSettings?.texture || "clean");
  const tones = Array.isArray(voiceSettings?.personalityTone) ? voiceSettings.personalityTone.join(", ") : "";
  const speciesFlavor = String(voiceSettings?.speciesFlavor || "none");
  const speciesTrait = String(voiceSettings?.speciesTrait || "");

  return [
    "natural cinematic delivery",
    age,
    gender,
    pitch + " pitch",
    resonance + " resonance",
    energy + " energy",
    texture + " vocal texture",
    tones,
    speciesFlavor !== "none" && speciesTrait ? speciesFlavor + " " + speciesTrait + " vocal flavor" : "",
    "clear pronunciation",
    "believable acting",
  ].filter(Boolean).join(", ");
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const ownerKey = ownerKeyFromRequest(req);
    const characterId = safeSegment(body?.characterId || body?.characterName || "character");
    const text = String(body?.text || "").trim();

    if (!text) {
      return NextResponse.json({ ok: false, error: "Preview text is required." }, { status: 400 });
    }

    const qwenDesignRecord = extractQwenDesignRecord(body?.voiceSettings || {});
    const useQwen = !!qwenDesignRecord;

    if (useQwen) {
      await requireDir(QWEN_TTS_ROOT, "Qwen3-TTS root");
      await requireFile(QWEN_TTS_PYTHON, "Qwen3-TTS repaired Python");
      await requireDir(QWEN_TTS_SITE_PACKAGES, "Qwen3-TTS site-packages");
      await requireFile(QWEN_TTS_BRIDGE, "Qwen3-TTS bridge");
    } else {
      await requireDir(INDEX_TTS_ROOT, "IndexTTS2 root");
      await requireFile(INDEX_TTS_PYTHON, "IndexTTS2 Python");
      await requireFile(INDEX_TTS_BRIDGE, "IndexTTS2 bridge");
      await requireFile(INDEX_TTS_REFERENCE_WAV, "IndexTTS2 reference WAV");
    }

    const outDir = path.join(OTG_DATA_ROOT, "characters", ownerKey, "voice-packs", characterId);
    const logsDir = path.join(outDir, "logs");
    await fs.mkdir(logsDir, { recursive: true });

    const qwenCandidateId = safeSegment(qwenDesignRecord?.selectedCandidateId || body?.candidateId || "candidate_01");
    const outputBase = useQwen ? "qwen_preview_" + qwenCandidateId : "preview_neutral";

    const outputWav = path.join(outDir, outputBase + ".wav");
    const paramsPath = path.join(logsDir, outputBase + "_params.json");
    const stdoutPath = path.join(logsDir, outputBase + "_stdout.log");
    const stderrPath = path.join(logsDir, outputBase + "_stderr.log");

    const params = useQwen
      ? {
          engine: "Qwen3-TTS VoiceDesign",
          model_id: QWEN_TTS_MODEL_ID,
          qwen_tts_root: QWEN_TTS_ROOT,
          output_wav: outputWav,
          text,
          language: normalizeQwenLanguage(body?.language || "english"),
          dtype: String(body?.dtype || "float16"),
          qwen_instruction: String(qwenDesignRecord?.fullQwenInstruction || qwenDesignRecord?.baseInstruction || ""),
          qwen_design_record: qwenDesignRecord,
        }
      : {
          index_tts_root: INDEX_TTS_ROOT,
          reference_wav: INDEX_TTS_REFERENCE_WAV,
          output_wav: outputWav,
          text,
          emotion: voiceEmotionPrompt(body?.voiceSettings || {}),
          emotion_alpha: Number(body?.emotionAlpha || 0.6),
        };

    await fs.writeFile(paramsPath, JSON.stringify(params, null, 2) + "\n", "utf8");

    if (useQwen) {
      await runQwenTts({ paramsPath, stdoutPath, stderrPath });
    } else {
      await runIndexTts({ paramsPath, stdoutPath, stderrPath });
    }

    const stat = await fs.stat(outputWav).catch(() => null);
    if (!stat?.isFile() || stat.size <= 0) {
      throw new Error("IndexTTS2 completed but preview WAV was not created.");
    }

    const voicePackPath = path.join(outDir, "voice-pack.json");
    if (fssync.existsSync(voicePackPath)) {
      const current = JSON.parse(await fs.readFile(voicePackPath, "utf8").catch(() => "{}"));
      current.status = "preview_generated";
      current.updatedAt = new Date().toISOString();
      current.previewAudioPath = outputWav;
      current.previewAudioUrl = fileUrlFor(outputWav);
      current.previewLine = text;
      current.previewGeneration = {
        engine: useQwen ? "Qwen3-TTS VoiceDesign" : "IndexTTS2 direct",
        paramsPath,
        stdoutPath,
        stderrPath,
        outputWav,
        outputBytes: stat.size,
      };
      await fs.writeFile(voicePackPath, JSON.stringify(current, null, 2) + "\n", "utf8");
    }

    return NextResponse.json({
      ok: true,
      status: "preview_generated",
      engine: useQwen ? "Qwen3-TTS VoiceDesign" : "IndexTTS2 direct",
      characterId,
      audioPath: outputWav,
      audioUrl: fileUrlFor(outputWav),
      outputBytes: stat.size,
      paramsPath,
      stdoutPath,
      stderrPath,
    });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || "IndexTTS2 voice preview failed" },
      { status: 500 },
    );
  }
}
