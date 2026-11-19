#!/usr/bin/env python3
"""Local pyannote Community-1 bridge for the voice-dubbing analyzer.

The bridge receives an in-memory waveform so pyannote does not need TorchCodec
to open the source file. Diagnostics go to stderr; stdout remains one JSON
object for the Next.js route to parse.
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sys

import numpy as np
import soundfile as sf
import torch
import yaml
from pyannote.audio import Pipeline
from pyannote.audio.core.task import Problem, Resolution, Specifications


COMMUNITY_MODELS = {"segmentation": "$model/segmentation", "embedding": "$model/embedding", "plda": "$model/plda"}
ALLOWED_CHECKPOINT_CLASSES = (Problem, Resolution, Specifications)


def cached_file(root: Path, name: str) -> Path:
    file = (root / name).resolve(strict=True)
    if not file.is_relative_to(root) or not file.is_file():
        raise ValueError(f"Community-1 cache member is unavailable: {name}")
    return file


def load_pipeline(location: str) -> Pipeline:
    # Path comes from deployment configuration. Limit this bridge to the
    # expected local Community-1 layout before opening any checkpoints.
    root = Path(location).resolve(strict=True)
    config = yaml.safe_load(cached_file(root, "config.yaml").read_text(encoding="utf-8"))
    pipeline = config.get("pipeline", {}) if isinstance(config, dict) else {}
    params = pipeline.get("params", {})
    if pipeline.get("name") != "pyannote.audio.pipelines.SpeakerDiarization" or any(params.get(key) != value for key, value in COMMUNITY_MODELS.items()):
        raise ValueError("The local Community-1 configuration is invalid.")

    allowed = {f"{cls.__module__}.{cls.__qualname__}" for cls in ALLOWED_CHECKPOINT_CLASSES}
    for component in ("segmentation", "embedding"):
        checkpoint = cached_file(root, f"{component}/pytorch_model.bin")
        if set(torch.serialization.get_unsafe_globals_in_checkpoint(checkpoint)) - allowed:
            raise ValueError(f"Unexpected serialized class in the Community-1 {component} checkpoint.")
    cached_file(root, "plda/plda.npz")
    cached_file(root, "plda/xvec_transform.npz")

    # Force the restricted loader in this subprocess even if an upstream
    # caller passes weights_only=False. These are the only added classes.
    os.environ["TORCH_FORCE_WEIGHTS_ONLY_LOAD"] = "1"
    with torch.serialization.safe_globals(list(ALLOWED_CHECKPOINT_CLASSES)):
        return Pipeline.from_pretrained(str(root))


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

    if not mono.size or sample_rate <= 0 or not np.isfinite(mono).all():
        raise ValueError("The dialogue track did not decode to usable samples.")
    duration = len(mono) / sample_rate
    pipeline = load_pipeline(args.model)
    device_name = args.device if args.device == "cpu" or torch.cuda.is_available() else "cpu"
    pipeline.to(torch.device(device_name))

    kwargs = {"max_speakers": max(1, min(5, args.max_speakers))}
    if args.min_speakers is not None and args.min_speakers > 0:
        kwargs["min_speakers"] = max(1, min(5, args.min_speakers))

    diarization = pipeline(
        {"waveform": torch.from_numpy(mono).unsqueeze(0), "sample_rate": int(sample_rate)},
        **kwargs,
    )

    annotation = getattr(diarization, "speaker_diarization", diarization)
    segments = []
    for turn, _track, speaker in annotation.itertracks(yield_label=True):
        start = max(0.0, float(turn.start))
        end = min(duration, float(turn.end))
        if end <= start:
            continue
        segments.append(
            {
                "start": round(start, 3),
                "end": round(end, 3),
                "speakerId": str(speaker),
            }
        )

    print(json.dumps({"ok": True, "tool": "pyannote-community-1", "segments": segments}, allow_nan=False))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # Keep the route error readable without corrupting JSON stdout.
        print(f"pyannote diarization failed: {exc}", file=sys.stderr)
        raise
