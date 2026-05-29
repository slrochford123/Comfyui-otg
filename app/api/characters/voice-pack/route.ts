import { NextRequest, NextResponse } from "next/server";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";

const OTG_DATA_ROOT = path.resolve(process.env.OTG_DATA_ROOT || path.join(process.cwd(), "data"));

const INDEX_TTS_ROOT = path.resolve(process.env.INDEX_TTS_ROOT || "C:\\AI\\voices\\IndexTTS2");
const INDEX_TTS_PYTHON = path.resolve(process.env.INDEX_TTS_PYTHON || "C:\\AI\\voices\\IndexTTS2\\.venv\\Scripts\\python.exe");
const INDEX_TTS_BRIDGE = path.resolve(process.env.INDEX_TTS_BRIDGE || "C:\\AI\\voices\\VoiceLab\\scripts\\indextts2_voicelab_smoke.py");
const INDEX_TTS_PACK_TIMEOUT_MS = Math.max(60_000, Number(process.env.INDEX_TTS_PACK_TIMEOUT_MS || 12 * 60 * 1000));

const INDEX_STYLE_PACK = [
  {
    id: "neutral",
    label: "Neutral",
    text: "I understand. I will handle this carefully.",
    emotion: "neutral natural dialogue, clear pronunciation, steady pacing, believable character delivery",
    emotionAlpha: 0.45,
  },
  {
    id: "happy",
    label: "Happy",
    text: "That is exactly what I wanted to hear.",
    emotion: "warm happy delivery, light smile in the voice, natural excitement, not cartoonish",
    emotionAlpha: 0.65,
  },
  {
    id: "sad",
    label: "Sad",
    text: "I thought there would be more time.",
    emotion: "sad restrained delivery, softer tone, slower pacing, emotional but still clear",
    emotionAlpha: 0.7,
  },
  {
    id: "angry",
    label: "Angry",
    text: "Do not test me again.",
    emotion: "angry controlled delivery, tense voice, firm pacing, cinematic intensity, no screaming",
    emotionAlpha: 0.75,
  },
  {
    id: "whisper",
    label: "Whisper",
    text: "Stay quiet. Something is close.",
    emotion: "quiet whisper, breathy close voice, suspenseful, clear words, low volume performance",
    emotionAlpha: 0.7,
  },
  {
    id: "shout",
    label: "Shout",
    text: "Get back now!",
    emotion: "urgent shout, strong projection, strained but clear, controlled yelling, not distorted",
    emotionAlpha: 0.8,
  },
  {
    id: "fear",
    label: "Fear",
    text: "No. Something is wrong here.",
    emotion: "fearful tense delivery, shaky breath, nervous pacing, believable panic, clear pronunciation",
    emotionAlpha: 0.75,
  },
  {
    id: "cinematic",
    label: "Cinematic",
    text: "This is where the story changes.",
    emotion: "cinematic dramatic delivery, grounded acting, rich tone, slow confident pacing",
    emotionAlpha: 0.65,
  },
];

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

function nowIso() {
  return new Date().toISOString();
}

