#!/usr/bin/env python3
"""Linux IndexTTS2 training-dataset worker for ComfyUI-OTG TEST.

Claims only:
  jobType=character_voice_pipeline
  action=generate_training_dataset

The worker uses the official IndexTTS2 Python API, loads the model once per
claimed job, generates the requested same-speaker WAV clips, uploads resumable
batches to the Linux control plane, and releases GPU memory before polling again.
"""

from __future__ import annotations

import argparse
import difflib
import fcntl
import gc
import hashlib
import json
import mimetypes
import os
import shutil
import subprocess
import sys
import threading
import time
import traceback
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path
from typing import Any, Dict, List, Tuple


SOURCE_URL_KEYS = [
    "approvedSampleUrl",
    "approvedSampleURL",
    "tunedVoicePreviewUrl",
    "tunedSampleUrl",
    "baseSampleUrl",
    "sourceSampleUrl",
    "referenceAudioUrl",
]

SOURCE_PATH_KEYS = [
    "approvedSamplePath",
    "tunedVoicePreviewPath",
    "tunedSamplePath",
    "baseSamplePath",
    "sourceSamplePath",
    "referenceWav",
    "referenceWavPath",
    "referenceAudioPath",
]

EMOTION_UTTERANCES = [
    ("neutral", "This is a clear neutral line for the character voice."),
    ("calm", "I am calm now, and I can explain what happened."),
    ("happy", "That is wonderful news, and I cannot stop smiling."),
    ("excited", "This is it, we finally found the answer."),
    ("sad", "I tried to hold on, but everything changed too fast."),
    ("scared", "Please be quiet, I think something is moving outside."),
    ("angry", "No, that is not acceptable, and I will not ignore it."),
    ("whisper", "Keep your voice down, someone may be listening."),
    ("shout", "Run now, get out before the door closes."),
    ("tired", "I need a moment, because this has been a very long day."),
    ("curious", "What is that light doing behind the old wall."),
    ("serious", "Listen carefully, because this decision matters."),
    ("confident", "I know exactly what needs to happen next."),
    ("confused", "Wait, that does not match what we saw before."),
    ("relieved", "It is over now, and we made it through together."),
    ("nervous", "I am trying to stay steady, but my hands are shaking."),
    ("soft", "It is alright, you can rest here for a while."),
    ("urgent", "There is no time left, we have to move immediately."),
    ("suspicious", "Something about this story does not feel right."),
    ("determined", "I will finish this, no matter how difficult it becomes."),
    ("question", "Can you hear the difference between these two quiet sounds?"),
    ("narration", "The narrow path curved through the forest before reaching the river."),
    ("statement", "Today I will speak clearly, steadily, and without rushing the words."),
    ("pace", "Slowly and carefully, I counted each step before moving forward again."),
    ("phoneme", "Peter picked bright peppers while Sally searched beside the silver shore."),
    ("phoneme", "Quick brown foxes jump past lazy dogs while vivid voices echo nearby."),
]

COVERAGE_BY_EMOTION = {
    "neutral": "neutral",
    "question": "question",
    "curious": "question",
    "confused": "question",
    "narration": "narration",
    "statement": "narration",
    "serious": "narration",
    "confident": "narration",
    "whisper": "intensity",
    "shout": "intensity",
    "soft": "intensity",
    "urgent": "intensity",
    "phoneme": "phoneme",
    "pace": "emotional",
}

REQUIRED_MODEL_FILES = [
    "bpe.model",
    "gpt.pth",
    "config.yaml",
    "s2mel.pth",
    "wav2vec2bert_stats.pt",
]


class WorkerError(RuntimeError):
    pass


class TerminatedJob(RuntimeError):
    pass


def log(message: str) -> None:
    print(message, flush=True)


def clean(value: Any) -> str:
    return str(value or "").strip()


def truthy(value: Any) -> bool:
    return clean(value).lower() in {"1", "true", "yes", "on"}


def build_url(base_url: str, path_or_url: str) -> str:
    value = clean(path_or_url)
    if value.startswith("http://") or value.startswith("https://"):
        return value
    return urllib.parse.urljoin(base_url.rstrip("/") + "/", value.lstrip("/"))


def load_voice_training_policy(policy_path: Path) -> Dict[str, Any]:
    """Load the central voice-training-policy.json used by the real Linux worker."""

    if not policy_path.is_file():
        raise WorkerError(
            f"Voice training policy is missing: {policy_path}"
        )

    try:
        policy = json.loads(
            policy_path.read_text(
                encoding="utf-8"
            )
        )
    except Exception as error:
        raise WorkerError(
            f"Could not parse voice-training-policy.json: {error}"
        ) from error

    required = {
        "acceptedMinutesMin",
        "acceptedMinutesTarget",
        "acceptedMinutesMax",
        "referenceMode",
        "speakerSimilarityRequired",
        "transcriptVerificationRequired",
        "audioQualityQcRequired",
        "regenerateRejectedClips",
        "maxGeneratedAttempts",
        "maxClipRegenerations",
        "speakerSimilarityMin",
        "transcriptSimilarityMin",
        "rvc",
        "checkpointSelection",
    }

    missing = sorted(
        required.difference(
            policy.keys()
        )
    )

    if missing:
        raise WorkerError(
            "Voice training policy is incomplete: "
            + ", ".join(
                missing
            )
        )

    if clean(
        policy.get(
            "referenceMode"
        )
    ) != "original-sample-only":
        raise WorkerError(
            "Voice training policy must use the original saved sample only."
        )

    return policy


def policy_float(
    policy: Dict[str, Any],
    key: str,
    fallback: float,
) -> float:
    try:
        return float(
            policy.get(
                key,
                fallback,
            )
        )
    except Exception:
        return fallback


def policy_int(
    policy: Dict[str, Any],
    key: str,
    fallback: int,
) -> int:
    try:
        return int(
            float(
                policy.get(
                    key,
                    fallback,
                )
            )
        )
    except Exception:
        return fallback


def build_utterances(count: int) -> List[Dict[str, str]]:
    rows: List[Dict[str, str]] = []

    for index in range(
        max(
            1,
            count,
        )
    ):
        emotion, base_text = EMOTION_UTTERANCES[
            index % len(
                EMOTION_UTTERANCES
            )
        ]

        take = (
            index // len(
                EMOTION_UTTERANCES
            )
        ) + 1

        text = base_text

        if take > 1:
            text = (
                f"{base_text} "
                f"This is alternate reading number {take}."
            )

        coverage = COVERAGE_BY_EMOTION.get(
            emotion,
            "emotional",
        )

        rows.append(
            {
                "emotion": emotion,
                "coverage": coverage,
                "text": text,
            }
        )

    return rows


