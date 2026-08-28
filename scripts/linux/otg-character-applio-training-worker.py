#!/usr/bin/env python3
"""Linux Applio model-training worker for ComfyUI-OTG TEST.

Claims only:
  jobType=character_voice_pipeline
  action=start_applio_training

The worker validates a real 200-clip IndexTTS2 voice pack, serializes RTX 3090
access through the shared voice GPU lock, waits for ComfyUI to become idle,
requests cached-model release, runs the official Applio preprocess/extract/train
pipeline, verifies the generated .pth and .index files, and completes the durable
job without involving PROD.
"""

from __future__ import annotations

import argparse
import fcntl
import hashlib
import json
import os
import shutil
import signal
import subprocess
import sys
import threading
import time
import traceback
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Tuple


TERMINAL_STATUSES = {"canceled", "cancelled", "terminated", "completed", "ready_for_review"}


def log(message: str) -> None:
    print(message, flush=True)


class TerminatedJob(RuntimeError):
    pass


def clean(value: Any) -> str:
    return str(value or "").strip()


def safe_segment(value: Any) -> str:
    raw = clean(value) or "item"
    out = "".join(ch if ch.isalnum() or ch in "._@-" else "-" for ch in raw)
    return out[:160] or "item"


def build_url(base_url: str, path_or_url: str) -> str:
    value = clean(path_or_url)
    if value.startswith("http://") or value.startswith("https://"):
        return value
    return urllib.parse.urljoin(base_url.rstrip("/") + "/", value.lstrip("/"))


def request_json(method: str, url: str, headers: Dict[str, str] | None = None, payload: Dict[str, Any] | None = None, timeout: int = 120) -> Dict[str, Any]:
    body = None
    req_headers = dict(headers or {})
    if payload is not None:
        body = json.dumps(payload).encode("utf-8")
        req_headers["content-type"] = "application/json"
    req = urllib.request.Request(url, data=body, headers=req_headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            raw = response.read()
            return json.loads(raw.decode("utf-8")) if raw else {}
    except urllib.error.HTTPError as error:
        raw = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {error.code} {url}: {raw}") from error
    except urllib.error.URLError as error:
        raise RuntimeError(f"Could not reach {url}: {error}") from error


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
    data = request_json(
        "POST",
        build_url(args.base_url, "/api/worker/jobs/claim"),
        auth_headers(args),
        {
            "jobType": "character_voice_pipeline",
            "action": "start_applio_training",
            "claimScope": "all_owners",
            "workerId": args.worker_id,
        },
        timeout=60,
    )
    job = data.get("job")
    return job if isinstance(job, dict) else None


def fetch_job(args: argparse.Namespace, owner_key: str, job_id: str) -> Dict[str, Any]:
    data = request_json(
        "GET",
        build_url(args.base_url, f"/api/characters/voice-pipeline/{urllib.parse.quote(job_id)}"),
        auth_headers(args, owner_key),
        timeout=60,
    )
    job = data.get("job")
    return job if isinstance(job, dict) else {}


def assert_job_active(args: argparse.Namespace, owner_key: str, job_id: str) -> None:
    status = clean(fetch_job(args, owner_key, job_id).get("status"))
    if status in TERMINAL_STATUSES:
        raise TerminatedJob(f"Applio job {job_id} is no longer active; status={status}.")
    if status not in {"queued", "running", "interrupted"}:
        raise RuntimeError(f"Applio job {job_id} returned unexpected status={status or 'missing'}.")


def checkpoint(args: argparse.Namespace, owner_key: str, job_id: str, progress: int, message: str, result: Dict[str, Any]) -> None:
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
                    "adapter": "applio_real_training",
                    "mock": False,
                    "status": "running",
                },
            },
            timeout=60,
        )
    except Exception as error:
        log(f"[warn] checkpoint failed for {job_id}: {error}")


def complete_job(args: argparse.Namespace, owner_key: str, job_id: str, result: Dict[str, Any], message: str) -> None:
    request_json(
        "POST",
        build_url(args.base_url, "/api/worker/jobs/complete"),
        auth_headers(args, owner_key),
        {"jobId": job_id, "result": result, "message": message},
        timeout=120,
    )


def fail_job(args: argparse.Namespace, owner_key: str, job_id: str, error: str, result: Dict[str, Any]) -> None:
    request_json(
        "POST",
        build_url(args.base_url, "/api/worker/jobs/fail"),
        auth_headers(args, owner_key),
        {"jobId": job_id, "error": error, "result": result},
        timeout=120,
    )


def read_json(path: Path) -> Dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, data: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + f".{os.getpid()}.tmp")
    tmp.write_text(json.dumps(data, indent=2), encoding="utf-8")
    tmp.replace(path)


def has_bytes(path: Path) -> bool:
    try:
        return path.is_file() and path.stat().st_size > 0
    except OSError:
        return False


