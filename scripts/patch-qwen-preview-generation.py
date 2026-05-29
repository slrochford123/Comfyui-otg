from pathlib import Path
from datetime import datetime
import shutil
import re

root = Path(r"C:\AI\OTG-Test2")
backup_dir = root / ".manual-backups" / ("qwen-preview-generation-" + datetime.now().strftime("%Y%m%d-%H%M%S"))

route = root / "app" / "api" / "characters" / "voice-preview" / "route.ts"
panel = root / "app" / "app" / "components" / "CharactersPanel.tsx"
bridge = root / "scripts" / "qwen3_voice_design_preview.py"

for target in [route, panel]:
    if not target.exists():
        raise FileNotFoundError(target)

backup_dir.mkdir(parents=True, exist_ok=True)
shutil.copy2(route, backup_dir / "voice-preview.route.ts")
shutil.copy2(panel, backup_dir / "CharactersPanel.tsx")
if bridge.exists():
    shutil.copy2(bridge, backup_dir / "qwen3_voice_design_preview.py")

bridge.parent.mkdir(parents=True, exist_ok=True)

bridge.write_text(r'''import argparse
import inspect
import json
import os
import sys
from pathlib import Path

def main():
    parser = argparse.ArgumentParser(description="Qwen3-TTS VoiceDesign preview bridge")
    parser.add_argument("--params-json", required=True)
    parser.add_argument("--stdout-log", required=True)
    parser.add_argument("--stderr-log", required=True)
    args = parser.parse_args()

    stdout_path = Path(args.stdout_log)
    stderr_path = Path(args.stderr_log)
    stdout_path.parent.mkdir(parents=True, exist_ok=True)
    stderr_path.parent.mkdir(parents=True, exist_ok=True)

    try:
        params = json.loads(Path(args.params_json).read_text(encoding="utf-8"))

        import torch
        import soundfile as sf
        from qwen_tts.inference.qwen3_tts_model import Qwen3TTSModel

        model_id = params.get("model_id") or "Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign"
        output_wav = Path(params["output_wav"])
        output_wav.parent.mkdir(parents=True, exist_ok=True)

        text = str(params.get("text") or "").strip()
        if not text:
            raise RuntimeError("Preview text is empty.")

        language = str(params.get("language") or "en").strip() or "en"
        speaker_id = int(params.get("speaker_id", 0))
        dtype = str(params.get("dtype") or "float16").strip()
        instruction = str(params.get("qwen_instruction") or "").strip()

        device = "cuda" if torch.cuda.is_available() else "cpu"

        load_kwargs_attempts = [
            {"device": device, "dtype": dtype, "use_flash_attn": True},
            {"device": device, "dtype": dtype},
            {"device": device},
            {"device_map": "cuda:0" if torch.cuda.is_available() else "cpu"},
            {},
        ]

        model = None
        load_errors = []
        for kwargs in load_kwargs_attempts:
            try:
                model = Qwen3TTSModel.from_pretrained(model_id, **kwargs)
                break
            except Exception as exc:
                load_errors.append(f"{kwargs}: {exc}")

        if model is None:
            raise RuntimeError("Failed to load Qwen model. Attempts: " + " | ".join(load_errors))

        generate = getattr(model, "generate", None)
        if generate is None:
            raise RuntimeError("Loaded Qwen model has no generate method.")

        signature = ""
        accepts_kwargs = False
        supported = set()
        try:
            sig = inspect.signature(generate)
            signature = str(sig)
            accepts_kwargs = any(p.kind == inspect.Parameter.VAR_KEYWORD for p in sig.parameters.values())
            supported = set(sig.parameters.keys())
        except Exception:
            pass

        base_kwargs = {
            "text": text,
            "speaker_id": speaker_id,
            "language": language,
        }

        design_kwargs = {
            "instruction": instruction,
            "voice_instruction": instruction,
            "voice_description": instruction,
            "speaker_prompt": instruction,
            "prompt": instruction,
            "style_prompt": instruction,
            "voice_prompt": instruction,
            "description": instruction,
        }

        attempts = []

        if instruction:
            rich = dict(base_kwargs)
            for key, value in design_kwargs.items():
                if accepts_kwargs or key in supported:
                    rich[key] = value
            if rich != base_kwargs:
                attempts.append(("generate_with_design_kwargs", rich))

        attempts.append(("generate_standard", base_kwargs))
        attempts.append(("generate_text_language", {"text": text, "language": language}))
        attempts.append(("generate_text_only", {"text": text}))

        wav = None
        sr = None
        used_name = None
        errors = []

        for name, kwargs in attempts:
            try:
                result = generate(**kwargs)
                if isinstance(result, tuple) and len(result) >= 2:
                    wav, sr = result[0], result[1]
                else:
                    wav = result
                    sr = int(params.get("sample_rate") or 24000)
                used_name = name
                break
            except Exception as exc:
                errors.append(f"{name}: {exc}")

        if wav is None:
            raise RuntimeError("Qwen generate failed. Attempts: " + " | ".join(errors))

        if isinstance(wav, (list, tuple)):
            wav0 = wav[0]
        else:
            wav0 = wav

        sf.write(str(output_wav), wav0, int(sr))

        meta = {
            "ok": True,
            "engine": "Qwen3-TTS VoiceDesign",
            "model_id": model_id,
            "device": device,
            "dtype": dtype,
            "language": language,
            "speaker_id": speaker_id,
            "used_generate_attempt": used_name,
            "generate_signature": signature,
            "instruction_supplied": bool(instruction),
            "output_wav": str(output_wav),
            "sample_rate": int(sr),
        }

        stdout_path.write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
        stderr_path.write_text("", encoding="utf-8")
        print(json.dumps(meta))
        return 0

    except Exception as exc:
        stderr_path.write_text(str(exc) + "\n", encoding="utf-8")
        print(str(exc), file=sys.stderr)
        return 1

if __name__ == "__main__":
    raise SystemExit(main())
''', encoding="utf-8")

