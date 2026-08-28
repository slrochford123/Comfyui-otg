#!/usr/bin/env python3
"""Official CosyVoice3 bridge used by the Linux OTG worker."""

from __future__ import annotations

import argparse
import json
import os
import sys
import traceback
from pathlib import Path


def write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def append_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(payload, indent=2, sort_keys=True) + "\n")


def required(params: dict, key: str) -> str:
    value = str(params.get(key) or "").strip()
    if not value:
        raise RuntimeError(f"Missing required params field: {key}")
    return value


def normalize_instruction(value: str) -> str:
    cleaned = value.strip() or "You are a helpful assistant. Speak in a clear, natural character voice."
    return cleaned if cleaned.endswith("<|endofprompt|>") else cleaned + "<|endofprompt|>"


def add_sys_path(value: str) -> None:
    if value and value not in sys.path:
        sys.path.insert(0, value)


def main() -> int:
    parser = argparse.ArgumentParser(description="CosyVoice3 OTG bridge")
    parser.add_argument("--params-json", required=True)
    parser.add_argument("--stdout-log", required=True)
    parser.add_argument("--stderr-log", required=True)
    args = parser.parse_args()

    stdout_path = Path(args.stdout_log)
    stderr_path = Path(args.stderr_log)
    try:
        params = json.loads(Path(args.params_json).read_text(encoding="utf-8-sig"))
        root = Path(required(params, "cosyvoice_root")).expanduser().resolve()
        model_dir = Path(required(params, "model_id")).expanduser().resolve()
        prompt_wav = Path(required(params, "prompt_wav")).expanduser().resolve()
        output_wav = Path(required(params, "output_wav")).expanduser().resolve()
        text = required(params, "text")
        instruction = normalize_instruction(str(params.get("instruction") or params.get("prompt") or ""))

        if not root.is_dir():
            raise RuntimeError(f"CosyVoice root not found: {root}")
        if not model_dir.is_dir():
            raise RuntimeError(f"CosyVoice model directory not found: {model_dir}")
        if not prompt_wav.is_file():
            raise RuntimeError(f"CosyVoice prompt WAV not found: {prompt_wav}")

        output_wav.parent.mkdir(parents=True, exist_ok=True)
        add_sys_path(str(root))
        add_sys_path(str(root / "third_party" / "Matcha-TTS"))
        site_packages = os.environ.get("COSYVOICE_SITE_PACKAGES", "").strip()
        add_sys_path(site_packages)

        append_json(
            stdout_path,
            {
                "ok": False,
                "phase": "start",
                "engine": "Fun-CosyVoice3-0.5B",
                "model_dir": str(model_dir),
                "prompt_wav": str(prompt_wav),
                "output_wav": str(output_wav),
                "text_length": len(text),
                "instruction_length": len(instruction),
                "source_job_id": params.get("source_job_id"),
                "character_id": params.get("character_id"),
            },
        )

        import torch  # type: ignore
        import torchaudio  # type: ignore
        from cosyvoice.cli.cosyvoice import AutoModel  # type: ignore

        if not torch.cuda.is_available():
            raise RuntimeError("CUDA is unavailable in the CosyVoice environment.")

        model = AutoModel(model_dir=str(model_dir))
        saved = False
        sample_rate = int(model.sample_rate)
        for result in model.inference_instruct2(text, instruction, str(prompt_wav), stream=False):
            speech = result.get("tts_speech") if isinstance(result, dict) else None
            if speech is None:
                raise RuntimeError("CosyVoice inference result did not include tts_speech.")
            torchaudio.save(str(output_wav), speech, sample_rate)
            saved = True
            break

        if not saved or not output_wav.is_file() or output_wav.stat().st_size <= 0:
            raise RuntimeError(f"CosyVoice finished without writing a non-empty WAV: {output_wav}")

        payload = {
            "ok": True,
            "engine": "Fun-CosyVoice3-0.5B",
            "model_dir": str(model_dir),
            "prompt_wav": str(prompt_wav),
            "output_wav": str(output_wav),
            "sample_rate": sample_rate,
            "output_bytes": output_wav.stat().st_size,
            "source_job_id": params.get("source_job_id"),
            "character_id": params.get("character_id"),
            "cuda_device": torch.cuda.get_device_name(0),
        }
        append_json(stdout_path, payload)
        write_text(stderr_path, "")
        print(json.dumps(payload))
        return 0
    except Exception as exc:
        payload = {"ok": False, "error": str(exc), "traceback": traceback.format_exc()}
        write_text(stderr_path, json.dumps(payload, indent=2, sort_keys=True) + "\n")
        append_json(stdout_path, {"ok": False, "phase": "failed", "error": str(exc)})
        print(str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
