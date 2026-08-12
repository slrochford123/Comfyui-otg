#!/usr/bin/env python3
"""Linux Qwen3-TTS VoiceDesign bridge for ComfyUI-OTG TEST.

Loads the official Qwen3-TTS VoiceDesign model for one job, writes one WAV,
and exits so CUDA memory is released back to the system.
"""

from __future__ import annotations

import argparse
import gc
import json
import os
import sys
from pathlib import Path
from typing import Any


def write_text_safe(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def clean(value: Any) -> str:
    return str(value or "").strip()


def normalized_language(value: Any) -> str:
    raw = clean(value).lower() or "english"
    mapping = {
        "en": "English",
        "eng": "English",
        "english": "English",
        "zh": "Chinese",
        "cn": "Chinese",
        "chinese": "Chinese",
        "de": "German",
        "german": "German",
        "it": "Italian",
        "italian": "Italian",
        "pt": "Portuguese",
        "portuguese": "Portuguese",
        "es": "Spanish",
        "spanish": "Spanish",
        "ja": "Japanese",
        "jp": "Japanese",
        "japanese": "Japanese",
        "ko": "Korean",
        "korean": "Korean",
        "fr": "French",
        "french": "French",
        "ru": "Russian",
        "russian": "Russian",
        "auto": "Auto",
    }
    return mapping.get(raw, clean(value) or "English")


def parse_seed(value: Any) -> int | None:
    text = clean(value)
    if not text:
        return None
    try:
        return int(text)
    except ValueError:
        return None


def main() -> int:
    parser = argparse.ArgumentParser(description="Linux Qwen3-TTS VoiceDesign bridge")
    parser.add_argument("--params-json", required=True)
    parser.add_argument("--stdout-log", required=True)
    parser.add_argument("--stderr-log", required=True)
    args = parser.parse_args()

    stdout_path = Path(args.stdout_log)
    stderr_path = Path(args.stderr_log)
    stdout_path.parent.mkdir(parents=True, exist_ok=True)
    stderr_path.parent.mkdir(parents=True, exist_ok=True)

    model = None
    torch = None
    try:
        params_path = Path(args.params_json)
        params = json.loads(params_path.read_text(encoding="utf-8-sig"))

        import soundfile as sf
        import torch as torch_module
        from qwen_tts import Qwen3TTSModel

        torch = torch_module
        if not torch.cuda.is_available():
            raise RuntimeError("CUDA is unavailable in the Qwen3-TTS virtual environment.")

        model_id = clean(params.get("model_id")) or "Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign"
        output_wav = Path(str(params["output_wav"]))
        output_wav.parent.mkdir(parents=True, exist_ok=True)

        text = clean(params.get("text"))
        if not text:
            raise RuntimeError("Preview text is empty.")

        instruct = clean(params.get("qwen_instruction") or params.get("voice_instruction") or params.get("instruct"))
        if not instruct:
            instruct = "Create a clear, natural, plain neutral character voice with understandable pronunciation."

        language = normalized_language(params.get("language"))
        seed = parse_seed(params.get("request_seed") or params.get("seed"))
        if seed is not None:
            torch.manual_seed(seed)
            torch.cuda.manual_seed_all(seed)

        dtype = torch.bfloat16
        load_attempts = [
            {
                "device_map": "cuda:0",
                "dtype": dtype,
                "attn_implementation": "sdpa",
            },
            {
                "device_map": "cuda:0",
                "dtype": dtype,
            },
        ]

        load_errors: list[str] = []
        for kwargs in load_attempts:
            try:
                model = Qwen3TTSModel.from_pretrained(model_id, **kwargs)
                break
            except Exception as exc:  # pragma: no cover - runtime diagnostics
                load_errors.append(f"{kwargs}: {exc}")
                model = None
                gc.collect()
                torch.cuda.empty_cache()

        if model is None:
            raise RuntimeError("Failed to load Qwen3-TTS VoiceDesign model. " + " | ".join(load_errors))
        if not hasattr(model, "generate_voice_design"):
            raise RuntimeError("Loaded Qwen3-TTS model has no generate_voice_design method.")

        wavs, sample_rate = model.generate_voice_design(
            text=text,
            language=language,
            instruct=instruct,
        )
        wav = wavs[0] if isinstance(wavs, (list, tuple)) else wavs
        sf.write(str(output_wav), wav, int(sample_rate))

        if not output_wav.is_file() or output_wav.stat().st_size <= 0:
            raise RuntimeError(f"Qwen3-TTS did not create a non-empty WAV: {output_wav}")

        meta = {
            "ok": True,
            "engine": "Qwen3-TTS VoiceDesign",
            "model_id": model_id,
            "device": "cuda:0",
            "dtype": "bfloat16",
            "attention": "sdpa-or-default",
            "language": language,
            "method": "generate_voice_design",
            "seed": seed,
            "output_wav": str(output_wav),
            "output_bytes": output_wav.stat().st_size,
            "sample_rate": int(sample_rate),
        }
        write_text_safe(stdout_path, json.dumps(meta, indent=2) + "\n")
        write_text_safe(stderr_path, "")
        print(json.dumps(meta))
        return 0
    except Exception as exc:
        write_text_safe(stderr_path, f"{type(exc).__name__}: {exc}\n")
        write_text_safe(stdout_path, "")
        print(f"{type(exc).__name__}: {exc}", file=sys.stderr)
        return 1
    finally:
        try:
            del model
        except Exception:
            pass
        gc.collect()
        if torch is not None:
            try:
                torch.cuda.empty_cache()
                torch.cuda.ipc_collect()
            except Exception:
                pass


if __name__ == "__main__":
    raise SystemExit(main())
