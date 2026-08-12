#!/usr/bin/env python3
"""Linux CosyVoice3 character voice worker for ComfyUI-OTG TEST.

Claims only:
  jobType=character_voice_pipeline
  action=create_voice_sample
  provider=cosy

The worker waits for the RTX 3090 ComfyUI queue to become idle, requests cached
ComfyUI models to be released, runs one official CosyVoice3 subprocess, uploads
the WAV, completes the durable job, and returns to polling.
"""

from __future__ import annotations

import argparse
import fcntl
import json
import mimetypes
import os
import subprocess
import time
import traceback
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Dict


class WorkerError(RuntimeError):
    pass


def clean(value: Any) -> str:
    return str(value or "").strip()


def log(message: str) -> None:
    print(message, flush=True)


def acquire_gpu_lock(path_text: str):
    path = Path(path_text).expanduser()
    path.parent.mkdir(parents=True, exist_ok=True)
    handle = path.open("a+")
    log(f"[gpu-lock] Waiting for shared voice GPU lock: {path}")
    fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
    log(f"[gpu-lock] Acquired shared voice GPU lock: {path}")
    return handle


def build_url(base_url: str, route: str) -> str:
    return urllib.parse.urljoin(base_url.rstrip("/") + "/", route.lstrip("/"))


def auth_headers(args: argparse.Namespace, owner_key: str | None = None) -> Dict[str, str]:
    headers = {
        "content-type": "application/json",
        "x-otg-worker-id": args.worker_id,
        "x-otg-device-id": args.device_id,
    }
    if args.worker_token:
        headers["authorization"] = f"Bearer {args.worker_token}"
    if owner_key:
        headers["x-otg-owner-key"] = owner_key
    return headers


def request_json(
    method: str,
    url: str,
    headers: Dict[str, str] | None = None,
    payload: Dict[str, Any] | None = None,
    timeout: int = 300,
) -> Dict[str, Any]:
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=headers or {}, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            raw = response.read().decode("utf-8", errors="replace")
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        raise WorkerError(f"HTTP {error.code} {url}: {body}") from error
    except urllib.error.URLError as error:
        raise WorkerError(f"Could not reach {url}: {error}") from error


def checkpoint(
    args: argparse.Namespace,
    headers: Dict[str, str],
    job_id: str,
    progress: int,
    message: str,
    result: Dict[str, Any] | None = None,
) -> None:
    try:
        request_json(
            "POST",
            build_url(args.base_url, "/api/worker/jobs/checkpoint"),
            headers,
            {
                "jobId": job_id,
                "progress": progress,
                "message": message,
                "result": result or {},
            },
            timeout=args.upload_timeout_seconds,
        )
    except Exception as error:
        log(f"[warn] Could not checkpoint job {job_id}: {error}")


