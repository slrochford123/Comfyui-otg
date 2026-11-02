#!/usr/bin/env python3
"""Isolated, CPU-only Story Creator models over a private Unix socket.

No HTTP listener, shell execution, caller paths, remote model code or paid APIs.
Only the configured, pre-downloaded model directory is used for inference.
"""
import argparse
import base64
import gc
import io
import json
import os
import re
import socket
import socketserver
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

os.environ["CUDA_VISIBLE_DEVICES"] = ""
os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"
os.environ["TOKENIZERS_PARALLELISM"] = "false"
for variable in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS"):
    os.environ[variable] = "2"

import numpy as np
import soundfile as sf
import torch

torch.set_num_threads(2)
torch.set_num_interop_threads(1)
if torch.version.cuda is not None:
    raise RuntimeError("This worker requires a CPU-only Torch build; GPU inference is not permitted.")

MODELS = {}
BUSY = threading.Lock()
CANCELLED = set()
ROOT = None


def cancelled(job):
    if job in CANCELLED:
        raise InterruptedError("Cancelled after the current bounded model evaluation.")


def embed(data):
    from transformers import AutoModel, AutoTokenizer
    texts = data.get("texts")
    if not isinstance(texts, list) or not 1 <= len(texts) <= 64 or any(not isinstance(t, str) or len(t) > 4000 for t in texts):
        raise ValueError("Expected one to 64 bounded text passages.")
    if "bge" not in MODELS:
        directory = ROOT / "models/bge-small"
        MODELS["bge"] = (AutoTokenizer.from_pretrained(directory, local_files_only=True),
                         AutoModel.from_pretrained(directory, local_files_only=True).eval().to("cpu"))
    tokenizer, model = MODELS["bge"]
    if data.get("query"):
        texts = ["Represent this sentence for searching relevant passages: " + text for text in texts]
    with torch.inference_mode():
        tokens = tokenizer(texts, padding=True, truncation=True, max_length=512, return_tensors="pt")
        vectors = torch.nn.functional.normalize(model(**tokens).last_hidden_state[:, 0], p=2, dim=1)
    return {"vectors": vectors.tolist(), "model": "bge-small@5c38ec7c405ec4b44b94cc5a9bb96e735b38267a"}


def short_chunks(text, maximum=140):
    chunks = []
    current = ""
    for word in text.split():
        if current and len(current) + len(word) + 1 > maximum:
            chunks.append(current)
            current = ""
        current = (current + " " + word).strip()
        if len(current) >= maximum // 2 and re.search(r"[.!?][\"']?$", current):
            chunks.append(current)
            current = ""
    if current:
        chunks.append(current)
    return chunks


