#!/usr/bin/env python3
"""OTG TEST Voice Characters ECAPA speaker-similarity QC.

This helper intentionally runs outside the IndexTTS2 and Applio Python
environments. It loads the validated SpeechBrain ECAPA runtime, converts both
the original saved Character Voice Sample and the generated candidate to
16 kHz mono, extracts embeddings, and returns cosine speaker similarity.

The calling dataset worker remains responsible for transcript verification,
waveform/audio-quality QC, rejection, and regeneration.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path


EXPECTED_SAMPLE_RATE = 16000


def emit(payload: dict, code: int = 0) -> None:
    sys.stdout.write(
        json.dumps(
            payload,
            ensure_ascii=False,
        )
    )
    sys.stdout.flush()
    raise SystemExit(code)


def require_file(value: str, label: str) -> Path:
    path = Path(value).expanduser().resolve()

    if (
        not path.is_file()
        or path.stat().st_size <= 0
    ):
        emit(
            {
                "ok": False,
                "error": f"{label} is missing or empty: {path}",
            },
            2,
        )

    return path


def load_waveform(path: Path):
    import numpy as np
    import soundfile as sf
    import torch
    import torchaudio

    audio, sample_rate = sf.read(
        str(path),
        dtype="float32",
        always_2d=False,
    )

    if audio.ndim > 1:
        audio = audio.mean(
            axis=1,
        )

    audio = np.asarray(
        audio,
        dtype=np.float32,
    )

    if audio.size < 1:
        raise RuntimeError(
            f"Audio contains no samples: {path}"
        )

    waveform = torch.from_numpy(
        audio,
    ).unsqueeze(0)

    if int(sample_rate) != EXPECTED_SAMPLE_RATE:
        waveform = torchaudio.functional.resample(
            waveform,
            int(sample_rate),
            EXPECTED_SAMPLE_RATE,
        )

    waveform = waveform - waveform.mean(
        dim=-1,
        keepdim=True,
    )

    peak = waveform.abs().amax()

    if float(peak.item()) > 0.0:
        waveform = waveform / peak * 0.95

    return waveform


def main() -> None:
    parser = argparse.ArgumentParser(
        description=(
            "Compare original Character Voice Sample "
            "and generated candidate with ECAPA cosine similarity."
        )
    )

    parser.add_argument(
        "--source",
        required=True,
    )

    parser.add_argument(
        "--candidate",
        required=True,
    )

    parser.add_argument(
        "--model-dir",
        required=True,
    )

    parser.add_argument(
        "--hf-home",
        required=True,
    )

    args = parser.parse_args()

    source = require_file(
        args.source,
        "Source voice sample",
    )

    candidate = require_file(
        args.candidate,
        "Candidate voice clip",
    )

    model_dir = Path(
        args.model_dir,
    ).expanduser().resolve()

    if not model_dir.is_dir():
        emit(
            {
                "ok": False,
                "error": (
                    "ECAPA model directory is missing: "
                    f"{model_dir}"
                ),
            },
            2,
        )

    os.environ["HF_HOME"] = str(
        Path(
            args.hf_home,
        ).expanduser().resolve()
    )

    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"

    try:
        import torch
        import torch.nn.functional as F

        from speechbrain.inference.speaker import (
            EncoderClassifier,
        )

        classifier = (
            EncoderClassifier.from_hparams(
                source=(
                    "speechbrain/"
                    "spkrec-ecapa-voxceleb"
                ),
                savedir=str(
                    model_dir,
                ),
                run_opts={
                    "device": "cpu",
                },
            )
        )

        source_waveform = load_waveform(
            source,
        )

        candidate_waveform = load_waveform(
            candidate,
        )

        with torch.inference_mode():
            source_embedding = (
                classifier.encode_batch(
                    source_waveform,
                )
            )

            candidate_embedding = (
                classifier.encode_batch(
                    candidate_waveform,
                )
            )

        source_embedding = (
            source_embedding.reshape(
                source_embedding.shape[0],
                -1,
            )
        )

        candidate_embedding = (
            candidate_embedding.reshape(
                candidate_embedding.shape[0],
                -1,
            )
        )

        similarity = F.cosine_similarity(
            source_embedding,
            candidate_embedding,
            dim=-1,
        )

        value = float(
            similarity[0].item()
        )

        emit(
            {
                "ok": True,
                "engine": "speechbrain-ecapa",
                "metric": "cosine-similarity",
                "speakerSimilarity": value,
                "sampleRate": EXPECTED_SAMPLE_RATE,
                "embeddingDimensions": int(
                    source_embedding.shape[-1]
                ),
            }
        )

    except SystemExit:
        raise
    except Exception as error:
        emit(
            {
                "ok": False,
                "error": str(
                    error
                ),
            },
            1,
        )


if __name__ == "__main__":
    main()