def multipart_post(
    url: str,
    headers: Dict[str, str],
    fields: Dict[str, str],
    file_field: str,
    file_path: Path,
    timeout: int,
) -> Dict[str, Any]:
    boundary = f"----otg-linux-cosyvoice-{int(time.time() * 1000)}"
    body = bytearray()
    for key, value in fields.items():
        body.extend(f"--{boundary}\r\n".encode("utf-8"))
        body.extend(f'Content-Disposition: form-data; name="{key}"\r\n\r\n'.encode("utf-8"))
        body.extend(str(value).encode("utf-8"))
        body.extend(b"\r\n")

    mime = mimetypes.guess_type(str(file_path))[0] or "audio/wav"
    body.extend(f"--{boundary}\r\n".encode("utf-8"))
    body.extend(
        f'Content-Disposition: form-data; name="{file_field}"; filename="{file_path.name}"\r\n'.encode("utf-8")
    )
    body.extend(f"Content-Type: {mime}\r\n\r\n".encode("utf-8"))
    body.extend(file_path.read_bytes())
    body.extend(b"\r\n")
    body.extend(f"--{boundary}--\r\n".encode("utf-8"))

    request_headers = {key: value for key, value in headers.items() if key.lower() != "content-type"}
    request_headers["content-type"] = f"multipart/form-data; boundary={boundary}"
    req = urllib.request.Request(url, data=bytes(body), headers=request_headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            raw = response.read().decode("utf-8", errors="replace")
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as error:
        text = error.read().decode("utf-8", errors="replace")
        raise WorkerError(f"HTTP {error.code} {url}: {text}") from error


def absolute_path_without_resolving_symlink(path_text: str) -> Path:
    path = Path(path_text).expanduser()
    if not path.is_absolute():
        path = Path.cwd() / path
    return Path(os.path.abspath(str(path)))


def require_file(path_text: str, label: str) -> Path:
    path = absolute_path_without_resolving_symlink(path_text)
    if not path.is_file():
        raise WorkerError(f"{label} file not found: {path}")
    return path


def require_dir(path_text: str, label: str) -> Path:
    path = Path(path_text).expanduser().resolve()
    if not path.is_dir():
        raise WorkerError(f"{label} directory not found: {path}")
    return path


def first_text(job_input: Dict[str, Any], *keys: str, default: str = "Hello, this is the selected character voice.") -> str:
    for key in keys:
        value = clean(job_input.get(key))
        if value:
            return value
    return default


def write_json(path: Path, value: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2), encoding="utf-8")


def queue_counts(payload: Dict[str, Any]) -> tuple[int, int]:
    running = payload.get("queue_running")
    pending = payload.get("queue_pending")
    return (
        len(running) if isinstance(running, list) else 0,
        len(pending) if isinstance(pending, list) else 0,
    )


