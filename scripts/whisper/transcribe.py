import argparse
import json
import sys


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--audio", required=True, help="Path to input audio file")
    p.add_argument("--model", default="small", help="Whisper model name (tiny/base/small/medium/large-v3)")
    p.add_argument("--device", default="auto", help="auto|cpu|cuda")
    p.add_argument("--compute_type", default="auto", help="auto|int8|int8_float16|float16|float32")
    p.add_argument("--language", default="", help="Optional language code, e.g. en")
    args = p.parse_args()

    try:
        from faster_whisper import WhisperModel
    except Exception as e:
        print(json.dumps({"ok": False, "error": "faster-whisper not installed", "detail": str(e)}))
        return 2

    device = args.device
    if device == "auto":
        # Prefer CUDA if available.
        try:
            import torch  # type: ignore

            device = "cuda" if torch.cuda.is_available() else "cpu"
        except Exception:
            device = "cpu"

    compute_type = args.compute_type
    if compute_type == "auto":
        compute_type = "float16" if device == "cuda" else "int8"

    model = WhisperModel(args.model, device=device, compute_type=compute_type)

    kw = {"vad_filter": True}
    if args.language:
        kw["language"] = args.language

    segments, info = model.transcribe(args.audio, **kw)
    text_parts = []
    for seg in segments:
        t = (seg.text or "").strip()
        if t:
            text_parts.append(t)

    text = " ".join(text_parts).strip()

    out = {
        "ok": True,
        "text": text,
        "language": getattr(info, "language", None),
        "duration": getattr(info, "duration", None),
        "device": device,
        "compute_type": compute_type,
        "model": args.model,
    }
    print(json.dumps(out, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
