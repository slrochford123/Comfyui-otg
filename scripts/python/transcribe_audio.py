#!/usr/bin/env python3
import argparse
import json
import os
import sys
from pathlib import Path


def emit(payload, code=0):
    sys.stdout.write(json.dumps(payload, ensure_ascii=False))
    sys.stdout.flush()
    raise SystemExit(code)


def transcribe_with_faster_whisper(audio_path: str, model_name: str) -> str:
    from faster_whisper import WhisperModel

    device = os.environ.get("OTG_TRANSCRIBE_DEVICE", "cpu")
    compute_type = os.environ.get("OTG_TRANSCRIBE_COMPUTE_TYPE", "int8")

    model = WhisperModel(model_name, device=device, compute_type=compute_type)
    segments, _info = model.transcribe(audio_path, beam_size=1, vad_filter=True)
    return " ".join(segment.text.strip() for segment in segments).strip()


def transcribe_with_openai_whisper(audio_path: str, model_name: str) -> str:
    import whisper

    model = whisper.load_model(model_name)
    result = model.transcribe(audio_path, fp16=False)
    return str(result.get("text", "")).strip()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("audio_path")
    parser.add_argument("--model", default=os.environ.get("OTG_TRANSCRIBE_MODEL", "base"))
    args = parser.parse_args()

    audio_path = str(Path(args.audio_path).resolve())
    if not Path(audio_path).exists():
        emit({"ok": False, "error": f"Audio file not found: {audio_path}"}, 2)

    errors = []

    try:
        text = transcribe_with_faster_whisper(audio_path, args.model)
        emit({"ok": True, "text": text, "transcript": text, "engine": "faster-whisper"})
    except Exception as error:
        errors.append(f"faster-whisper: {error}")

    try:
        text = transcribe_with_openai_whisper(audio_path, args.model)
        emit({"ok": True, "text": text, "transcript": text, "engine": "openai-whisper"})
    except Exception as error:
        errors.append(f"openai-whisper: {error}")

    emit(
        {
            "ok": False,
            "error": "No local Whisper engine is installed or usable.",
            "detail": " | ".join(errors),
            "install": "py -3 -m pip install faster-whisper",
        },
        1,
    )


if __name__ == "__main__":
    main()
