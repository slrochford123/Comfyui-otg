"""Private CPU dictation worker for Story Creator."""
import argparse
import base64
from http.server import BaseHTTPRequestHandler, HTTPServer
import io
import json
from pathlib import Path
import re
import socket
from socketserver import ThreadingMixIn
import subprocess
from threading import Event, Lock
import wave

import numpy as np
import sherpa_onnx

RATE = 16_000
MAX_SECONDS = 600
MAX_UPLOAD = 16 * 1024 * 1024
BUSY = Lock()
ACTIVE = {}
ACTIVE_LOCK = Lock()


def normalize(encoded):
    audio = base64.b64decode(encoded, validate=True)
    if not audio or len(audio) > MAX_UPLOAD:
        raise ValueError("Choose a recording up to 16 MiB.")
    result = subprocess.run(
        ["/usr/bin/ffmpeg", "-v", "error", "-nostdin", "-protocol_whitelist", "pipe",
         "-threads", "1", "-i", "pipe:0", "-map", "0:a:0", "-t", str(MAX_SECONDS),
         "-ac", "1", "-ar", str(RATE), "-f", "s16le", "pipe:1"],
        input=audio, capture_output=True, timeout=30,
    )
    pcm = result.stdout[:MAX_SECONDS * RATE * 2]
    if result.returncode or len(pcm) < RATE // 2:
        raise ValueError("The recording could not be decoded or was too short.")
    return pcm


def check_cancel(cancel):
    if cancel.is_set():
        raise ValueError("Transcription cancelled.")


def recognize(pcm, cancel, normalize_only):
    samples = np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768
    vad.reset()
    parts = []
    speech = False
    for start in range(0, len(samples) + 4096, 4096):
        check_cancel(cancel)
        if start < len(samples):
            frame = samples[start:start + 4096]
            # The VAD needs complete analysis windows, including the recording tail.
            if len(frame) % 512:
                frame = np.pad(frame, (0, 512 - len(frame) % 512))
            vad.accept_waveform(frame)
        else:
            vad.flush()
        while not vad.empty():
            speech = True
            if not normalize_only:
                segment = vad.front.samples
                for offset in range(0, len(segment), 24 * RATE):
                    check_cancel(cancel)
                    stream = model.create_stream()
                    stream.accept_waveform(RATE, segment[offset:offset + 24 * RATE])
                    model.decode_stream(stream)
                    if stream.result.text.strip():
                        parts.append(stream.result.text.strip())
            vad.pop()
    check_cancel(cancel)
    if not speech or (not normalize_only and not parts):
        raise ValueError("No clear speech was detected. Nothing was sent.")
    result = {"durationSeconds": len(pcm) / (2 * RATE)}
    if normalize_only:
        buffer = io.BytesIO()
        with wave.open(buffer, "wb") as output:
            output.setparams((1, 2, RATE, 0, "NONE", "not compressed"))
            output.writeframes(pcm)
        result["wav"] = base64.b64encode(buffer.getvalue()).decode()
    else:
        result.update(text=" ".join(parts), model="parakeet-tdt-0.6b-v3-int8")
    return result


class Handler(BaseHTTPRequestHandler):
    def setup(self):
        self.request.settimeout(30)
        super().setup()

    def log_message(self, *_):
        pass

    def reply(self, status, value):
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
        if self.path == "/health":
            self.reply(200, {"ok": True, "model": "parakeet-tdt-0.6b-v3-int8", "device": "cpu"})
        else:
            self.reply(404, {"ok": False})

    def do_POST(self):
        is_job = self.path == "/transcribe"
        if not is_job and self.path != "/cancel":
            return self.reply(404, {"ok": False})
        if is_job and not BUSY.acquire(blocking=False):
            return self.reply(503, {"ok": False, "error": "Dictation is busy. Retry this recording shortly."})
        job = None
        try:
            length = int(self.headers.get("Content-Length", 0))
            if not 0 < length <= (24 * 1024 * 1024 if is_job else 512):
                return self.reply(413, {"ok": False, "error": "Invalid recording size."})
            data = json.loads(self.rfile.read(length))
            job = data.get("jobId")
            if not isinstance(job, str) or not re.fullmatch(r"[a-f0-9-]{36}", job):
                raise ValueError("Invalid dictation identifier.")
            if not is_job:
                with ACTIVE_LOCK:
                    event = ACTIVE.get(job)
                    if event:
                        event.set()
                return self.reply(200, {"ok": True})
            event = Event()
            with ACTIVE_LOCK:
                ACTIVE[job] = event
            result = recognize(normalize(data.get("audio", "")), event, data.get("normalizeOnly") is True)
            self.reply(200, {"ok": True, **result})
        except (ValueError, TypeError, subprocess.TimeoutExpired) as error:
            self.reply(422, {"ok": False, "error": str(error)[:180]})
        finally:
            if is_job:
                if isinstance(job, str):
                    with ACTIVE_LOCK:
                        ACTIVE.pop(job, None)
                BUSY.release()


class UnixServer(ThreadingMixIn, HTTPServer):
    address_family = socket.AF_UNIX
    daemon_threads = True

    def server_bind(self):
        socket.socket.bind(self.socket, self.server_address)
        self.server_name = "story-dictation"
        self.server_port = 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, required=True)
    root = parser.parse_args().root
    weights = root / "models"
    model = sherpa_onnx.OfflineRecognizer.from_transducer(
        encoder=str(weights / "encoder.int8.onnx"), decoder=str(weights / "decoder.int8.onnx"),
        joiner=str(weights / "joiner.int8.onnx"), tokens=str(weights / "tokens.txt"),
        num_threads=2, provider="cpu", model_type="nemo_transducer", decoding_method="greedy_search",
    )
    config = sherpa_onnx.VadModelConfig()
    config.silero_vad.model = str(weights / "silero_vad.onnx")
    config.silero_vad.min_silence_duration = 0.45
    config.silero_vad.min_speech_duration = 0.18
    config.silero_vad.max_speech_duration = 20
    vad = sherpa_onnx.VoiceActivityDetector(config, buffer_size_in_seconds=32)
    address = root / "worker.sock"
    if address.exists():
        with socket.socket(socket.AF_UNIX) as probe:
            try:
                probe.connect(str(address))
            except ConnectionRefusedError:
                if not address.is_socket():
                    raise
                address.unlink()
            else:
                raise RuntimeError("A dictation worker already owns the socket.")
    with UnixServer(str(address), Handler) as server:
        address.chmod(0o600)
        print("Story dictation ready: Parakeet INT8 on CPU", flush=True)
        server.serve_forever()
