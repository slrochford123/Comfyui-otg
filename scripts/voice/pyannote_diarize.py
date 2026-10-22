#!/usr/bin/env python3
"""Local pyannote Community-1 bridge for the voice-dubbing analyzer.

The bridge receives an in-memory waveform so pyannote does not need TorchCodec
to open the source file. Diagnostics go to stderr; stdout remains one JSON
object for the Next.js route to parse.
"""

from __future__ import annotations

import argparse
import json
import sys

import soundfile as sf
import torch
from pyannote.audio import Pipeline


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--audio", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--device", default="cuda")
    parser.add_argument("--min-speakers", type=int, default=None)
    parser.add_argument("--max-speakers", type=int, default=5)
    args = parser.parse_args()

    waveform, sample_rate = sf.read(args.audio, dtype="float32", always_2d=False)
    if waveform.ndim == 1:
        mono = waveform
    else:
        mono = waveform.mean(axis=1)

    pipeline = Pipeline.from_pretrained(args.model)
    device_name = args.device if args.device == "cpu" or torch.cuda.is_available() else "cpu"
    pipeline.to(torch.device(device_name))

    kwargs = {"max_speakers": max(1, min(5, args.max_speakers))}
    if args.min_speakers is not None and args.min_speakers > 0:
        kwargs["min_speakers"] = max(1, min(5, args.min_speakers))

    annotation = pipeline(
        {"waveform": torch.from_numpy(mono).unsqueeze(0), "sample_rate": int(sample_rate)},
        **kwargs,
    )

    segments = []
    for turn, _track, speaker in annotation.itertracks(yield_label=True):
        start = max(0.0, float(turn.start))
        end = max(start, float(turn.end))
        if end <= start:
            continue
        segments.append(
            {
                "start": round(start, 3),
                "end": round(end, 3),
                "speakerId": str(speaker),
            }
        )

    print(json.dumps({"ok": True, "tool": "pyannote-community-1", "segments": segments}))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # Keep the route error readable without corrupting JSON stdout.
        print(f"pyannote diarization failed: {exc}", file=sys.stderr)
        raise
