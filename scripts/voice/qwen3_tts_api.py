import inspect
import os
import sys
import traceback
from pathlib import Path
from typing import Any, Optional

import torch
import soundfile as sf
from fastapi import FastAPI, Form
from fastapi.responses import JSONResponse

try:
    from qwen_tts import Qwen3TTSModel
except Exception:
    from qwen_tts.inference.qwen3_tts_model import Qwen3TTSModel


# OTG_QWEN3_BASE_CLONE_FIX_V14
#
# Qwen3-TTS model roles:
# - Base models support arbitrary reference-audio voice clone.
# - CustomVoice models do not support arbitrary reference-audio voice clone.
# - VoiceDesign models generate from natural-language voice design prompts.
#
# OTG Characters-tab reference voices must use a Base model.

DEFAULT_CLONE_MODEL = "Qwen/Qwen3-TTS-12Hz-1.7B-Base"
DEFAULT_CUSTOM_MODEL = "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice"

CLONE_MODEL = os.environ.get("QWEN3_TTS_CLONE_MODEL") or os.environ.get("QWEN3_TTS_MODEL") or DEFAULT_CLONE_MODEL
if "Base" not in CLONE_MODEL:
    CLONE_MODEL = DEFAULT_CLONE_MODEL

CUSTOM_MODEL = os.environ.get("QWEN3_TTS_CUSTOM_MODEL") or DEFAULT_CUSTOM_MODEL
DEFAULT_LANGUAGE = os.environ.get("QWEN3_TTS_LANGUAGE", "English")
DEFAULT_CUSTOM_SPEAKER = os.environ.get("QWEN3_TTS_CUSTOM_SPEAKER", "Ryan")
DTYPE_NAME = os.environ.get("QWEN3_TTS_DTYPE", "bfloat16").lower()
USE_FLASH = os.environ.get("QWEN3_TTS_USE_FLASH", "1") not in {"0", "false", "False", "no", "No"}

_loaded_repo: Optional[str] = None
_loaded_model: Optional[Any] = None

app = FastAPI(title="SLR Studios OTG Qwen3-TTS API", version="14")


def _dtype() -> Any:
    if DTYPE_NAME in {"bf16", "bfloat16"}:
        return torch.bfloat16
    if DTYPE_NAME in {"fp16", "float16", "half"}:
        return torch.float16
    if DTYPE_NAME in {"fp32", "float32"}:
        return torch.float32
    return torch.bfloat16


def _device() -> str:
    return "cuda:0" if torch.cuda.is_available() else "cpu"


def _normalize_language(value: Optional[str]) -> str:
    if not value:
        return DEFAULT_LANGUAGE
    v = value.strip()
    lookup = {
        "en": "English",
        "english": "English",
        "zh": "Chinese",
        "zh-cn": "Chinese",
        "cn": "Chinese",
        "chinese": "Chinese",
        "es": "Spanish",
        "spanish": "Spanish",
        "fr": "French",
        "french": "French",
        "de": "German",
        "german": "German",
        "it": "Italian",
        "italian": "Italian",
        "pt": "Portuguese",
        "portuguese": "Portuguese",
        "ja": "Japanese",
        "japanese": "Japanese",
        "ko": "Korean",
        "korean": "Korean",
        "ru": "Russian",
        "russian": "Russian",
        "auto": "Auto",
    }
    return lookup.get(v.lower(), v)


