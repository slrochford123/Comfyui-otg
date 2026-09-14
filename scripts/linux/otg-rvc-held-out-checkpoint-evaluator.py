#!/usr/bin/env python3
"""Held-out RVC checkpoint evaluator for ComfyUI-OTG TEST.

This evaluator intentionally does not use target-conditioned training clips as
conversion inputs. It synthesizes independent held-out source utterances with
espeak-ng, converts the same utterances through every inference-ready RVC
checkpoint, scores the converted outputs against the original saved Character
Voice Sample, and selects the best technically passing checkpoint.

Speaker similarity is advisory until live calibration. Hard technical gates are
ASR intelligibility, waveform/audio quality, successful conversion, and duration
performance preservation.
"""

from __future__ import annotations

import argparse
import difflib
import hashlib
import json
import math
import os
import re
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path
from typing import Any, Dict, List, Tuple

import numpy as np
import soundfile as sf
import torch
import torchaudio
from speechbrain.inference.classifiers import EncoderClassifier


def clean(value: Any) -> str:
    return str(value or "").strip()


def has_bytes(path: Path) -> bool:
    try:
        return path.is_file() and path.stat().st_size > 0
    except Exception:
        return False


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def clamp01(value: float) -> float:
    return max(0.0, min(1.0, float(value)))


def normalized_text(value: str) -> str:
    return " ".join(re.findall(r"[a-z0-9']+", clean(value).lower()))


def transcript_similarity(expected: str, actual: str) -> float:
    left = normalized_text(expected)
    right = normalized_text(actual)
    if not left or not right:
        return 0.0
    return float(difflib.SequenceMatcher(None, left, right).ratio())


def load_policy(path: Path) -> Dict[str, Any]:
    data = json.loads(path.read_text(encoding="utf-8"))
    rvc = data.get("rvc") if isinstance(data.get("rvc"), dict) else {}
    if clean(rvc.get("version")).lower() != "v2":
        raise RuntimeError("Voice training policy must require RVC v2.")
    if int(rvc.get("sampleRate") or 0) != 48000:
        raise RuntimeError("Voice training policy must require RVC 48 kHz.")
    if clean(rvc.get("pitchExtractor")).lower() != "rmvpe":
        raise RuntimeError("Voice training policy must require RMVPE.")
    if rvc.get("pitchGuidance") is not True:
        raise RuntimeError("Voice training policy must require pitch guidance.")
    if clean(data.get("checkpointSelection")).lower() != "held-out-best":
        raise RuntimeError("Voice training policy must require held-out-best checkpoint selection.")
    return data


def run_checked(command: List[str], cwd: Path | None = None, timeout: int = 1200) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(
        command,
        cwd=str(cwd) if cwd else None,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=timeout,
    )
    if result.returncode != 0:
        raise RuntimeError(
            "Command failed with code "
            f"{result.returncode}: {' '.join(command)}\n"
            f"stdout:\n{result.stdout[-4000:]}\n"
            f"stderr:\n{result.stderr[-4000:]}"
        )
    return result


def normalize_wav(source: Path, target: Path, sample_rate: int) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    temp = target.with_suffix(".tmp.wav")
    run_checked(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-i",
            str(source),
            "-vn",
            "-ac",
            "1",
            "-ar",
            str(sample_rate),
            "-c:a",
            "pcm_s16le",
            str(temp),
        ],
        timeout=300,
    )
    if not has_bytes(temp):
        raise RuntimeError(f"Normalized WAV missing: {temp}")
    os.replace(temp, target)


def synthesize_held_out(text: str, raw_path: Path, final_path: Path, sample_rate: int) -> None:
    raw_path.parent.mkdir(parents=True, exist_ok=True)
    raw_path.unlink(missing_ok=True)
    final_path.unlink(missing_ok=True)
    run_checked(
        ["espeak-ng", "-v", "en-us", "-s", "165", "-w", str(raw_path), text],
        timeout=120,
    )
    normalize_wav(raw_path, final_path, sample_rate)