def resolve_manifest(job: Dict[str, Any]) -> Tuple[Path, Dict[str, Any], str]:
    job_input = job.get("input") if isinstance(job.get("input"), dict) else {}
    result = job.get("result") if isinstance(job.get("result"), dict) else {}
    manifest_path = clean(job_input.get("manifestPath")) or clean(result.get("manifestPath"))
    if not manifest_path:
        raise RuntimeError("Applio training job is missing dataset manifestPath.")
    path = Path(manifest_path)
    if not has_bytes(path):
        raise RuntimeError(f"Dataset manifest is missing or empty: {path}")
    manifest = read_json(path)
    source_job_id = clean(job_input.get("sourceDatasetJobId")) or clean(result.get("sourceDatasetJobId")) or clean(manifest.get("jobId"))
    return path, manifest, source_job_id


def validate_real_manifest(manifest_path: Path, manifest: Dict[str, Any]) -> List[Dict[str, Any]]:
    clips = manifest.get("clips") if isinstance(manifest.get("clips"), list) else []
    ready = [clip for clip in clips if isinstance(clip, dict) and clean(clip.get("status")) == "ready"]
    if manifest.get("mock") is not False or clean(manifest.get("generationMode")) != "real":
        raise RuntimeError(f"Real Applio training requires a real IndexTTS2 voice pack: {manifest_path}")
    if clean(manifest.get("status")) != "voice_pack_ready":
        raise RuntimeError(f"Real Applio training requires manifest status voice_pack_ready: {manifest_path}")
    if int(manifest.get("generatedClipCount") or 0) < 200 or len(ready) < 200:
        raise RuntimeError(f"Real Applio training requires 200 ready clips. generated={manifest.get('generatedClipCount')} ready={len(ready)}")
    for clip in ready[:200]:
        clip_path = Path(clean(clip.get("expectedAudioPath")))
        if not has_bytes(clip_path):
            raise RuntimeError(f"Ready dataset clip is missing or empty: {clip.get('clipId')} {clip_path}")
    return ready[:200]


def model_name_for(character_id: str, job_id: str) -> str:
    return f"voice_model_{safe_segment(character_id)}_{safe_segment(job_id)}"


def derive_master_port(job_id: str) -> str:
    explicit = clean(os.environ.get("APPLIO_MASTER_PORT"))
    if explicit:
        return explicit
    digest = hashlib.sha256(job_id.encode("utf-8")).hexdigest()
    return str(45000 + (int(digest[:8], 16) % 15000))


def bool_env(name: str, fallback: str) -> str:
    value = clean(os.environ.get(name))
    if not value:
        return fallback
    if value not in {"True", "False"}:
        raise RuntimeError(f"{name} must be True or False. Received: {value}")
    return value


def int_env(name: str, fallback: int) -> int:
    value = clean(os.environ.get(name))
    if not value:
        return fallback
    try:
        parsed = int(value)
    except ValueError as error:
        raise RuntimeError(f"{name} must be an integer. Received: {value}") from error
    if parsed <= 0:
        raise RuntimeError(f"{name} must be positive. Received: {value}")
    return parsed