def tts(data, job):
    text = str(data.get("text", "")).strip()
    engine = data.get("engine")
    if not text or len(text) > 12000:
        raise ValueError("Speech text must contain one to 12000 characters.")
    voice = str(data.get("voice", "female"))
    allowed_voices = ("af_heart", "am_puck", "bf_isabella", "bm_fable") if engine == "paradee" else ("female", "male")
    if voice not in allowed_voices:
        raise ValueError("Unsupported assistant voice.")
    audio = []
    if engine == "paradee":
        MODELS.pop("bark", None)
        gc.collect()
        if "paradee" not in MODELS:
            from paradee import Paradee
            directory = ROOT / "models/paradee"
            MODELS["paradee"] = Paradee(version="1.2", threads=1,
                model_path=str(directory / "onnx/paradee_int8.onnx"), config_path=str(directory / "config.json"))
        model = MODELS["paradee"]
        # Pin package version; its chunker preserves sentences beyond the 510-phoneme limit.
        # Iterate chunks here so cancellation is checked between bounded evaluations.
        for phonemes in model._chunks(text, voice):
            cancelled(job)
            audio.append(model.generate_from_phonemes(phonemes, speed=1.0, voice=voice))
        rate = 24000
    elif engine == "kokoro":
        MODELS.pop("bark", None)
        gc.collect()
        if "kokoro" not in MODELS:
            from kokoro import KModel, KPipeline
            directory = ROOT / "models/kokoro"
            model = KModel(repo_id="hexgrad/Kokoro-82M", config=str(directory / "config.json"),
                           model=str(directory / "kokoro-v1_0.pth")).eval().to("cpu")
            MODELS["kokoro"] = KPipeline(lang_code="a", repo_id="hexgrad/Kokoro-82M", model=model, device="cpu")
        pipeline = MODELS["kokoro"]
        pack = ROOT / "models/kokoro/voices" / ("af_heart.pt" if voice == "female" else "am_michael.pt")
        for result in pipeline(text, voice=str(pack), speed=1.0):
            cancelled(job)
            if result.audio is not None:
                audio.append(result.audio.detach().cpu().numpy())
        rate = 24000
    elif engine == "bark":
        if len(text) > 400:
            raise ValueError("Experimental Bark playback is limited to 400 characters.")
        MODELS.pop("kokoro", None)
        gc.collect()
        from transformers import BarkModel, BarkProcessor
        if "bark" not in MODELS:
            directory = ROOT / "models/bark-small"
            MODELS["bark"] = (BarkProcessor.from_pretrained(directory, local_files_only=True),
                              BarkModel.from_pretrained(directory, local_files_only=True, attn_implementation="eager").eval().to("cpu"))
        processor, model = MODELS["bark"]
        speaker = "en_speaker_9" if voice == "female" else "en_speaker_6"
        preset = {name: np.load(ROOT / "models/bark-small/speaker_embeddings" / f"{speaker}_{name}.npy", allow_pickle=False)
                  for name in ("semantic_prompt", "coarse_prompt", "fine_prompt")}
        torch.manual_seed(424242)
        for chunk in short_chunks(text):
            cancelled(job)
            inputs = processor(text=chunk, voice_preset=preset, return_tensors="pt")
            with torch.inference_mode():
                value = model.generate(**inputs, semantic_max_new_tokens=512)
            cancelled(job)
            audio.append(value.detach().cpu().numpy().squeeze())
        rate = model.generation_config.sample_rate
    else:
        raise ValueError("Unsupported speech engine.")
    cancelled(job)
    if not audio:
        raise ValueError("No speech waveform was produced.")
    silence = np.zeros(int(rate * 0.1), dtype=np.float32)
    joined = np.concatenate([piece for index, waveform in enumerate(audio)
                             for piece in ((silence, waveform) if index else (waveform,))])
    if not np.isfinite(joined).all() or len(joined) < rate // 4:
        raise ValueError("Invalid or empty speech waveform.")
    peak = float(np.abs(joined).max())
    if peak > 0.98:
        joined = joined * (0.98 / peak)
    output = io.BytesIO()
    sf.write(output, joined, rate, format="WAV", subtype="PCM_16")
    return {"audio": base64.b64encode(output.getvalue()).decode(), "sampleRate": rate,
            "durationSeconds": len(joined) / rate, "chunks": len(audio), "engine": engine,
            "voice": voice, "peak": min(peak, 0.98)}


