"""Return local, word-aligned transcript evidence for Fix Voices."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import subprocess

from faster_whisper import WhisperModel
import numpy as np

SAMPLE_RATE = 16_000


def decode(line: str) -> np.ndarray:
    # In-memory PCM avoids version differences in faster-whisper's PyAV reader.
    ffmpeg = os.environ.get("OTG_FFMPEG_BIN") or "ffmpeg"
    args = [
        ffmpeg, "-v", "error", "-nostdin", "-xerror",
        "-protocol_whitelist", "file,pipe",
        "-format_whitelist", "wav,mp3,flac,ogg,mov,matroska,webm,aac",
        "-i", str(Path(line).resolve(strict=True)), "-map", "0:a:0", "-ac", "1",
        "-ar", str(SAMPLE_RATE), "-f", "f32le", "pipe:1",
    ]
    result = subprocess.run(args, capture_output=True, check=True, timeout=30)
    pcm = np.frombuffer(result.stdout, dtype="<f4")
    if pcm.size == 0 or not np.isfinite(pcm).all():
        raise ValueError("The speech line did not decode to usable samples.")
    return pcm.astype(np.float32, copy=False)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("model", type=Path)
    parser.add_argument("lines", nargs="+")
    args = parser.parse_args()
    cache = args.model.resolve(strict=True)
    if not (cache / "model.bin").is_file():
        raise ValueError("The installed transcript model is unavailable.")
    lines = [decode(line) for line in args.lines]
    model = WhisperModel(str(cache), device="cpu", compute_type="int8", cpu_threads=2, local_files_only=True)
    results = []
    for pcm in lines:
        segments, _ = model.transcribe(pcm, word_timestamps=True, vad_filter=False, beam_size=5, condition_on_previous_text=False)
        words = [word for segment in segments for word in (segment.words or [])]
        results.append([
            {"text": word.word, "start": word.start, "end": word.end, "probability": word.probability}
            for word in words
        ])
    print(json.dumps(results, allow_nan=False))


if __name__ == "__main__":
    main()