def wait_for_comfy_idle(args: argparse.Namespace, headers: Dict[str, str], job_id: str) -> None:
    deadline = time.monotonic() + args.comfy_idle_timeout_seconds
    last_report = 0.0
    while True:
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
            checkpoint(
                args,
                headers,
                job_id,
                18,
                "Waiting for the RTX 3090 ComfyUI queue to become idle before CosyVoice generation.",
                {
                    "remoteWorker": True,
                    "workerId": args.worker_id,
                    "platform": "linux",
                    "provider": "cosy",
                    "currentStage": "waiting_for_gpu",
                    "comfyRunning": running,
                    "comfyPending": pending,
                },
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


def normalize_instruction(value: str) -> str:
    cleaned = value.strip() or "You are a helpful assistant. Speak in a clear, natural character voice."
    return cleaned if cleaned.endswith("<|endofprompt|>") else cleaned + "<|endofprompt|>"


def run_bridge(command: list[str], cwd: Path, env: Dict[str, str], output_wav: Path, timeout: int) -> None:
    log(f"[bridge] {' '.join(command)}")
    result = subprocess.run(command, cwd=str(cwd), env=env, timeout=timeout)
    if result.returncode != 0:
        raise WorkerError(f"CosyVoice bridge failed with exit code {result.returncode}.")
    if not output_wav.is_file() or output_wav.stat().st_size <= 0:
        raise WorkerError(f"CosyVoice bridge did not create a non-empty WAV: {output_wav}")


def generate_cosy(args: argparse.Namespace, job: Dict[str, Any], job_input: Dict[str, Any], work_dir: Path) -> Dict[str, Any]:
    cosy_root = require_dir(args.cosy_root, "COSYVOICE_ROOT")
    cosy_python = require_file(args.cosy_python, "COSYVOICE_PYTHON")
    cosy_bridge = require_file(args.cosy_bridge, "COSYVOICE_BRIDGE")
    model_dir = require_dir(args.cosy_model_dir, "COSYVOICE_MODEL_DIR")
    prompt_wav = require_file(args.cosy_prompt_wav, "COSYVOICE_PROMPT_WAV")

    output_wav = work_dir / "sample.wav"
    stdout_log = work_dir / "logs" / "cosyvoice-stdout.log"
    stderr_log = work_dir / "logs" / "cosyvoice-stderr.log"
    params_path = work_dir / "cosyvoice_sample_params.json"
    stdout_log.parent.mkdir(parents=True, exist_ok=True)

    instruction = normalize_instruction(
        clean(job_input.get("voiceInstruction") or job_input.get("prompt") or job_input.get("instruct"))
    )
    text = first_text(job_input, "sampleText", "previewText", "text")
    params = {
        "engine": "cosyvoice3",
        "model_id": str(model_dir),
        "cosyvoice_root": str(cosy_root),
        "output_wav": str(output_wav),
        "text": text,
        "instruction": instruction,
        "prompt": instruction,
        "prompt_wav": str(prompt_wav),
        "language": clean(job_input.get("language")) or "English",
        "source_job_id": clean(job.get("jobId")),
        "character_id": clean(job.get("characterId")),
        "seed": clean(job_input.get("seed") or job_input.get("requestSeed")),
        "request_seed": clean(job_input.get("requestSeed") or job_input.get("seed")),
        "input": job_input,
    }
    write_json(params_path, params)

    env = os.environ.copy()
    env["COSYVOICE_SITE_PACKAGES"] = clean(args.cosy_site_packages)
    env["HF_HUB_DISABLE_SYMLINKS_WARNING"] = "1"
    env["TOKENIZERS_PARALLELISM"] = "false"

    run_bridge(
        [
            str(cosy_python),
            str(cosy_bridge),
            "--params-json",
            str(params_path),
            "--stdout-log",
            str(stdout_log),
            "--stderr-log",
            str(stderr_log),
        ],
        cosy_root,
        env,
        output_wav,
        args.sample_timeout_seconds,
    )
    return {
        "provider": "cosy",
        "adapter": "cosyvoice3_real_voice_sample",
        "sample": output_wav,
        "paramsPath": str(params_path),
        "stdoutPath": str(stdout_log),
        "stderrPath": str(stderr_log),
        "logsPath": str(stdout_log.parent),
        "outputDir": str(work_dir),
        "modelDir": str(model_dir),
        "promptWav": str(prompt_wav),
    }


def upload_sample(
    args: argparse.Namespace,
    headers: Dict[str, str],
    character_id: str,
    job_id: str,
    generated: Dict[str, Any],
) -> Dict[str, Any]:
    response = multipart_post(
        build_url(args.base_url, "/api/characters/voice-sample/upload"),
        headers,
        {
            "characterId": character_id,
            "jobId": job_id,
            "provider": generated["provider"],
            "adapter": generated["adapter"],
        },
        "file",
        generated["sample"],
        args.upload_timeout_seconds,
    )
    if not response.get("ok"):
        raise WorkerError(f"Voice sample upload failed: {json.dumps(response, indent=2)}")
    return response


def process_one(args: argparse.Namespace) -> int:
    job_id = ""
    owner_key = ""
    try:
        claim = request_json(
            "POST",
            build_url(args.base_url, "/api/worker/jobs/claim"),
            auth_headers(args),
            {
                "jobType": "character_voice_pipeline",
                "action": "create_voice_sample",
                "claimScope": "all_owners",
                "workerId": args.worker_id,
                "providers": ["cosy"],
            },
        )
        job = claim.get("job")
        if not isinstance(job, dict):
            log("[idle] No queued CosyVoice create_voice_sample job available.")
            return 0

        job_id = clean(job.get("jobId"))
        owner_key = clean(job.get("ownerKey"))
        character_id = clean(job.get("characterId"))
        job_input = job.get("input") if isinstance(job.get("input"), dict) else {}
        provider = clean(job_input.get("provider")).lower()
        if not job_id or not owner_key or not character_id:
            raise WorkerError(f"Invalid claimed CosyVoice job: {job}")
        if provider != "cosy":
            raise WorkerError(f"CosyVoice worker claimed unexpected provider: {provider}")

        headers = auth_headers(args, owner_key)
        work_dir = Path(args.work_root).expanduser().resolve() / owner_key / character_id / job_id
        work_dir.mkdir(parents=True, exist_ok=True)
        log(f"[claim] {job_id} owner={owner_key} character={character_id} provider=cosy")

        checkpoint(
            args,
            headers,
            job_id,
            12,
            "CosyVoice generation started on the Linux worker.",
            {
                "remoteWorker": True,
                "workerId": args.worker_id,
                "platform": "linux",
                "provider": "cosy",
                "currentStage": "started",
            },
        )

        gpu_lock = acquire_gpu_lock(args.gpu_lock_file)
        try:
            wait_for_comfy_idle(args, headers, job_id)
            release_comfy_models(args)
            free = wait_for_free_vram(args)
            if free is not None:
                log(f"[gpu] RTX 3090 free VRAM before CosyVoice: {free} MiB")

            checkpoint(
                args,
                headers,
                job_id,
                35,
                "Generating the CosyVoice3 character voice sample on the Linux RTX 3090 worker.",
                {
                    "remoteWorker": True,
                    "workerId": args.worker_id,
                    "platform": "linux",
                    "provider": "cosy",
                    "currentStage": "voice_generation",
                    "freeVramMiB": free,
                },
            )

            generated = generate_cosy(args, job, job_input, work_dir)
        finally:
            fcntl.flock(gpu_lock.fileno(), fcntl.LOCK_UN)
            gpu_lock.close()
            log("[gpu-lock] Released shared voice GPU lock.")

        log(f"[output] job={job_id} sample={generated['sample']} bytes={generated['sample'].stat().st_size}")

        checkpoint(
            args,
            headers,
            job_id,
            80,
            "CosyVoice sample generated. Uploading it to the character.",
            {
                "remoteWorker": True,
                "workerId": args.worker_id,
                "platform": "linux",
                "provider": "cosy",
                "adapter": generated["adapter"],
                "currentStage": "uploading",
                "outputDir": generated["outputDir"],
                "logsPath": generated["logsPath"],
                "paramsPath": generated["paramsPath"],
            },
        )

        upload = upload_sample(args, headers, character_id, job_id, generated)
        result = {
            "mock": False,
            "provider": "cosy",
            "adapter": generated["adapter"],
            "remoteWorker": True,
            "platform": "linux",
            "workerId": args.worker_id,
            "samplePath": upload.get("samplePath"),
            "sampleUrl": upload.get("sampleUrl"),
            "uploadId": upload.get("uploadId"),
            "jobId": job_id,
            "outputBytes": upload.get("outputBytes"),
            "outputDir": generated["outputDir"],
            "logsPath": generated["logsPath"],
            "paramsPath": generated["paramsPath"],
            "stdoutPath": generated["stdoutPath"],
            "stderrPath": generated["stderrPath"],
            "modelDir": generated["modelDir"],
            "completedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
        complete = request_json(
            "POST",
            build_url(args.base_url, "/api/worker/jobs/complete"),
            headers,
            {
                "jobId": job_id,
                "result": result,
                "message": "Linux CosyVoice3 character voice sample completed.",
            },
            timeout=args.upload_timeout_seconds,
        )
        log(f"[complete] {json.dumps(complete, indent=2)}")
        return 0
    except Exception as error:
        text = f"{error}\n{traceback.format_exc()}"
        log(f"[error] {text}")
        if job_id and owner_key:
            try:
                request_json(
                    "POST",
                    build_url(args.base_url, "/api/worker/jobs/fail"),
                    auth_headers(args, owner_key),
                    {
                        "jobId": job_id,
                        "error": str(error),
                        "result": {
                            "remoteWorker": True,
                            "platform": "linux",
                            "workerId": args.worker_id,
                            "provider": "cosy",
                            "error": text,
                        },
                    },
                    timeout=args.upload_timeout_seconds,
                )
            except Exception as fail_error:
                log(f"[warn] Could not mark CosyVoice job failed: {fail_error}")
        return 1


def main() -> int:
    parser = argparse.ArgumentParser(description="Dedicated Linux CosyVoice3 character voice worker")
    parser.add_argument("--base-url", default=os.environ.get("OTG_BASE_URL", "http://100.75.162.64:3001"))
    parser.add_argument("--device-id", default=os.environ.get("OTG_DEVICE_ID", "linux-cosyvoice"))
    parser.add_argument("--worker-id", default=os.environ.get("OTG_WORKER_ID", "linux-cosyvoice-worker"))
    parser.add_argument("--worker-token", default=os.environ.get("OTG_WORKER_TOKEN", ""))
    parser.add_argument("--work-root", default=os.environ.get("OTG_COSYVOICE_WORK_ROOT", "/home/shawn-rochford/AI/runtime/test/cosyvoice-jobs"))
    parser.add_argument("--cosy-root", default=os.environ.get("COSYVOICE_ROOT", "/home/shawn-rochford/AI/runtime/test/CosyVoice"))
    parser.add_argument("--cosy-python", default=os.environ.get("COSYVOICE_PYTHON", "/home/shawn-rochford/AI/runtime/test/cosyvoice-env/bin/python"))
    parser.add_argument("--cosy-site-packages", default=os.environ.get("COSYVOICE_SITE_PACKAGES", ""))
    parser.add_argument("--cosy-bridge", default=os.environ.get("COSYVOICE_BRIDGE", "/home/shawn-rochford/AI/deploy/otg-test/current/scripts/linux/cosy_voice_sample_bridge.py"))
    parser.add_argument("--cosy-model-dir", default=os.environ.get("COSYVOICE_MODEL_DIR", "/home/shawn-rochford/AI/runtime/test/CosyVoice/pretrained_models/Fun-CosyVoice3-0.5B"))
    parser.add_argument("--cosy-prompt-wav", default=os.environ.get("COSYVOICE_PROMPT_WAV", "/home/shawn-rochford/AI/runtime/test/CosyVoice/asset/zero_shot_prompt.wav"))
    parser.add_argument("--comfy-url", default=os.environ.get("OTG_PRIMARY_COMFY_URL", "http://100.75.162.64:8188"))
    parser.add_argument("--sample-timeout-seconds", type=int, default=int(os.environ.get("OTG_COSYVOICE_SAMPLE_TIMEOUT_SECONDS", "1800")))
    parser.add_argument("--upload-timeout-seconds", type=int, default=int(os.environ.get("OTG_COSYVOICE_UPLOAD_TIMEOUT_SECONDS", "300")))
    parser.add_argument("--poll-seconds", type=int, default=int(os.environ.get("OTG_COSYVOICE_POLL_SECONDS", "10")))
    parser.add_argument("--comfy-poll-seconds", type=int, default=int(os.environ.get("OTG_COSYVOICE_COMFY_POLL_SECONDS", "5")))
    parser.add_argument("--comfy-idle-timeout-seconds", type=int, default=int(os.environ.get("OTG_COSYVOICE_COMFY_IDLE_TIMEOUT_SECONDS", "1800")))
    parser.add_argument("--min-free-vram-mib", type=int, default=int(os.environ.get("OTG_COSYVOICE_MIN_FREE_VRAM_MIB", "8192")))
    parser.add_argument("--vram-wait-seconds", type=int, default=int(os.environ.get("OTG_COSYVOICE_VRAM_WAIT_SECONDS", "120")))
    parser.add_argument("--gpu-lock-file", default=os.environ.get("OTG_VOICE_GPU_LOCK_FILE", "/home/shawn-rochford/AI/runtime/test/voice-gpu.lock"))
    parser.add_argument("--once", action="store_true")
    args = parser.parse_args()

    if not args.worker_token:
        raise WorkerError("Missing OTG_WORKER_TOKEN. CosyVoice worker requires token-protected universal claim.")

    while True:
        code = process_one(args)
        if args.once:
            return code
        time.sleep(max(1, args.poll_seconds))


if __name__ == "__main__":
    raise SystemExit(main())