def multipart_transcribe(base_url: str, endpoint: str, audio_path: Path, timeout: int) -> str:
    boundary = "----otg-heldout-asr-" + uuid.uuid4().hex
    file_bytes = audio_path.read_bytes()
    chunks = [
        f"--{boundary}\r\n".encode(),
        f'Content-Disposition: form-data; name="audio"; filename="{audio_path.name}"\r\n'.encode(),
        b"Content-Type: audio/wav\r\n\r\n",
        file_bytes,
        b"\r\n",
        f"--{boundary}--\r\n".encode(),
    ]
    body = b"".join(chunks)
    headers = {
        "content-type": f"multipart/form-data; boundary={boundary}",
        "content-length": str(len(body)),
    }
    token = clean(os.environ.get("OTG_WORKER_TOKEN"))
    owner_key = clean(os.environ.get("OTG_OWNER_KEY"))
    if token:
        headers["authorization"] = f"Bearer {token}"
    if owner_key:
        headers["x-otg-owner-key"] = owner_key
    url = urllib.parse.urljoin(base_url.rstrip("/") + "/", endpoint.lstrip("/"))
    request = urllib.request.Request(url, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        raw = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"ASR HTTP {error.code}: {raw}") from error
    text = clean(payload.get("text") or payload.get("transcript") or payload.get("output"))
    if not text:
        raise RuntimeError(f"ASR returned no transcript: {payload}")
    return text


def waveform_metrics(path: Path) -> Dict[str, float]:
    audio, sr = sf.read(str(path), always_2d=False, dtype="float32")
    array = np.asarray(audio, dtype=np.float32)
    if array.ndim > 1:
        array = array.mean(axis=1)
    if array.size == 0 or int(sr) <= 0:
        raise RuntimeError(f"Empty waveform: {path}")
    absolute = np.abs(array)
    duration = float(array.size / float(sr))
    peak = float(np.max(absolute))
    rms = float(np.sqrt(np.mean(np.square(array)) + 1e-12))
    clipping = float(np.mean(absolute >= 0.995))
    silence = float(np.mean(absolute <= 0.004))

    score = 1.0
    if peak < 0.01:
        score -= 0.60
    if rms < 0.008:
        score -= 0.40
    if rms > 0.35:
        score -= 0.20
    score -= min(0.70, clipping * 20.0)
    score -= min(0.30, max(0.0, silence - 0.65))

    return {
        "sampleRate": float(sr),
        "durationSeconds": duration,
        "peak": peak,
        "rms": rms,
        "clippingRatio": clipping,
        "silenceRatio": silence,
        "audioQualityScore": clamp01(score),
    }


def load_audio_16k(path: Path) -> torch.Tensor:
    waveform, sample_rate = torchaudio.load(str(path))
    if waveform.ndim == 1:
        waveform = waveform.unsqueeze(0)
    waveform = waveform.mean(dim=0, keepdim=True)
    if sample_rate != 16000:
        waveform = torchaudio.functional.resample(waveform, sample_rate, 16000)
    return waveform


def speaker_embedding(classifier: EncoderClassifier, path: Path) -> torch.Tensor:
    waveform = load_audio_16k(path)
    with torch.inference_mode():
        embedding = classifier.encode_batch(waveform)
    return embedding.squeeze().detach().cpu().float()


def cosine_similarity(left: torch.Tensor, right: torch.Tensor) -> float:
    denom = torch.linalg.vector_norm(left) * torch.linalg.vector_norm(right)
    if float(denom) <= 0:
        return 0.0
    return float(torch.dot(left, right) / denom)


