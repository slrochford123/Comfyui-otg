from pathlib import Path
from datetime import datetime
import shutil

root = Path(r"C:\AI\OTG-Test2")
bridge = root / "scripts" / "qwen3_voice_design_preview.py"
backup_dir = root / ".manual-backups" / ("qwen-bridge-generate-voice-design-" + datetime.now().strftime("%Y%m%d-%H%M%S"))

if not bridge.exists():
    raise FileNotFoundError(bridge)

backup_dir.mkdir(parents=True, exist_ok=True)
shutil.copy2(bridge, backup_dir / "qwen3_voice_design_preview.py")

bridge.write_text(r'''import argparse
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
        params = json.loads(params_path.read_text(encoding="utf-8-sig"))

        import torch
        import soundfile as sf
        from qwen_tts import Qwen3TTSModel

        model_id = str(params.get("model_id") or "Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign")
        output_wav = Path(params["output_wav"])
        output_wav.parent.mkdir(parents=True, exist_ok=True)

        text = str(params.get("text") or "").strip()
        if not text:
            raise RuntimeError("Preview text is empty.")

        instruct = str(params.get("qwen_instruction") or params.get("instruct") or "").strip()
        if not instruct:
            instruct = "Create a clear, natural, plain neutral character voice. Keep pronunciation understandable."

        language = str(params.get("language") or "en").strip() or "en"
        dtype = str(params.get("dtype") or "float16").strip()

        device_map = "cuda:0" if torch.cuda.is_available() else "cpu"

        load_attempts = [
            {"device_map": device_map},
            {"device_map": "auto"},
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

        if not hasattr(model, "generate_voice_design"):
            raise RuntimeError("Loaded Qwen model has no generate_voice_design method.")

        wavs, sr = model.generate_voice_design(
            text=text,
            instruct=instruct,
            language=language,
            non_streaming_mode=True,
        )

        wav0 = wavs[0] if isinstance(wavs, (list, tuple)) else wavs
        sf.write(str(output_wav), wav0, int(sr))

        meta = {
            "ok": True,
            "engine": "Qwen3-TTS VoiceDesign",
            "model_id": model_id,
            "device_map": device_map,
            "dtype_requested": dtype,
            "language": language,
            "method": "generate_voice_design",
            "instruction_supplied": bool(instruct),
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
    "from qwen_tts import Qwen3TTSModel",
    "device_map",
    "generate_voice_design",
    "encoding=\"utf-8-sig\"",
    "sf.write",
]

missing = [item for item in required if item not in written]
if missing:
    raise RuntimeError("Bridge verification failed: " + ", ".join(missing))

print("OK: Qwen bridge now uses generate_voice_design.")
print("Changed:", bridge)
print("Backup:", backup_dir)