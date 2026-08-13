import os
import tempfile
import traceback
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, Form, UploadFile
from fastapi.responses import JSONResponse

app = FastAPI(title="OTG Speaker Diarization", version="1.0")

PIPELINE: Any | None = None
PIPELINE_MODEL = os.environ.get("PYANNOTE_MODEL", "pyannote/speaker-diarization-3.1").strip()


def _auth_token() -> str:
    return (
        os.environ.get("PYANNOTE_AUTH_TOKEN")
        or os.environ.get("HUGGINGFACE_TOKEN")
        or os.environ.get("HF_TOKEN")
        or ""
    ).strip()


def _device_name() -> str:
    requested = os.environ.get("PYANNOTE_DEVICE", "auto").strip().lower()
    if requested and requested != "auto":
        return requested

    try:
        import torch

        return "cuda" if torch.cuda.is_available() else "cpu"
    except Exception:
        return "cpu"


def _load_pipeline():
    global PIPELINE
    if PIPELINE is not None:
        return PIPELINE

    token = _auth_token()
    if not token:
        raise RuntimeError(
            "Missing Hugging Face token. Set PYANNOTE_AUTH_TOKEN, HUGGINGFACE_TOKEN, or HF_TOKEN "
            "after accepting the pyannote diarization model terms on Hugging Face."
        )

    try:
        from pyannote.audio import Pipeline
    except Exception as exc:
        raise RuntimeError(
            "pyannote.audio is not installed in this worker environment. Run install_speaker_diarization.ps1."
        ) from exc

    try:
        PIPELINE = Pipeline.from_pretrained(PIPELINE_MODEL, token=token)
    except TypeError:
        PIPELINE = Pipeline.from_pretrained(PIPELINE_MODEL, use_auth_token=token)
    except Exception as exc:
        message = str(exc)
        if "gated" in message.lower() or "403" in message or "authorized list" in message.lower():
            raise RuntimeError(
                f"Cannot access gated pyannote model {PIPELINE_MODEL}. "
                "Open https://huggingface.co/pyannote/speaker-diarization-3.1, accept the model terms, "
                "then make sure the worker is started with a token from that same Hugging Face account."
            ) from exc
        raise

    device = _device_name()
    try:
        import torch

        PIPELINE.to(torch.device(device))
    except Exception:
        pass

    return PIPELINE


def _positive_int(value: Any, default: int = 0) -> int:
    try:
        number = int(str(value or "").strip())
    except Exception:
        return default
    return number if number > 0 else default


def _load_audio_input(audio_path: Path) -> dict[str, Any]:
    try:
        import torch
        import torchaudio
    except Exception as exc:
        raise RuntimeError("torchaudio is required to preload audio for pyannote diarization.") from exc

    waveform, sample_rate = torchaudio.load(str(audio_path))
    if waveform.ndim == 2 and waveform.shape[0] > 1:
        waveform = waveform.mean(dim=0, keepdim=True)
    waveform = waveform.to(dtype=torch.float32)
    return {"waveform": waveform, "sample_rate": int(sample_rate)}


@app.get("/health")
def health():
    return {
        "ok": True,
        "model": PIPELINE_MODEL,
        "device": _device_name(),
        "tokenConfigured": bool(_auth_token()),
        "loaded": PIPELINE is not None,
    }


@app.post("/diarize")
async def diarize(
    audio: UploadFile = File(...),
    speakerCount: str | None = Form(None),
    maxSpeakers: str | None = Form(None),
    minSpeakers: str | None = Form(None),
):
    try:
        pipeline = _load_pipeline()
        suffix = Path(audio.filename or "audio.wav").suffix or ".wav"

        with tempfile.TemporaryDirectory(prefix="otg_diarize_") as tmp:
            audio_path = Path(tmp) / f"source{suffix}"
            audio_path.write_bytes(await audio.read())

            requested_speakers = _positive_int(speakerCount)
            requested_max = _positive_int(maxSpeakers, 5)
            requested_min = _positive_int(minSpeakers, 1)

            kwargs: dict[str, int] = {}
            if requested_speakers:
                kwargs["num_speakers"] = min(5, max(1, requested_speakers))
            else:
                kwargs["min_speakers"] = min(5, max(1, requested_min))
                kwargs["max_speakers"] = min(5, max(kwargs["min_speakers"], requested_max))

            # Preloading avoids pyannote's torchcodec decoder path, which is fragile on Windows.
            diarization = pipeline(_load_audio_input(audio_path), **kwargs)

        segments = []
        for turn, _track, speaker in diarization.itertracks(yield_label=True):
            segments.append(
                {
                    "speaker": str(speaker),
                    "start": round(float(turn.start), 2),
                    "end": round(float(turn.end), 2),
                }
            )

        speaker_order: list[str] = []
        for segment in segments:
            speaker = segment["speaker"]
            if speaker not in speaker_order:
                speaker_order.append(speaker)

        speakers = []
        for index, speaker in enumerate(speaker_order, start=1):
            speaker_segments = [segment for segment in segments if segment["speaker"] == speaker]
            speech_seconds = round(
                sum(max(0.0, float(segment["end"]) - float(segment["start"])) for segment in speaker_segments),
                2,
            )
            speakers.append(
                {
                    "id": speaker,
                    "label": f"Voice {index}",
                    "description": f"Pyannote diarized dialogue speaker {index}.",
                    "confidence": "pyannote_diarization",
                    "totalSpeechSeconds": speech_seconds,
                    "segments": speaker_segments,
                }
            )

        return {
            "ok": True,
            "tool": "pyannote.audio",
            "model": PIPELINE_MODEL,
            "device": _device_name(),
            "segments": segments,
            "speakers": speakers,
        }
    except Exception as exc:
        trace = traceback.format_exc(limit=8)
        print(trace, flush=True)
        return JSONResponse(
            status_code=500,
            content={
                "ok": False,
                "error": str(exc),
                "errorType": type(exc).__name__,
                "model": PIPELINE_MODEL,
                "tokenConfigured": bool(_auth_token()),
            },
        )


if __name__ == "__main__":
    import uvicorn

    host = os.environ.get("PYANNOTE_HOST", "127.0.0.1")
    port = int(os.environ.get("PYANNOTE_PORT", "9010"))
    uvicorn.run("app:app", host=host, port=port, reload=False)