route_text = route.read_text(encoding="utf-8")

# Add Qwen constants after Index constants.
anchor = 'const PREVIEW_TIMEOUT_MS = Math.max(60_000, Number(process.env.INDEX_TTS_PREVIEW_TIMEOUT_MS || 5 * 60 * 1000));'
qwen_constants = '''const PREVIEW_TIMEOUT_MS = Math.max(60_000, Number(process.env.INDEX_TTS_PREVIEW_TIMEOUT_MS || 5 * 60 * 1000));

const QWEN_TTS_ROOT = path.resolve(process.env.QWEN_TTS_ROOT || "C:\\\\AI\\\\voices\\\\qwen 3");
const QWEN_TTS_PYTHON = path.resolve(process.env.QWEN_TTS_PYTHON || "C:\\\\Users\\\\SLRoc\\\\miniconda3\\\\envs\\\\qwen3tts-repair\\\\python.exe");
const QWEN_TTS_SITE_PACKAGES = path.resolve(process.env.QWEN_TTS_SITE_PACKAGES || "C:\\\\AI\\\\voices\\\\qwen 3\\\\qwen3tts-env\\\\Lib\\\\site-packages");
const QWEN_TTS_BRIDGE = path.resolve(process.env.QWEN_TTS_BRIDGE || path.join(process.cwd(), "scripts", "qwen3_voice_design_preview.py"));
const QWEN_TTS_MODEL_ID = String(process.env.QWEN_TTS_MODEL_ID || "Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign");
const QWEN_PREVIEW_TIMEOUT_MS = Math.max(60_000, Number(process.env.QWEN_TTS_PREVIEW_TIMEOUT_MS || 10 * 60 * 1000));'''

if "const QWEN_TTS_ROOT" not in route_text:
    if anchor not in route_text:
        raise RuntimeError("Missing route constant anchor.")
    route_text = route_text.replace(anchor, qwen_constants, 1)

# Add runQwen function after runIndexTts.
run_anchor = '''function voiceEmotionPrompt(voiceSettings: any) {'''
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
    voiceSettings?.fullQwenInstruction ? voiceSettings : null
  );
}

'''

if "function runQwenTts" not in route_text:
    if run_anchor not in route_text:
        raise RuntimeError("Missing runQwen insertion anchor.")
    route_text = route_text.replace(run_anchor, run_qwen + run_anchor, 1)

old_require_block = '''    await requireDir(INDEX_TTS_ROOT, "IndexTTS2 root");
    await requireFile(INDEX_TTS_PYTHON, "IndexTTS2 Python");
    await requireFile(INDEX_TTS_BRIDGE, "IndexTTS2 bridge");
    await requireFile(INDEX_TTS_REFERENCE_WAV, "IndexTTS2 reference WAV");'''

new_require_block = '''    const qwenDesignRecord = extractQwenDesignRecord(body?.voiceSettings || {});
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