def transcribe(data, job):
    import av
    from faster_whisper import WhisperModel
    audio = base64.b64decode(data.get("audio", ""), validate=True)
    if not audio or len(audio) > 16 * 1024 * 1024:
        raise ValueError("Recording must contain at most 16 MiB.")
    language = data.get("language") or None
    if language and (not isinstance(language, str) or not re.fullmatch(r"[a-z]{2,3}", language)):
        raise ValueError("Unsupported language code.")
    if "whisper" not in MODELS:
        MODELS["whisper"] = WhisperModel(str(ROOT / "models/whisper-base"), device="cpu",
                                         compute_type="int8", cpu_threads=2, num_workers=1,
                                         local_files_only=True)
    # Decode explicitly: recent PyAV removed the metadata_errors argument used by
    # faster-whisper 1.2.1's convenience decoder. Pass normalized samples instead.
    samples = []
    count = 0
    with av.open(io.BytesIO(audio), mode="r") as container:
        resampler = av.AudioResampler(format="fltp", layout="mono", rate=16000)
        for frame in container.decode(audio=0):
            cancelled(job)
            for normalized in resampler.resample(frame):
                value = normalized.to_ndarray().flatten()
                count += len(value)
                if count > 600 * 16000:
                    raise ValueError("Recordings are limited to ten minutes.")
                samples.append(value)
        for normalized in resampler.resample(None):
            samples.append(normalized.to_ndarray().flatten())
    if not samples:
        raise ValueError("No audio samples were decoded.")
    normalized_audio = np.concatenate(samples).astype(np.float32)
    def recognize(task, selected_language):
        segments, info = MODELS["whisper"].transcribe(normalized_audio, language=selected_language,
            task=task, beam_size=3, initial_prompt=str(data.get("vocabulary", ""))[:1200] or None,
            vad_filter=True, condition_on_previous_text=False)
        parts = []
        for segment in segments:
            cancelled(job)
            if segment.no_speech_prob < 0.75:
                parts.append(segment.text)
        return " ".join(parts).strip(), info

    original, info = recognize("transcribe", language)
    cancelled(job)
    text = recognize("translate", info.language)[0] if data.get("translate") and original else original
    return {"text": text, "originalText": original, "language": info.language,
            "durationSeconds": info.duration, "model": "faster-whisper-base-int8-cpu",
            "translatedInto": "en" if data.get("translate") else None}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass  # Never log story text, recordings, or tokens.

    def send_json(self, value, status=200):
        raw = json.dumps(value).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        try:
            self.wfile.write(raw)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def do_GET(self):
        if self.path != "/health":
            return self.send_json({"ok": False}, 404)
        self.send_json({"ok": True, "device": "cpu", "gpuAvailable": False,
                        "busy": BUSY.locked(), "loaded": sorted(MODELS), "pid": os.getpid()})

    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            if length < 1 or length > 24 * 1024 * 1024:
                return self.send_json({"ok": False, "error": "Request is too large or empty."}, 413)
            data = json.loads(self.rfile.read(length))
            job = str(data.get("jobId", ""))
            if not re.fullmatch(r"[a-zA-Z0-9_-]{8,100}", job):
                raise ValueError("A valid operation identifier is required.")
            if self.path == "/cancel":
                CANCELLED.add(job)
                return self.send_json({"ok": True, "cancelRequested": True})
            if self.path not in ("/embed", "/tts", "/transcribe"):
                return self.send_json({"ok": False}, 404)
            if not BUSY.acquire(blocking=False):
                return self.send_json({"ok": False, "error": "Local speech/memory worker is busy. Try again shortly."}, 503)
            started = time.monotonic()
            try:
                cancelled(job)
                if self.path == "/embed":
                    result = embed(data)
                elif self.path == "/tts":
                    result = tts(data, job)
                else:
                    result = transcribe(data, job)
                result.update(ok=True, device="cpu", elapsedSeconds=time.monotonic() - started)
                self.send_json(result)
            finally:
                BUSY.release()
                CANCELLED.discard(job)
        except InterruptedError:
            self.send_json({"ok": False, "error": "Operation cancelled."}, 409)
        except Exception as error:
            print(json.dumps({"event": "model_error", "type": type(error).__name__, "error": str(error)[:300]}), flush=True)
            self.send_json({"ok": False, "error": "Local model operation failed. No cloud fallback was used."}, 500)


class UnixServer(socketserver.ThreadingMixIn, HTTPServer):
    address_family = socket.AF_UNIX
    daemon_threads = True


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", required=True)
    args = parser.parse_args()
    ROOT = Path(args.root).resolve()
    ROOT.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(ROOT, 0o700)
    address = ROOT / "worker.sock"
    if address.exists():
        probe = socket.socket(socket.AF_UNIX)
        try:
            probe.connect(str(address))
        except ConnectionRefusedError:
            address.unlink()  # Only our explicitly named stale Unix socket.
        else:
            raise RuntimeError("A Story Creator CPU worker is already running.")
        finally:
            probe.close()
    server = UnixServer(str(address), Handler)
    os.chmod(address, 0o600)
    print(json.dumps({"event": "ready", "device": "cpu", "pid": os.getpid(), "socket": str(address)}), flush=True)
    server.serve_forever()
