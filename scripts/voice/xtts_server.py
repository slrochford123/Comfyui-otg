import os
import sys
from fastapi import FastAPI, Form
from TTS.api import TTS
import torch

MODEL_NAME = os.environ.get("XTTS_MODEL", "tts_models/multilingual/multi-dataset/xtts_v2")
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"

app = FastAPI()
tts = None


def get_tts():
    global tts
    if tts is None:
        tts = TTS(model_name=MODEL_NAME)
        tts.to(DEVICE)
    return tts


@app.get("/health")
def health():
    return {"ok": True, "model": MODEL_NAME, "device": DEVICE}


@app.post("/synthesize")
def synthesize(
    text: str = Form(...),
    speaker_path: str = Form(...),
    output_path: str = Form(...),
    language: str = Form("en"),
):
    speaker_path = os.path.abspath(speaker_path)
    output_path = os.path.abspath(output_path)
    if not os.path.isfile(speaker_path):
        return {"ok": False, "error": f"Speaker file not found: {speaker_path}"}
    if not text.strip():
        return {"ok": False, "error": "Text is empty"}
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    engine = get_tts()
    engine.tts_to_file(
        text=text.strip(),
        speaker_wav=speaker_path,
        language=language,
        file_path=output_path,
    )
    if not os.path.isfile(output_path) or os.path.getsize(output_path) <= 0:
        return {"ok": False, "error": f"XTTS did not write output: {output_path}"}
    return {"ok": True, "output": output_path}


if __name__ == "__main__":
    import uvicorn
    host = os.environ.get("XTTS_HOST", "127.0.0.1")
    port = int(os.environ.get("XTTS_PORT", "7862"))
    uvicorn.run(app, host=host, port=port)