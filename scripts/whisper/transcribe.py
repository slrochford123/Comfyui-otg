#!/usr/bin/env python3
import argparse, json, os, sys

def out(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False))
    sys.stdout.flush()

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--audio", required=True)
    ap.add_argument("--model", default=os.environ.get("WHISPER_MODEL", "base"))
    ap.add_argument("--device", default=os.environ.get("WHISPER_DEVICE", "cpu"))
    ap.add_argument("--compute_type", default=os.environ.get("WHISPER_COMPUTE_TYPE", "int8"))
    ap.add_argument("--language", default="")
    args = ap.parse_args()

    try:
        from faster_whisper import WhisperModel
    except Exception as e:
        out({"ok": False, "error": f"Missing faster-whisper. Install in venv: pip install faster-whisper. Detail: {e}"})
        return 2

    try:
        model = WhisperModel(args.model, device=args.device, compute_type=args.compute_type)
        segments, info = model.transcribe(args.audio, language=(args.language or None))
        text = "".join([s.text for s in segments]).strip()
        out({"ok": True, "text": text, "language": getattr(info, "language", None)})
        return 0
    except Exception as e:
        out({"ok": False, "error": str(e)})
        return 1

if __name__ == "__main__":
    sys.exit(main())
