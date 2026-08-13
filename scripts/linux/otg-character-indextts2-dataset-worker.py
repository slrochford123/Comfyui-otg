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
]

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


def clamp_clip_count(value: Any, fallback: int = 200) -> int:
    try:
        number = int(float(value))
    except Exception:
        number = fallback
    return max(1, min(200, number))


def build_utterances(count: int) -> List[Dict[str, str]]:
    rows: List[Dict[str, str]] = []
    for index in range(count):
        emotion, text = EMOTION_UTTERANCES[index % len(EMOTION_UTTERANCES)]
        take = index // len(EMOTION_UTTERANCES) + 1
        if take > 1:
            text = f"{text} Take {take}, keep the same character voice with {emotion} delivery."
        rows.append({"emotion": emotion, "text": text})
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
    if requested_count > 0:
        progress = max(5, min(99, int((generated_count / requested_count) * 100)))
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


def make_manifest(
    owner_key: str,
    character_id: str,
    job_id: str,
    source_ref: str,
    utterances: List[Dict[str, str]],
    ready_count: int,
) -> Dict[str, Any]:
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    clips = []
    for index, row in enumerate(utterances):
        clip_number = index + 1
        clip_id = f"clip_{clip_number:03d}"
        ready = clip_number <= ready_count
        clips.append(
            {
                "clipId": clip_id,
                "index": index,
                "text": row["text"],
                "emotion": row["emotion"],
                "status": "ready" if ready else "pending",
                "expectedAudioPath": "",
                "expectedAudioUrl": None,
                "generatorProvider": "indextts2" if ready else None,
                "updatedAt": now,
            }
        )

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
        },
        "logs": {},
        "generationMode": "real",
        "provider": "indextts2",
        "startedAt": now,
        "completedAt": now if ready_count == len(utterances) else None,
        "requestedClipCount": len(utterances),
        "generatedClipCount": ready_count,
        "clips": clips,
        "status": "voice_pack_ready" if ready_count == len(utterances) else "manifest_ready",
        "mock": False,
        "note": "Generated on the Linux RTX 3090 IndexTTS2 dataset worker using varied phrase prompts.",
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


