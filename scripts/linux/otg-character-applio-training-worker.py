#!/usr/bin/env python3
"""Linux Applio model-training worker for ComfyUI-OTG TEST.

Claims only:
  jobType=character_voice_pipeline
  action=start_applio_training

The worker validates a real adaptive/QC-passing IndexTTS2 voice pack, serializes
RTX 3090 access through the shared voice GPU lock, runs RVC v2 at 48 kHz with
RMVPE/pitch guidance, evaluates inference-ready checkpoint candidates on held-out
conversions, and persists the verified winner without involving PROD.
"""

from __future__ import annotations

import argparse
import fcntl
import hashlib
import json
import os
import re
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



def load_voice_training_policy() -> Tuple[Dict[str, Any], Path]:
    policy_path = Path(
        clean(os.environ.get("OTG_VOICE_TRAINING_POLICY"))
        or (Path(__file__).resolve().parents[2] / "config" / "voice-training-policy.json")
    ).resolve()
    if not policy_path.is_file():
        raise RuntimeError(f"Voice training policy missing: {policy_path}")
    policy = read_json(policy_path)
    rvc = policy.get("rvc") if isinstance(policy.get("rvc"), dict) else {}
    if clean(rvc.get("version")).lower() != "v2":
        raise RuntimeError("Voice training policy must require RVC v2.")
    if int(rvc.get("sampleRate") or 0) != 48000:
        raise RuntimeError("Voice training policy must require 48000 Hz RVC training.")
    if clean(rvc.get("pitchExtractor")).lower() != "rmvpe":
        raise RuntimeError("Voice training policy must require RMVPE pitch extraction.")
    if rvc.get("pitchGuidance") is not True:
        raise RuntimeError("Voice training policy must keep RVC pitch guidance enabled.")
    if clean(policy.get("checkpointSelection")).lower() != "held-out-best":
        raise RuntimeError("Voice training policy must require held-out-best checkpoint selection.")
    return policy, policy_path


def validate_real_manifest(
    manifest_path: Path,
    manifest: Dict[str, Any],
    policy: Dict[str, Any],
) -> List[Dict[str, Any]]:
    clips = manifest.get("clips") if isinstance(manifest.get("clips"), list) else []
    ready = [
        clip
        for clip in clips
        if isinstance(clip, dict)
        and clean(clip.get("status")) == "ready"
        and isinstance(clip.get("qc"), dict)
        and clip["qc"].get("pass") is True
    ]
    if manifest.get("mock") is not False or clean(manifest.get("generationMode")) != "real":
        raise RuntimeError(f"Real Applio training requires a real IndexTTS2 voice pack: {manifest_path}")
    if clean(manifest.get("status")) != "voice_pack_ready":
        raise RuntimeError(f"Real Applio training requires manifest status voice_pack_ready: {manifest_path}")
    if manifest.get("adaptiveComplete") is not True:
        raise RuntimeError("Real Applio training requires adaptiveComplete:true after dataset QC.")

    accepted_duration_seconds = float(manifest.get("acceptedDurationSeconds") or 0.0)
    minimum_seconds = float(policy.get("acceptedMinutesMin") or 8.0) * 60.0
    maximum_seconds = float(policy.get("acceptedMinutesMax") or 12.0) * 60.0
    if accepted_duration_seconds < minimum_seconds or accepted_duration_seconds > maximum_seconds:
        raise RuntimeError(
            "Adaptive voice pack duration is outside policy: "
            f"acceptedDurationSeconds={accepted_duration_seconds:.2f}; "
            f"required={minimum_seconds:.0f}-{maximum_seconds:.0f}."
        )
    if not ready:
        raise RuntimeError("Adaptive voice pack has no ready clips with qc.pass:true.")

    for clip in ready:
        clip_path = Path(clean(clip.get("expectedAudioPath")))
        if not has_bytes(clip_path):
            raise RuntimeError(f"QC-passing dataset clip is missing or empty: {clip.get('clipId')} {clip_path}")
    return ready


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



