import argparse
import json
import os
import struct
import sys
import traceback
import wave
from pathlib import Path


def write_text_safe(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def append_json_log(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(payload, indent=2, sort_keys=True) + "\n")


def write_test_wav(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    sample_rate = 24000
    duration_seconds = 0.25
    frame_count = int(sample_rate * duration_seconds)
    with wave.open(str(path), "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(sample_rate)
        for index in range(frame_count):
            # Low amplitude deterministic tone. Test mode only.
            sample = int(9000 * ((index % 80) / 40 - 1))
            wav_file.writeframes(struct.pack("<h", sample))


def require_text(params: dict, key: str) -> str:
    value = str(params.get(key) or "").strip()
    if not value:
        raise RuntimeError(f"Missing required params field: {key}")
    return value


def optional_text(params: dict, *keys: str) -> str:
    for key in keys:
        value = str(params.get(key) or "").strip()
        if value:
            return value
    return ""


def add_sys_path(path_value: str) -> None:
    if path_value and path_value not in sys.path:
        sys.path.insert(0, path_value)


def resolve_model_dir(root: Path, model_id: str) -> Path:
    candidate = Path(model_id)
    if candidate.is_absolute():
        return candidate
    return root / "pretrained_models" / model_id


def resolve_prompt_wav(root: Path, params: dict) -> Path:
    raw = optional_text(params, "prompt_wav", "promptWav", "reference_wav", "referenceWav")
    if raw:
        candidate = Path(raw)
        if candidate.is_absolute():
            return candidate
        return root / candidate
    return root / "asset" / "zero_shot_prompt.wav"


def default_instruction() -> str:
    return (
        "You are a helpful assistant. Speak in English with a natural, clean, character voice. "
        "Preserve intelligibility and realistic pacing.<|endofprompt|>"
    )


def normalize_instruction(value: str) -> str:
    cleaned = value.strip() or default_instruction()
    return cleaned if cleaned.endswith("<|endofprompt|>") else cleaned + "<|endofprompt|>"


def require_file(path_value: Path, label: str) -> None:
    if not path_value.is_file():
        raise RuntimeError(f"{label} not found: {path_value}")


def require_dir(path_value: Path, label: str) -> None:
    if not path_value.is_dir():
        raise RuntimeError(f"{label} not found: {path_value}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Cosy/CosyVoice voice sample bridge")
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
        root = Path(require_text(params, "cosyvoice_root"))
        require_dir(root, "CosyVoice root")

        output_wav = Path(require_text(params, "output_wav"))
        output_wav.parent.mkdir(parents=True, exist_ok=True)

        text = require_text(params, "text")
        model_id = str(params.get("model_id") or "Fun-CosyVoice3-0.5B").strip()
        instruction = normalize_instruction(optional_text(params, "instruction", "instruct", "prompt"))
        model_dir = resolve_model_dir(root, model_id)
        prompt_wav = resolve_prompt_wav(root, params)
        site_packages = os.environ.get("COSYVOICE_SITE_PACKAGES", "").strip()

        append_json_log(
            stdout_path,
            {
                "ok": False,
                "phase": "start",
                "engine": params.get("engine") or "CosyVoice3",
                "adapter": "cosy",
                "model_id": model_id,
                "model_dir": str(model_dir),
                "prompt_wav": str(prompt_wav),
                "cosyvoice_root": str(root),
                "output_wav": str(output_wav),
                "text_length": len(text),
                "instruction_length": len(instruction),
                "language": params.get("language") or "english",
                "source_job_id": params.get("source_job_id"),
                "character_id": params.get("character_id"),
                "test_mode": os.environ.get("COSYVOICE_BRIDGE_TEST_MODE") or "",
            },
        )

        if os.environ.get("COSYVOICE_BRIDGE_TEST_MODE") == "success":
            write_test_wav(output_wav)
            size = output_wav.stat().st_size
            payload = {
                "ok": True,
                "engine": "CosyVoice3 bridge test mode",
                "adapter": "cosy",
                "model_id": model_id,
                "model_dir": str(model_dir),
                "prompt_wav": str(prompt_wav),
                "output_wav": str(output_wav),
                "output_bytes": size,
                "sample_rate": 24000,
                "channels": 1,
                "source_job_id": params.get("source_job_id"),
            }
            append_json_log(stdout_path, payload)
            write_text_safe(stderr_path, "")
            print(json.dumps(payload))
            return 0

        require_dir(model_dir, "CosyVoice model directory")
        require_file(prompt_wav, "CosyVoice prompt WAV")

        add_sys_path(str(root))
        add_sys_path(str(root / "third_party" / "Matcha-TTS"))
        if site_packages:
            add_sys_path(site_packages)

        from cosyvoice.cli.cosyvoice import AutoModel  # type: ignore
        import torchaudio  # type: ignore

        model = AutoModel(model_dir=str(model_dir))
        saved = False
        sample_rate = int(model.sample_rate)
        for _index, result in enumerate(model.inference_instruct2(text, instruction, str(prompt_wav), stream=False)):
            if "tts_speech" not in result:
                raise RuntimeError("CosyVoice inference result did not include tts_speech.")
            torchaudio.save(str(output_wav), result["tts_speech"], sample_rate)
            saved = True
            break

        if not saved:
            raise RuntimeError("CosyVoice inference produced no results.")

        if not output_wav.is_file() or output_wav.stat().st_size <= 0:
            raise RuntimeError(f"CosyVoice finished without writing output WAV: {output_wav}")

        payload = {
            "ok": True,
            "engine": "CosyVoice3",
            "adapter": "cosy",
            "model_dir": str(model_dir),
            "prompt_wav": str(prompt_wav),
            "output_wav": str(output_wav),
            "sample_rate": sample_rate,
            "output_bytes": output_wav.stat().st_size,
            "source_job_id": params.get("source_job_id"),
            "character_id": params.get("character_id"),
        }
        append_json_log(stdout_path, payload)
        write_text_safe(stderr_path, "")
        print(json.dumps(payload))
        return 0

    except Exception as exc:
        error_payload = {
            "ok": False,
            "error": str(exc),
            "traceback": traceback.format_exc(),
        }
        write_text_safe(stderr_path, json.dumps(error_payload, indent=2, sort_keys=True) + "\n")
        if stdout_path.exists():
            append_json_log(stdout_path, {"ok": False, "phase": "failed", "error": str(exc)})
        else:
            write_text_safe(stdout_path, json.dumps({"ok": False, "phase": "failed", "error": str(exc)}, indent=2) + "\n")
        print(str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