def assert_manifest_complete(upload_response: Dict[str, Any], requested_count: int) -> Dict[str, Any]:
    manifest = upload_response.get("manifest")
    if not isinstance(manifest, dict):
        raise WorkerError("Remote upload did not return a training dataset manifest.")
    ready_count = remote_ready_count(upload_response)
    generated_count = int(manifest.get("generatedClipCount") or ready_count or 0)
    if manifest.get("generationMode") != "real" or manifest.get("provider") != "indextts2":
        raise WorkerError("Remote manifest is not a real IndexTTS2 dataset manifest.")
    if generated_count < requested_count or ready_count < requested_count:
        raise WorkerError(
            f"Remote manifest is incomplete: ready={ready_count}, generated={generated_count}, requested={requested_count}."
        )
    if manifest.get("status") != "voice_pack_ready":
        raise WorkerError(f"Remote manifest status is not voice_pack_ready: {manifest.get('status')}")
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
            build_url(args.base_url, "/api/worker/jobs/claim"),
            headers,
            {
                "jobType": "character_voice_pipeline",
                "action": "generate_training_dataset",
                "claimScope": "all_owners",
                "workerId": args.worker_id,
            },
        )
        job = claim.get("job")
        if not isinstance(job, dict):
            log("[idle] No queued generate_training_dataset job available.")
            return 0

        job_id = clean(job.get("jobId"))
        owner_key = clean(job.get("ownerKey") or job.get("owner_key"))
        character_id = clean(job.get("characterId"))
        job_input = job.get("input") if isinstance(job.get("input"), dict) else {}
        if not job_id or not owner_key or not character_id:
            raise WorkerError(f"Invalid claimed dataset job: {job}")

        headers = auth_headers(args, owner_key)
        requested_count = clamp_clip_count(job_input.get("requestedClipCount") or job_input.get("clipCount"), 200)
        if args.max_clips > 0:
            requested_count = min(requested_count, args.max_clips)
        utterances = build_utterances(requested_count)

        work_dir = Path(args.work_root).expanduser().resolve() / owner_key / character_id / job_id
        clips_dir = work_dir / "clips"
        raw_dir = work_dir / "raw"
        manifest_path = work_dir / "manifest.json"
        work_dir.mkdir(parents=True, exist_ok=True)
        clips_dir.mkdir(parents=True, exist_ok=True)
        raw_dir.mkdir(parents=True, exist_ok=True)

        job_result = job.get("result") if isinstance(job.get("result"), dict) else {}
        try:
            server_ready_count = max(0, min(requested_count, int(job_result.get("generatedClipCount") or 0)))
        except Exception:
            server_ready_count = 0

        state: Dict[str, Any] = {
            "generated_count": server_ready_count,
            "stage": "claimed",
            "message": "Linux IndexTTS2 dataset worker claimed the job.",
        }
        heartbeat = Heartbeat(args, headers, job_id, requested_count, state)
        heartbeat.start()
        checkpoint_job(
            args,
            headers,
            job_id,
            server_ready_count,
            requested_count,
            state["message"],
            state["stage"],
        )
        log(
            f"[claim] job={job_id} owner={owner_key} character={character_id} "
            f"clips={requested_count} serverReady={server_ready_count}"
        )

        source_path, source_ref = resolve_source_sample(args, headers, job_input, work_dir)
        state["stage"] = "source_ready"
        state["message"] = "Approved voice reference is normalized and ready."
        checkpoint_job(
            args,
            headers,
            job_id,
            server_ready_count,
            requested_count,
            state["message"],
            state["stage"],
            {"sourceBytes": source_path.stat().st_size},
        )

        gpu_lock = acquire_gpu_lock(args, headers, job_id, state, requested_count)
        wait_for_comfy_idle(args, headers, job_id, state, requested_count)
        release_comfy_models(args)
        free = wait_for_free_vram(args)
        log(f"[gpu] RTX 3090 free VRAM before IndexTTS2: {free if free is not None else 'unknown'} MiB")

        state["stage"] = "loading_model"
        state["message"] = "Loading the official IndexTTS2 model on the Linux RTX 3090 worker."
        checkpoint_job(
            args,
            headers,
            job_id,
            server_ready_count,
            requested_count,
            state["message"],
            state["stage"],
            {"freeVramMiB": free, "useFp16": args.use_fp16},
        )
        tts, torch_module = load_indextts2(args)
        log("[model] Official IndexTTS2 model loaded.")

        pending_upload: List[Path] = []
        seen_hashes: set[str] = set()
        last_upload: Dict[str, Any] | None = None

        for index, row in enumerate(utterances, start=1):
            clip_id = f"clip_{index:03d}"
            final_output = clips_dir / f"{clip_id}.wav"
            raw_output = raw_dir / f"{clip_id}.wav"
            assert_job_active(args, headers, job_id)

            if index <= server_ready_count and not args.regenerate:
                log(f"[remote-skip] {clip_id}")
                continue

            if final_output.is_file() and final_output.stat().st_size > 1024 and not args.regenerate:
                log(f"[local-resume] {clip_id}")
            else:
                last_error: Exception | None = None
                for attempt in range(1, args.clip_retries + 2):
                    try:
                        state["stage"] = "generating"
                        state["message"] = f"Generating {clip_id}: {index} / {requested_count}."
                        checkpoint_job(
                            args,
                            headers,
                            job_id,
                            max(server_ready_count, index - 1),
                            requested_count,
                            state["message"],
                            state["stage"],
                            {"currentClipId": clip_id, "attempt": attempt},
                        )
                        generate_clip(
                            tts,
                            source_path,
                            row["text"],
                            raw_output,
                            final_output,
                            args.clip_timeout_seconds,
                        )
                        last_error = None
                        break
                    except Exception as error:
                        last_error = error
                        log(f"[retry] {clip_id} attempt={attempt} failed: {error}")
                        final_output.unlink(missing_ok=True)
                        raw_output.unlink(missing_ok=True)
                        if attempt <= args.clip_retries:
                            time.sleep(2)
                if last_error is not None:
                    raise WorkerError(f"IndexTTS2 failed for {clip_id} after {args.clip_retries + 1} attempts: {last_error}")

            clip_hash = sha256(final_output)
            if clip_hash in seen_hashes:
                raise WorkerError(f"Generated duplicate WAV content detected at {clip_id}; refusing to mark dataset real.")
            seen_hashes.add(clip_hash)
            pending_upload.append(final_output)

            local_ready = max(server_ready_count, index)
            state["generated_count"] = local_ready
            state["stage"] = "generated"
            state["message"] = f"Generated {local_ready} / {requested_count} IndexTTS2 clips."
            checkpoint_job(
                args,
                headers,
                job_id,
                local_ready,
                requested_count,
                state["message"],
                state["stage"],
                {"currentClipId": clip_id, "outputBytes": final_output.stat().st_size},
            )

            if len(pending_upload) >= args.upload_chunk_size:
                assert_job_active(args, headers, job_id)
                manifest = make_manifest(owner_key, character_id, job_id, source_ref, utterances, local_ready)
                manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
                state["stage"] = "uploading"
                state["message"] = f"Uploading clips through {clip_id}."
                last_upload = upload_batch(
                    args,
                    headers,
                    character_id,
                    job_id,
                    manifest,
                    source_path,
                    pending_upload,
                )
                server_ready_count = remote_ready_count(last_upload)
                state["generated_count"] = server_ready_count
                log(f"[progress] server ready {server_ready_count}/{requested_count}")
                pending_upload = []

        if pending_upload:
            assert_job_active(args, headers, job_id)
            local_ready = max(server_ready_count, max(int(path.stem.split("_")[-1]) for path in pending_upload))
            manifest = make_manifest(owner_key, character_id, job_id, source_ref, utterances, local_ready)
            manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
            state["stage"] = "uploading"
            state["message"] = f"Uploading the final IndexTTS2 batch through clip {local_ready}."
            last_upload = upload_batch(
                args,
                headers,
                character_id,
                job_id,
                manifest,
                source_path,
                pending_upload,
            )
            server_ready_count = remote_ready_count(last_upload)
            state["generated_count"] = server_ready_count

        if server_ready_count < requested_count:
            raise WorkerError(
                f"IndexTTS2 generation ended before the server had all clips: {server_ready_count}/{requested_count}."
            )

        if last_upload is not None:
            remote_manifest = assert_manifest_complete(last_upload, requested_count)
            manifest_status = clean(remote_manifest.get("status"))
        else:
            manifest_status = clean(job_result.get("status"))
            if manifest_status != "voice_pack_ready":
                raise WorkerError(
                    "Server reported all clips ready, but the claimed job result is not voice_pack_ready. "
                    "Resume the job after checking its manifest."
                )

        complete_result = {
            "mock": False,
            "adapter": "dataset_manifest",
            "provider": "indextts2",
            "remoteWorker": True,
            "platform": "linux",
            "workerId": args.worker_id,
            "clipCount": requested_count,
            "requestedClipCount": requested_count,
            "generatedClipCount": server_ready_count,
            "generationMode": "real",
            "status": "voice_pack_ready",
            "localWorkDir": str(work_dir),
            "manifestStatus": manifest_status,
            "modelDir": str(Path(args.model_dir).expanduser().resolve()),
            "useFp16": args.use_fp16,
        }
        complete = request_json(
            "POST",
            build_url(args.base_url, "/api/characters/voice-pipeline/worker/complete"),
            headers,
            {
                "jobId": job_id,
                "result": complete_result,
                "message": f"Linux IndexTTS2 dataset ready for review: {server_ready_count}/{requested_count} clips.",
            },
            timeout=args.upload_timeout_seconds,
        )
        log(f"[complete] {json.dumps(complete, indent=2)}")
        return 0

    except TerminatedJob as error:
        log(f"[terminated] {error}")
        return 0
    except Exception as error:
        text = f"{error}\n{traceback.format_exc()}"
        log(f"[error] {text}")
        if job_id and owner_key:
            mark_failed(args, auth_headers(args, owner_key), job_id, text)
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
                log(f"[warn] Could not fully clear IndexTTS2 CUDA cache: {error}")
        if gpu_lock is not None:
            try:
                fcntl.flock(gpu_lock.fileno(), fcntl.LOCK_UN)
                gpu_lock.close()
                log("[gpu-lock] Released shared voice GPU lock.")
            except Exception as error:
                log(f"[warn] Could not release GPU lock cleanly: {error}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Dedicated Linux IndexTTS2 training-dataset worker")
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
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--regenerate", action="store_true")
    args = parser.parse_args()

    if not args.worker_token:
        raise WorkerError("Missing OTG_WORKER_TOKEN. The Linux IndexTTS2 worker requires token-protected universal claim.")
    if args.upload_chunk_size < 1 or args.upload_chunk_size > 25:
        raise WorkerError("OTG_INDEXTTS2_UPLOAD_CHUNK_SIZE must be between 1 and 25.")
    if args.clip_retries < 0 or args.clip_retries > 10:
        raise WorkerError("OTG_INDEXTTS2_CLIP_RETRIES must be between 0 and 10.")

    while True:
        code = process_one(args)
        if args.once:
            return code
        time.sleep(max(2, args.poll_seconds))


if __name__ == "__main__":
    raise SystemExit(main())