def request_json(
    method: str,
    url: str,
    headers: Dict[str, str] | None = None,
    payload: Dict[str, Any] | None = None,
    timeout: int = 120,
) -> Dict[str, Any]:
    body = None
    request_headers = dict(headers or {})
    if payload is not None:
        body = json.dumps(payload).encode("utf-8")
        request_headers["content-type"] = "application/json"

    request = urllib.request.Request(url, data=body, headers=request_headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read()
            return json.loads(raw.decode("utf-8")) if raw else {}
    except urllib.error.HTTPError as error:
        raw = error.read().decode("utf-8", errors="replace")
        raise WorkerError(f"HTTP {error.code} {url}: {raw}") from error
    except urllib.error.URLError as error:
        raise WorkerError(f"Could not reach {url}: {error}") from error


def auth_headers(args: argparse.Namespace, owner_key: str | None = None) -> Dict[str, str]:
    headers = {
        "x-otg-device-id": args.device_id,
        "x-otg-worker-id": args.worker_id,
    }
    if args.worker_token:
        headers["authorization"] = f"Bearer {args.worker_token}"
    if owner_key:
        headers["x-otg-owner-key"] = owner_key
    return headers


def assert_job_active(args: argparse.Namespace, headers: Dict[str, str], job_id: str) -> Dict[str, Any]:
    data = request_json(
        "GET",
        build_url(args.base_url, f"/api/characters/voice-pipeline/{urllib.parse.quote(job_id)}"),
        headers,
        timeout=60,
    )
    job = data.get("job") if isinstance(data.get("job"), dict) else {}
    status = clean(job.get("status"))
    if status in {"canceled", "cancelled", "terminated", "completed", "ready_for_review"}:
        raise TerminatedJob(f"Dataset job {job_id} is no longer active; status={status}.")
    if status not in {"queued", "running", "interrupted"}:
        raise WorkerError(f"Dataset job {job_id} returned unexpected status={status or 'missing'}.")
    return job


def checkpoint_job(
    args: argparse.Namespace,
    headers: Dict[str, str],
    job_id: str,
    generated_count: int,
    requested_count: int,
    message: str,
    stage: str,
    extra: Dict[str, Any] | None = None,
) -> None:
    progress = 5

    target_duration = float(
        (extra or {}).get(
            "targetDurationSeconds"
        )
        or 0
    )

    accepted_duration = float(
        (extra or {}).get(
            "acceptedDurationSeconds"
        )
        or 0
    )

    if target_duration > 0:
        progress = max(
            5,
            min(
                99,
                int(
                    (
                        accepted_duration
                        / target_duration
                    )
                    * 100
                ),
            ),
        )
    elif requested_count > 0:
        progress = max(
            5,
            min(
                99,
                int(
                    (
                        generated_count
                        / requested_count
                    )
                    * 100
                ),
            ),
        )
    result = {
        "remoteWorker": True,
        "platform": "linux",
        "workerId": args.worker_id,
        "provider": "indextts2",
        "requestedClipCount": requested_count,
        "generatedClipCount": generated_count,
        "currentClipId": f"clip_{generated_count:03d}" if generated_count else "",
        "currentStage": stage,
        **(extra or {}),
    }
    request_json(
        "POST",
        build_url(args.base_url, "/api/worker/jobs/checkpoint"),
        headers,
        {
            "jobId": job_id,
            "progress": progress,
            "message": message,
            "result": result,
        },
        timeout=60,
    )


class Heartbeat:
    def __init__(
        self,
        args: argparse.Namespace,
        headers: Dict[str, str],
        job_id: str,
        requested_count: int,
        state: Dict[str, Any],
    ) -> None:
        self.args = args
        self.headers = headers
        self.job_id = job_id
        self.requested_count = requested_count
        self.state = state
        self.stop_event = threading.Event()
        self.thread = threading.Thread(target=self._run, name=f"indextts2-heartbeat-{job_id}", daemon=True)

    def start(self) -> None:
        self.thread.start()

    def stop(self) -> None:
        self.stop_event.set()
        self.thread.join(timeout=5)

    def _run(self) -> None:
        while not self.stop_event.wait(max(15, self.args.heartbeat_seconds)):
            try:
                checkpoint_job(
                    self.args,
                    self.headers,
                    self.job_id,
                    int(self.state.get("generated_count") or 0),
                    self.requested_count,
                    clean(self.state.get("message")) or "Linux IndexTTS2 worker heartbeat.",
                    clean(self.state.get("stage")) or "running",
                )
            except Exception as error:
                log(f"[warn] Heartbeat failed for {self.job_id}: {error}")


def download_file(url: str, target: Path, headers: Dict[str, str], timeout: int = 300) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    request = urllib.request.Request(url, headers=headers, method="GET")
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            with target.open("wb") as handle:
                shutil.copyfileobj(response, handle)
    except urllib.error.HTTPError as error:
        raw = error.read().decode("utf-8", errors="replace")
        raise WorkerError(f"HTTP {error.code} downloading {url}: {raw}") from error
    if not target.is_file() or target.stat().st_size <= 0:
        raise WorkerError(f"Downloaded file is empty: {target}")


def normalize_audio(source: Path, target: Path, timeout: int = 300) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    temp = target.with_suffix(".tmp.wav")
    command = [
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
        "24000",
        "-c:a",
        "pcm_s16le",
        str(temp),
    ]
    result = subprocess.run(command, capture_output=True, text=True, timeout=timeout)
    if result.returncode != 0:
        raise WorkerError(f"ffmpeg failed to normalize {source}: {result.stderr.strip()}")
    if not temp.is_file() or temp.stat().st_size <= 44:
        raise WorkerError(f"Normalized audio is missing or empty: {temp}")
    os.replace(temp, target)


def resolve_source_sample(
    args: argparse.Namespace,
    headers: Dict[str, str],
    job_input: Dict[str, Any],
    work_dir: Path,
) -> Tuple[Path, str]:
    raw_source = work_dir / "source-input"
    normalized_source = work_dir / "source.wav"

    for key in SOURCE_PATH_KEYS:
        value = clean(job_input.get(key))
        if not value:
            continue
        candidate = Path(value).expanduser()
        if candidate.is_file() and candidate.stat().st_size > 0:
            log(f"[source] using local {key}: {candidate}")
            normalize_audio(candidate, normalized_source)
            return normalized_source, str(candidate)
        log(f"[source] local candidate from {key} is not readable on this Linux worker: {value}")

    for key in SOURCE_URL_KEYS:
        value = clean(job_input.get(key))
        if not value:
            continue
        url = build_url(args.base_url, value)
        log(f"[download] using {key}: {url}")
        download_file(url, raw_source, headers, timeout=args.download_timeout_seconds)
        normalize_audio(raw_source, normalized_source)
        return normalized_source, value

    raise WorkerError(
        "Claimed dataset job has no readable approved reference sample. Expected one of path fields "
        + ", ".join(SOURCE_PATH_KEYS)
        + " or URL fields "
        + ", ".join(SOURCE_URL_KEYS)
        + "."
    )


def multipart_post(
    url: str,
    headers: Dict[str, str],
    fields: Dict[str, str],
    files: List[Tuple[str, Path, str]],
    timeout: int,
) -> Dict[str, Any]:
    boundary = "----otg-linux-indextts2-" + uuid.uuid4().hex
    chunks: List[bytes] = []

    for name, value in fields.items():
        chunks.append(f"--{boundary}\r\n".encode("utf-8"))
        chunks.append(f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode("utf-8"))
        chunks.append(str(value).encode("utf-8"))
        chunks.append(b"\r\n")

    for name, file_path, content_type in files:
        chunks.append(f"--{boundary}\r\n".encode("utf-8"))
        chunks.append(
            f'Content-Disposition: form-data; name="{name}"; filename="{file_path.name}"\r\n'.encode("utf-8")
        )
        chunks.append(f"Content-Type: {content_type}\r\n\r\n".encode("utf-8"))
        chunks.append(file_path.read_bytes())
        chunks.append(b"\r\n")

    chunks.append(f"--{boundary}--\r\n".encode("utf-8"))
    body = b"".join(chunks)
    request_headers = {key: value for key, value in headers.items() if key.lower() != "content-type"}
    request_headers["content-type"] = f"multipart/form-data; boundary={boundary}"
    request_headers["content-length"] = str(len(body))

    request = urllib.request.Request(url, data=body, headers=request_headers, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read()
            return json.loads(raw.decode("utf-8")) if raw else {}
    except urllib.error.HTTPError as error:
        raw = error.read().decode("utf-8", errors="replace")
        raise WorkerError(f"HTTP {error.code} {url}: {raw}") from error


def accepted_duration_seconds(
    clips: List[Dict[str, Any]],
) -> float:
    total = 0.0

    for clip in clips:
        if clean(
            clip.get(
                "status"
            )
        ) != "ready":
            continue

        qc = (
            clip.get(
                "qc"
            )
            if isinstance(
                clip.get(
                    "qc"
                ),
                dict,
            )
            else {}
        )

        if qc.get(
            "pass"
        ) is not True:
            continue

        try:
            total += float(
                clip.get(
                    "durationSeconds"
                )
                or 0
            )
        except Exception:
            pass

    return total


def coverage_set(
    clips: List[Dict[str, Any]],
) -> set[str]:
    return {
        clean(
            clip.get(
                "coverage"
            )
        )
        for clip in clips
        if clean(
            clip.get(
                "coverage"
            )
        )
        and clean(
            clip.get(
                "status"
            )
        ) == "ready"
        and isinstance(
            clip.get(
                "qc"
            ),
            dict,
        )
        and clip["qc"].get(
            "pass"
        )
        is True
    }


def adaptive_dataset_complete(
    policy: Dict[str, Any],
    clips: List[Dict[str, Any]],
    allow_minimum: bool = False,
) -> bool:
    duration = accepted_duration_seconds(
        clips
    )

    minimum = (
        policy_float(
            policy,
            "acceptedMinutesMin",
            8.0,
        )
        * 60.0
    )

    target = (
        policy_float(
            policy,
            "acceptedMinutesTarget",
            10.0,
        )
        * 60.0
    )

    maximum = (
        policy_float(
            policy,
            "acceptedMinutesMax",
            12.0,
        )
        * 60.0
    )

    threshold = (
        minimum
        if allow_minimum
        else target
    )

    required_coverage = {
        clean(
            value
        )
        for value in (
            policy.get(
                "requiredCoverage"
            )
            if isinstance(
                policy.get(
                    "requiredCoverage"
                ),
                list,
            )
            else []
        )
        if clean(
            value
        )
    }

    return (
        duration >= threshold
        and duration <= maximum
        and required_coverage.issubset(
            coverage_set(
                clips
            )
        )
    )


def make_manifest(
    owner_key: str,
    character_id: str,
    job_id: str,
    source_ref: str,
    accepted_clips: List[Dict[str, Any]],
    rejected_attempts: List[Dict[str, Any]],
    policy: Dict[str, Any],
    adaptive_complete: bool,
) -> Dict[str, Any]:
    now = time.strftime(
        "%Y-%m-%dT%H:%M:%SZ",
        time.gmtime(),
    )

    duration = accepted_duration_seconds(
        accepted_clips
    )

    accepted_minutes = duration / 60.0

    attempted_count = (
        len(
            accepted_clips
        )
        + len(
            rejected_attempts
        )
    )

    quality_control = {
        "pass": bool(
            adaptive_complete
        ),
        "speakerSimilarityRequired": bool(
            policy.get(
                "speakerSimilarityRequired"
            )
        ),
        "transcriptVerificationRequired": bool(
            policy.get(
                "transcriptVerificationRequired"
            )
        ),
        "audioQualityQcRequired": bool(
            policy.get(
                "audioQualityQcRequired"
            )
        ),
        "regenerateRejectedClips": bool(
            policy.get(
                "regenerateRejectedClips"
            )
        ),
        "attemptedClipCount": attempted_count,
        "acceptedClipCount": len(
            accepted_clips
        ),
        "rejectedClipCount": len(
            rejected_attempts
        ),
        "rejectedAttempts": rejected_attempts[
            -100:
        ],
        "acceptedCoverage": sorted(
            coverage_set(
                accepted_clips
            )
        ),
        "requiredCoverage": list(
            policy.get(
                "requiredCoverage"
            )
            or []
        ),
    }

    return {
        "schemaVersion": 1,
        "ownerKey": owner_key,
        "characterId": character_id,
        "jobId": job_id,
        "createdAt": now,
        "source": {
            "approvedSampleUrl": source_ref,
            "originalSourceUrl": source_ref,
            "sourceFormat": ".wav",
            "sampleRate": 24000,
            "channels": 1,
            "referenceMode": "original-sample-only",
        },
        "logs": {},
        "generationMode": "real",
        "provider": "indextts2",
        "startedAt": now,
        "completedAt": (
            now
            if adaptive_complete
            else None
        ),
        "requestedClipCount": len(
            accepted_clips
        ),
        "generatedClipCount": len(
            accepted_clips
        ),
        "acceptedDurationSeconds": round(
            duration,
            3,
        ),
        "acceptedMinutes": round(
            accepted_minutes,
            4,
        ),
        "adaptiveComplete": bool(
            adaptive_complete
        ),
        "qualityControl": quality_control,
        "clips": accepted_clips,
        "status": (
            "voice_pack_ready"
            if adaptive_complete
            else "manifest_ready"
        ),
        "mock": False,
        "note": (
            "Adaptive Linux RTX 3090 IndexTTS2 dataset. "
            "Every generated candidate is conditioned directly "
            "from the original saved Character Voice Sample and "
            "must pass transcript verification, ECAPA speaker "
            "similarity, and waveform audio-quality QC."
        ),
    }


def upload_batch(
    args: argparse.Namespace,
    headers: Dict[str, str],
    character_id: str,
    job_id: str,
    manifest: Dict[str, Any],
    source_path: Path,
    clip_paths: List[Path],
) -> Dict[str, Any]:
    fields = {
        "characterId": character_id,
        "jobId": job_id,
        "manifest": json.dumps(manifest),
    }
    files: List[Tuple[str, Path, str]] = [("source.wav", source_path, "audio/wav")]
    for clip_path in clip_paths:
        files.append((clip_path.stem, clip_path, mimetypes.guess_type(str(clip_path))[0] or "audio/wav"))

    log(f"[upload] {job_id}: {len(clip_paths)} clips")
    response = multipart_post(
        build_url(args.base_url, "/api/characters/training-dataset/upload-batch"),
        headers,
        fields,
        files,
        timeout=args.upload_timeout_seconds,
    )
    if not response.get("ok"):
        raise WorkerError(f"Upload failed: {json.dumps(response, indent=2)}")
    return response


def remote_ready_count(upload_response: Dict[str, Any]) -> int:
    manifest = upload_response.get("manifest")
    if not isinstance(manifest, dict):
        raise WorkerError("Remote upload did not return a training dataset manifest.")
    clips = manifest.get("clips")
    if not isinstance(clips, list):
        raise WorkerError("Remote training dataset manifest has no clips array.")
    return sum(1 for clip in clips if isinstance(clip, dict) and clip.get("status") == "ready")


def assert_manifest_complete(
    upload_response: Dict[str, Any],
    policy: Dict[str, Any],
) -> Dict[str, Any]:
    manifest = upload_response.get(
        "manifest"
    )

    if not isinstance(
        manifest,
        dict,
    ):
        raise WorkerError(
            "Remote upload did not return a training dataset manifest."
        )

    if (
        manifest.get(
            "generationMode"
        )
        != "real"
        or manifest.get(
            "provider"
        )
        != "indextts2"
    ):
        raise WorkerError(
            "Remote manifest is not a real IndexTTS2 dataset manifest."
        )

    if manifest.get(
        "adaptiveComplete"
    ) is not True:
        raise WorkerError(
            "Remote adaptive dataset is not complete."
        )

    if clean(
        manifest.get(
            "status"
        )
    ) != "voice_pack_ready":
        raise WorkerError(
            "Remote manifest status is not voice_pack_ready."
        )

    minimum_seconds = (
        policy_float(
            policy,
            "acceptedMinutesMin",
            8.0,
        )
        * 60.0
    )

    maximum_seconds = (
        policy_float(
            policy,
            "acceptedMinutesMax",
            12.0,
        )
        * 60.0
    )

    duration = float(
        manifest.get(
            "acceptedDurationSeconds"
        )
        or 0
    )

    if (
        duration < minimum_seconds
        or duration > maximum_seconds
    ):
        raise WorkerError(
            "Remote adaptive dataset duration is outside policy: "
            f"{duration:.2f}s."
        )

    clips = (
        manifest.get(
            "clips"
        )
        if isinstance(
            manifest.get(
                "clips"
            ),
            list,
        )
        else []
    )

    ready = [
        clip
        for clip in clips
        if isinstance(
            clip,
            dict,
        )
        and clean(
            clip.get(
                "status"
            )
        )
        == "ready"
    ]

    if not ready:
        raise WorkerError(
            "Remote adaptive dataset has no accepted clips."
        )

    for clip in ready:
        qc = (
            clip.get(
                "qc"
            )
            if isinstance(
                clip.get(
                    "qc"
                ),
                dict,
            )
            else {}
        )

        if qc.get(
            "pass"
        ) is not True:
            raise WorkerError(
                "Remote adaptive dataset contains a ready clip "
                "without passing QC: "
                f"{clip.get('clipId')}"
            )

    return manifest


def queue_counts(payload: Dict[str, Any]) -> Tuple[int, int]:
    running = payload.get("queue_running")
    pending = payload.get("queue_pending")
    return (
        len(running) if isinstance(running, list) else 0,
        len(pending) if isinstance(pending, list) else 0,
    )


def wait_for_comfy_idle(
    args: argparse.Namespace,
    headers: Dict[str, str],
    job_id: str,
    state: Dict[str, Any],
    requested_count: int,
) -> None:
    deadline = time.monotonic() + args.comfy_idle_timeout_seconds
    last_report = 0.0
    while True:
        assert_job_active(args, headers, job_id)
        queue = request_json("GET", build_url(args.comfy_url, "/queue"), timeout=15)
        running, pending = queue_counts(queue)
        if running == 0 and pending == 0:
            log("[gpu] RTX 3090 ComfyUI queue is idle.")
            return
        now = time.monotonic()
        if now >= deadline:
            raise WorkerError(
                f"Timed out waiting for RTX 3090 ComfyUI queue to become idle. running={running}; pending={pending}"
            )
        if now - last_report >= 20:
            state["stage"] = "waiting_for_comfy"
            state["message"] = "Waiting for the RTX 3090 ComfyUI queue to become idle before IndexTTS2 generation."
            checkpoint_job(
                args,
                headers,
                job_id,
                int(state.get("generated_count") or 0),
                requested_count,
                state["message"],
                state["stage"],
                {"comfyRunning": running, "comfyPending": pending},
            )
            log(f"[wait] RTX 3090 ComfyUI running={running} pending={pending}")
            last_report = now
        time.sleep(max(2, args.comfy_poll_seconds))


def release_comfy_models(args: argparse.Namespace) -> None:
    try:
        response = request_json(
            "POST",
            build_url(args.comfy_url, "/free"),
            {"content-type": "application/json"},
            {"unload_models": True, "free_memory": True},
            timeout=30,
        )
        log(f"[gpu] Requested ComfyUI model release: {json.dumps(response)}")
    except Exception as error:
        log(f"[warn] ComfyUI /free request failed; continuing: {error}")


def free_vram_mib() -> int | None:
    try:
        result = subprocess.run(
            ["nvidia-smi", "--query-gpu=memory.free", "--format=csv,noheader,nounits"],
            check=True,
            capture_output=True,
            text=True,
            timeout=20,
        )
        return int(result.stdout.strip().splitlines()[0].strip())
    except Exception as error:
        log(f"[warn] Could not read free VRAM with nvidia-smi: {error}")
        return None


def wait_for_free_vram(args: argparse.Namespace) -> int | None:
    deadline = time.monotonic() + args.vram_wait_seconds
    while True:
        free = free_vram_mib()
        if free is None or free >= args.min_free_vram_mib:
            return free
        if time.monotonic() >= deadline:
            raise WorkerError(
                f"RTX 3090 free VRAM stayed below {args.min_free_vram_mib} MiB. Last reading: {free} MiB."
            )
        log(f"[wait] RTX 3090 free VRAM {free} MiB; need {args.min_free_vram_mib} MiB.")
        time.sleep(5)


def acquire_gpu_lock(
    args: argparse.Namespace,
    headers: Dict[str, str],
    job_id: str,
    state: Dict[str, Any],
    requested_count: int,
):
    path = Path(args.gpu_lock_file).expanduser()
    path.parent.mkdir(parents=True, exist_ok=True)
    handle = path.open("a+")
    log(f"[gpu-lock] Waiting for shared voice GPU lock: {path}")
    last_report = 0.0
    while True:
        try:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            log(f"[gpu-lock] Acquired shared voice GPU lock: {path}")
            return handle
        except BlockingIOError:
            assert_job_active(args, headers, job_id)
            now = time.monotonic()
            if now - last_report >= 20:
                state["stage"] = "waiting_for_gpu_lock"
                state["message"] = "Waiting for the shared RTX 3090 voice GPU lock."
                checkpoint_job(
                    args,
                    headers,
                    job_id,
                    int(state.get("generated_count") or 0),
                    requested_count,
                    state["message"],
                    state["stage"],
                )
                last_report = now
            time.sleep(2)


def validate_model_files(model_dir: Path) -> None:
    missing = [name for name in REQUIRED_MODEL_FILES if not (model_dir / name).is_file()]
    if missing:
        raise WorkerError(f"IndexTTS2 model directory is incomplete: missing {', '.join(missing)} in {model_dir}")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()



def normalize_transcript_text(
    value: Any,
) -> str:
    text = clean(
        value
    ).lower()

    return " ".join(
        "".join(
            ch
            if ch.isalnum()
            or ch == "'"
            else " "
            for ch in text
        ).split()
    )


def transcript_similarity(
    expected: str,
    actual: str,
) -> float:
    expected_normalized = normalize_transcript_text(
        expected
    )

    actual_normalized = normalize_transcript_text(
        actual
    )

    if (
        not expected_normalized
        or not actual_normalized
    ):
        return 0.0

    return float(
        difflib.SequenceMatcher(
            None,
            expected_normalized.split(),
            actual_normalized.split(),
        ).ratio()
    )


def transcribe_clip(
    args: argparse.Namespace,
    headers: Dict[str, str],
    clip_path: Path,
) -> str:
    response = multipart_post(
        build_url(
            args.base_url,
            "/api/ollama-ai/transcribe",
        ),
        headers,
        {},
        [
            (
                "audio",
                clip_path,
                "audio/wav",
            )
        ],
        timeout=args.qc_timeout_seconds,
    )

    if response.get(
        "ok"
    ) is not True:
        raise WorkerError(
            "Transcript verification failed: "
            + clean(
                response.get(
                    "error"
                )
            )
        )

    transcript = clean(
        response.get(
            "text"
        )
        or response.get(
            "transcript"
        )
    )

    if not transcript:
        raise WorkerError(
            "Transcript verification returned empty text."
        )

    return transcript


def audio_quality_metrics(
    clip_path: Path,
    policy: Dict[str, Any],
) -> Dict[str, Any]:
    import numpy as np
    import soundfile as sf

    audio, sample_rate = sf.read(
        str(
            clip_path
        ),
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

    if (
        audio.size < 1
        or int(
            sample_rate
        )
        <= 0
    ):
        raise WorkerError(
            f"Audio quality QC could not read samples from {clip_path}."
        )

    absolute = np.abs(
        audio
    )

    duration = (
        float(
            audio.size
        )
        / float(
            sample_rate
        )
    )

    peak = float(
        np.max(
            absolute
        )
    )

    rms = float(
        np.sqrt(
            np.mean(
                np.square(
                    audio
                )
            )
        )
    )

    clipping_ratio = float(
        np.mean(
            absolute >= 0.999
        )
    )

    quality_policy = (
        policy.get(
            "audioQuality"
        )
        if isinstance(
            policy.get(
                "audioQuality"
            ),
            dict,
        )
        else {}
    )

    silence_amplitude = float(
        quality_policy.get(
            "silenceAmplitude",
            0.003,
        )
    )

    silence_ratio = float(
        np.mean(
            absolute
            < silence_amplitude
        )
    )

    return {
        "durationSeconds": duration,
        "sampleRate": int(
            sample_rate
        ),
        "peak": peak,
        "rms": rms,
        "clippingRatio": clipping_ratio,
        "silenceRatio": silence_ratio,
    }


def speaker_similarity(
    args: argparse.Namespace,
    source_voice: Path,
    candidate: Path,
) -> float:
    command = [
        args.speaker_qc_python,
        args.speaker_qc_script,
        "--source",
        str(
            source_voice
        ),
        "--candidate",
        str(
            candidate
        ),
        "--model-dir",
        args.speaker_qc_model_dir,
        "--hf-home",
        args.speaker_qc_hf_home,
    ]

    environment = os.environ.copy()
    environment["HF_HUB_OFFLINE"] = "1"
    environment["TRANSFORMERS_OFFLINE"] = "1"

    result = subprocess.run(
        command,
        capture_output=True,
        text=True,
        timeout=args.qc_timeout_seconds,
        env=environment,
    )

    try:
        payload = json.loads(
            result.stdout.strip()
            or "{}"
        )
    except Exception as error:
        raise WorkerError(
            "Speaker similarity QC returned invalid JSON: "
            f"{result.stdout!r}; stderr={result.stderr!r}"
        ) from error

    if (
        result.returncode != 0
        or payload.get(
            "ok"
        )
        is not True
    ):
        raise WorkerError(
            "Speaker similarity QC failed: "
            + clean(
                payload.get(
                    "error"
                )
                or result.stderr
            )
        )

    try:
        return float(
            payload.get(
                "speakerSimilarity"
            )
        )
    except Exception as error:
        raise WorkerError(
            "Speaker similarity QC returned no numeric score."
        ) from error


def evaluate_clip_quality_control(
    args: argparse.Namespace,
    headers: Dict[str, str],
    policy: Dict[str, Any],
    source_voice: Path,
    clip_path: Path,
    expected_text: str,
) -> Dict[str, Any]:
    """Run transcript verification, speaker similarity, and audio quality QC."""

    audio_quality = audio_quality_metrics(
        clip_path,
        policy,
    )

    transcript = transcribe_clip(
        args,
        headers,
        clip_path,
    )

    transcript_score = transcript_similarity(
        expected_text,
        transcript,
    )

    speaker_score = speaker_similarity(
        args,
        source_voice,
        clip_path,
    )

    quality_policy = (
        policy.get(
            "audioQuality"
        )
        if isinstance(
            policy.get(
                "audioQuality"
            ),
            dict,
        )
        else {}
    )

    reasons: List[str] = []

    min_duration = float(
        quality_policy.get(
            "minDurationSeconds",
            1.0,
        )
    )

    max_duration = float(
        quality_policy.get(
            "maxDurationSeconds",
            18.0,
        )
    )

    min_rms = float(
        quality_policy.get(
            "minRms",
            0.006,
        )
    )

    max_clipping_ratio = float(
        quality_policy.get(
            "maxClippingRatio",
            0.002,
        )
    )

    max_silence_ratio = float(
        quality_policy.get(
            "maxSilenceRatio",
            0.55,
        )
    )

    speaker_threshold = policy_float(
        policy,
        "speakerSimilarityMin",
        0.68,
    )

    transcript_threshold = policy_float(
        policy,
        "transcriptSimilarityMin",
        0.82,
    )

    duration = float(
        audio_quality[
            "durationSeconds"
        ]
    )

    if (
        duration < min_duration
        or duration > max_duration
    ):
        reasons.append(
            "audio-quality-duration"
        )

    if float(
        audio_quality[
            "rms"
        ]
    ) < min_rms:
        reasons.append(
            "audio-quality-rms"
        )

    if float(
        audio_quality[
            "clippingRatio"
        ]
    ) > max_clipping_ratio:
        reasons.append(
            "audio-quality-clipping"
        )

    if float(
        audio_quality[
            "silenceRatio"
        ]
    ) > max_silence_ratio:
        reasons.append(
            "audio-quality-silence"
        )

    if speaker_score < speaker_threshold:
        reasons.append(
            "speaker-similarity"
        )

    if transcript_score < transcript_threshold:
        reasons.append(
            "transcript-verification"
        )

    return {
        "pass": len(
            reasons
        )
        == 0,
        "speakerSimilarity": speaker_score,
        "speakerSimilarityMin": speaker_threshold,
        "transcript": transcript,
        "expectedTranscript": expected_text,
        "transcriptSimilarity": transcript_score,
        "transcriptSimilarityMin": transcript_threshold,
        "audioQuality": audio_quality,
        "reasons": reasons,
    }


def load_resume_manifest(
    args: argparse.Namespace,
    headers: Dict[str, str],
    job_result: Dict[str, Any],
) -> Dict[str, Any]:
    manifest_path = clean(
        job_result.get(
            "manifestPath"
        )
        or job_result.get(
            "datasetManifestPath"
        )
    )

    if manifest_path:
        candidate = Path(
            manifest_path
        ).expanduser()

        if (
            candidate.is_file()
            and candidate.stat().st_size > 0
        ):
            try:
                parsed = json.loads(
                    candidate.read_text(
                        encoding="utf-8"
                    )
                )

                if isinstance(
                    parsed,
                    dict,
                ):
                    return parsed
            except Exception:
                pass

    manifest_url = clean(
        job_result.get(
            "manifestUrl"
        )
        or job_result.get(
            "datasetManifestUrl"
        )
    )

    if manifest_url:
        try:
            response = request_json(
                "GET",
                build_url(
                    args.base_url,
                    manifest_url,
                ),
                headers,
                timeout=60,
            )

            if isinstance(
                response.get(
                    "manifest"
                ),
                dict,
            ):
                return response[
                    "manifest"
                ]

            if isinstance(
                response,
                dict,
            ) and isinstance(
                response.get(
                    "clips"
                ),
                list,
            ):
                return response
        except Exception as error:
            log(
                "[warn] Could not restore adaptive "
                f"manifest state: {error}"
            )

    return {}


def normalize_generated_clip(raw_output: Path, final_output: Path, timeout: int) -> None:
    normalize_audio(raw_output, final_output, timeout=timeout)
    if final_output.stat().st_size <= 1024:
        raise WorkerError(f"Generated clip is too small: {final_output} ({final_output.stat().st_size} bytes)")


def load_indextts2(args: argparse.Namespace):
    index_root = Path(args.index_root).expanduser().resolve()
    model_dir = Path(args.model_dir).expanduser().resolve()
    if not (index_root / "indextts" / "infer_v2.py").is_file():
        raise WorkerError(f"Official IndexTTS2 source is missing: {index_root / 'indextts/infer_v2.py'}")
    validate_model_files(model_dir)
    if str(index_root) not in sys.path:
        sys.path.insert(0, str(index_root))

    import torch
    from indextts.infer_v2 import IndexTTS2

    if not torch.cuda.is_available():
        raise WorkerError("CUDA is unavailable inside the IndexTTS2 runtime.")
    log(f"[model] torch={torch.__version__} cuda={torch.version.cuda} gpu={torch.cuda.get_device_name(0)}")
    tts = IndexTTS2(
        cfg_path=str(model_dir / "config.yaml"),
        model_dir=str(model_dir),
        use_fp16=args.use_fp16,
        use_cuda_kernel=False,
        use_deepspeed=False,
    )
    return tts, torch


def generate_clip(
    tts: Any,
    source_voice: Path,
    text: str,
    raw_output: Path,
    final_output: Path,
    timeout_seconds: int,
) -> None:
    del timeout_seconds  # IndexTTS2 currently exposes a synchronous in-process API.
    raw_output.parent.mkdir(parents=True, exist_ok=True)
    raw_output.unlink(missing_ok=True)
    final_output.unlink(missing_ok=True)
    log(f"[generate] {final_output.name}")
    tts.infer(
        spk_audio_prompt=str(source_voice),
        text=text,
        output_path=str(raw_output),
        verbose=False,
    )
    if not raw_output.is_file() or raw_output.stat().st_size <= 0:
        raise WorkerError(f"IndexTTS2 did not create output: {raw_output}")
    normalize_generated_clip(raw_output, final_output, timeout=300)


def mark_failed(
    args: argparse.Namespace,
    headers: Dict[str, str],
    job_id: str,
    error: str,
) -> None:
    if not job_id:
        return
    try:
        request_json(
            "POST",
            build_url(args.base_url, "/api/characters/voice-pipeline/worker/fail"),
            headers,
            {
                "jobId": job_id,
                "error": error,
                "result": {
                    "remoteWorker": True,
                    "platform": "linux",
                    "provider": "indextts2",
                    "workerId": args.worker_id,
                    "localError": error,
                },
            },
            timeout=args.upload_timeout_seconds,
        )
    except Exception as fail_error:
        log(f"[warn] Could not mark dataset job failed: {fail_error}")


def process_one(args: argparse.Namespace) -> int:
    job_id = ""
    owner_key = ""
    headers = auth_headers(args)
    heartbeat: Heartbeat | None = None
    gpu_lock = None
    tts = None
    torch_module = None

    try:
        claim = request_json(
            "POST",
            build_url(
                args.base_url,
                "/api/worker/jobs/claim",
            ),
            headers,
            {
                "jobType": "character_voice_pipeline",
                "action": "generate_training_dataset",
                "claimScope": "all_owners",
                "workerId": args.worker_id,
            },
        )

        job = claim.get(
            "job"
        )

        if not isinstance(
            job,
            dict,
        ):
            log(
                "[idle] No queued generate_training_dataset job available."
            )
            return 0

        job_id = clean(
            job.get(
                "jobId"
            )
        )

        owner_key = clean(
            job.get(
                "ownerKey"
            )
            or job.get(
                "owner_key"
            )
        )

        character_id = clean(
            job.get(
                "characterId"
            )
        )

        job_input = (
            job.get(
                "input"
            )
            if isinstance(
                job.get(
                    "input"
                ),
                dict,
            )
            else {}
        )

        if (
            not job_id
            or not owner_key
            or not character_id
        ):
            raise WorkerError(
                f"Invalid claimed dataset job: {job}"
            )

        headers = auth_headers(
            args,
            owner_key,
        )

        policy = load_voice_training_policy(
            Path(
                args.policy_path
            ).expanduser().resolve()
        )

        attempt_budget = max(
            1,
            policy_int(
                policy,
                "maxGeneratedAttempts",
                240,
            ),
        )

        if args.max_clips > 0:
            attempt_budget = min(
                attempt_budget,
                args.max_clips,
            )

        utterances = build_utterances(
            attempt_budget
        )

        target_duration_seconds = (
            policy_float(
                policy,
                "acceptedMinutesTarget",
                10.0,
            )
            * 60.0
        )

        minimum_duration_seconds = (
            policy_float(
                policy,
                "acceptedMinutesMin",
                8.0,
            )
            * 60.0
        )

        maximum_duration_seconds = (
            policy_float(
                policy,
                "acceptedMinutesMax",
                12.0,
            )
            * 60.0
        )

        work_dir = (
            Path(
                args.work_root
            )
            .expanduser()
            .resolve()
            / owner_key
            / character_id
            / job_id
        )

        clips_dir = (
            work_dir
            / "clips"
        )

        raw_dir = (
            work_dir
            / "raw"
        )

        manifest_path = (
            work_dir
            / "manifest.json"
        )

        work_dir.mkdir(
            parents=True,
            exist_ok=True,
        )

        clips_dir.mkdir(
            parents=True,
            exist_ok=True,
        )

        raw_dir.mkdir(
            parents=True,
            exist_ok=True,
        )

        job_result = (
            job.get(
                "result"
            )
            if isinstance(
                job.get(
                    "result"
                ),
                dict,
            )
            else {}
        )

        resume_manifest = load_resume_manifest(
            args,
            headers,
            job_result,
        )

        resume_clips = (
            resume_manifest.get(
                "clips"
            )
            if isinstance(
                resume_manifest.get(
                    "clips"
                ),
                list,
            )
            else []
        )

        accepted_clips: List[Dict[str, Any]] = [
            dict(
                clip
            )
            for clip in resume_clips
            if isinstance(
                clip,
                dict,
            )
            and clean(
                clip.get(
                    "status"
                )
            )
            == "ready"
            and isinstance(
                clip.get(
                    "qc"
                ),
                dict,
            )
            and clip[
                "qc"
            ].get(
                "pass"
            )
            is True
        ]

        quality_control_resume = (
            resume_manifest.get(
                "qualityControl"
            )
            if isinstance(
                resume_manifest.get(
                    "qualityControl"
                ),
                dict,
            )
            else {}
        )

        rejected_attempts = (
            [
                dict(
                    item
                )
                for item in quality_control_resume.get(
                    "rejectedAttempts",
                    [],
                )
                if isinstance(
                    item,
                    dict,
                )
            ]
            if isinstance(
                quality_control_resume.get(
                    "rejectedAttempts"
                ),
                list,
            )
            else []
        )

        attempted_count = int(
            quality_control_resume.get(
                "attemptedClipCount"
            )
            or (
                len(
                    accepted_clips
                )
                + len(
                    rejected_attempts
                )
            )
        )

        state: Dict[str, Any] = {
            "generated_count": len(
                accepted_clips
            ),
            "acceptedDurationSeconds": accepted_duration_seconds(
                accepted_clips
            ),
            "stage": "claimed",
            "message": (
                "Linux IndexTTS2 adaptive dataset worker claimed the job."
            ),
        }

        heartbeat = Heartbeat(
            args,
            headers,
            job_id,
            max(
                1,
                attempt_budget,
            ),
            state,
        )

        heartbeat.start()

        checkpoint_job(
            args,
            headers,
            job_id,
            len(
                accepted_clips
            ),
            attempt_budget,
            state[
                "message"
            ],
            state[
                "stage"
            ],
            {
                "acceptedDurationSeconds": state[
                    "acceptedDurationSeconds"
                ],
                "targetDurationSeconds": target_duration_seconds,
                "referenceMode": "original-sample-only",
            },
        )

        log(
            "[claim] "
            f"job={job_id} "
            f"owner={owner_key} "
            f"character={character_id} "
            f"accepted={len(accepted_clips)} "
            f"acceptedSeconds={state['acceptedDurationSeconds']:.2f} "
            f"attemptBudget={attempt_budget}"
        )

        source_path, source_ref = resolve_source_sample(
            args,
            headers,
            job_input,
            work_dir,
        )

        state[
            "stage"
        ] = "source_ready"

        state[
            "message"
        ] = (
            "Original saved Character Voice Sample is normalized "
            "and locked as the only IndexTTS2 speaker reference."
        )

        checkpoint_job(
            args,
            headers,
            job_id,
            len(
                accepted_clips
            ),
            attempt_budget,
            state[
                "message"
            ],
            state[
                "stage"
            ],
            {
                "sourceBytes": source_path.stat().st_size,
                "acceptedDurationSeconds": accepted_duration_seconds(
                    accepted_clips
                ),
                "targetDurationSeconds": target_duration_seconds,
                "referenceMode": "original-sample-only",
            },
        )

        gpu_lock = acquire_gpu_lock(
            args,
            headers,
            job_id,
            state,
            attempt_budget,
        )

        wait_for_comfy_idle(
            args,
            headers,
            job_id,
            state,
            attempt_budget,
        )

        release_comfy_models(
            args
        )

        free = wait_for_free_vram(
            args
        )

        log(
            "[gpu] RTX 3090 free VRAM before IndexTTS2: "
            f"{free if free is not None else 'unknown'} MiB"
        )

        state[
            "stage"
        ] = "loading_model"

        state[
            "message"
        ] = (
            "Loading the official IndexTTS2 model "
            "on the Linux RTX 3090 worker."
        )

        checkpoint_job(
            args,
            headers,
            job_id,
            len(
                accepted_clips
            ),
            attempt_budget,
            state[
                "message"
            ],
            state[
                "stage"
            ],
            {
                "freeVramMiB": free,
                "useFp16": args.use_fp16,
                "acceptedDurationSeconds": accepted_duration_seconds(
                    accepted_clips
                ),
                "targetDurationSeconds": target_duration_seconds,
            },
        )

        tts, torch_module = load_indextts2(
            args
        )

        log(
            "[model] Official IndexTTS2 model loaded."
        )

        pending_upload: List[Path] = []

        seen_hashes: set[str] = set()

        last_upload: Dict[str, Any] | None = None

        last_local_accepted_path: Path | None = None

        budget_exhausted = False

        clip_retry_limit = max(
            args.clip_retries,
            policy_int(
                policy,
                "maxClipRegenerations",
                2,
            ),
        )

        for row_index in range(
            attempted_count,
            len(
                utterances
            ),
        ):
            if adaptive_dataset_complete(
                policy,
                accepted_clips,
            ):
                break

            if accepted_duration_seconds(
                accepted_clips
            ) >= maximum_duration_seconds:
                break

            row = utterances[
                row_index
            ]

            accepted_this_row = False

            for regeneration in range(
                clip_retry_limit
                + 1
            ):
                if attempted_count >= attempt_budget:
                    budget_exhausted = True
                    break

                attempted_count += 1

                accepted_number = (
                    len(
                        accepted_clips
                    )
                    + 1
                )

                clip_id = (
                    f"clip_{accepted_number:03d}"
                )

                attempt_id = (
                    f"attempt_{attempted_count:04d}"
                )

                final_output = (
                    clips_dir
                    / f"{clip_id}.wav"
                )

                raw_output = (
                    raw_dir
                    / f"{attempt_id}.wav"
                )

                assert_job_active(
                    args,
                    headers,
                    job_id,
                )

                state[
                    "stage"
                ] = "generating"

                state[
                    "message"
                ] = (
                    f"Generating adaptive training candidate "
                    f"{attempt_id}; "
                    f"{accepted_duration_seconds(accepted_clips):.1f}s "
                    f"accepted."
                )

                checkpoint_job(
                    args,
                    headers,
                    job_id,
                    len(
                        accepted_clips
                    ),
                    attempt_budget,
                    state[
                        "message"
                    ],
                    state[
                        "stage"
                    ],
                    {
                        "currentClipId": clip_id,
                        "currentAttemptId": attempt_id,
                        "regeneration": regeneration,
                        "acceptedDurationSeconds": accepted_duration_seconds(
                            accepted_clips
                        ),
                        "targetDurationSeconds": target_duration_seconds,
                    },
                )

                try:
                    # Critical invariant:
                    # every candidate is directly conditioned on
                    # the original saved Character Voice Sample.
                    generate_clip(
                        tts,
                        source_path,
                        row[
                            "text"
                        ],
                        raw_output,
                        final_output,
                        args.clip_timeout_seconds,
                    )

                    state[
                        "stage"
                    ] = "validating_dataset"

                    state[
                        "message"
                    ] = (
                        f"Running transcript verification, "
                        f"speaker similarity, and audio quality QC "
                        f"for {clip_id}."
                    )

                    qc = evaluate_clip_quality_control(
                        args,
                        headers,
                        policy,
                        source_path,
                        final_output,
                        row[
                            "text"
                        ],
                    )

                    if qc.get(
                        "pass"
                    ) is not True:
                        rejection = {
                            "attemptId": attempt_id,
                            "clipId": clip_id,
                            "text": row[
                                "text"
                            ],
                            "coverage": row[
                                "coverage"
                            ],
                            "regeneration": regeneration,
                            "reasons": list(
                                qc.get(
                                    "reasons"
                                )
                                or []
                            ),
                            "qc": qc,
                            "rejectedAt": time.strftime(
                                "%Y-%m-%dT%H:%M:%SZ",
                                time.gmtime(),
                            ),
                        }

                        rejected_attempts.append(
                            rejection
                        )

                        log(
                            "[qc-reject] "
                            f"{attempt_id} "
                            + ", ".join(
                                rejection[
                                    "reasons"
                                ]
                            )
                        )

                        final_output.unlink(
                            missing_ok=True
                        )

                        raw_output.unlink(
                            missing_ok=True
                        )

                        if (
                            policy.get(
                                "regenerateRejectedClips"
                            )
                            is True
                            and regeneration < clip_retry_limit
                        ):
                            continue

                        break

                    duration = float(
                        (
                            qc.get(
                                "audioQuality"
                            )
                            or {}
                        ).get(
                            "durationSeconds"
                        )
                        or 0
                    )

                    proposed_duration = (
                        accepted_duration_seconds(
                            accepted_clips
                        )
                        + duration
                    )

                    if proposed_duration > maximum_duration_seconds:
                        rejection = {
                            "attemptId": attempt_id,
                            "clipId": clip_id,
                            "text": row[
                                "text"
                            ],
                            "coverage": row[
                                "coverage"
                            ],
                            "regeneration": regeneration,
                            "reasons": [
                                "accepted-duration-max"
                            ],
                            "qc": qc,
                            "rejectedAt": time.strftime(
                                "%Y-%m-%dT%H:%M:%SZ",
                                time.gmtime(),
                            ),
                        }

                        rejected_attempts.append(
                            rejection
                        )

                        final_output.unlink(
                            missing_ok=True
                        )

                        raw_output.unlink(
                            missing_ok=True
                        )

                        break

                    clip_hash = sha256(
                        final_output
                    )

                    if clip_hash in seen_hashes:
                        rejected_attempts.append(
                            {
                                "attemptId": attempt_id,
                                "clipId": clip_id,
                                "text": row[
                                    "text"
                                ],
                                "coverage": row[
                                    "coverage"
                                ],
                                "regeneration": regeneration,
                                "reasons": [
                                    "duplicate-audio"
                                ],
                                "qc": qc,
                                "rejectedAt": time.strftime(
                                    "%Y-%m-%dT%H:%M:%SZ",
                                    time.gmtime(),
                                ),
                            }
                        )

                        final_output.unlink(
                            missing_ok=True
                        )

                        raw_output.unlink(
                            missing_ok=True
                        )

                        if regeneration < clip_retry_limit:
                            continue

                        break

                    seen_hashes.add(
                        clip_hash
                    )

                    accepted_record = {
                        "clipId": clip_id,
                        "index": len(
                            accepted_clips
                        ),
                        "text": row[
                            "text"
                        ],
                        "emotion": row[
                            "emotion"
                        ],
                        "coverage": row[
                            "coverage"
                        ],
                        "status": "ready",
                        "expectedAudioPath": "",
                        "expectedAudioUrl": None,
                        "generatorSamplePath": str(
                            raw_output
                        ),
                        "generatorProvider": "indextts2",
                        "durationSeconds": duration,
                        "qc": qc,
                        "updatedAt": time.strftime(
                            "%Y-%m-%dT%H:%M:%SZ",
                            time.gmtime(),
                        ),
                    }

                    accepted_clips.append(
                        accepted_record
                    )

                    pending_upload.append(
                        final_output
                    )

                    last_local_accepted_path = (
                        final_output
                    )

                    accepted_this_row = True

                    current_duration = accepted_duration_seconds(
                        accepted_clips
                    )

                    state[
                        "generated_count"
                    ] = len(
                        accepted_clips
                    )

                    state[
                        "acceptedDurationSeconds"
                    ] = current_duration

                    state[
                        "stage"
                    ] = "validated"

                    state[
                        "message"
                    ] = (
                        f"Accepted {clip_id}; "
                        f"{current_duration:.1f}s "
                        f"of QC-passing speech."
                    )

                    checkpoint_job(
                        args,
                        headers,
                        job_id,
                        len(
                            accepted_clips
                        ),
                        attempt_budget,
                        state[
                            "message"
                        ],
                        state[
                            "stage"
                        ],
                        {
                            "currentClipId": clip_id,
                            "acceptedDurationSeconds": current_duration,
                            "acceptedMinutes": current_duration
                            / 60.0,
                            "targetDurationSeconds": target_duration_seconds,
                            "speakerSimilarity": qc.get(
                                "speakerSimilarity"
                            ),
                            "transcriptSimilarity": qc.get(
                                "transcriptSimilarity"
                            ),
                            "audioQuality": qc.get(
                                "audioQuality"
                            ),
                            "coverage": row[
                                "coverage"
                            ],
                        },
                    )

                    break

                except Exception as error:
                    rejection = {
                        "attemptId": attempt_id,
                        "clipId": clip_id,
                        "text": row[
                            "text"
                        ],
                        "coverage": row[
                            "coverage"
                        ],
                        "regeneration": regeneration,
                        "reasons": [
                            "generation-or-qc-error"
                        ],
                        "error": str(
                            error
                        ),
                        "rejectedAt": time.strftime(
                            "%Y-%m-%dT%H:%M:%SZ",
                            time.gmtime(),
                        ),
                    }

                    rejected_attempts.append(
                        rejection
                    )

                    log(
                        "[retry] "
                        f"{attempt_id} "
                        f"regeneration={regeneration} "
                        f"failed: {error}"
                    )

                    final_output.unlink(
                        missing_ok=True
                    )

                    raw_output.unlink(
                        missing_ok=True
                    )

                    if regeneration < clip_retry_limit:
                        time.sleep(
                            2
                        )
                        continue

                    break

            if budget_exhausted:
                break

            if not accepted_this_row:
                continue

            complete_now = adaptive_dataset_complete(
                policy,
                accepted_clips,
            )

            if (
                len(
                    pending_upload
                )
                >= args.upload_chunk_size
                or complete_now
            ):
                assert_job_active(
                    args,
                    headers,
                    job_id,
                )

                manifest = make_manifest(
                    owner_key,
                    character_id,
                    job_id,
                    source_ref,
                    accepted_clips,
                    rejected_attempts,
                    policy,
                    complete_now,
                )

                manifest_path.write_text(
                    json.dumps(
                        manifest,
                        indent=2,
                    ),
                    encoding="utf-8",
                )

                state[
                    "stage"
                ] = "uploading"

                state[
                    "message"
                ] = (
                    f"Uploading {len(pending_upload)} "
                    f"QC-passing adaptive clips."
                )

                last_upload = upload_batch(
                    args,
                    headers,
                    character_id,
                    job_id,
                    manifest,
                    source_path,
                    pending_upload,
                )

                remote_manifest = (
                    last_upload.get(
                        "manifest"
                    )
                    if isinstance(
                        last_upload.get(
                            "manifest"
                        ),
                        dict,
                    )
                    else {}
                )

                remote_clips = (
                    remote_manifest.get(
                        "clips"
                    )
                    if isinstance(
                        remote_manifest.get(
                            "clips"
                        ),
                        list,
                    )
                    else []
                )

                if remote_clips:
                    accepted_clips = [
                        dict(
                            clip
                        )
                        for clip in remote_clips
                        if isinstance(
                            clip,
                            dict,
                        )
                        and clean(
                            clip.get(
                                "status"
                            )
                        )
                        == "ready"
                        and isinstance(
                            clip.get(
                                "qc"
                            ),
                            dict,
                        )
                        and clip[
                            "qc"
                        ].get(
                            "pass"
                        )
                        is True
                    ]

                pending_upload = []

                log(
                    "[progress] "
                    f"accepted={len(accepted_clips)} "
                    f"seconds={accepted_duration_seconds(accepted_clips):.1f} "
                    f"rejected={len(rejected_attempts)}"
                )

                if complete_now:
                    break

        final_complete = adaptive_dataset_complete(
            policy,
            accepted_clips,
            allow_minimum=True,
        )

        final_duration = accepted_duration_seconds(
            accepted_clips
        )

        if not final_complete:
            raise WorkerError(
                "Adaptive IndexTTS2 dataset did not reach an "
                "acceptable 8-12 minute QC-passing corpus with "
                "required coverage before the attempt budget ended. "
                f"accepted={len(accepted_clips)}; "
                f"seconds={final_duration:.2f}; "
                f"minimum={minimum_duration_seconds:.2f}; "
                f"target={target_duration_seconds:.2f}; "
                f"maximum={maximum_duration_seconds:.2f}; "
                f"coverage={sorted(coverage_set(accepted_clips))}; "
                f"attempted={attempted_count}; "
                f"rejected={len(rejected_attempts)}."
            )

        final_manifest = make_manifest(
            owner_key,
            character_id,
            job_id,
            source_ref,
            accepted_clips,
            rejected_attempts,
            policy,
            True,
        )

        manifest_path.write_text(
            json.dumps(
                final_manifest,
                indent=2,
            ),
            encoding="utf-8",
        )

        final_upload_paths = list(
            pending_upload
        )

        if not final_upload_paths:
            if (
                last_local_accepted_path
                is not None
                and last_local_accepted_path.is_file()
            ):
                final_upload_paths = [
                    last_local_accepted_path
                ]
            elif accepted_clips:
                candidate = Path(
                    clean(
                        accepted_clips[
                            -1
                        ].get(
                            "expectedAudioPath"
                        )
                    )
                )

                if (
                    candidate.is_file()
                    and candidate.stat().st_size > 0
                ):
                    final_upload_paths = [
                        candidate
                    ]

        remote_is_complete = bool(
            last_upload
            and isinstance(
                last_upload.get(
                    "manifest"
                ),
                dict,
            )
            and last_upload[
                "manifest"
            ].get(
                "adaptiveComplete"
            )
            is True
        )

        if not remote_is_complete:
            if not final_upload_paths:
                raise WorkerError(
                    "Adaptive dataset is locally complete but "
                    "no accepted clip is available to finalize "
                    "the remote manifest."
                )

            last_upload = upload_batch(
                args,
                headers,
                character_id,
                job_id,
                final_manifest,
                source_path,
                final_upload_paths,
            )

        if last_upload is None:
            last_upload = {
                "manifest": final_manifest,
            }

        remote_manifest = assert_manifest_complete(
            last_upload,
            policy,
        )

        server_ready_count = remote_ready_count(
            last_upload
        )

        complete_result = {
            "mock": False,
            "adapter": "dataset_manifest",
            "provider": "indextts2",
            "remoteWorker": True,
            "platform": "linux",
            "workerId": args.worker_id,
            "clipCount": server_ready_count,
            "requestedClipCount": server_ready_count,
            "generatedClipCount": server_ready_count,
            "acceptedDurationSeconds": float(
                remote_manifest.get(
                    "acceptedDurationSeconds"
                )
                or final_duration
            ),
            "acceptedMinutes": float(
                remote_manifest.get(
                    "acceptedMinutes"
                )
                or (
                    final_duration
                    / 60.0
                )
            ),
            "adaptiveComplete": True,
            "qualityControl": remote_manifest.get(
                "qualityControl"
            ),
            "generationMode": "real",
            "referenceMode": "original-sample-only",
            "status": "voice_pack_ready",
            "localWorkDir": str(
                work_dir
            ),
            "manifestStatus": clean(
                remote_manifest.get(
                    "status"
                )
            ),
            "modelDir": str(
                Path(
                    args.model_dir
                )
                .expanduser()
                .resolve()
            ),
            "useFp16": args.use_fp16,
        }

        complete = request_json(
            "POST",
            build_url(
                args.base_url,
                "/api/characters/voice-pipeline/worker/complete",
            ),
            headers,
            {
                "jobId": job_id,
                "result": complete_result,
                "message": (
                    "Linux IndexTTS2 adaptive dataset ready: "
                    f"{complete_result['acceptedMinutes']:.2f} "
                    "QC-passing minutes."
                ),
            },
            timeout=args.upload_timeout_seconds,
        )

        log(
            f"[complete] {json.dumps(complete, indent=2)}"
        )

        return 0

    except TerminatedJob as error:
        log(
            f"[terminated] {error}"
        )
        return 0

    except Exception as error:
        text = (
            f"{error}" + chr(10) +
            f"{traceback.format_exc()}"
        )

        log(
            f"[error] {text}"
        )

        if job_id and owner_key:
            mark_failed(
                args,
                auth_headers(
                    args,
                    owner_key,
                ),
                job_id,
                text,
            )

        return 1

    finally:
        if heartbeat is not None:
            heartbeat.stop()

        if tts is not None:
            try:
                del tts
            except Exception:
                pass

        gc.collect()

        if torch_module is not None:
            try:
                torch_module.cuda.empty_cache()
                torch_module.cuda.ipc_collect()
            except Exception as error:
                log(
                    "[warn] Could not fully clear "
                    f"IndexTTS2 CUDA cache: {error}"
                )

        if gpu_lock is not None:
            try:
                fcntl.flock(
                    gpu_lock.fileno(),
                    fcntl.LOCK_UN,
                )

                gpu_lock.close()

                log(
                    "[gpu-lock] Released shared voice GPU lock."
                )

            except Exception as error:
                log(
                    "[warn] Could not release GPU lock cleanly: "
                    f"{error}"
                )


def main() -> int:
    parser = argparse.ArgumentParser(description="Dedicated Linux IndexTTS2 training-dataset worker")
    repo_root = Path(__file__).resolve().parents[2]
    parser.add_argument("--base-url", default=os.environ.get("OTG_BASE_URL", "http://100.75.162.64:3001"))
    parser.add_argument("--device-id", default=os.environ.get("OTG_DEVICE_ID", "linux-indextts2"))
    parser.add_argument("--worker-id", default=os.environ.get("OTG_WORKER_ID", "linux-indextts2-dataset-worker"))
    parser.add_argument("--worker-token", default=os.environ.get("OTG_WORKER_TOKEN", ""))
    parser.add_argument("--index-root", default=os.environ.get("INDEXTTS2_ROOT", "/home/shawn-rochford/AI/runtime/test/IndexTTS2"))
    parser.add_argument("--model-dir", default=os.environ.get("INDEXTTS2_MODEL_DIR", "/home/shawn-rochford/AI/runtime/test/IndexTTS2/checkpoints"))
    parser.add_argument("--work-root", default=os.environ.get("OTG_INDEXTTS2_WORK_ROOT", "/home/shawn-rochford/AI/runtime/test/indextts2-datasets"))
    parser.add_argument("--comfy-url", default=os.environ.get("OTG_PRIMARY_COMFY_URL", "http://100.75.162.64:8188"))
    parser.add_argument("--upload-chunk-size", type=int, default=int(os.environ.get("OTG_INDEXTTS2_UPLOAD_CHUNK_SIZE", "5")))
    parser.add_argument("--max-clips", type=int, default=int(os.environ.get("OTG_INDEXTTS2_MAX_CLIPS", "0")))
    parser.add_argument("--clip-retries", type=int, default=int(os.environ.get("OTG_INDEXTTS2_CLIP_RETRIES", "2")))
    parser.add_argument("--clip-timeout-seconds", type=int, default=int(os.environ.get("OTG_INDEXTTS2_CLIP_TIMEOUT_SECONDS", "900")))
    parser.add_argument("--upload-timeout-seconds", type=int, default=int(os.environ.get("OTG_INDEXTTS2_UPLOAD_TIMEOUT_SECONDS", "1800")))
    parser.add_argument("--download-timeout-seconds", type=int, default=int(os.environ.get("OTG_INDEXTTS2_DOWNLOAD_TIMEOUT_SECONDS", "600")))
    parser.add_argument("--poll-seconds", type=int, default=int(os.environ.get("OTG_INDEXTTS2_POLL_SECONDS", "10")))
    parser.add_argument("--heartbeat-seconds", type=int, default=int(os.environ.get("OTG_INDEXTTS2_HEARTBEAT_SECONDS", "30")))
    parser.add_argument("--comfy-poll-seconds", type=int, default=int(os.environ.get("OTG_INDEXTTS2_COMFY_POLL_SECONDS", "5")))
    parser.add_argument("--comfy-idle-timeout-seconds", type=int, default=int(os.environ.get("OTG_INDEXTTS2_COMFY_IDLE_TIMEOUT_SECONDS", "1800")))
    parser.add_argument("--min-free-vram-mib", type=int, default=int(os.environ.get("OTG_INDEXTTS2_MIN_FREE_VRAM_MIB", "16384")))
    parser.add_argument("--vram-wait-seconds", type=int, default=int(os.environ.get("OTG_INDEXTTS2_VRAM_WAIT_SECONDS", "180")))
    parser.add_argument("--gpu-lock-file", default=os.environ.get("OTG_VOICE_GPU_LOCK_FILE", "/home/shawn-rochford/AI/runtime/test/voice-gpu.lock"))
    parser.add_argument("--use-fp16", action="store_true", default=truthy(os.environ.get("INDEXTTS2_USE_FP16", "0")))
    parser.add_argument(
        "--policy-path",
        default=os.environ.get(
            "VOICE_TRAINING_POLICY_PATH",
            str(repo_root / "config" / "voice-training-policy.json"),
        ),
    )
    parser.add_argument(
        "--speaker-qc-python",
        default=os.environ.get(
            "OTG_VOICE_QC_PYTHON",
            "/home/shawn-rochford/AI/runtime/test/voice-qc/speechbrain-ecapa/venv/bin/python",
        ),
    )
    parser.add_argument(
        "--speaker-qc-script",
        default=os.environ.get(
            "OTG_VOICE_QC_SCRIPT",
            str(repo_root / "scripts" / "linux" / "otg-voice-speaker-qc.py"),
        ),
    )
    parser.add_argument(
        "--speaker-qc-model-dir",
        default=os.environ.get(
            "OTG_VOICE_QC_MODEL_DIR",
            "/home/shawn-rochford/AI/runtime/test/voice-qc/speechbrain-ecapa/models/spkrec-ecapa-voxceleb",
        ),
    )
    parser.add_argument(
        "--speaker-qc-hf-home",
        default=os.environ.get(
            "OTG_VOICE_QC_HF_HOME",
            "/home/shawn-rochford/AI/runtime/test/voice-qc/speechbrain-ecapa/hf-cache",
        ),
    )
    parser.add_argument(
        "--qc-timeout-seconds",
        type=int,
        default=int(
            os.environ.get(
                "OTG_VOICE_QC_TIMEOUT_SECONDS",
                "300",
            )
        ),
    )
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--regenerate", action="store_true")
    args = parser.parse_args()

    if not args.worker_token:
        raise WorkerError("Missing OTG_WORKER_TOKEN. The Linux IndexTTS2 worker requires token-protected universal claim.")
    if args.upload_chunk_size < 1 or args.upload_chunk_size > 25:
        raise WorkerError("OTG_INDEXTTS2_UPLOAD_CHUNK_SIZE must be between 1 and 25.")
    if args.clip_retries < 0 or args.clip_retries > 10:
        raise WorkerError("OTG_INDEXTTS2_CLIP_RETRIES must be between 0 and 10.")

    if not Path(args.policy_path).expanduser().is_file():
        raise WorkerError(
            f"VOICE_TRAINING_POLICY_PATH is missing: {args.policy_path}"
        )

    if not Path(args.speaker_qc_python).expanduser().is_file():
        raise WorkerError(
            f"OTG_VOICE_QC_PYTHON is missing: {args.speaker_qc_python}"
        )

    if not Path(args.speaker_qc_script).expanduser().is_file():
        raise WorkerError(
            f"OTG_VOICE_QC_SCRIPT is missing: {args.speaker_qc_script}"
        )

    if not Path(args.speaker_qc_model_dir).expanduser().is_dir():
        raise WorkerError(
            f"OTG_VOICE_QC_MODEL_DIR is missing: {args.speaker_qc_model_dir}"
        )

    if args.qc_timeout_seconds < 10:
        raise WorkerError(
            "OTG_VOICE_QC_TIMEOUT_SECONDS must be at least 10."
        )

    while True:
        code = process_one(args)
        if args.once:
            return code
        time.sleep(max(2, args.poll_seconds))


if __name__ == "__main__":
    raise SystemExit(main())