def prepare_dataset(ready_clips: List[Dict[str, Any]], target: Path, manifest_path: Path, source_job_id: str) -> None:
    if target.exists():
        shutil.rmtree(target)
    target.mkdir(parents=True, exist_ok=True)
    for clip in ready_clips:
        source = Path(clean(clip.get("expectedAudioPath")))
        target_file = target / f"{safe_segment(clip.get('clipId'))}.wav"
        shutil.copyfile(source, target_file)
    write_json(target / "otg-dataset-source.json", {
        "schemaVersion": 1,
        "sourceManifestPath": str(manifest_path),
        "sourceDatasetJobId": source_job_id,
        "clipCount": len(ready_clips),
        "copiedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    })


def queue_counts(payload: Dict[str, Any]) -> Tuple[int, int]:
    running = payload.get("queue_running")
    pending = payload.get("queue_pending")
    return (len(running) if isinstance(running, list) else 0, len(pending) if isinstance(pending, list) else 0)


def wait_for_comfy_idle(args: argparse.Namespace, owner_key: str, job_id: str) -> None:
    deadline = time.time() + max(60, int(args.comfy_idle_timeout_seconds))
    last_log = 0.0
    while True:
        queue = request_json("GET", build_url(args.comfy_url, "/queue"), timeout=15)
        running, pending = queue_counts(queue)
        if running == 0 and pending == 0:
            log("[gpu] RTX 3090 ComfyUI queue is idle.")
            return
        assert_job_active(args, owner_key, job_id)
        checkpoint(
            args,
            owner_key,
            job_id,
            5,
            "Waiting for the RTX 3090 ComfyUI queue to become idle before Applio training.",
            {"currentStage": "waiting_for_comfy_idle", "queueRunning": running, "queuePending": pending},
        )
        if time.time() >= deadline:
            raise RuntimeError(
                f"Timed out waiting for RTX 3090 ComfyUI queue to become idle. running={running}; pending={pending}"
            )
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


def free_vram_mib() -> int | None:
    try:
        result = subprocess.run(
            ["nvidia-smi", "--query-gpu=memory.free", "--format=csv,noheader,nounits", "-i", "0"],
            capture_output=True,
            text=True,
            timeout=20,
            check=True,
        )
        return int(result.stdout.strip().splitlines()[0])
    except Exception as error:
        log(f"[warn] Could not read free VRAM with nvidia-smi: {error}")
        return None


def wait_for_free_vram(args: argparse.Namespace, owner_key: str, job_id: str) -> int | None:
    deadline = time.time() + max(30, int(args.vram_wait_seconds))
    while True:
        free = free_vram_mib()
        if free is None or free >= int(args.min_free_vram_mib):
            return free
        assert_job_active(args, owner_key, job_id)
        checkpoint(
            args,
            owner_key,
            job_id,
            5,
            f"Waiting for RTX 3090 free VRAM before Applio training: {free} MiB available.",
            {"currentStage": "waiting_for_vram", "freeVramMiB": free, "requiredFreeVramMiB": int(args.min_free_vram_mib)},
        )
        if time.time() >= deadline:
            raise RuntimeError(
                f"RTX 3090 free VRAM stayed below {args.min_free_vram_mib} MiB. Last reading: {free} MiB."
            )
        log(f"[wait] RTX 3090 free VRAM {free} MiB; need {args.min_free_vram_mib} MiB.")
        time.sleep(10)


def acquire_gpu_lock(args: argparse.Namespace, owner_key: str, job_id: str):
    path = Path(args.gpu_lock_file).expanduser()
    path.parent.mkdir(parents=True, exist_ok=True)
    handle = path.open("a+")
    deadline = time.time() + max(60, int(args.gpu_lock_wait_seconds))
    log(f"[gpu-lock] Waiting for shared voice GPU lock: {path}")
    while True:
        try:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            handle.seek(0)
            handle.truncate()
            handle.write(f"linux-applio-training-worker pid={os.getpid()} job={job_id} acquired={time.time()}\n")
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
                "Waiting for the shared RTX 3090 voice GPU lock before Applio training.",
                {"currentStage": "waiting_for_gpu_lock"},
            )
            if time.time() >= deadline:
                handle.close()
                raise RuntimeError(f"Timed out waiting for shared voice GPU lock: {path}")
            time.sleep(5)


def require_applio_file(path: Path, label: str) -> None:
    if not has_bytes(path):
        raise RuntimeError(f"Missing required Applio {label}: {path}")


def validate_applio_prerequisites(plan: Dict[str, Any]) -> None:
    root = Path(plan["applioRoot"])
    f0_method = clean(plan["f0Method"]).lower()
    predictors = root / "rvc" / "models" / "predictors"
    if f0_method == "rmvpe":
        require_applio_file(predictors / "rmvpe.pt", "RMVPE predictor model for APPLIO_F0_METHOD=rmvpe")
    elif f0_method == "fcpe":
        require_applio_file(predictors / "fcpe.pt", "FCPE predictor model for APPLIO_F0_METHOD=fcpe")

    if plan["pretrained"] == "True" and plan["customPretrained"] == "False":
        pretrained_dir = root / "rvc" / "models" / "pretraineds" / clean(plan["vocoder"]).lower()
        prefix = f"{str(plan['sampleRate'])[:2]}k"
        require_applio_file(pretrained_dir / f"f0G{prefix}.pth", f"generator pretrained checkpoint for {plan['vocoder']} {plan['sampleRate']}Hz")
        require_applio_file(pretrained_dir / f"f0D{prefix}.pth", f"discriminator pretrained checkpoint for {plan['vocoder']} {plan['sampleRate']}Hz")


def command_log_payload(plan: Dict[str, Any], commands: List[Dict[str, Any]], validation: Dict[str, Any] | None = None) -> Dict[str, Any]:
    return {
        "schemaVersion": 1,
        "adapter": "applio_real_training",
        "cwd": plan["applioRoot"],
        "modelName": plan["modelName"],
        "preparedDatasetPath": plan["preparedDatasetPath"],
        "trainingQualityPreset": plan["trainingQualityPreset"],
        "epochs": plan["epochs"],
        "saveEveryEpoch": plan["saveEveryEpoch"],
        "estimatedDurationLabel": plan["estimatedDurationLabel"],
        "validation": {
            "extractCpuCores": plan["extractCpuCores"],
            "includeMutes": plan["includeMutes"],
            "saveEveryWeights": plan["saveEveryWeights"],
            "saveOnlyLatest": plan["saveOnlyLatest"],
            "pretrained": plan["pretrained"],
            "customPretrained": plan["customPretrained"],
            "vocoder": plan["vocoder"],
            "distributedEnv": plan["distributedEnv"],
            **(validation or {}),
        },
        "commands": [
            {
                "step": cmd["step"],
                "command": plan["python"],
                "cwd": plan["applioRoot"],
                "env": plan["distributedEnv"],
                "args": cmd["args"],
            }
            for cmd in commands
        ],
    }


def build_plan(args: argparse.Namespace, owner_key: str, character_id: str, job_id: str, job_input: Dict[str, Any]) -> Dict[str, Any]:
    applio_root = Path(args.applio_root).resolve()
    python = Path(args.applio_python).expanduser().absolute()
    core_script = Path(args.applio_core).resolve()
    if not applio_root.exists():
        raise RuntimeError(f"APPLIO_ROOT not found: {applio_root}")
    if not python.exists():
        raise RuntimeError(f"APPLIO_PYTHON not found: {python}")
    if not core_script.exists():
        raise RuntimeError(f"Applio core.py not found: {core_script}")

    model_name = model_name_for(character_id, job_id)
    output_dir = Path(args.data_root).resolve() / "characters" / safe_segment(owner_key) / "applio-models" / safe_segment(character_id) / safe_segment(job_id)
    logs_dir = output_dir / "logs"
    datasets_root = Path(clean(os.environ.get("APPLIO_DATASETS_ROOT")) or (Path(args.data_root).resolve().parent / "applio" / "datasets"))
    preset = clean(job_input.get("trainingQualityPreset")) or "normal"
    epochs = int(job_input.get("epochs") or os.environ.get("APPLIO_EPOCHS") or 100)
    save_every_epoch = int(job_input.get("saveEveryEpoch") or os.environ.get("APPLIO_SAVE_EVERY_EPOCH") or 10)
    master_addr = "127.0.0.1"
    master_port = derive_master_port(job_id)
    return {
        "applioRoot": str(applio_root),
        "python": str(python),
        "coreScript": str(core_script),
        "outputDir": str(output_dir),
        "logsDir": str(logs_dir),
        "stdoutPath": str(logs_dir / "applio-stdout.log"),
        "stderrPath": str(logs_dir / "applio-stderr.log"),
        "commandPath": str(logs_dir / "applio-commands.json"),
        "preparedDatasetPath": str(datasets_root / model_name),
        "modelName": model_name,
        "modelPath": str(output_dir / f"{model_name}.pth"),
        "indexPath": str(output_dir / f"{model_name}.index"),
        "sampleRate": int_env("APPLIO_SAMPLE_RATE", 40000),
        "trainingQualityPreset": preset,
        "epochs": epochs,
        "saveEveryEpoch": save_every_epoch,
        "estimatedDurationLabel": clean(job_input.get("estimatedDurationLabel")) or "45-90 minutes",
        "batchSize": int_env("APPLIO_BATCH_SIZE", 4),
        "gpu": clean(os.environ.get("APPLIO_GPU")) or "0",
        "f0Method": clean(os.environ.get("APPLIO_F0_METHOD")) or "rmvpe",
        "indexAlgorithm": clean(os.environ.get("APPLIO_INDEX_ALGORITHM")) or "Auto",
        "vocoder": clean(os.environ.get("APPLIO_VOCODER")) or "HiFi-GAN",
        "cacheDataset": "True" if clean(os.environ.get("APPLIO_CACHE_DATASET")).lower() not in {"0", "false", "no"} else "False",
        "saveEveryWeights": bool_env("APPLIO_SAVE_EVERY_WEIGHTS", "True"),
        "saveOnlyLatest": bool_env("APPLIO_SAVE_ONLY_LATEST", "False"),
        "pretrained": bool_env("APPLIO_PRETRAINED", "True"),
        "customPretrained": bool_env("APPLIO_CUSTOM_PRETRAINED", "False"),
        "cutPreprocess": clean(os.environ.get("APPLIO_CUT_PREPROCESS")) or "Skip",
        "includeMutes": int_env("APPLIO_INCLUDE_MUTES", 2),
        "preprocessCpuCores": int_env("APPLIO_PREPROCESS_CPU_CORES", min(8, os.cpu_count() or 1)),
        "extractCpuCores": int_env("APPLIO_EXTRACT_CPU_CORES", min(8, os.cpu_count() or 1)),
        "distributedEnv": {
            "MASTER_ADDR": master_addr,
            "MASTER_PORT": master_port,
            "TORCH_DISTRIBUTED_DEBUG": clean(os.environ.get("TORCH_DISTRIBUTED_DEBUG")) or "DETAIL",
        },
    }


def build_commands(plan: Dict[str, Any]) -> List[Dict[str, Any]]:
    common = ["--model_name", plan["modelName"]]
    return [
        {
            "step": "preprocess",
            "args": [
                plan["coreScript"], "preprocess", *common,
                "--dataset_path", plan["preparedDatasetPath"],
                "--sample_rate", str(plan["sampleRate"]),
                "--cpu_cores", str(plan["preprocessCpuCores"]),
                "--cut_preprocess", plan["cutPreprocess"],
            ],
        },
        {
            "step": "extract",
            "args": [
                plan["coreScript"], "extract", *common,
                "--f0_method", plan["f0Method"],
                "--gpu", plan["gpu"],
                "--sample_rate", str(plan["sampleRate"]),
                "--include_mutes", str(plan["includeMutes"]),
                "--cpu_cores", str(plan["extractCpuCores"]),
            ],
        },
        {
            "step": "train",
            "args": [
                plan["coreScript"], "train", *common,
                "--save_every_epoch", str(plan["saveEveryEpoch"]),
                "--save_only_latest", plan["saveOnlyLatest"],
                "--save_every_weights", plan["saveEveryWeights"],
                "--total_epoch", str(plan["epochs"]),
                "--sample_rate", str(plan["sampleRate"]),
                "--batch_size", str(plan["batchSize"]),
                "--gpu", plan["gpu"],
                "--pretrained", plan["pretrained"],
                "--custom_pretrained", plan["customPretrained"],
                "--vocoder", plan["vocoder"],
                "--cache_data_in_gpu", plan["cacheDataset"],
                "--index_algorithm", plan["indexAlgorithm"],
            ],
        },
    ]


def has_traceback(text: str) -> bool:
    return "Traceback (most recent call last)" in text or "ValueError:" in text or "DistNetworkError" in text


def kill_process_tree(proc: subprocess.Popen[Any]) -> None:
    if proc.poll() is not None:
        return
    try:
        os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
        proc.wait(timeout=15)
        return
    except Exception:
        pass
    try:
        os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
    except Exception:
        try:
            proc.kill()
        except Exception:
            pass


def pipe_reader(pipe: Any, chunks: List[str], log_file: Any) -> None:
    try:
        for line in iter(pipe.readline, ""):
            if not line:
                break
            chunks.append(line)
            log_file.write(line)
            log_file.flush()
    finally:
        try:
            pipe.close()
        except Exception:
            pass


def run_command(
    args: argparse.Namespace,
    owner_key: str,
    job_id: str,
    plan: Dict[str, Any],
    command: Dict[str, Any],
    progress: int,
    result: Dict[str, Any],
) -> None:
    assert_job_active(args, owner_key, job_id)
    stdout_path = Path(plan["stdoutPath"])
    stderr_path = Path(plan["stderrPath"])
    stdout_path.parent.mkdir(parents=True, exist_ok=True)
    with stdout_path.open("a", encoding="utf-8") as stdout_file, stderr_path.open("a", encoding="utf-8") as stderr_file:
        stdout_file.write(f"\n[{time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}] START {command['step']}: {plan['python']} {' '.join(command['args'])}\n")
        stdout_file.write(f"[env] MASTER_ADDR={plan['distributedEnv']['MASTER_ADDR']} MASTER_PORT={plan['distributedEnv']['MASTER_PORT']} TORCH_DISTRIBUTED_DEBUG={plan['distributedEnv']['TORCH_DISTRIBUTED_DEBUG']}\n")
        stdout_file.flush()
        env = os.environ.copy()
        env.update(plan["distributedEnv"])
        proc = subprocess.Popen(
            [plan["python"], *command["args"]],
            cwd=plan["applioRoot"],
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            start_new_session=True,
        )
        out_chunks: List[str] = []
        err_chunks: List[str] = []
        stdout_thread = threading.Thread(target=pipe_reader, args=(proc.stdout, out_chunks, stdout_file), daemon=True) if proc.stdout else None
        stderr_thread = threading.Thread(target=pipe_reader, args=(proc.stderr, err_chunks, stderr_file), daemon=True) if proc.stderr else None
        if stdout_thread:
            stdout_thread.start()
        if stderr_thread:
            stderr_thread.start()

        last_heartbeat = 0.0
        try:
            while proc.poll() is None:
                now = time.time()
                if now - last_heartbeat >= max(5, int(args.heartbeat_seconds)):
                    assert_job_active(args, owner_key, job_id)
                    checkpoint(args, owner_key, job_id, progress, f"Applio {command['step']} running.", result)
                    last_heartbeat = now
                time.sleep(2)
        except (TerminatedJob, KeyboardInterrupt):
            kill_process_tree(proc)
            raise

        if stdout_thread:
            stdout_thread.join(timeout=5)
        if stderr_thread:
            stderr_thread.join(timeout=5)
        stdout_file.write(f"\n[{time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}] EXIT {command['step']}: {proc.returncode}\n")
        stdout_file.flush()
    stderr_text = "".join(err_chunks)
    if proc.returncode != 0:
        raise RuntimeError(f"Applio {command['step']} exited with code {proc.returncode}. stdout: {stdout_path}; stderr: {stderr_path}")
    if has_traceback(stderr_text):
        raise RuntimeError(f"Applio {command['step']} reported traceback/error despite exit code 0. stdout: {stdout_path}; stderr: {stderr_path}")


def find_outputs(plan: Dict[str, Any]) -> Tuple[Path, Path]:
    roots = [
        Path(plan["applioRoot"]) / "assets" / "weights",
        Path(plan["applioRoot"]) / "logs" / plan["modelName"],
        Path(plan["applioRoot"]) / "logs",
        Path(plan["outputDir"]),
    ]
    candidates_pth: List[Path] = []
    candidates_index: List[Path] = []
    for root in roots:
        if not root.exists():
            continue
        candidates_pth.extend(path for path in root.rglob("*.pth") if plan["modelName"] in str(path) and has_bytes(path))
        candidates_index.extend(path for path in root.rglob("*.index") if plan["modelName"] in str(path) and has_bytes(path))
    if not candidates_pth and candidates_index:
        raise RuntimeError("Applio produced index but no model checkpoint. Check --save_every_weights and train logs.")
    if not candidates_pth or not candidates_index:
        raise RuntimeError("Applio train produced index only; model training did not run.")
    candidates_pth.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    candidates_index.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    return candidates_pth[0], candidates_index[0]


def run_training_body(args: argparse.Namespace, job: Dict[str, Any]) -> None:
    owner_key = clean(job.get("ownerKey")) or clean((job.get("result") or {}).get("ownerKey"))
    job_id = clean(job.get("jobId"))
    character_id = clean(job.get("characterId")) or clean((job.get("input") or {}).get("characterId"))
    if not owner_key or not job_id or not character_id:
        raise RuntimeError("Claimed Applio job is missing ownerKey, jobId, or characterId.")
    job_input = job.get("input") if isinstance(job.get("input"), dict) else {}
    manifest_path, manifest, source_dataset_job_id = resolve_manifest(job)
    ready_clips = validate_real_manifest(manifest_path, manifest)
    plan = build_plan(args, owner_key, character_id, job_id, job_input)
    validate_applio_prerequisites(plan)
    start_time = time.time()
    base_result = {
        "mock": False,
        "adapter": "applio_real_training",
        "status": "running",
        "manifestPath": str(manifest_path),
        "manifestUrl": clean(job_input.get("manifestUrl")) or clean(manifest.get("manifestUrl")),
        "sourceDatasetJobId": source_dataset_job_id,
        "clipCount": len(ready_clips),
        "modelName": plan["modelName"],
        "trainingQualityPreset": plan["trainingQualityPreset"],
        "epochs": plan["epochs"],
        "saveEveryEpoch": plan["saveEveryEpoch"],
        "estimatedDurationLabel": plan["estimatedDurationLabel"],
        "trainingStartedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(start_time)),
        "stdoutPath": plan["stdoutPath"],
        "stderrPath": plan["stderrPath"],
        "commandPath": plan["commandPath"],
        "preparedDatasetPath": plan["preparedDatasetPath"],
    }
    Path(plan["logsDir"]).mkdir(parents=True, exist_ok=True)
    commands = build_commands(plan)
    write_json(Path(plan["commandPath"]), command_log_payload(plan, commands))

    checkpoint(args, owner_key, job_id, 10, "Applio training worker preparing dataset.", {**base_result, "currentStage": "queued"})
    assert_job_active(args, owner_key, job_id)
    prepare_dataset(ready_clips, Path(plan["preparedDatasetPath"]), manifest_path, source_dataset_job_id)

    stage_progress = {"preprocess": 30, "extract": 50, "train": 70}
    for command in commands:
      stage = command["step"]
      progress = stage_progress.get(stage, 20)
      stage_result = {**base_result, "currentStage": stage}
      checkpoint(args, owner_key, job_id, progress, f"Applio {stage} started.", stage_result)
      run_command(args, owner_key, job_id, plan, command, progress, stage_result)
      if stage == "extract":
          config_path = Path(plan["applioRoot"]) / "logs" / plan["modelName"] / "config.json"
          write_json(Path(plan["commandPath"]), command_log_payload(plan, commands, {"postExtractConfigPath": str(config_path), "postExtractConfigExists": has_bytes(config_path)}))
          if not has_bytes(config_path):
              raise RuntimeError(f"Config file missing after Applio extract: {config_path}")
      checkpoint(args, owner_key, job_id, min(94, stage_progress.get(stage, 20) + 10), f"Applio {stage} completed.", {**base_result, "currentStage": stage})

    checkpoint(args, owner_key, job_id, 95, "Applio training worker packaging artifacts.", {**base_result, "currentStage": "artifact_copy"})
    assert_job_active(args, owner_key, job_id)
    source_model, source_index = find_outputs(plan)
    output_dir = Path(plan["outputDir"])
    output_dir.mkdir(parents=True, exist_ok=True)
    model_path = Path(plan["modelPath"])
    index_path = Path(plan["indexPath"])
    shutil.copyfile(source_model, model_path)
    shutil.copyfile(source_index, index_path)
    if not has_bytes(model_path) or not has_bytes(index_path):
        raise RuntimeError("Copied Applio model artifacts are missing or empty.")
    completed_at = time.time()
    total_ms = int((completed_at - start_time) * 1000)
    result = {
        **base_result,
        "status": "trained",
        "currentStage": "completed",
        "artifactPath": str(output_dir / "training-artifact.json"),
        "artifactUrl": f"/api/characters/applio-training/artifact?owner={urllib.parse.quote(safe_segment(owner_key))}&characterId={urllib.parse.quote(safe_segment(character_id))}&jobId={urllib.parse.quote(safe_segment(job_id))}",
        "modelPath": str(model_path),
        "indexPath": str(index_path),
        "sourceModelPath": str(source_model),
        "sourceIndexPath": str(source_index),
        "expectedModelPath": str(model_path),
        "expectedIndexPath": str(index_path),
        "trainingCompletedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(completed_at)),
        "totalTrainingMs": total_ms,
        "totalTrainingLabel": f"{round(total_ms / 1000)}s",
    }
    artifact = {
        "schemaVersion": 1,
        "ownerKey": owner_key,
        "characterId": character_id,
        "jobId": job_id,
        "createdAt": result["trainingCompletedAt"],
        "status": "trained",
        "mock": False,
        "adapter": "applio_real_training",
        "dataset": {
            "manifestPath": str(manifest_path),
            "manifestUrl": result.get("manifestUrl", ""),
            "sourceDatasetJobId": source_dataset_job_id,
            "clipCount": len(ready_clips),
            "preparedDatasetPath": plan["preparedDatasetPath"],
            "generationMode": "real",
            "provider": "indextts2",
        },
        "model": {
            "modelName": plan["modelName"],
            "expectedModelPath": str(model_path),
            "expectedIndexPath": str(index_path),
            "expectedConfigPath": str(Path(plan["applioRoot"]) / "logs" / plan["modelName"] / "config.json"),
            "modelPath": str(model_path),
            "indexPath": str(index_path),
            "sourceModelPath": str(source_model),
            "sourceIndexPath": str(source_index),
            "status": "trained",
        },
        "logs": {
            "logsDir": plan["logsDir"],
            "stdoutPath": plan["stdoutPath"],
            "stderrPath": plan["stderrPath"],
            "commandPath": plan["commandPath"],
        },
        "trainingQualityPreset": plan["trainingQualityPreset"],
        "epochs": plan["epochs"],
        "saveEveryEpoch": plan["saveEveryEpoch"],
        "estimatedDurationLabel": plan["estimatedDurationLabel"],
        "trainingStartedAt": result["trainingStartedAt"],
        "trainingCompletedAt": result["trainingCompletedAt"],
        "totalTrainingMs": result["totalTrainingMs"],
        "totalTrainingLabel": result["totalTrainingLabel"],
        "note": "Real Applio model trained by the dedicated Linux RTX 3090 Applio worker.",
    }
    write_json(output_dir / "training-artifact.json", artifact)
    complete_job(args, owner_key, job_id, result, f"Real Applio training complete. modelPath: {model_path}; indexPath: {index_path}")


def run_training(args: argparse.Namespace, job: Dict[str, Any]) -> None:
    owner_key = clean(job.get("ownerKey")) or clean((job.get("result") or {}).get("ownerKey"))
    job_id = clean(job.get("jobId"))
    if not owner_key or not job_id:
        raise RuntimeError("Claimed Applio job is missing ownerKey or jobId.")
    gpu_lock = None
    try:
        gpu_lock = acquire_gpu_lock(args, owner_key, job_id)
        wait_for_comfy_idle(args, owner_key, job_id)
        release_comfy_models(args)
        free = wait_for_free_vram(args, owner_key, job_id)
        log(f"[gpu] RTX 3090 free VRAM before Applio: {free if free is not None else 'unknown'} MiB")
        run_training_body(args, job)
    finally:
        if gpu_lock is not None:
            try:
                fcntl.flock(gpu_lock.fileno(), fcntl.LOCK_UN)
                gpu_lock.close()
                log("[gpu-lock] Released shared voice GPU lock.")
            except Exception as error:
                log(f"[warn] Could not release GPU lock cleanly: {error}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Dedicated OTG Linux Applio training worker.")
    parser.add_argument("--repo", default=os.environ.get("OTG_REPO", "/home/shawn-rochford/AI/deploy/otg-test/current"))
    parser.add_argument("--base-url", default=os.environ.get("OTG_BASE_URL", "http://100.75.162.64:3001"))
    parser.add_argument("--device-id", default=os.environ.get("OTG_DEVICE_ID", "linux-applio"))
    parser.add_argument("--worker-id", default=os.environ.get("OTG_WORKER_ID", "linux-applio-training-worker"))
    parser.add_argument("--worker-token", default=os.environ.get("OTG_WORKER_TOKEN", ""))
    parser.add_argument("--applio-root", default=os.environ.get("APPLIO_ROOT", "/home/shawn-rochford/AI/runtime/test/Applio"))
    parser.add_argument("--applio-python", default=os.environ.get("APPLIO_PYTHON", "/home/shawn-rochford/AI/runtime/test/Applio/.venv/bin/python"))
    parser.add_argument("--applio-core", default=os.environ.get("APPLIO_CORE_SCRIPT") or os.environ.get("APPLIO_TRAIN_SCRIPT") or "/home/shawn-rochford/AI/runtime/test/Applio/core.py")
    parser.add_argument("--data-root", default=os.environ.get("OTG_DATA_DIR", "/home/shawn-rochford/AI/runtime/test/data"))
    parser.add_argument("--comfy-url", default=os.environ.get("OTG_PRIMARY_COMFY_URL", "http://100.75.162.64:8188"))
    parser.add_argument("--gpu-lock-file", default=os.environ.get("OTG_VOICE_GPU_LOCK_FILE", "/home/shawn-rochford/AI/runtime/test/voice-gpu.lock"))
    parser.add_argument("--poll-seconds", type=int, default=int(os.environ.get("OTG_APPLIO_WORKER_POLL_SECONDS", "30")))
    parser.add_argument("--heartbeat-seconds", type=int, default=int(os.environ.get("OTG_APPLIO_WORKER_HEARTBEAT_SECONDS", "20")))
    parser.add_argument("--comfy-idle-timeout-seconds", type=int, default=int(os.environ.get("OTG_APPLIO_COMFY_IDLE_TIMEOUT_SECONDS", "1800")))
    parser.add_argument("--gpu-lock-wait-seconds", type=int, default=int(os.environ.get("OTG_APPLIO_GPU_LOCK_WAIT_SECONDS", "21600")))
    parser.add_argument("--min-free-vram-mib", type=int, default=int(os.environ.get("OTG_APPLIO_MIN_FREE_VRAM_MIB", "16384")))
    parser.add_argument("--vram-wait-seconds", type=int, default=int(os.environ.get("OTG_APPLIO_VRAM_WAIT_SECONDS", "300")))
    parser.add_argument("--once", action="store_true")
    args = parser.parse_args()

    if not clean(args.worker_token):
        raise RuntimeError("OTG_WORKER_TOKEN is required for universal Applio worker claim mode.")

    log("Starting dedicated OTG Linux Applio training worker")
    log("  Route: character_voice_pipeline / start_applio_training only")
    log(f"  BaseUrl: {args.base_url}")
    log(f"  WorkerId: {args.worker_id}")
    log(f"  ApplioRoot: {args.applio_root}")
    log(f"  DataRoot: {args.data_root}")
    log(f"  ComfyUrl: {args.comfy_url}")
    log(f"  GpuLock: {args.gpu_lock_file}")

    while True:
        try:
            job = claim_job(args)
            if not job:
                log("[idle] No queued start_applio_training job available.")
                if args.once:
                    return 0
                time.sleep(max(5, args.poll_seconds))
                continue
            log(f"[claim] {job.get('jobId')} owner={job.get('ownerKey')} character={job.get('characterId')}")
            try:
                run_training(args, job)
                log(f"[complete] {job.get('jobId')}")
            except TerminatedJob as error:
                log(f"[terminated] {job.get('jobId')}: {error}")
            except Exception as error:
                owner_key = clean(job.get("ownerKey")) or clean((job.get("result") or {}).get("ownerKey"))
                job_id = clean(job.get("jobId"))
                failed = {
                    "mock": False,
                    "adapter": "applio_real_training",
                    "status": "failed",
                    "failedStage": "failed",
                    "trainingFailedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                    "message": str(error),
                }
                if owner_key and job_id:
                    try:
                        fail_job(args, owner_key, job_id, str(error), failed)
                    except Exception as fail_error:
                        log(f"[warn] Could not mark job failed: {fail_error}")
                log(f"[failed] {job_id}: {error}")
                traceback.print_exc()
            if args.once:
                return 0
        except KeyboardInterrupt:
            return 130
        except Exception as error:
            log(f"[error] worker loop failed: {error}")
            traceback.print_exc()
            if args.once:
                return 1
            time.sleep(max(5, args.poll_seconds))


if __name__ == "__main__":
    sys.exit(main())