if "const qwenDesignRecord = extractQwenDesignRecord" not in route_text:
    if old_require_block not in route_text:
        raise RuntimeError("Missing IndexTTS require block.")
    route_text = route_text.replace(old_require_block, new_require_block, 1)

old_output = '''    const outputWav = path.join(outDir, "preview_neutral.wav");
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

new_output = '''    const qwenCandidateId = safeSegment(qwenDesignRecord?.selectedCandidateId || body?.candidateId || "candidate_01");
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
          language: String(body?.language || "en"),
          speaker_id: Number(body?.speakerId || body?.speaker_id || 0),
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

if "qwen_preview_" not in route_text:
    if old_output not in route_text:
        raise RuntimeError("Missing output params block.")
    route_text = route_text.replace(old_output, new_output, 1)

route_text = route_text.replace(
    'current.previewGeneration = {\n        engine: "IndexTTS2 direct",',
    'current.previewGeneration = {\n        engine: useQwen ? "Qwen3-TTS VoiceDesign" : "IndexTTS2 direct",',
)

route_text = route_text.replace(
    'engine: "IndexTTS2 direct",\n      characterId,',
    'engine: useQwen ? "Qwen3-TTS VoiceDesign" : "IndexTTS2 direct",\n      characterId,',
)

route.write_text(route_text, encoding="utf-8")

panel_text = panel.read_text(encoding="utf-8")

# Patch generateVoicePreview body payload to send selected Qwen record and preview text.
old_preview_payload = '''          voiceSettings: voice,
          text: PREVIEW_LINES[0]?.text || "",'''

new_preview_payload = '''          voiceSettings: {
            legacyVoiceSettings: voice,
            qwenVoiceDesign,
            qwenVoiceDesignRecord: qwenVoiceDesignRecord || (selectedQwenVoiceCandidate ? qwenVoiceDesignStorageRecord(qwenVoiceDesign, selectedQwenVoiceCandidate) : null),
          },
          candidateId: selectedQwenVoiceCandidate?.candidateId || "",
          text: selectedQwenVoiceCandidate?.previewText || PREVIEW_LINES[0]?.text || "",
          language: "en",
          speakerId: 0,'''

if old_preview_payload in panel_text:
    panel_text = panel_text.replace(old_preview_payload, new_preview_payload, 1)

panel_text = panel_text.replace(
    'setMessage("Generating IndexTTS2 voice preview...");',
    'setMessage("Generating Qwen3-TTS voice preview...");',
)

panel_text = panel_text.replace(
    'disabled={true}\n                  className="rounded-xl border border-cyan-400 px-4 py-2 text-sm font-semibold text-cyan-100 opacity-40"\n                >\n                  Generate Qwen Audio Preview - Patch 3',
    'onClick={generateVoicePreview}\n                  disabled={loading || !voicePackCreated || !selectedQwenVoiceCandidate}\n                  className="rounded-xl border border-cyan-400 px-4 py-2 text-sm font-semibold text-cyan-100 disabled:opacity-40"\n                >\n                  {loading ? "Generating..." : "Generate Qwen Audio Preview"}',
)

if "Generate Qwen Audio Preview - Patch 3" in panel_text:
    raise RuntimeError("Failed to re-enable Qwen audio preview button.")

panel.write_text(panel_text, encoding="utf-8")

# Final verification.
route_verify = route.read_text(encoding="utf-8")
panel_verify = panel.read_text(encoding="utf-8")
bridge_verify = bridge.read_text(encoding="utf-8")

for item in [
    "QWEN_TTS_PYTHON",
    "runQwenTts",
    "Qwen3-TTS VoiceDesign",
    "qwen_preview_",
]:
    if item not in route_verify:
        raise RuntimeError("Route verification failed: " + item)

for item in [
    "qwenVoiceDesignRecord",
    "Generate Qwen Audio Preview",
    "selectedQwenVoiceCandidate?.previewText",
]:
    if item not in panel_verify:
        raise RuntimeError("Panel verification failed: " + item)

for item in [
    "Qwen3TTSModel",
    "generate_with_design_kwargs",
    "sf.write",
]:
    if item not in bridge_verify:
        raise RuntimeError("Bridge verification failed: " + item)

print("OK: Qwen3-TTS preview generation patch applied.")
print("Changed:", bridge)
print("Changed:", route)
print("Changed:", panel)
print("Backup:", backup_dir)