def _load_model(repo_id: str) -> Any:
    global _loaded_repo, _loaded_model

    if _loaded_repo == repo_id and _loaded_model is not None:
        return _loaded_model

    _loaded_repo = None
    _loaded_model = None
    if torch.cuda.is_available():
        torch.cuda.empty_cache()

    dtype = _dtype()
    attempts = [
        {"device_map": _device(), "dtype": dtype, "attn_implementation": "flash_attention_2"},
        {"device_map": _device(), "dtype": dtype},
        {"device": "cuda" if torch.cuda.is_available() else "cpu", "dtype": DTYPE_NAME, "use_flash_attn": USE_FLASH},
        {"device": "cuda" if torch.cuda.is_available() else "cpu", "dtype": DTYPE_NAME, "use_flash_attn": False},
        {},
    ]

    last_error: Optional[Exception] = None
    for kwargs in attempts:
        try:
            model = Qwen3TTSModel.from_pretrained(repo_id, **kwargs)
            _loaded_repo = repo_id
            _loaded_model = model
            return model
        except Exception as exc:
            last_error = exc
            if torch.cuda.is_available():
                torch.cuda.empty_cache()

    raise RuntimeError(f"Could not load Qwen3-TTS model {repo_id}: {last_error}")


def _write_audio(wavs: Any, sr: int, output_path: str) -> None:
    out = Path(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)

    wav0 = wavs[0] if isinstance(wavs, (list, tuple)) else wavs
    sf.write(str(out), wav0, sr)

    if not out.is_file() or out.stat().st_size <= 0:
        raise RuntimeError(f"Qwen3-TTS did not write output: {out}")


def _call_method_variants(model: Any, method_name: str, variants: list[dict]) -> tuple[Any, int, dict]:
    method = getattr(model, method_name)
    signature_text = ""
    try:
        signature_text = str(inspect.signature(method))
    except Exception:
        signature_text = "signature unavailable"

    errors = []
    for kwargs in variants:
        clean_kwargs = {k: v for k, v in kwargs.items() if v is not None}
        try:
            result = method(**clean_kwargs)
            if isinstance(result, tuple) and len(result) >= 2:
                wavs, sr = result[0], result[1]
                return wavs, int(sr), clean_kwargs
            raise RuntimeError(f"{method_name} returned unexpected result type: {type(result)}")
        except Exception as exc:
            errors.append(f"{clean_kwargs}: {exc}")

    raise RuntimeError(
        f"{method_name} failed for all argument variants. Signature: {signature_text}. "
        + " | ".join(errors)
    )


def _voice_clone(
    text: str,
    speaker_path: str,
    output_path: str,
    language: str,
    ref_text: Optional[str],
) -> dict:
    speaker = Path(speaker_path).resolve()
    if not speaker.is_file():
        raise FileNotFoundError(f"Reference speaker audio not found: {speaker}")

    model = _load_model(CLONE_MODEL)

    if not hasattr(model, "generate_voice_clone"):
        methods = [name for name in dir(model) if name.startswith("generate")]
        raise RuntimeError(
            f"Loaded model does not support generate_voice_clone. "
            f"Model: {CLONE_MODEL}. Available methods: {', '.join(methods)}"
        )

    lang = _normalize_language(language)
    ref_text_clean = (ref_text or "").strip()

    # Qwen3-TTS API signatures have changed across packages.
    # Try known argument names safely.
    variants = []
    if ref_text_clean:
        variants.extend([
            {"text": text, "language": lang, "ref_audio": str(speaker), "ref_text": ref_text_clean, "x_vector_only_mode": False},
            {"text": text, "language": lang, "speaker_wav": str(speaker), "ref_text": ref_text_clean, "x_vector_only_mode": False},
            {"text": text, "language": lang, "prompt_audio": str(speaker), "prompt_text": ref_text_clean},
        ])

    variants.extend([
        {"text": text, "language": lang, "ref_audio": str(speaker), "x_vector_only_mode": True},
        {"text": text, "language": lang, "speaker_wav": str(speaker), "x_vector_only_mode": True},
        {"text": text, "language": lang, "reference_audio": str(speaker), "x_vector_only_mode": True},
        {"text": text, "language": lang, "prompt_audio": str(speaker)},
        {"text": text, "ref_audio": str(speaker), "x_vector_only_mode": True},
        {"text": text, "speaker_wav": str(speaker), "x_vector_only_mode": True},
    ])

    wavs, sr, used_kwargs = _call_method_variants(model, "generate_voice_clone", variants)
    _write_audio(wavs, sr, output_path)

    return {
        "ok": True,
        "output": output_path,
        "model": CLONE_MODEL,
        "mode": "voice_clone",
        "language": lang,
        "sampleRate": sr,
        "usedArgs": list(used_kwargs.keys()),
    }