function isInside(parent: string, child: string) {
  const relative = path.relative(parent, child);
  return relative === "" || (!!relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

function dataAudioUrl(absPath: string) {
  const rel = path.relative(OTG_DATA_ROOT, absPath).replace(/\\/g, "/");
  return "/api/characters/voice-file?path=" + encodeURIComponent(rel);
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

function resolveReferencePath(body: any) {
  const raw = String(
    body?.indexVoiceReferencePath ||
      body?.indexVoiceReference?.audioPath ||
      body?.selectedIndexVoiceReference?.audioPath ||
      body?.voiceSettings?.indexVoiceReferencePath ||
      body?.voiceSettings?.indexVoiceReference?.audioPath ||
      "",
  ).trim();

  if (!raw) {
    return "";
  }

  return path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(OTG_DATA_ROOT, raw);
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
      reject(new Error("IndexTTS2 voice-pack generation timed out."));
    }, INDEX_TTS_PACK_TIMEOUT_MS);

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
      reject(new Error(("IndexTTS2 voice-pack generation failed with exit code " + code + ".\n" + stderr + "\n" + stdout).trim()));
    });
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const ownerKey = ownerKeyFromRequest(req);
    const characterId = safeSegment(body?.characterId || body?.characterName || "character");
    const characterName = String(body?.characterName || "").trim();

    const referenceWav = resolveReferencePath(body);

    if (!referenceWav) {
      return NextResponse.json(
        {
          ok: false,
          error: "Missing locked Index voice reference. Select Use Raw or Use Tuned before creating the Index voice pack.",
        },
        { status: 400 },
      );
    }

    await requireDir(INDEX_TTS_ROOT, "IndexTTS2 root");
    await requireFile(INDEX_TTS_PYTHON, "IndexTTS2 Python");
    await requireFile(INDEX_TTS_BRIDGE, "IndexTTS2 bridge");
    await requireFile(referenceWav, "Locked Index reference WAV");

    const voicePackDir = path.join(OTG_DATA_ROOT, "characters", ownerKey, "voice-packs", characterId);
    const logsDir = path.join(voicePackDir, "logs");
    const voicePackPath = path.join(voicePackDir, "voice-pack.json");

    await fs.mkdir(logsDir, { recursive: true });

    const outputs: Record<string, any> = {};

    for (const style of INDEX_STYLE_PACK) {
      const outputWav = path.join(voicePackDir, "index_" + style.id + ".wav");
      const paramsPath = path.join(logsDir, "index_" + style.id + "_params.json");
      const stdoutPath = path.join(logsDir, "index_" + style.id + "_stdout.log");
      const stderrPath = path.join(logsDir, "index_" + style.id + "_stderr.log");

      const params = {
        index_tts_root: INDEX_TTS_ROOT,
        reference_wav: referenceWav,
        output_wav: outputWav,
        text: style.text,
        emotion: style.emotion,
        emotion_alpha: style.emotionAlpha,
      };

      await fs.writeFile(paramsPath, JSON.stringify(params, null, 2) + "\n", "utf8");

      await runIndexTts({ paramsPath, stdoutPath, stderrPath });

      const stat = await fs.stat(outputWav).catch(() => null);
      if (!stat?.isFile() || stat.size <= 0) {
        throw new Error("IndexTTS2 completed but output was not created for style: " + style.id);
      }

      outputs[style.id] = {
        status: "generated",
        id: style.id,
        label: style.label,
        text: style.text,
        emotion: style.emotion,
        emotionAlpha: style.emotionAlpha,
        audioPath: outputWav,
        audioUrl: dataAudioUrl(outputWav),
        outputBytes: stat.size,
        paramsPath,
        stdoutPath,
        stderrPath,
      };
    }

    const voicePack = {
      ok: true,
      schemaVersion: 2,
      status: "generated",
      characterId,
      characterName,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      engine: "IndexTTS2 direct",
      defaultEngine: "IndexTTS2 direct",
      referenceWav,
      indexVoiceReference: body?.indexVoiceReference || body?.selectedIndexVoiceReference || null,
      voiceSettings: body?.voiceSettings || {},
      characterDetails: body?.characterDetails || {},
      identityBlock: String(body?.identityBlock || ""),
      styles: INDEX_STYLE_PACK.map((style) => ({
        id: style.id,
        label: style.label,
        text: style.text,
        emotion: style.emotion,
        emotionAlpha: style.emotionAlpha,
      })),
      outputs,
    };

    await fs.writeFile(voicePackPath, JSON.stringify(voicePack, null, 2) + "\n", "utf8");

    return NextResponse.json({
      ok: true,
      status: "generated",
      characterId,
      voicePackPath,
      voicePack,
      outputs,
    });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || "IndexTTS2 voice-pack creation failed" },
      { status: 500 },
    );
  }
}