def inspect_checkpoint(path: Path) -> Dict[str, Any]:
    metadata: Dict[str, Any] = {
        "path": str(path),
        "bytes": path.stat().st_size,
        "sha256": sha256_file(path),
    }
    try:
        payload = torch.load(str(path), map_location="cpu", weights_only=False)
        if isinstance(payload, dict):
            version = clean(payload.get("version"))
            sample_rate = clean(payload.get("sr") or payload.get("sample_rate") or payload.get("sampleRate"))
            if version:
                metadata["version"] = version
            if sample_rate:
                metadata["sampleRateMetadata"] = sample_rate
            metadata["metadataVerified"] = bool(version or sample_rate)
            if version and version.lower() != "v2":
                metadata["metadataConflict"] = f"Expected RVC v2, checkpoint reports {version}."
            normalized_sr = sample_rate.lower().replace("hz", "").replace(" ", "")
            if sample_rate and normalized_sr not in {"48k", "48000", "48.0k"}:
                metadata["metadataConflict"] = f"Expected 48 kHz, checkpoint reports {sample_rate}."
    except Exception as error:
        metadata["metadataReadError"] = str(error)
        metadata["metadataVerified"] = False
    return metadata


def parse_epoch_step(path: Path, model_name: str) -> Tuple[int, int]:
    match = re.fullmatch(re.escape(model_name) + r"_(\d+)e_(\d+)s\.pth", path.name)
    if not match:
        raise RuntimeError(f"Not an inference-ready checkpoint candidate: {path.name}")
    return int(match.group(1)), int(match.group(2))


def run_applio_infer(
    applio_python: Path,
    core_script: Path,
    applio_root: Path,
    checkpoint_path: Path,
    index_path: Path,
    input_path: Path,
    output_path: Path,
    f0_method: str,
    timeout: int,
) -> Dict[str, Any]:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.unlink(missing_ok=True)
    command = [
        str(applio_python),
        str(core_script),
        "infer",
        "--pitch", "0",
        "--index_rate", clean(os.environ.get("APPLIO_INFERENCE_INDEX_RATE")) or "0.75",
        "--volume_envelope", "1",
        "--protect", clean(os.environ.get("APPLIO_INFERENCE_PROTECT")) or "0.33",
        "--f0_method", f0_method,
        "--input_path", str(input_path),
        "--output_path", str(output_path),
        "--pth_path", str(checkpoint_path),
        "--index_path", str(index_path),
        "--split_audio", "False",
        "--f0_autotune", "False",
        "--clean_audio", "False",
        "--export_format", "WAV",
        "--embedder_model", clean(os.environ.get("APPLIO_INFERENCE_EMBEDDER")) or "contentvec",
    ]
    started = time.time()
    infer_env = os.environ.copy()
    infer_env["APPLIO_SAMPLE_RATE"] = "48000"
    infer_env["APPLIO_F0_METHOD"] = "rmvpe"
    result = subprocess.run(
        command,
        cwd=str(applio_root),
        env=infer_env,
        capture_output=True,
        text=True,
        timeout=timeout,
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"Held-out Applio infer failed rc={result.returncode}: "
            f"stdout={result.stdout[-4000:]}; stderr={result.stderr[-4000:]}"
        )
    if not has_bytes(output_path):
        raise RuntimeError(f"Applio infer did not create output: {output_path}")
    if sha256_file(input_path) == sha256_file(output_path):
        raise RuntimeError("Applio held-out inference output is byte-identical to the input.")
    return {
        "command": command,
        "elapsedMs": int((time.time() - started) * 1000),
        "stdoutTail": result.stdout[-2000:],
        "stderrTail": result.stderr[-2000:],
    }


def performance_duration_score(input_duration: float, output_duration: float) -> Tuple[float, float]:
    if input_duration <= 0 or output_duration <= 0:
        return 0.0, 0.0
    ratio = output_duration / input_duration
    score = 1.0 - min(1.0, abs(math.log(max(1e-6, ratio), 2.0)))
    return ratio, clamp01(score)


