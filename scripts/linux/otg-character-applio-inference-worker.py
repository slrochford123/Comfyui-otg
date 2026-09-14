#!/usr/bin/env python3
"""Linux Applio inference worker for ComfyUI-OTG TEST.

Claims only character_voice_pipeline/test_trained_voice jobs. The worker uses the
installed Applio virtual environment as a subprocess, serializes RTX 3090 access
through the shared voice GPU lock, waits for ComfyUI to become idle, uploads the
real WAV through the existing application route, and completes the durable job.
"""
from __future__ import annotations

import argparse
import fcntl
import hashlib
import json
import os
import signal
import shutil
import subprocess
import sys
import time
import traceback
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Dict, Optional

TERMINAL_STATUSES = {"canceled", "cancelled", "terminated", "completed", "ready_for_review"}


class TerminatedJob(RuntimeError):
    pass


def log(message: str) -> None:
    print(message, flush=True)


def clean(value: Any) -> str:
    return str(value or "").strip()


def safe_segment(value: Any) -> str:
    raw = clean(value) or "item"
    return "".join(ch if ch.isalnum() or ch in "._-" else "-" for ch in raw)[:160] or "item"


def has_bytes(path: Path) -> bool:
    try:
        return path.is_file() and path.stat().st_size > 0
    except OSError:
        return False


def now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def build_url(base_url: str, path_or_url: str) -> str:
    value = clean(path_or_url)
    if value.startswith("http://") or value.startswith("https://"):
        return value
    return urllib.parse.urljoin(base_url.rstrip("/") + "/", value.lstrip("/"))


