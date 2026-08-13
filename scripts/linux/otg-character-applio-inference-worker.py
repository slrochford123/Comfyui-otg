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

    work_dir = Path(args.work_root).expanduser().resolve() / safe_segment(owner_key) / safe_segment(character_id) / safe_segment(job_id)
    input_dir = work_dir / "input"
    output_dir = work_dir / "output"
    logs_dir = work_dir / "logs"
    input_dir.mkdir(parents=True, exist_ok=True)
    output_dir.mkdir(parents=True, exist_ok=True)
    logs_dir.mkdir(parents=True, exist_ok=True)
    input_audio = Path(clean(job_input.get("inputAudioPath"))).expanduser()
    if not has_bytes(input_audio):
        input_url = clean(job_input.get("inputAudioUrl"))
        if not input_url:
            raise RuntimeError("Missing readable inputAudioPath and inputAudioUrl for Applio inference.")
        input_audio = download_file(args, owner_key, input_url, input_dir / "input.wav")

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
        "--input_path", str(input_audio),
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
        "inputAudioPath": str(input_audio),
        "inputAudioUrl": clean(job_input.get("inputAudioUrl")),
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
        checkpoint(args, owner_key, job_id, 30, "applio_inference", "Starting real Applio voice conversion.", base_result)
        run_command(args, owner_key, job_id, command, applio_root, stdout_path, stderr_path, base_result)
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