def main() -> int:
    parser = argparse.ArgumentParser(description="OTG held-out RVC checkpoint evaluator")
    parser.add_argument("--policy-path", required=True)
    parser.add_argument("--applio-root", required=True)
    parser.add_argument("--applio-python", required=True)
    parser.add_argument("--core-script", required=True)
    parser.add_argument("--model-name", required=True)
    parser.add_argument("--index-path", required=True)
    parser.add_argument("--reference-audio", required=True)
    parser.add_argument("--speaker-model-dir", required=True)
    parser.add_argument("--hf-home", required=True)
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--work-dir", required=True)
    parser.add_argument("--output-json", required=True)
    parser.add_argument("--candidate", action="append", required=True)
    args = parser.parse_args()

    policy_path = Path(args.policy_path).resolve()
    policy = load_policy(policy_path)
    rvc = policy["rvc"]
    evaluation = policy.get("checkpointEvaluation") if isinstance(policy.get("checkpointEvaluation"), dict) else {}
    prompts = evaluation.get("heldOutPrompts") if isinstance(evaluation.get("heldOutPrompts"), list) else []
    prompts = [clean(item) for item in prompts if clean(item)]
    if len(prompts) < 2:
        raise RuntimeError("Policy must define at least two held-out prompts.")

    scoring = evaluation.get("scoring") if isinstance(evaluation.get("scoring"), dict) else {}
    weights = {
        "speakerSimilarity": float(scoring.get("speakerSimilarity", 0.45)),
        "intelligibility": float(scoring.get("intelligibility", 0.30)),
        "audioQuality": float(scoring.get("audioQuality", 0.15)),
        "performance": float(scoring.get("performance", 0.10)),
    }
    total_weight = sum(weights.values())
    if abs(total_weight - 1.0) > 1e-6:
        raise RuntimeError(f"Checkpoint scoring weights must sum to 1.0; got {total_weight}.")

    gate = evaluation.get("technicalGate") if isinstance(evaluation.get("technicalGate"), dict) else {}
    min_transcript = float(gate.get("minTranscriptSimilarity", 0.55))
    min_audio_quality = float(gate.get("minAudioQualityScore", 0.55))
    min_duration_ratio = float(gate.get("minDurationRatio", 0.55))
    max_duration_ratio = float(gate.get("maxDurationRatio", 1.80))
    max_clipping = float(gate.get("maxClippingRatio", 0.02))

    asr_endpoint = clean((policy.get("qc") or {}).get("transcript", {}).get("endpoint")) if isinstance(policy.get("qc"), dict) else ""
    if not asr_endpoint:
        asr_endpoint = "/api/ollama-ai/transcribe"

    applio_root = Path(args.applio_root).resolve()
    # Preserve the venv launcher path; resolving follows the symlink to system Python.
    applio_python = Path(args.applio_python).expanduser()
    core_script = Path(args.core_script).resolve()
    index_path = Path(args.index_path).resolve()
    reference_audio = Path(args.reference_audio).resolve()
    work_dir = Path(args.work_dir).resolve()
    output_json = Path(args.output_json).resolve()
    candidates = [Path(item).resolve() for item in args.candidate]

    for required in [applio_root, applio_python, core_script, index_path, reference_audio, Path(args.speaker_model_dir)]:
        if not required.exists():
            raise RuntimeError(f"Required evaluator path missing: {required}")
    for candidate in candidates:
        if not has_bytes(candidate):
            raise RuntimeError(f"Checkpoint candidate missing: {candidate}")

    os.environ["HF_HOME"] = str(Path(args.hf_home).resolve())
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"

    classifier = EncoderClassifier.from_hparams(
        source="speechbrain/spkrec-ecapa-voxceleb",
        savedir=str(Path(args.speaker_model_dir).resolve()),
        run_opts={"device": "cpu"},
    )
    normalized_reference = work_dir / "original-reference-normalized.wav"
    normalize_wav(reference_audio, normalized_reference, 48000)
    reference_embedding = speaker_embedding(classifier, normalized_reference)

    source_dir = work_dir / "held-out-source"
    output_dir = work_dir / "held-out-converted"
    source_rows: List[Dict[str, Any]] = []
    for index, text in enumerate(prompts, start=1):
        raw = source_dir / f"heldout_{index:02d}.raw.wav"
        wav = source_dir / f"heldout_{index:02d}.wav"
        synthesize_held_out(text, raw, wav, 48000)
        metrics = waveform_metrics(wav)
        source_rows.append({
            "id": f"heldout_{index:02d}",
            "text": text,
            "path": str(wav),
            "sha256": sha256_file(wav),
            "durationSeconds": metrics["durationSeconds"],
        })

    checkpoint_evaluations: List[Dict[str, Any]] = []
    for candidate in candidates:
        epoch, step = parse_epoch_step(candidate, args.model_name)
        checkpoint_metadata = inspect_checkpoint(candidate)
        sample_results: List[Dict[str, Any]] = []
        failure_reasons: List[str] = []

        metadata_conflict = clean(checkpoint_metadata.get("metadataConflict"))
        if metadata_conflict:
            failure_reasons.append(metadata_conflict)

        for source in source_rows:
            output = output_dir / candidate.stem / f"{source['id']}.wav"
            row: Dict[str, Any] = {
                "heldOutId": source["id"],
                "expectedTranscript": source["text"],
                "inputPath": source["path"],
                "outputPath": str(output),
            }
            try:
                infer = run_applio_infer(
                    applio_python,
                    core_script,
                    applio_root,
                    candidate,
                    index_path,
                    Path(source["path"]),
                    output,
                    "rmvpe",
                    int(os.environ.get("OTG_APPLIO_HELDOUT_INFER_TIMEOUT_SECONDS", "1200")),
                )
                output_metrics = waveform_metrics(output)
                converted_embedding = speaker_embedding(classifier, output)
                similarity = cosine_similarity(reference_embedding, converted_embedding)
                transcript = multipart_transcribe(
                    args.base_url,
                    asr_endpoint,
                    output,
                    int(os.environ.get("OTG_APPLIO_HELDOUT_ASR_TIMEOUT_SECONDS", "300")),
                )
                intelligibility = transcript_similarity(source["text"], transcript)
                duration_ratio, duration_score = performance_duration_score(
                    float(source["durationSeconds"]),
                    float(output_metrics["durationSeconds"]),
                )
                sample_pass = (
                    intelligibility >= min_transcript
                    and output_metrics["audioQualityScore"] >= min_audio_quality
                    and output_metrics["clippingRatio"] <= max_clipping
                    and min_duration_ratio <= duration_ratio <= max_duration_ratio
                )
                row.update({
                    "infer": infer,
                    "speakerSimilarity": similarity,
                    "transcript": transcript,
                    "transcriptIntelligibility": intelligibility,
                    "audioQualityArtifact": output_metrics,
                    "performanceDuration": {
                        "inputDurationSeconds": source["durationSeconds"],
                        "outputDurationSeconds": output_metrics["durationSeconds"],
                        "durationRatio": duration_ratio,
                        "score": duration_score,
                    },
                    "passedTechnicalGate": sample_pass,
                })
                if not sample_pass:
                    failure_reasons.append(f"{source['id']} failed technical gate")
            except Exception as error:
                row.update({
                    "passedTechnicalGate": False,
                    "error": str(error),
                })
                failure_reasons.append(f"{source['id']}: {error}")
            sample_results.append(row)

        successful = [row for row in sample_results if isinstance(row.get("speakerSimilarity"), (int, float))]
        if successful:
            speaker = float(np.mean([float(row["speakerSimilarity"]) for row in successful]))
            intelligibility = float(np.mean([float(row["transcriptIntelligibility"]) for row in successful]))
            audio_quality = float(np.mean([float(row["audioQualityArtifact"]["audioQualityScore"]) for row in successful]))
            performance = float(np.mean([float(row["performanceDuration"]["score"]) for row in successful]))
        else:
            speaker = intelligibility = audio_quality = performance = 0.0

        composite = (
            weights["speakerSimilarity"] * clamp01(speaker)
            + weights["intelligibility"] * clamp01(intelligibility)
            + weights["audioQuality"] * clamp01(audio_quality)
            + weights["performance"] * clamp01(performance)
        )
        candidate_pass = (
            not metadata_conflict
            and len(sample_results) == len(source_rows)
            and all(row.get("passedTechnicalGate") is True for row in sample_results)
        )
        checkpoint_evaluations.append({
            "checkpointCandidate": str(candidate),
            "epoch": epoch,
            "step": step,
            "checkpointMetadata": checkpoint_metadata,
            "speakerSimilarity": speaker,
            "transcriptIntelligibility": intelligibility,
            "audioQualityArtifact": audio_quality,
            "performanceDuration": performance,
            "compositeScore": composite,
            "passedTechnicalGate": candidate_pass,
            "failureReasons": failure_reasons,
            "heldOutResults": sample_results,
        })

    passing = [item for item in checkpoint_evaluations if item.get("passedTechnicalGate") is True]
    if not passing:
        raise RuntimeError(
            "No RVC checkpoint passed held-out technical evaluation. Refusing newest/final checkpoint fallback. "
            + json.dumps(checkpoint_evaluations, indent=2)[-12000:]
        )

    passing.sort(
        key=lambda item: (
            -float(item.get("compositeScore") or 0.0),
            -float(item.get("speakerSimilarity") or 0.0),
            int(item.get("epoch") or 0),
            int(item.get("step") or 0),
            clean(item.get("checkpointCandidate")),
        )
    )
    winner = passing[0]
    selected_checkpoint = {
        "sourcePath": winner["checkpointCandidate"],
        "epoch": winner["epoch"],
        "step": winner["step"],
        "compositeScore": winner["compositeScore"],
        "speakerSimilarity": winner["speakerSimilarity"],
        "transcriptIntelligibility": winner["transcriptIntelligibility"],
        "audioQualityArtifact": winner["audioQualityArtifact"],
        "performanceDuration": winner["performanceDuration"],
        "checkpointMetadata": winner["checkpointMetadata"],
        "selectionMethod": "held-out-best",
    }

    result = {
        "schemaVersion": 1,
        "status": "passed",
        "evaluatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "rvcVersion": "v2",
        "sampleRate": 48000,
        "pitchExtractor": "rmvpe",
        "pitchGuidance": True,
        "checkpointSelection": "held-out-best",
        "selectedCheckpoint": selected_checkpoint,
        "checkpointEvaluations": checkpoint_evaluations,
        "heldOutEvaluation": {
            "sourceType": "independent-espeak-ng",
            "excludedFromTraining": True,
            "sources": source_rows,
            "scoring": weights,
            "technicalGate": {
                "minTranscriptSimilarity": min_transcript,
                "minAudioQualityScore": min_audio_quality,
                "minDurationRatio": min_duration_ratio,
                "maxDurationRatio": max_duration_ratio,
                "maxClippingRatio": max_clipping,
            },
            "speakerSimilarityGate": "advisory-until-live-calibration",
        },
        "qualityControl": {
            "pass": True,
            "selectedCheckpointPassedTechnicalGate": True,
            "speakerSimilarityAdvisory": winner["speakerSimilarity"],
            "thresholdStatus": clean(policy.get("thresholdStatus")) or "initial-test-defaults-require-live-calibration",
        },
        "sourceReference": {
            "referenceMode": "original-sample-only",
            "path": str(reference_audio),
            "sha256": sha256_file(reference_audio),
        },
        "trainingPolicy": {
            "path": str(policy_path),
            "thresholdStatus": clean(policy.get("thresholdStatus")) or "initial-test-defaults-require-live-calibration",
        },
        "indexPath": str(index_path),
    }

    output_json.parent.mkdir(parents=True, exist_ok=True)
    temp = output_json.with_suffix(output_json.suffix + ".tmp")
    temp.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    os.replace(temp, output_json)
    print(json.dumps({
        "ok": True,
        "selectedCheckpoint": selected_checkpoint,
        "checkpointCount": len(checkpoint_evaluations),
        "outputJson": str(output_json),
    }))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
