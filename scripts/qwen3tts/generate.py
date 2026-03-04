import argparse
import os
import sys
import numpy as np


def _normalize_lang(lang_in: str) -> str:
    lang_in = (lang_in or "").strip().lower()
    lang_map = {
        "en": "english",
        "eng": "english",
        "english": "english",
        "zh": "chinese",
        "cn": "chinese",
        "chinese": "chinese",
        "fr": "french",
        "french": "french",
        "de": "german",
        "german": "german",
        "it": "italian",
        "italian": "italian",
        "ja": "japanese",
        "jp": "japanese",
        "japanese": "japanese",
        "ko": "korean",
        "korean": "korean",
        "pt": "portuguese",
        "portuguese": "portuguese",
        "ru": "russian",
        "russian": "russian",
        "es": "spanish",
        "spanish": "spanish",
        "auto": "auto",
        "": "auto",
    }
    return lang_map.get(lang_in, "auto")


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--text", required=True)
    p.add_argument("--lang", default="en")
    p.add_argument("--out", required=True)
    p.add_argument("--ref", default="")
    p.add_argument("--speaker", default="")  # optional override
    args = p.parse_args()

    text = (args.text or "").strip()
    if not text:
        print("Missing --text", file=sys.stderr)
        return 2

    out = args.out
    os.makedirs(os.path.dirname(out), exist_ok=True)

    lang = _normalize_lang(args.lang)

    # Speaker: qwen-tts 0.0.5 expects a NAME (string), not an int.
    # Allow env override, CLI override, default "aiden".
    speaker = (args.speaker or os.environ.get("QWEN3TTS_SPEAKER", "aiden")).strip()
    if not speaker:
        speaker = "aiden"

    try:
        from qwen_tts.inference.qwen3_tts_model import Qwen3TTSModel
        import soundfile as sf
    except Exception as e:
        print(f"Import error: {e}", file=sys.stderr)
        return 3

    repo_custom = os.environ.get("QWEN3TTS_MODEL_CUSTOM", "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice")
    repo_base = os.environ.get("QWEN3TTS_MODEL_BASE", "Qwen/Qwen3-TTS-12Hz-0.6B-Base")

    use_ref = bool(args.ref and os.path.exists(args.ref))
    chosen_repo = repo_custom if use_ref else repo_base

    try:
        model = Qwen3TTSModel.from_pretrained(chosen_repo)
    except Exception as e:
        print(f"Model load error: {e}", file=sys.stderr)
        return 4

    try:
        if use_ref:
            ref_wav, ref_sr = sf.read(args.ref)
            if isinstance(ref_wav, np.ndarray) and ref_wav.ndim > 1:
                ref_wav = ref_wav[:, 0]

            wavs, sr = model.generate_custom_voice(
                text=text,
                speaker=speaker,
                prompt_wav=ref_wav,
                prompt_sr=ref_sr,
                language=lang,
            )
        else:
            wavs, sr = model.generate_custom_voice(
                text=text,
                speaker=speaker,
                language=lang,
            )

        wav = wavs[0] if isinstance(wavs, (list, tuple)) else wavs
    except Exception as e:
        print(f"TTS generation error: {e}", file=sys.stderr)
        return 5

    try:
        sf.write(out, wav, int(sr))
        print(f"OK {out} ({sr}Hz) speaker={speaker} lang={lang}")
        return 0
    except Exception as e:
        print(f"Failed to write wav: {e}", file=sys.stderr)
        return 6


if __name__ == "__main__":
    raise SystemExit(main())
