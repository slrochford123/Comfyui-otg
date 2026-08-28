from pathlib import Path
from datetime import datetime
import shutil

root = Path(r"C:\AI\OTG-Test2")
bridge = root / "scripts" / "qwen3_voice_design_preview.py"
backup_dir = root / ".manual-backups" / ("qwen3-bridge-only-" + datetime.now().strftime("%Y%m%d-%H%M%S"))

backup_dir.mkdir(parents=True, exist_ok=True)
bridge.parent.mkdir(parents=True, exist_ok=True)

if bridge.exists():
    shutil.copy2(bridge, backup_dir / "qwen3_voice_design_preview.py")

bridge.write_text(r'''import argparse
import inspect
import json
import sys
from pathlib import Path


def write_text_safe(path: Path, text: str):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


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
        params_path = Path(args.params_json)
        params = json.loads(params_path.read_text(encoding="utf-8"))

        import torch
        import soundfile as sf
        from qwen_tts.inference.qwen3_tts_model import Qwen3TTSModel

        model_id = str(params.get("model_id") or "Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign")
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

        load_attempts = [
            {"device": device, "dtype": dtype, "use_flash_attn": True},
            {"device": device, "dtype": dtype},
            {"device": device},
            {"device_map": "cuda:0" if torch.cuda.is_available() else "cpu"},
            {},
        ]

        model = None
        load_errors = []

        for kwargs in load_attempts:
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

        design_keys = [
            "instruction",
            "voice_instruction",
            "voice_description",
            "speaker_prompt",
            "prompt",
            "style_prompt",
            "voice_prompt",
            "description",
        ]

        attempts = []

        if instruction:
            rich_kwargs = dict(base_kwargs)
            for key in design_keys:
                if accepts_kwargs or key in supported:
                    rich_kwargs[key] = instruction
            if rich_kwargs != base_kwargs:
                attempts.append(("generate_with_design_kwargs", rich_kwargs))

        attempts.append(("generate_standard", base_kwargs))
        attempts.append(("generate_text_language", {"text": text, "language": language}))
        attempts.append(("generate_text_only", {"text": text}))

        wav = None
        sr = None
        used_attempt = None
        generate_errors = []

        for name, kwargs in attempts:
            try:
                result = generate(**kwargs)
                if isinstance(result, tuple) and len(result) >= 2:
                    wav, sr = result[0], result[1]
                else:
                    wav = result
                    sr = int(params.get("sample_rate") or 24000)
                used_attempt = name
                break
            except Exception as exc:
                generate_errors.append(f"{name}: {exc}")

        if wav is None:
            raise RuntimeError("Qwen generate failed. Attempts: " + " | ".join(generate_errors))

        wav0 = wav[0] if isinstance(wav, (list, tuple)) else wav
        sf.write(str(output_wav), wav0, int(sr))

        meta = {
            "ok": True,
            "engine": "Qwen3-TTS VoiceDesign",
            "model_id": model_id,
            "device": device,
            "dtype": dtype,
            "language": language,
            "speaker_id": speaker_id,
            "used_generate_attempt": used_attempt,
            "generate_signature": signature,
            "instruction_supplied": bool(instruction),
            "output_wav": str(output_wav),
            "sample_rate": int(sr),
        }

        write_text_safe(stdout_path, json.dumps(meta, indent=2) + "\n")
        write_text_safe(stderr_path, "")
        print(json.dumps(meta))
        return 0

    except Exception as exc:
        write_text_safe(stderr_path, str(exc) + "\n")
        write_text_safe(stdout_path, "")
        print(str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
''', encoding="utf-8")

written = bridge.read_text(encoding="utf-8")

required = [
    "Qwen3TTSModel",
    "generate_with_design_kwargs",
    "sf.write",
    "Qwen3-TTS VoiceDesign",
]

missing = [item for item in required if item not in written]
if missing:
    raise RuntimeError("Bridge verification failed: " + ", ".join(missing))

print("OK: Qwen bridge created.")
print("Changed:", bridge)
print("Backup:", backup_dir)