def build_plan(
    args: argparse.Namespace,
    owner_key: str,
    character_id: str,
    job_id: str,
    job_input: Dict[str, Any],
    policy: Dict[str, Any],
) -> Dict[str, Any]:
    applio_root = Path(args.applio_root).resolve()
    python = Path(args.applio_python).expanduser().absolute()
    core_script = Path(args.applio_core).resolve()
    if not applio_root.exists():
        raise RuntimeError(f"APPLIO_ROOT not found: {applio_root}")
    if not python.exists():
        raise RuntimeError(f"APPLIO_PYTHON not found: {python}")
    if not core_script.exists():
        raise RuntimeError(f"Applio core.py not found: {core_script}")

    rvc = policy.get("rvc") if isinstance(policy.get("rvc"), dict) else {}
    sample_rate = int(rvc.get("sampleRate") or 48000)
    f0_method = clean(rvc.get("pitchExtractor")) or "rmvpe"
    if sample_rate != 48000 or f0_method.lower() != "rmvpe":
        raise RuntimeError("Phase 1B-B requires RVC v2 48000 Hz with RMVPE.")

    model_name = model_name_for(character_id, job_id)
    output_dir = Path(args.data_root).resolve() / "characters" / safe_segment(owner_key) / "applio-models" / safe_segment(character_id) / safe_segment(job_id)
    logs_dir = output_dir / "logs"
    datasets_root = Path(clean(os.environ.get("APPLIO_DATASETS_ROOT")) or (Path(args.data_root).resolve().parent / "applio" / "datasets"))
    preset = clean(job_input.get("trainingQualityPreset")) or "normal"
    epochs = int(job_input.get("epochs") or os.environ.get("APPLIO_EPOCHS") or 100)
    save_every_epoch = int(job_input.get("saveEveryEpoch") or os.environ.get("APPLIO_SAVE_EVERY_EPOCH") or 10)
    if epochs > 1 and save_every_epoch >= epochs:
        save_every_epoch = max(1, epochs // 4)
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
        "sampleRate": 48000,
        "rvcVersion": "v2",
        "pitchGuidance": True,
        "checkpointSelection": "held-out-best",
        "trainingQualityPreset": preset,
        "epochs": epochs,
        "saveEveryEpoch": save_every_epoch,
        "estimatedDurationLabel": clean(job_input.get("estimatedDurationLabel")) or "45-90 minutes",
        "batchSize": int_env("APPLIO_BATCH_SIZE", 4),
        "gpu": clean(os.environ.get("APPLIO_GPU")) or "0",
        "f0Method": "rmvpe",
        "indexAlgorithm": clean(os.environ.get("APPLIO_INDEX_ALGORITHM")) or "Auto",
        "vocoder": clean(os.environ.get("APPLIO_VOCODER")) or "HiFi-GAN",
        "cacheDataset": "True" if clean(os.environ.get("APPLIO_CACHE_DATASET")).lower() not in {"0", "false", "no"} else "False",
        "saveEveryWeights": "True",
        "saveOnlyLatest": "False",
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
            "APPLIO_SAMPLE_RATE": "48000",
            "APPLIO_F0_METHOD": "rmvpe",
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



def checkpoint_candidate_pattern(model_name: str) -> re.Pattern[str]:
    return re.compile(rf"^{re.escape(model_name)}_(\d+)e_(\d+)s\.pth$")


def discover_checkpoint_candidates(plan: Dict[str, Any]) -> List[Dict[str, Any]]:
    model_root = Path(plan["applioRoot"]) / "logs" / plan["modelName"]
    pattern = checkpoint_candidate_pattern(plan["modelName"])
    candidates: List[Dict[str, Any]] = []
    if model_root.is_dir():
        for path in model_root.iterdir():
            if not path.is_file() or not has_bytes(path):
                continue
            match = pattern.fullmatch(path.name)
            if not match:
                continue
            candidates.append({
                "path": path,
                "epoch": int(match.group(1)),
                "step": int(match.group(2)),
            })
    candidates.sort(key=lambda item: (item["epoch"], item["step"], str(item["path"])))
    if not candidates:
        raise RuntimeError(
            "Applio training produced no inference-ready checkpoint candidates matching "
            f"{plan['modelName']}_<epoch>e_<step>s.pth in {model_root}."
        )
    return candidates


def discover_trained_index(plan: Dict[str, Any]) -> Path:
    model_root = Path(plan["applioRoot"]) / "logs" / plan["modelName"]
    exact = model_root / f"{plan['modelName']}.index"
    if has_bytes(exact):
        return exact
    found = [
        path
        for path in model_root.rglob("*.index")
        if has_bytes(path) and plan["modelName"] in path.name
    ] if model_root.is_dir() else []
    found.sort(key=lambda path: (0 if path.name == f"{plan['modelName']}.index" else 1, str(path)))
    if not found:
        raise RuntimeError(f"Applio produced no trained index for {plan['modelName']} in {model_root}.")
    return found[0]


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def resolve_original_reference(
    args: argparse.Namespace,
    owner_key: str,
    manifest: Dict[str, Any],
    job_input: Dict[str, Any],
    output_dir: Path,
) -> Tuple[Path, Dict[str, Any]]:
    source = manifest.get("source") if isinstance(manifest.get("source"), dict) else {}
    path_values = [
        source.get("originalSourcePath"),
        job_input.get("originalSourcePath"),
        job_input.get("referenceAudioPath"),
        source.get("approvedSamplePath"),
        job_input.get("approvedSamplePath"),
    ]
    for value in path_values:
        candidate_value = clean(value)
        if not candidate_value:
            continue
        candidate = Path(candidate_value).expanduser()
        if has_bytes(candidate):
            return candidate.resolve(), {
                "referenceMode": "original-sample-only",
                "path": str(candidate.resolve()),
                "url": clean(source.get("originalSourceUrl") or source.get("approvedSampleUrl")),
                "sha256": sha256_file(candidate),
            }

    url_values = [
        source.get("originalSourceUrl"),
        job_input.get("originalSourceUrl"),
        job_input.get("referenceAudioUrl"),
        source.get("approvedSampleUrl"),
        job_input.get("approvedSampleUrl"),
    ]
    target = output_dir / "held-out" / "original-reference.wav"
    for value in url_values:
        url_value = clean(value)
        if not url_value:
            continue
        url = build_url(args.base_url, url_value)
        target.parent.mkdir(parents=True, exist_ok=True)
        request = urllib.request.Request(url, headers=auth_headers(args, owner_key), method="GET")
        try:
            with urllib.request.urlopen(request, timeout=600) as response, target.open("wb") as handle:
                shutil.copyfileobj(response, handle)
        except urllib.error.HTTPError as error:
            raw = error.read().decode("utf-8", errors="replace")
            log(f"[warn] Could not download original reference {url}: HTTP {error.code}: {raw}")
            target.unlink(missing_ok=True)
            continue
        if has_bytes(target):
            return target, {
                "referenceMode": "original-sample-only",
                "path": str(target),
                "url": url_value,
                "sha256": sha256_file(target),
            }
    raise RuntimeError("Held-out checkpoint evaluation requires the original saved Character Voice Sample.")


def run_checkpoint_evaluation(
    args: argparse.Namespace,
    owner_key: str,
    job_id: str,
    plan: Dict[str, Any],
    policy_path: Path,
    candidates: List[Dict[str, Any]],
    index_path: Path,
    reference_audio: Path,
) -> Dict[str, Any]:
    evaluator = Path(__file__).resolve().with_name("otg-rvc-held-out-checkpoint-evaluator.py")
    qc_python = Path(clean(os.environ.get("OTG_VOICE_QC_PYTHON")) or "/home/shawn-rochford/AI/runtime/test/voice-qc/speechbrain-ecapa/venv/bin/python")
    speaker_model_dir = Path(clean(os.environ.get("OTG_VOICE_QC_SPEAKER_MODEL_DIR")) or "/home/shawn-rochford/AI/runtime/test/voice-qc/speechbrain-ecapa/models/spkrec-ecapa-voxceleb")
    hf_home = Path(clean(os.environ.get("OTG_VOICE_QC_HF_HOME")) or "/home/shawn-rochford/AI/runtime/test/voice-qc/speechbrain-ecapa/hf-cache")
    if not evaluator.is_file() or not qc_python.is_file() or not speaker_model_dir.is_dir() or not hf_home.is_dir():
        raise RuntimeError(
            f"Held-out evaluator runtime incomplete. evaluator={evaluator}; qcPython={qc_python}; "
            f"speakerModel={speaker_model_dir}; hfHome={hf_home}"
        )

    evaluation_root = Path(plan["outputDir"]) / "held-out"
    result_path = evaluation_root / "checkpoint-evaluation.json"
    stdout_path = evaluation_root / "checkpoint-evaluation.stdout.log"
    stderr_path = evaluation_root / "checkpoint-evaluation.stderr.log"
    evaluation_root.mkdir(parents=True, exist_ok=True)

    command = [
        str(qc_python),
        str(evaluator),
        "--policy-path", str(policy_path),
        "--applio-root", plan["applioRoot"],
        "--applio-python", plan["python"],
        "--core-script", plan["coreScript"],
        "--model-name", plan["modelName"],
        "--index-path", str(index_path),
        "--reference-audio", str(reference_audio),
        "--speaker-model-dir", str(speaker_model_dir),
        "--hf-home", str(hf_home),
        "--base-url", args.base_url,
        "--work-dir", str(evaluation_root),
        "--output-json", str(result_path),
    ]
    for candidate in candidates:
        command.extend(["--candidate", str(candidate["path"])])

    env = os.environ.copy()
    env["OTG_OWNER_KEY"] = owner_key
    env["OTG_WORKER_TOKEN"] = clean(args.worker_token)
    env["HF_HOME"] = str(hf_home)
    env["HF_HUB_OFFLINE"] = "1"
    env["TRANSFORMERS_OFFLINE"] = "1"
    env["APPLIO_SAMPLE_RATE"] = "48000"
    env["APPLIO_F0_METHOD"] = "rmvpe"
    timeout = int(clean(os.environ.get("OTG_APPLIO_CHECKPOINT_EVALUATION_TIMEOUT_SECONDS")) or "7200")

    assert_job_active(args, owner_key, job_id)
    with stdout_path.open("w", encoding="utf-8") as stdout_file, stderr_path.open("w", encoding="utf-8") as stderr_file:
        process = subprocess.run(
            command,
            cwd=plan["applioRoot"],
            env=env,
            stdout=stdout_file,
            stderr=stderr_file,
            text=True,
            timeout=timeout,
        )
    if process.returncode != 0 or not has_bytes(result_path):
        stdout_tail = stdout_path.read_text(encoding="utf-8", errors="replace")[-4000:] if stdout_path.exists() else ""
        stderr_tail = stderr_path.read_text(encoding="utf-8", errors="replace")[-4000:] if stderr_path.exists() else ""
        raise RuntimeError(
            f"Held-out checkpoint evaluation failed rc={process.returncode}. "
            f"stdout={stdout_tail}; stderr={stderr_tail}"
        )
    evaluation = read_json(result_path)
    selected = evaluation.get("selectedCheckpoint") if isinstance(evaluation.get("selectedCheckpoint"), dict) else {}
    selected_path = Path(clean(selected.get("sourcePath")))
    valid_paths = {str(item["path"].resolve()) for item in candidates}
    if str(selected_path.resolve()) not in valid_paths or not has_bytes(selected_path):
        raise RuntimeError(f"Evaluator returned invalid selectedCheckpoint: {selected}")
    if not isinstance(evaluation.get("checkpointEvaluations"), list) or not evaluation["checkpointEvaluations"]:
        raise RuntimeError("Evaluator returned no checkpointEvaluations.")
    return evaluation



def run_training_body(args: argparse.Namespace, job: Dict[str, Any]) -> None:
    owner_key = clean(job.get("ownerKey")) or clean((job.get("result") or {}).get("ownerKey"))
    job_id = clean(job.get("jobId"))
    character_id = clean(job.get("characterId")) or clean((job.get("input") or {}).get("characterId"))
    if not owner_key or not job_id or not character_id:
        raise RuntimeError("Claimed Applio job is missing ownerKey, jobId, or characterId.")
    job_input = job.get("input") if isinstance(job.get("input"), dict) else {}
    manifest_path, manifest, source_dataset_job_id = resolve_manifest(job)
    policy, policy_path = load_voice_training_policy()
    ready_clips = validate_real_manifest(manifest_path, manifest, policy)
    plan = build_plan(args, owner_key, character_id, job_id, job_input, policy)
    validate_applio_prerequisites(plan)
    start_time = time.time()
    accepted_duration_seconds = float(manifest.get("acceptedDurationSeconds") or 0.0)
    base_result = {
        "mock": False,
        "adapter": "applio_real_training",
        "status": "running",
        "manifestPath": str(manifest_path),
        "manifestUrl": clean(job_input.get("manifestUrl")) or clean(manifest.get("manifestUrl")),
        "sourceDatasetJobId": source_dataset_job_id,
        "clipCount": len(ready_clips),
        "acceptedDurationSeconds": accepted_duration_seconds,
        "acceptedMinutes": accepted_duration_seconds / 60.0,
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
        "rvcVersion": "v2",
        "sampleRate": 48000,
        "pitchExtractor": "rmvpe",
        "pitchGuidance": True,
        "checkpointSelection": "held-out-best",
        "trainingPolicy": {
            "path": str(policy_path),
            "thresholdStatus": clean(policy.get("thresholdStatus")),
        },
    }
    Path(plan["logsDir"]).mkdir(parents=True, exist_ok=True)
    commands = build_commands(plan)
    write_json(Path(plan["commandPath"]), command_log_payload(plan, commands, {
        "rvcVersion": "v2",
        "sampleRate": 48000,
        "pitchExtractor": "rmvpe",
        "pitchGuidance": True,
        "checkpointSelection": "held-out-best",
    }))

    checkpoint(args, owner_key, job_id, 10, "Applio training worker preparing adaptive QC-passing dataset.", {**base_result, "currentStage": "queued"})
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
            write_json(Path(plan["commandPath"]), command_log_payload(plan, commands, {
                "postExtractConfigPath": str(config_path),
                "postExtractConfigExists": has_bytes(config_path),
                "rvcVersion": "v2",
                "sampleRate": 48000,
                "pitchExtractor": "rmvpe",
                "pitchGuidance": True,
            }))
            if not has_bytes(config_path):
                raise RuntimeError(f"Config file missing after Applio extract: {config_path}")
        checkpoint(args, owner_key, job_id, min(94, stage_progress.get(stage, 20) + 10), f"Applio {stage} completed.", {**base_result, "currentStage": stage})

    assert_job_active(args, owner_key, job_id)
    checkpoint_candidates = discover_checkpoint_candidates(plan)
    source_index = discover_trained_index(plan)
    output_dir = Path(plan["outputDir"])
    original_reference, source_reference = resolve_original_reference(
        args,
        owner_key,
        manifest,
        job_input,
        output_dir,
    )

    checkpoint(args, owner_key, job_id, 95, "Testing RVC checkpoint candidates on independent held-out conversions.", {
        **base_result,
        "currentStage": "testing_voice_model",
        "checkpointCandidates": [
            {"path": str(item["path"]), "epoch": item["epoch"], "step": item["step"]}
            for item in checkpoint_candidates
        ],
        "sourceReference": source_reference,
    })
    evaluation = run_checkpoint_evaluation(
        args,
        owner_key,
        job_id,
        plan,
        policy_path,
        checkpoint_candidates,
        source_index,
        original_reference,
    )
    selected_checkpoint = dict(evaluation["selectedCheckpoint"])
    source_model = Path(clean(selected_checkpoint.get("sourcePath"))).resolve()
    if not has_bytes(source_model):
        raise RuntimeError(f"Selected checkpoint is missing after evaluation: {source_model}")

    checkpoint(args, owner_key, job_id, 98, "Finalizing the verified held-out-best HQ Voice Model.", {
        **base_result,
        "currentStage": "finalizing",
        "selectedCheckpoint": selected_checkpoint,
        "checkpointEvaluations": evaluation["checkpointEvaluations"],
        "speakerSimilarity": selected_checkpoint.get("speakerSimilarity"),
        "transcriptIntelligibility": selected_checkpoint.get("transcriptIntelligibility"),
        "audioQualityArtifact": selected_checkpoint.get("audioQualityArtifact"),
        "performanceDuration": selected_checkpoint.get("performanceDuration"),
        "qualityControl": evaluation.get("qualityControl"),
    })

    output_dir.mkdir(parents=True, exist_ok=True)
    model_path = Path(plan["modelPath"])
    index_path = Path(plan["indexPath"])
    shutil.copyfile(source_model, model_path)
    shutil.copyfile(source_index, index_path)
    if not has_bytes(model_path) or not has_bytes(index_path):
        raise RuntimeError("Copied held-out-selected Applio model artifacts are missing or empty.")

    selected_checkpoint.update({
        "canonicalModelPath": str(model_path),
        "canonicalIndexPath": str(index_path),
        "sourceIndexPath": str(source_index),
    })
    evaluation["selectedCheckpoint"] = selected_checkpoint
    evaluation["sourceReference"] = {
        **(evaluation.get("sourceReference") if isinstance(evaluation.get("sourceReference"), dict) else {}),
        **source_reference,
    }

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
        "selectedCheckpoint": selected_checkpoint,
        "checkpointEvaluations": evaluation["checkpointEvaluations"],
        "heldOutEvaluation": evaluation.get("heldOutEvaluation"),
        "qualityControl": evaluation.get("qualityControl"),
        "sourceReference": evaluation.get("sourceReference"),
        "trainingPolicy": evaluation.get("trainingPolicy") or base_result["trainingPolicy"],
        "rvcVersion": "v2",
        "sampleRate": 48000,
        "pitchExtractor": "rmvpe",
        "pitchGuidance": True,
        "checkpointSelection": "held-out-best",
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
            "acceptedDurationSeconds": accepted_duration_seconds,
            "acceptedMinutes": accepted_duration_seconds / 60.0,
            "adaptiveComplete": True,
            "qualityControl": manifest.get("qualityControl"),
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
            "rvcVersion": "v2",
            "sampleRate": 48000,
            "pitchExtractor": "rmvpe",
            "pitchGuidance": True,
            "checkpointSelection": "held-out-best",
            "selectedCheckpoint": selected_checkpoint,
        },
        "selectedCheckpoint": selected_checkpoint,
        "checkpointEvaluations": evaluation["checkpointEvaluations"],
        "heldOutEvaluation": evaluation.get("heldOutEvaluation"),
        "qualityControl": evaluation.get("qualityControl"),
        "sourceReference": evaluation.get("sourceReference"),
        "trainingPolicy": evaluation.get("trainingPolicy") or base_result["trainingPolicy"],
        "rvcVersion": "v2",
        "sampleRate": 48000,
        "pitchExtractor": "rmvpe",
        "pitchGuidance": True,
        "checkpointSelection": "held-out-best",
        "logs": {
            "logsDir": plan["logsDir"],
            "stdoutPath": plan["stdoutPath"],
            "stderrPath": plan["stderrPath"],
            "commandPath": plan["commandPath"],
            "heldOutEvaluationPath": str(output_dir / "held-out" / "checkpoint-evaluation.json"),
        },
        "trainingQualityPreset": plan["trainingQualityPreset"],
        "epochs": plan["epochs"],
        "saveEveryEpoch": plan["saveEveryEpoch"],
        "estimatedDurationLabel": plan["estimatedDurationLabel"],
        "trainingStartedAt": result["trainingStartedAt"],
        "trainingCompletedAt": result["trainingCompletedAt"],
        "totalTrainingMs": result["totalTrainingMs"],
        "totalTrainingLabel": result["totalTrainingLabel"],
        "note": "Real RVC v2 48 kHz model trained on Linux RTX 3090; held-out conversions selected the verified best checkpoint.",
    }
    write_json(output_dir / "training-artifact.json", artifact)
    complete_job(
        args,
        owner_key,
        job_id,
        result,
        f"Real Applio training complete. held-out-selected modelPath: {model_path}; indexPath: {index_path}",
    )


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