def request_json(
    method: str,
    url: str,
    headers: Optional[Dict[str, str]] = None,
    payload: Optional[Dict[str, Any]] = None,
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
        raise RuntimeError(f"HTTP {error.code} {url}: {raw}") from error


def auth_headers(args: argparse.Namespace, owner_key: str | None = None) -> Dict[str, str]:
    headers = {
        "x-otg-device-id": args.device_id,
        "x-otg-worker-id": args.worker_id,
    }
    if owner_key:
        headers["x-otg-owner-key"] = owner_key
    if clean(args.worker_token):
        headers["authorization"] = f"Bearer {clean(args.worker_token)}"
    return headers


def claim_job(args: argparse.Namespace) -> Dict[str, Any] | None:
    response = request_json(
        "POST",
        build_url(args.base_url, "/api/worker/jobs/claim"),
        auth_headers(args),
        {
            "jobType": "character_voice_pipeline",
            "action": "test_trained_voice",
            "claimScope": "all_owners",
            "workerId": args.worker_id,
        },
        timeout=60,
    )
    job = response.get("job")
    return job if isinstance(job, dict) else None


def fetch_job(args: argparse.Namespace, owner_key: str, job_id: str) -> Dict[str, Any]:
    response = request_json(
        "GET",
        build_url(args.base_url, f"/api/characters/voice-pipeline/{urllib.parse.quote(job_id)}"),
        auth_headers(args, owner_key),
        timeout=60,
    )
    job = response.get("job")
    return job if isinstance(job, dict) else {}


def assert_job_active(args: argparse.Namespace, owner_key: str, job_id: str) -> None:
    status = clean(fetch_job(args, owner_key, job_id).get("status"))
    if status in TERMINAL_STATUSES:
        raise TerminatedJob(f"Applio inference job {job_id} is no longer active; status={status}.")


def checkpoint(
    args: argparse.Namespace,
    owner_key: str,
    job_id: str,
    progress: int,
    stage: str,
    message: str,
    result: Dict[str, Any],
) -> None:
    try:
        request_json(
            "POST",
            build_url(args.base_url, "/api/worker/jobs/checkpoint"),
            auth_headers(args, owner_key),
            {
                "jobId": job_id,
                "progress": max(1, min(99, int(progress))),
                "message": message,
                "result": {
                    **result,
                    "remoteWorker": True,
                    "workerId": args.worker_id,
                    "adapter": "applio_real_inference",
                    "mock": False,
                    "status": "running",
                    "currentStage": stage,
                },
            },
            timeout=60,
        )
    except Exception as error:
        log(f"[warn] checkpoint failed for {job_id}: {error}")


def complete_job(args: argparse.Namespace, owner_key: str, job_id: str, result: Dict[str, Any]) -> None:
    request_json(
        "POST",
        build_url(args.base_url, "/api/worker/jobs/complete"),
        auth_headers(args, owner_key),
        {
            "jobId": job_id,
            "result": result,
            "message": f"Linux Applio inference completed. outputAudioUrl: {result.get('outputAudioUrl', '')}",
        },
        timeout=120,
    )


def fail_job(args: argparse.Namespace, owner_key: str, job_id: str, error: str, result: Dict[str, Any]) -> None:
    request_json(
        "POST",
        build_url(args.base_url, "/api/worker/jobs/fail"),
        auth_headers(args, owner_key),
        {"jobId": job_id, "error": error, "message": error, "result": result},
        timeout=120,
    )


def download_file(args: argparse.Namespace, owner_key: str, path_or_url: str, target: Path) -> Path:
    target.parent.mkdir(parents=True, exist_ok=True)
    request = urllib.request.Request(
        build_url(args.base_url, path_or_url),
        headers=auth_headers(args, owner_key),
        method="GET",
    )
    with urllib.request.urlopen(request, timeout=180) as response, target.open("wb") as output:
        while True:
            chunk = response.read(1024 * 1024)
            if not chunk:
                break
            output.write(chunk)
    if not has_bytes(target):
        raise RuntimeError(f"Downloaded input audio is empty: {target}")
    return target


def multipart_upload(
    url: str,
    fields: Dict[str, str],
    files: Dict[str, Path],
    headers: Dict[str, str],
    timeout: int = 300,
) -> Dict[str, Any]:
    boundary = "----otg-linux-applio-" + hashlib.sha256(f"{time.time()}-{os.getpid()}".encode()).hexdigest()
    body = bytearray()

    def part_header(name: str, filename: str | None = None, content_type: str | None = None) -> None:
        body.extend(f"--{boundary}\r\n".encode())
        if filename:
            body.extend(f'Content-Disposition: form-data; name="{name}"; filename="{filename}"\r\n'.encode())
            body.extend(f"Content-Type: {content_type or 'application/octet-stream'}\r\n\r\n".encode())
        else:
            body.extend(f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode())

    for name, value in fields.items():
        part_header(name)
        body.extend(str(value).encode("utf-8"))
        body.extend(b"\r\n")
    for name, path in files.items():
        if not has_bytes(path):
            continue
        part_header(name, path.name, "application/octet-stream")
        body.extend(path.read_bytes())
        body.extend(b"\r\n")
    body.extend(f"--{boundary}--\r\n".encode())

    request_headers = dict(headers)
    request_headers["content-type"] = f"multipart/form-data; boundary={boundary}"
    request_headers["content-length"] = str(len(body))
    request = urllib.request.Request(url, data=bytes(body), headers=request_headers, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read()
            return json.loads(raw.decode("utf-8")) if raw else {}
    except urllib.error.HTTPError as error:
        raw = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {error.code} {url}: {raw}") from error


def wait_for_comfy_idle(args: argparse.Namespace, owner_key: str, job_id: str) -> None:
    deadline = time.time() + max(30, args.comfy_idle_timeout_seconds)
    last_log = 0.0
    while True:
        queue = request_json("GET", build_url(args.comfy_url, "/queue"), timeout=30)
        running = len(queue.get("queue_running") or [])
        pending = len(queue.get("queue_pending") or [])
        if running == 0 and pending == 0:
            log("[gpu] RTX 3090 ComfyUI queue is idle.")
            return
        assert_job_active(args, owner_key, job_id)
        checkpoint(
            args,
            owner_key,
            job_id,
            5,
            "waiting_for_comfy",
            "Waiting for the RTX 3090 ComfyUI queue before Applio inference.",
            {"comfyRunning": running, "comfyPending": pending},
        )
        if time.time() >= deadline:
            raise RuntimeError(f"Timed out waiting for RTX 3090 ComfyUI. running={running}; pending={pending}")
        if time.time() - last_log >= 20:
            log(f"[wait] RTX 3090 ComfyUI running={running} pending={pending}")
            last_log = time.time()
        time.sleep(5)


def release_comfy_models(args: argparse.Namespace) -> None:
    try:
        response = request_json(
            "POST",
            build_url(args.comfy_url, "/free"),
            payload={"unload_models": True, "free_memory": True},
            timeout=60,
        )
        log(f"[gpu] Requested ComfyUI model release: {json.dumps(response)}")
    except Exception as error:
        log(f"[warn] ComfyUI /free request failed; continuing: {error}")


def acquire_gpu_lock(args: argparse.Namespace, owner_key: str, job_id: str):
    path = Path(args.gpu_lock_file).expanduser()
    path.parent.mkdir(parents=True, exist_ok=True)
    handle = path.open("a+")
    deadline = time.time() + max(60, args.gpu_lock_wait_seconds)
    log(f"[gpu-lock] Waiting for shared voice GPU lock: {path}")
    while True:
        try:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            handle.seek(0)
            handle.truncate()
            handle.write(f"linux-applio-inference-worker pid={os.getpid()} job={job_id} acquired={time.time()}\n")
            handle.flush()
            log(f"[gpu-lock] Acquired shared voice GPU lock: {path}")
            return handle
        except BlockingIOError:
            assert_job_active(args, owner_key, job_id)
            checkpoint(
                args,
                owner_key,
                job_id,
                5,
                "waiting_for_gpu_lock",
                "Waiting for the shared RTX 3090 voice GPU lock before Applio inference.",
                {},
            )
            if time.time() >= deadline:
                handle.close()
                raise RuntimeError(f"Timed out waiting for shared voice GPU lock: {path}")
            time.sleep(5)


def kill_process_group(process: subprocess.Popen[Any]) -> None:
    if process.poll() is not None:
        return
    try:
        os.killpg(os.getpgid(process.pid), signal.SIGTERM)
        process.wait(timeout=15)
    except Exception:
        try:
            os.killpg(os.getpgid(process.pid), signal.SIGKILL)
        except Exception:
            process.kill()


def run_command(
    args: argparse.Namespace,
    owner_key: str,
    job_id: str,
    command: list[str],
    cwd: Path,
    stdout_path: Path,
    stderr_path: Path,
    base_result: Dict[str, Any],
) -> None:
    stdout_path.parent.mkdir(parents=True, exist_ok=True)
    with stdout_path.open("a", encoding="utf-8") as stdout_file, stderr_path.open("a", encoding="utf-8") as stderr_file:
        stdout_file.write(f"[{now_iso()}] START infer: {' '.join(command)}\n")
        stdout_file.flush()
        process = subprocess.Popen(
            command,
            cwd=str(cwd),
            stdout=stdout_file,
            stderr=stderr_file,
            text=True,
            start_new_session=True,
        )
        started = time.time()
        try:
            while process.poll() is None:
                if time.time() - started >= args.inference_timeout_seconds:
                    kill_process_group(process)
                    raise RuntimeError(f"Applio inference timed out after {args.inference_timeout_seconds} seconds.")
                time.sleep(max(3, args.heartbeat_seconds))
                assert_job_active(args, owner_key, job_id)
                checkpoint(
                    args,
                    owner_key,
                    job_id,
                    65,
                    "applio_inference",
                    "Linux Applio inference is running.",
                    base_result,
                )
        except BaseException:
            kill_process_group(process)
            raise
        stdout_file.write(f"[{now_iso()}] EXIT infer: {process.returncode}\n")
    if process.returncode != 0:
        raise RuntimeError(
            f"Applio inference exited with code {process.returncode}. stdout: {stdout_path}; stderr: {stderr_path}"
        )



# OTG_TYPED_TEST_VOICE_INDEXTTS2_V2
def generate_typed_source_speech(
    args: argparse.Namespace,
    owner_key: str,
    job_id: str,
    job_input: Dict[str, Any],
    reference_audio: Path,
    work_dir: Path,
) -> tuple[Path, Dict[str, Any]]:
    speech_text = clean(job_input.get("text"))

    if not speech_text:
        raise RuntimeError("Typed Test Voice requires non-empty text.")

    index_root = Path(args.indextts2_root).expanduser().resolve()
    index_python = Path(args.indextts2_python).expanduser().resolve()
    index_cfg = Path(args.indextts2_cfg).expanduser().resolve()
    index_model_dir = Path(args.indextts2_model_dir).expanduser().resolve()
    bridge = Path(args.indextts2_bridge).expanduser().resolve()

    if not index_root.is_dir():
        raise RuntimeError(f"IndexTTS2 root is missing: {index_root}")
    if not index_python.is_file():
        raise RuntimeError(f"IndexTTS2 Python is missing: {index_python}")
    if not index_cfg.is_file():
        raise RuntimeError(f"IndexTTS2 config is missing: {index_cfg}")
    if not index_model_dir.is_dir():
        raise RuntimeError(f"IndexTTS2 model directory is missing: {index_model_dir}")
    if not bridge.is_file():
        raise RuntimeError(
            f"IndexTTS2 single-utterance bridge is missing: {bridge}"
        )
    if not has_bytes(reference_audio):
        raise RuntimeError(
            f"Typed Test Voice reference audio is missing: {reference_audio}"
        )

    source_dir = work_dir / "source-speech"
    source_dir.mkdir(parents=True, exist_ok=True)

    input_audio = source_dir / "typed-source.wav"
    request_path = source_dir / "indextts2-single-utterance.json"
    stdout_path = source_dir / "indextts2-stdout.log"
    stderr_path = source_dir / "indextts2-stderr.log"

    request_payload = {
        "referenceWav": str(reference_audio),
        "outputDir": str(source_dir),
        "clips": [
            {
                "id": "typed_test_voice",
                "text": speech_text,
                "delivery": "neutral",
                "outputPath": str(input_audio),
            }
        ],

        # Audit marker. The bridge itself enforces this in IndexTTS2.infer().
        "use_random=False": True,
    }

    request_path.write_text(
        json.dumps(request_payload, indent=2),
        encoding="utf-8",
    )

    command = [
        str(index_python),
        str(bridge),
        "--params-json",
        str(request_path),
    ]

    env = os.environ.copy()
    env.update(
        {
            "INDEXTTS2_ROOT": str(index_root),
            "INDEXTTS2_PYTHON": str(index_python),
            "INDEXTTS2_CFG": str(index_cfg),
            "INDEXTTS2_MODEL_DIR": str(index_model_dir),
            # OTG_INDEXTTS2_CHILD_ENV_V1
            "VIRTUAL_ENV": str(index_root / ".venv"),
            "PATH": (
                str(index_root / ".venv" / "bin")
                + os.pathsep
                + os.environ.get("PATH", "")
            ),
            "PYTHONPATH": (
                str(
                    index_root
                    / ".venv"
                    / "lib"
                    / "python3.11"
                    / "site-packages"
                )
                + os.pathsep
                + str(index_root)
                + (
                    os.pathsep + os.environ.get("PYTHONPATH", "")
                    if os.environ.get("PYTHONPATH")
                    else ""
                )
            ),
            "INDEXTTS2_USE_FP16": "0",
            "INDEXTTS2_USE_CUDA_KERNEL": "0",
            "INDEXTTS2_USE_DEEPSPEED": "0",
            "INDEXTTS2_EMO_ALPHA": str(args.indextts2_emo_alpha),
            "PYTHONUTF8": "1",
            "PYTHONIOENCODING": "utf-8",
        }
    )

    checkpoint(
        args,
        owner_key,
        job_id,
        20,
        "indextts2_source_speech",
        "Generating fresh typed source speech with Linux IndexTTS2.",
        {
            "sourceSpeechProvider": "indextts2",
            "sourceSpeechAdapter": "indextts2_single_utterance",
            "sourceSpeechText": speech_text,
            "referenceAudioPath": str(reference_audio),
            "sourceSpeechRequestPath": str(request_path),
        },
    )

    started = time.time()

    with stdout_path.open("w", encoding="utf-8") as stdout_file, stderr_path.open(
        "w",
        encoding="utf-8",
    ) as stderr_file:
        process = subprocess.Popen(
            command,
            cwd=str(index_root),
            env=env,
            stdout=stdout_file,
            stderr=stderr_file,
            text=True,
            start_new_session=True,
        )

        try:
            while process.poll() is None:
                if (
                    time.time() - started
                    >= args.typed_source_timeout_seconds
                ):
                    kill_process_group(process)
                    raise RuntimeError(
                        "IndexTTS2 typed source speech timed out after "
                        f"{args.typed_source_timeout_seconds} seconds."
                    )

                time.sleep(max(3, args.heartbeat_seconds))
                assert_job_active(
                    args,
                    owner_key,
                    job_id,
                )

                checkpoint(
                    args,
                    owner_key,
                    job_id,
                    25,
                    "indextts2_source_speech",
                    "Linux IndexTTS2 typed source speech is running.",
                    {
                        "sourceSpeechProvider": "indextts2",
                        "sourceSpeechAdapter": "indextts2_single_utterance",
                        "sourceSpeechText": speech_text,
                        "referenceAudioPath": str(reference_audio),
                        "sourceSpeechRequestPath": str(request_path),
                    },
                )
        except BaseException:
            kill_process_group(process)
            raise

    if process.returncode != 0:
        raise RuntimeError(
            "IndexTTS2 typed source speech failed with "
            f"exit code {process.returncode}. "
            f"stdout: {stdout_path}; stderr: {stderr_path}"
        )

    if not has_bytes(input_audio):
        raise RuntimeError(
            f"IndexTTS2 did not create typed source speech: {input_audio}"
        )

    return input_audio, {
        "sourceSpeechProvider": "indextts2",
        "sourceSpeechAdapter": "indextts2_single_utterance",
        "sourceSpeechText": speech_text,
        "sourceSpeechPath": str(input_audio),
        "sourceSpeechBytes": input_audio.stat().st_size,
        "sourceSpeechRequestPath": str(request_path),
        "sourceSpeechStdoutPath": str(stdout_path),
        "sourceSpeechStderrPath": str(stderr_path),
        "referenceAudioPath": str(reference_audio),
    }


def process_job(args: argparse.Namespace, job: Dict[str, Any]) -> None:
    owner_key = clean(job.get("ownerKey"))
    job_id = clean(job.get("jobId"))
    character_id = clean(job.get("characterId") or (job.get("input") or {}).get("characterId"))
    job_input = job.get("input") if isinstance(job.get("input"), dict) else {}
    if not owner_key or not job_id or not character_id:
        raise RuntimeError("Claimed Applio inference job is missing ownerKey, jobId, or characterId.")

    model_path = Path(clean(job_input.get("trainedModelPath") or job_input.get("modelPath"))).expanduser()
    index_path = Path(clean(job_input.get("trainedIndexPath") or job_input.get("indexPath"))).expanduser()
    if not has_bytes(model_path) or not has_bytes(index_path):
        raise RuntimeError(f"Trained Applio model/index missing. model={model_path}; index={index_path}")
    if job_input.get("trainedArtifactMock") is not False and job_input.get("trainingMock") is not False and job_input.get("artifactMock") is not False:
        raise RuntimeError("Applio inference requires a real trained artifact with mock:false.")

    if job_input.get("serverResolvedTrainedVoice") is not True:
        raise RuntimeError(
            "Test Trained Voice requires a server-resolved trained voice artifact."
        )

    resolved_owner_key = clean(
        job_input.get("serverResolvedOwnerKey")
    )

    if resolved_owner_key != owner_key:
        raise RuntimeError(
            "Test Trained Voice server owner does not match the claimed job owner."
        )

    work_dir = Path(args.work_root).expanduser().resolve() / safe_segment(owner_key) / safe_segment(character_id) / safe_segment(job_id)
    input_dir = work_dir / "input"
    output_dir = work_dir / "output"
    logs_dir = work_dir / "logs"
    input_dir.mkdir(parents=True, exist_ok=True)
    output_dir.mkdir(parents=True, exist_ok=True)
    logs_dir.mkdir(parents=True, exist_ok=True)
    reference_audio = Path(
        clean(job_input.get("inputAudioPath"))
    ).expanduser()

    reference_audio_url = clean(
        job_input.get("inputAudioUrl")
    )

    if not has_bytes(reference_audio):
        if not reference_audio_url:
            raise RuntimeError(
                "Missing readable server-resolved reference audio for typed Test Voice."
            )

        reference_audio = download_file(
            args,
            owner_key,
            reference_audio_url,
            input_dir / "reference.wav",
        )

    if not has_bytes(reference_audio):
        raise RuntimeError(
            f"Typed Test Voice reference audio is unreadable: {reference_audio}"
        )

    output_audio = output_dir / "output.wav"
    stdout_path = logs_dir / "applio-infer-stdout.log"
    stderr_path = logs_dir / "applio-infer-stderr.log"
    command_path = logs_dir / "applio-infer-command.json"
    applio_root = Path(args.applio_root).expanduser().resolve()
    applio_python = Path(args.applio_python).expanduser().absolute()
    core_script = Path(args.applio_core).expanduser().resolve()
    if not applio_root.is_dir() or not applio_python.exists() or not core_script.is_file():
        raise RuntimeError(
            f"Applio runtime is incomplete. root={applio_root}; python={applio_python}; core={core_script}"
        )

    command = [
        str(applio_python),
        str(core_script),
        "infer",
        "--pitch", str(args.pitch),
        "--index_rate", str(args.index_rate),
        "--volume_envelope", "1",
        "--protect", str(args.protect),
        "--f0_method", args.f0_method,
        "--input_path", str(reference_audio),
        "--output_path", str(output_audio),
        "--pth_path", str(model_path),
        "--index_path", str(index_path),
        "--split_audio", "False",
        "--f0_autotune", "False",
        "--clean_audio", "False",
        "--export_format", "WAV",
        "--embedder_model", args.embedder_model,
    ]
    base_result = {
        "trainedArtifactId": clean(job_input.get("trainedArtifactId") or job_input.get("voiceModelArtifactId")),
        "trainedModelPath": str(model_path),
        "trainedIndexPath": str(index_path),
        "inputAudioPath": str(reference_audio),
        "inputAudioUrl": reference_audio_url,
        "referenceAudioPath": str(reference_audio),
        "referenceAudioUrl": reference_audio_url,
        "stdoutPath": str(stdout_path),
        "stderrPath": str(stderr_path),
        "commandPath": str(command_path),
        "localWorkDir": str(work_dir),
    }
    command_path.write_text(
        json.dumps(
            {
                "schemaVersion": 1,
                "adapter": "applio_real_inference",
                "workerId": args.worker_id,
                "jobId": job_id,
                "ownerKey": owner_key,
                "characterId": character_id,
                "cwd": str(applio_root),
                "python": str(applio_python),
                "command": command,
                "startedAt": now_iso(),
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    gpu_lock = None
    started = time.time()
    try:
        checkpoint(args, owner_key, job_id, 10, "queued", "Linux Applio inference worker claimed the job.", base_result)
        gpu_lock = acquire_gpu_lock(args, owner_key, job_id)
        wait_for_comfy_idle(args, owner_key, job_id)
        release_comfy_models(args)

        input_audio, source_speech_result = generate_typed_source_speech(
            args,
            owner_key,
            job_id,
            job_input,
            reference_audio,
            work_dir,
        )

        # Critical invariant: Applio receives the fresh typed IndexTTS2 WAV,
        # not the reference/approved speaker sample.
        command[command.index("--input_path") + 1] = str(input_audio)

        base_result.update(source_speech_result)
        base_result["inputAudioPath"] = str(input_audio)
        base_result["inputAudioUrl"] = ""

        command_path.write_text(
            json.dumps(
                {
                    "schemaVersion": 2,
                    "adapter": "applio_real_inference",
                    "sourceSpeechProvider": "indextts2",
                    "sourceSpeechAdapter": "indextts2_single_utterance",
                    "workerId": args.worker_id,
                    "jobId": job_id,
                    "ownerKey": owner_key,
                    "characterId": character_id,
                    "cwd": str(applio_root),
                    "python": str(applio_python),
                    "command": command,
                    "inputAudioPath": str(input_audio),
                    "referenceAudioPath": str(reference_audio),
                    "startedAt": now_iso(),
                },
                indent=2,
            ),
            encoding="utf-8",
        )

        checkpoint(
            args,
            owner_key,
            job_id,
            40,
            "applio_inference",
            "Converting fresh typed IndexTTS2 speech with the trained Applio voice.",
            base_result,
        )

        run_command(
            args,
            owner_key,
            job_id,
            command,
            applio_root,
            stdout_path,
            stderr_path,
            base_result,
        )
    finally:
        if gpu_lock is not None:
            try:
                fcntl.flock(gpu_lock.fileno(), fcntl.LOCK_UN)
            finally:
                gpu_lock.close()
                log("[gpu-lock] Released shared voice GPU lock.")

    if not has_bytes(output_audio):
        raise RuntimeError(f"Applio inference did not create output audio: {output_audio}")
    input_sha = sha256_file(input_audio)
    output_sha = sha256_file(output_audio)
    if input_sha == output_sha:
        raise RuntimeError("Applio inference output is byte-identical to input audio.")

    canonical_dir = (
        Path(args.data_root).expanduser().resolve()
        / "characters"
        / safe_segment(owner_key)
        / "applio-inference"
        / safe_segment(character_id)
        / safe_segment(job_id)
    )
    canonical_logs = canonical_dir / "logs"
    canonical_dir.mkdir(parents=True, exist_ok=True)
    canonical_logs.mkdir(parents=True, exist_ok=True)
    canonical_output = canonical_dir / "output.wav"
    shutil.copyfile(output_audio, canonical_output)
    shutil.copyfile(stdout_path, canonical_logs / stdout_path.name)
    shutil.copyfile(stderr_path, canonical_logs / stderr_path.name)
    shutil.copyfile(command_path, canonical_logs / command_path.name)
    if not has_bytes(canonical_output):
        raise RuntimeError(f"Canonical Applio inference output is missing: {canonical_output}")
    output_url = (
        "/api/characters/applio-inference/file"
        f"?owner={urllib.parse.quote(owner_key)}"
        f"&characterId={urllib.parse.quote(character_id)}"
        f"&jobId={urllib.parse.quote(job_id)}"
    )
    output_bytes = canonical_output.stat().st_size

    elapsed_ms = int((time.time() - started) * 1000)
    result = {
        **base_result,
        "adapter": "applio_real_inference",
        "provider": "applio",
        "mock": False,
        "remoteWorker": True,
        "workerId": args.worker_id,
        "status": "completed",
        "currentStage": "completed",
        "outputAudioPath": str(canonical_output),
        "outputAudioUrl": output_url,
        "outputBytes": output_bytes,
        "outputDir": str(canonical_dir),
        "logsPath": str(canonical_logs),
        "inputSha256": input_sha,
        "outputSha256": output_sha,
        "completedAt": now_iso(),
        "elapsedMs": elapsed_ms,
        "elapsedLabel": f"{round(elapsed_ms / 1000)}s",
    }
    complete_job(args, owner_key, job_id, result)
    log(f"[complete] {job_id} output={output_url} bytes={output_bytes}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Dedicated OTG Linux Applio inference worker")
    parser.add_argument("--base-url", default=os.environ.get("OTG_BASE_URL", "http://100.75.162.64:3001"))
    parser.add_argument("--device-id", default=os.environ.get("OTG_DEVICE_ID", "linux-applio-inference"))
    parser.add_argument("--worker-id", default=os.environ.get("OTG_WORKER_ID", "linux-applio-inference-worker"))
    parser.add_argument("--worker-token", default=os.environ.get("OTG_WORKER_TOKEN", ""))
    parser.add_argument("--applio-root", default=os.environ.get("APPLIO_ROOT", "/home/shawn-rochford/AI/runtime/test/Applio"))
    parser.add_argument("--applio-python", default=os.environ.get("APPLIO_PYTHON", "/home/shawn-rochford/AI/runtime/test/Applio/.venv/bin/python"))
    parser.add_argument("--applio-core", default=os.environ.get("APPLIO_CORE_SCRIPT", "/home/shawn-rochford/AI/runtime/test/Applio/core.py"))
    parser.add_argument(
        "--indextts2-root",
        default=os.environ.get(
            "INDEXTTS2_ROOT",
            "/home/shawn-rochford/AI/runtime/test/IndexTTS2",
        ),
    )
    parser.add_argument(
        "--indextts2-python",
        default=os.environ.get(
            "INDEXTTS2_PYTHON",
            "/home/shawn-rochford/AI/runtime/test/IndexTTS2/.venv/bin/python",
        ),
    )
    parser.add_argument(
        "--indextts2-cfg",
        default=os.environ.get(
            "INDEXTTS2_CFG",
            "/home/shawn-rochford/AI/runtime/test/IndexTTS2/checkpoints/config.yaml",
        ),
    )
    parser.add_argument(
        "--indextts2-model-dir",
        default=os.environ.get(
            "INDEXTTS2_MODEL_DIR",
            "/home/shawn-rochford/AI/runtime/test/IndexTTS2/checkpoints",
        ),
    )
    parser.add_argument(
        "--indextts2-bridge",
        default=os.environ.get(
            "INDEXTTS2_BRIDGE",
            str(
                Path(__file__).resolve().parents[1]
                / "index_tts2_clone_pack_bridge.py"
            ),
        ),
    )
    parser.add_argument(
        "--indextts2-emo-alpha",
        default=os.environ.get(
            "INDEXTTS2_EMO_ALPHA",
            "0.45",
        ),
    )
    parser.add_argument(
        "--typed-source-timeout-seconds",
        type=int,
        default=int(
            os.environ.get(
                "OTG_INDEXTTS2_TYPED_SOURCE_TIMEOUT_SECONDS",
                "900",
            )
        ),
    )
    parser.add_argument("--work-root", default=os.environ.get("OTG_APPLIO_INFERENCE_WORK_ROOT", "/home/shawn-rochford/AI/runtime/test/applio-inference-jobs"))
    parser.add_argument("--data-root", default=os.environ.get("OTG_DATA_DIR", "/home/shawn-rochford/AI/runtime/test/data"))
    parser.add_argument("--comfy-url", default=os.environ.get("OTG_PRIMARY_COMFY_URL", "http://100.75.162.64:8188"))
    parser.add_argument("--gpu-lock-file", default=os.environ.get("OTG_VOICE_GPU_LOCK_FILE", "/home/shawn-rochford/AI/runtime/test/voice-gpu.lock"))
    parser.add_argument("--pitch", type=int, default=int(os.environ.get("APPLIO_INFERENCE_PITCH", "0")))
    parser.add_argument("--index-rate", type=float, default=float(os.environ.get("APPLIO_INFERENCE_INDEX_RATE", "0.75")))
    parser.add_argument("--protect", type=float, default=float(os.environ.get("APPLIO_INFERENCE_PROTECT", "0.33")))
    parser.add_argument("--f0-method", default=os.environ.get("APPLIO_INFERENCE_F0_METHOD", "rmvpe"))
    parser.add_argument("--embedder-model", default=os.environ.get("APPLIO_INFERENCE_EMBEDDER", "contentvec"))
    parser.add_argument("--poll-seconds", type=int, default=int(os.environ.get("OTG_APPLIO_INFERENCE_POLL_SECONDS", "15")))
    parser.add_argument("--heartbeat-seconds", type=int, default=int(os.environ.get("OTG_APPLIO_INFERENCE_HEARTBEAT_SECONDS", "15")))
    parser.add_argument("--inference-timeout-seconds", type=int, default=int(os.environ.get("OTG_APPLIO_INFERENCE_TIMEOUT_SECONDS", "1200")))
    parser.add_argument("--comfy-idle-timeout-seconds", type=int, default=int(os.environ.get("OTG_APPLIO_INFERENCE_COMFY_IDLE_TIMEOUT_SECONDS", "1800")))
    parser.add_argument("--gpu-lock-wait-seconds", type=int, default=int(os.environ.get("OTG_APPLIO_INFERENCE_GPU_LOCK_WAIT_SECONDS", "21600")))
    parser.add_argument("--once", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if not clean(args.worker_token):
        raise RuntimeError("OTG_WORKER_TOKEN is required for universal all-owner Applio inference claim mode.")
    log("Starting dedicated OTG Linux Applio inference worker")
    log("  Route: character_voice_pipeline / test_trained_voice only")
    log(f"  BaseUrl: {args.base_url}")
    log(f"  WorkerId: {args.worker_id}")
    log(f"  ApplioRoot: {args.applio_root}")
    while True:
        job: Dict[str, Any] | None = None
        try:
            job = claim_job(args)
            if not job:
                log("[idle] No queued test_trained_voice job available.")
                if args.once:
                    return 0
                time.sleep(max(5, args.poll_seconds))
                continue
            log(f"[claim] {job.get('jobId')} owner={job.get('ownerKey')} character={job.get('characterId')}")
            process_job(args, job)
            if args.once:
                return 0
        except TerminatedJob as error:
            log(f"[stop] {error}")
            if args.once:
                return 0
        except KeyboardInterrupt:
            return 130
        except Exception as error:
            owner_key = clean((job or {}).get("ownerKey"))
            job_id = clean((job or {}).get("jobId"))
            if owner_key and job_id:
                try:
                    fail_job(
                        args,
                        owner_key,
                        job_id,
                        str(error),
                        {
                            "adapter": "applio_real_inference",
                            "mock": False,
                            "remoteWorker": True,
                            "workerId": args.worker_id,
                            "status": "failed",
                            "failedAt": now_iso(),
                            "message": str(error),
                        },
                    )
                except Exception as report_error:
                    log(f"[warn] Could not report failed inference job: {report_error}")
            log(f"[failed] {job_id}: {error}")
            traceback.print_exc()
            if args.once:
                return 1
            time.sleep(max(5, args.poll_seconds))


if __name__ == "__main__":
    raise SystemExit(main())
