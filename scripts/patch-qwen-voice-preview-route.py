from pathlib import Path
from datetime import datetime
import shutil

root = Path(r"C:\AI\OTG-Test2")
route = root / "app" / "api" / "characters" / "voice-preview" / "route.ts"
backup_dir = root / ".manual-backups" / ("qwen-voice-preview-route-" + datetime.now().strftime("%Y%m%d-%H%M%S"))

if not route.exists():
    raise FileNotFoundError(route)

backup_dir.mkdir(parents=True, exist_ok=True)
shutil.copy2(route, backup_dir / "voice-preview.route.ts")

text = route.read_text(encoding="utf-8")
original = text

anchor = 'const PREVIEW_TIMEOUT_MS = Math.max(60_000, Number(process.env.INDEX_TTS_PREVIEW_TIMEOUT_MS || 5 * 60 * 1000));'

qwen_constants = '''const PREVIEW_TIMEOUT_MS = Math.max(60_000, Number(process.env.INDEX_TTS_PREVIEW_TIMEOUT_MS || 5 * 60 * 1000));

const QWEN_TTS_ROOT = path.resolve(process.env.QWEN_TTS_ROOT || "C:\\\\AI\\\\voices\\\\qwen 3");
const QWEN_TTS_PYTHON = path.resolve(process.env.QWEN_TTS_PYTHON || "C:\\\\Users\\\\SLRoc\\\\miniconda3\\\\envs\\\\qwen3tts-repair\\\\python.exe");
const QWEN_TTS_SITE_PACKAGES = path.resolve(process.env.QWEN_TTS_SITE_PACKAGES || "C:\\\\AI\\\\voices\\\\qwen 3\\\\qwen3tts-env\\\\Lib\\\\site-packages");
const QWEN_TTS_BRIDGE = path.resolve(process.env.QWEN_TTS_BRIDGE || path.join(process.cwd(), "scripts", "qwen3_voice_design_preview.py"));
const QWEN_TTS_MODEL_ID = String(process.env.QWEN_TTS_MODEL_ID || "Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign");
const QWEN_PREVIEW_TIMEOUT_MS = Math.max(60_000, Number(process.env.QWEN_TTS_PREVIEW_TIMEOUT_MS || 10 * 60 * 1000));'''

if "const QWEN_TTS_ROOT" not in text:
    if anchor not in text:
        raise RuntimeError("Missing PREVIEW_TIMEOUT_MS anchor.")
    text = text.replace(anchor, qwen_constants, 1)

run_anchor = "function voiceEmotionPrompt(voiceSettings: any) {"

run_qwen = '''function runQwenTts(args: {
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
      reject(new Error(("Qwen3-TTS preview failed with exit code " + code + ".\\n" + stderr + "\\n" + stdout).trim()));
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

'''

if "function runQwenTts" not in text:
    if run_anchor not in text:
        raise RuntimeError("Missing voiceEmotionPrompt anchor.")
    text = text.replace(run_anchor, run_qwen + run_anchor, 1)

old_require = '''    await requireDir(INDEX_TTS_ROOT, "IndexTTS2 root");
    await requireFile(INDEX_TTS_PYTHON, "IndexTTS2 Python");
    await requireFile(INDEX_TTS_BRIDGE, "IndexTTS2 bridge");
    await requireFile(INDEX_TTS_REFERENCE_WAV, "IndexTTS2 reference WAV");'''

new_require = '''    const qwenDesignRecord = extractQwenDesignRecord(body?.voiceSettings || {});
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
    }'''

if "const qwenDesignRecord = extractQwenDesignRecord" not in text:
    if old_require not in text:
        raise RuntimeError("Missing IndexTTS require block.")
    text = text.replace(old_require, new_require, 1)

old_params = '''    const outputWav = path.join(outDir, "preview_neutral.wav");
    const paramsPath = path.join(logsDir, "preview_neutral_params.json");
    const stdoutPath = path.join(logsDir, "preview_neutral_stdout.log");
    const stderrPath = path.join(logsDir, "preview_neutral_stderr.log");

    const params = {
      index_tts_root: INDEX_TTS_ROOT,
      reference_wav: INDEX_TTS_REFERENCE_WAV,
      output_wav: outputWav,
      text,
      emotion: voiceEmotionPrompt(body?.voiceSettings || {}),
      emotion_alpha: Number(body?.emotionAlpha || 0.6),
    };

    await fs.writeFile(paramsPath, JSON.stringify(params, null, 2) + "\\n", "utf8");

    await runIndexTts({ paramsPath, stdoutPath, stderrPath });'''

new_params = '''    const qwenCandidateId = safeSegment(qwenDesignRecord?.selectedCandidateId || body?.candidateId || "candidate_01");
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

    await fs.writeFile(paramsPath, JSON.stringify(params, null, 2) + "\\n", "utf8");

    if (useQwen) {
      await runQwenTts({ paramsPath, stdoutPath, stderrPath });
    } else {
      await runIndexTts({ paramsPath, stdoutPath, stderrPath });
    }'''

if "qwen_preview_" not in text:
    if old_params not in text:
        raise RuntimeError("Missing output/params block.")
    text = text.replace(old_params, new_params, 1)

text = text.replace(
    'current.previewGeneration = {\n        engine: "IndexTTS2 direct",',
    'current.previewGeneration = {\n        engine: useQwen ? "Qwen3-TTS VoiceDesign" : "IndexTTS2 direct",',
)

text = text.replace(
    'engine: "IndexTTS2 direct",\n      characterId,',
    'engine: useQwen ? "Qwen3-TTS VoiceDesign" : "IndexTTS2 direct",\n      characterId,',
)

if text == original:
    raise RuntimeError("No changes made. Route may already be patched.")

required = [
    "QWEN_TTS_PYTHON",
    "runQwenTts",
    "extractQwenDesignRecord",
    "normalizeQwenLanguage",
    "qwen_preview_",
    "Qwen3-TTS VoiceDesign",
]

for item in required:
    if item not in text:
        raise RuntimeError("Verification failed. Missing: " + item)

route.write_text(text, encoding="utf-8")

print("OK: voice-preview route wired for Qwen bridge.")
print("Changed:", route)
print("Backup:", backup_dir)