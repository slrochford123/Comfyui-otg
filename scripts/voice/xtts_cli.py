import argparse
import os
import sys

import torch
from TTS.api import TTS


def main() -> int:
    parser = argparse.ArgumentParser(description="SLR Studios OTG local XTTS v2 CLI bridge")
    parser.add_argument("--text", required=True)
    parser.add_argument("--speaker", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--language", default=os.environ.get("XTTS_LANGUAGE", "en"))
    parser.add_argument("--model", default=os.environ.get("XTTS_MODEL", "tts_models/multilingual/multi-dataset/xtts_v2"))
    args = parser.parse_args()

    speaker = os.path.abspath(args.speaker)
    output = os.path.abspath(args.output)
    if not os.path.isfile(speaker):
        raise FileNotFoundError(f"Speaker reference audio not found: {speaker}")

    os.makedirs(os.path.dirname(output), exist_ok=True)
    device = "cuda" if torch.cuda.is_available() else "cpu"
    tts = TTS(model_name=args.model)
    tts.to(device)
    tts.tts_to_file(
        text=args.text,
        speaker_wav=speaker,
        language=args.language,
        file_path=output,
    )
    if not os.path.isfile(output) or os.path.getsize(output) <= 0:
        raise RuntimeError(f"XTTS did not write output: {output}")
    print(output)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"XTTS CLI failed: {exc}", file=sys.stderr)
        raise