def _custom_voice(
    text: str,
    output_path: str,
    language: str,
    speaker: Optional[str],
    instruct: Optional[str],
) -> dict:
    model = _load_model(CUSTOM_MODEL)

    if not hasattr(model, "generate_custom_voice"):
        methods = [name for name in dir(model) if name.startswith("generate")]
        raise RuntimeError(
            f"Loaded custom model does not support generate_custom_voice. "
            f"Model: {CUSTOM_MODEL}. Available methods: {', '.join(methods)}"
        )

    lang = _normalize_language(language)
    speaker_name = (speaker or DEFAULT_CUSTOM_SPEAKER).strip() or DEFAULT_CUSTOM_SPEAKER
    instruct_clean = (instruct or "").strip() or None

    variants = [
        {"text": text, "language": lang, "speaker": speaker_name, "instruct": instruct_clean},
        {"text": text, "language": lang, "speaker": speaker_name},
        {"text": text, "language": lang, "speaker_id": speaker_name, "instruct": instruct_clean},
        {"text": text, "speaker": speaker_name, "instruct": instruct_clean},
    ]

    wavs, sr, used_kwargs = _call_method_variants(model, "generate_custom_voice", variants)
    _write_audio(wavs, sr, output_path)

    return {
        "ok": True,
        "output": output_path,
        "model": CUSTOM_MODEL,
        "mode": "custom_voice",
        "language": lang,
        "speaker": speaker_name,
        "sampleRate": sr,
        "usedArgs": list(used_kwargs.keys()),
    }


@app.get("/health")
def health():
    return {
        "ok": True,
        "service": "qwen3-tts-api",
        "version": "14",
        "device": _device(),
        "cuda": torch.cuda.is_available(),
        "loadedModel": _loaded_repo,
        "cloneModel": CLONE_MODEL,
        "customModel": CUSTOM_MODEL,
        "defaultLanguage": DEFAULT_LANGUAGE,
    }


@app.post("/synthesize")
def synthesize(
    text: str = Form(...),
    output_path: str = Form(...),
    speaker_path: Optional[str] = Form(None),
    reference_path: Optional[str] = Form(None),
    language: str = Form(DEFAULT_LANGUAGE),
    ref_text: Optional[str] = Form(None),
    speaker: Optional[str] = Form(None),
    instruct: Optional[str] = Form(None),
):
    try:
        clean_text = (text or "").strip()
        if not clean_text:
            return JSONResponse({"ok": False, "error": "Text is empty."}, status_code=400)

        out = str(Path(output_path).resolve())
        ref = (speaker_path or reference_path or "").strip()

        if ref:
            result = _voice_clone(
                text=clean_text,
                speaker_path=ref,
                output_path=out,
                language=language,
                ref_text=ref_text,
            )
        else:
            result = _custom_voice(
                text=clean_text,
                output_path=out,
                language=language,
                speaker=speaker,
                instruct=instruct,
            )

        return result

    except Exception as exc:
        traceback.print_exc()
        return JSONResponse(
            {
                "ok": False,
                "error": str(exc),
                "cloneModel": CLONE_MODEL,
                "customModel": CUSTOM_MODEL,
                "fix": "Use Qwen3 Base model for Characters-tab reference audio. CustomVoice cannot clone arbitrary reference audio.",
            },
            status_code=500,
        )


if __name__ == "__main__":
    import uvicorn

    host = os.environ.get("QWEN3_TTS_HOST", "127.0.0.1")
    port = int(os.environ.get("QWEN3_TTS_PORT", "7863"))
    uvicorn.run(app, host=host, port=port)
