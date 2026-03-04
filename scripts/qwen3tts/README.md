# Qwen3TTS scripts (OTG)

These scripts are invoked by OTG server-side API routes.

They intentionally avoid Gradio and use the installed `qwen_tts` python package.

## Requirements

- A working python environment with `qwen_tts` installed (your existing Qwen3TTS setup).
- Set in `.env.local`:
  - `QWEN3TTS_PYTHON=C:/path/to/qwen3tts-env/Scripts/python.exe`
  - Optional:
    - `QWEN3TTS_ENABLE_CLONE=1`
    - `QWEN3TTS_ENABLE_TTS=1`

## Notes

- `clone.py` is best-effort. The upstream `qwen_tts` API for reference-audio cloning differs by version.
- `generate.py` will try reference-audio generation if supported; otherwise it falls back to standard TTS.
