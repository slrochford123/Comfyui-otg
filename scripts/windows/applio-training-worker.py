#!/usr/bin/env python3
import argparse
import json
import os
import shutil
import subprocess
import threading
import sys
import time
import traceback
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timezone
from pathlib import Path


def utc_now():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def clean(value):
    return str(value or "").strip()


def safe_segment(value, fallback="value"):
    raw = clean(value)
    out = "".join(ch if ch.isalnum() or ch in ("-", "_", ".") else "_" for ch in raw).strip("._-")
    return out[:120] or fallback


def join_url(base_url, path):
    base = base_url.rstrip("/")
    if path.startswith("http://") or path.startswith("https://"):
        return path
    return base + "/" + path.lstrip("/")


def request_json(method, url, headers=None, data=None, timeout=120):
    body = None
    request_headers = dict(headers or {})
    if data is not None:
        body = json.dumps(data).encode("utf-8")
        request_headers["content-type"] = "application/json"

    req = urllib.request.Request(url, data=body, headers=request_headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            raw = response.read().decode("utf-8", errors="replace")
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as error:
        raw = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {error.code} {url}: {raw}") from error


def request_bytes(url, headers=None, timeout=300):
    req = urllib.request.Request(url, headers=dict(headers or {}), method="GET")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            return response.read()
    except urllib.error.HTTPError as error:
        raw = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {error.code} {url}: {raw}") from error


def encode_multipart(fields, files):
    boundary = "----otg-applio-" + uuid.uuid4().hex
    chunks = []

    for name, value in fields.items():
        chunks.append(f"--{boundary}\r\n".encode("utf-8"))
        chunks.append(f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode("utf-8"))
        chunks.append(str(value).encode("utf-8"))
        chunks.append(b"\r\n")

    for name, file_path, content_type in files:
        p = Path(file_path)
        chunks.append(f"--{boundary}\r\n".encode("utf-8"))
        chunks.append(
            f'Content-Disposition: form-data; name="{name}"; filename="{p.name}"\r\n'.encode("utf-8")
        )
        chunks.append(f"Content-Type: {content_type}\r\n\r\n".encode("utf-8"))
        chunks.append(p.read_bytes())
        chunks.append(b"\r\n")

    chunks.append(f"--{boundary}--\r\n".encode("utf-8"))
    return boundary, b"".join(chunks)


def request_multipart(url, headers, fields, files, timeout=3600):
    boundary, body = encode_multipart(fields, files)
    request_headers = dict(headers or {})
    request_headers["content-type"] = f"multipart/form-data; boundary={boundary}"
    request_headers["content-length"] = str(len(body))

    req = urllib.request.Request(url, data=body, headers=request_headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            raw = response.read().decode("utf-8", errors="replace")
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as error:
        raw = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {error.code} {url}: {raw}") from error


def job_input(job):
    value = job.get("input")
    return value if isinstance(value, dict) else {}


def claim_job(args, headers):
    url = join_url(args.base_url, "/api/characters/voice-pipeline/worker/claim")
    payload = {
        "action": "start_applio_training",
        "workerId": args.worker_id,
    }
    return request_json("POST", url, headers=headers, data=payload, timeout=60)


def fail_job(args, headers, job_id, error, result=None):
    url = join_url(args.base_url, "/api/characters/voice-pipeline/worker/fail")
    payload = {
        "jobId": job_id,
        "message": "Remote Windows Applio training failed.",
        "error": str(error),
        "result": result or {},
    }
    try:
        return request_json("POST", url, headers=headers, data=payload, timeout=120)
    except Exception as fail_error:
        print(f"[warn] Could not report failure: {fail_error}", flush=True)
        return None


def complete_job(args, headers, job_id, result):
    url = join_url(args.base_url, "/api/characters/voice-pipeline/worker/complete")
    payload = {
        "jobId": job_id,
        "message": f"Remote Windows Applio training completed. modelPath: {result.get('modelPath')}; indexPath: {result.get('indexPath')}",
        "result": result,
    }
    return request_json("POST", url, headers=headers, data=payload, timeout=120)


def fetch_manifest(args, headers, owner_key, character_id, source_dataset_job_id):
    params = {
        "owner": owner_key,
        "characterId": character_id,
    }
    if source_dataset_job_id:
        params["jobId"] = source_dataset_job_id

    url = join_url(args.base_url, "/api/characters/training-dataset/manifest?" + urllib.parse.urlencode(params))
    data = request_json("GET", url, headers=headers, timeout=120)

    if isinstance(data, dict) and isinstance(data.get("manifest"), dict):
        manifest = data["manifest"]
    elif isinstance(data, dict) and isinstance(data.get("data"), dict) and isinstance(data["data"].get("manifest"), dict):
        manifest = data["data"]["manifest"]
    elif isinstance(data, dict) and data.get("schemaVersion"):
        manifest = data
    else:
        raise RuntimeError(f"Could not parse training dataset manifest response from {url}: {data}")

    return manifest, url


def validate_manifest(manifest):
    clips = manifest.get("clips") if isinstance(manifest.get("clips"), list) else []
    ready = [clip for clip in clips if isinstance(clip, dict) and clip.get("status") == "ready"]

    generated = int(manifest.get("generatedClipCount") or 0)
    status = clean(manifest.get("status"))
    mock = manifest.get("mock")

    if status != "voice_pack_ready":
        raise RuntimeError(f"Dataset manifest is not voice_pack_ready: {status}")
    if mock is not False:
        raise RuntimeError("Dataset manifest is not a real voice pack. mock must be false.")
    if generated < 200 or len(ready) < 200:
        raise RuntimeError(f"Applio training requires 200 ready clips. generated={generated}, ready={len(ready)}")

    return ready[:200]


def download_dataset(args, headers, manifest, dataset_dir):
    dataset_dir.mkdir(parents=True, exist_ok=True)
    clips = validate_manifest(manifest)

    for index, clip in enumerate(clips, start=1):
        clip_id = clean(clip.get("clipId")) or f"clip_{index:03d}"
        url_path = clean(clip.get("expectedAudioUrl") or clip.get("sourceSampleUrl"))
        if not url_path:
            raise RuntimeError(f"Clip has no downloadable URL: {clip_id}")

        url = join_url(args.base_url, url_path)
        target = dataset_dir / f"{clip_id}.wav"
        if target.exists() and target.stat().st_size > 0:
            continue

        print(f"[download] {clip_id} <- {url_path}", flush=True)
        target.write_bytes(request_bytes(url, headers=headers, timeout=300))

        if target.stat().st_size <= 0:
            raise RuntimeError(f"Downloaded empty clip: {target}")

    return len(clips)


def append_text(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8", errors="replace") as handle:
        handle.write(text)


def stream_pipe(pipe, sink_path, label, collected):
    try:
        for line in iter(pipe.readline, ""):
            if not line:
                break
            collected.append(line)
            append_text(sink_path, line)

            lowered = line.lower()
            if (
                "epoch" in lowered
                or "training" in lowered
                or "extract" in lowered
                or "completed" in lowered
                or "%" in line
                or "error" in lowered
                or "traceback" in lowered
            ):
                print(f"[{label}] {line.rstrip()}", flush=True)
    finally:
        try:
            pipe.close()
        except Exception:
            pass


def run_command(args, command, cwd, stdout_path, stderr_path):
    append_text(stdout_path, f"\n\n===== {' '.join(command)} =====\n")
    append_text(stderr_path, f"\n\n===== {' '.join(command)} =====\n")

    print(f"[run] {' '.join(command)}", flush=True)

    process = subprocess.Popen(
        command,
        cwd=str(cwd),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
        bufsize=1,
    )

    stdout_lines = []
    stderr_lines = []

    stdout_thread = threading.Thread(
        target=stream_pipe,
        args=(process.stdout, stdout_path, "stdout", stdout_lines),
        daemon=True,
    )
    stderr_thread = threading.Thread(
        target=stream_pipe,
        args=(process.stderr, stderr_path, "stderr", stderr_lines),
        daemon=True,
    )

    stdout_thread.start()
    stderr_thread.start()

    last_report = time.time()
    while process.poll() is None:
        time.sleep(5)
        now = time.time()
        if now - last_report >= 60:
            print(f"[wait] still running: {' '.join(command)}", flush=True)
            last_report = now

    rc = process.wait()

    stdout_thread.join(timeout=30)
    stderr_thread.join(timeout=30)

    if rc != 0:
        raise RuntimeError(f"Command failed with exit code {rc}: {' '.join(command)}")

    return {
        "returnCode": rc,
        "stdout": "".join(stdout_lines),
        "stderr": "".join(stderr_lines),
    }

def newest_file_matching(root, extension, model_name):
    root = Path(root)
    if not root.exists():
        return None

    candidates = []
    for path in root.rglob(f"*{extension}"):
        try:
            if not path.is_file() or path.stat().st_size <= 0:
                continue
            name = path.name.lower()
            score = 1
            if model_name.lower() in name:
                score = 10
            candidates.append((score, path.stat().st_mtime, path))
        except OSError:
            continue

    if not candidates:
        return None

    candidates.sort(key=lambda item: (item[0], item[1]), reverse=True)
    return candidates[0][2]


def discover_outputs(applio_root, work_dir, model_name):
    roots = [
        Path(applio_root) / "assets" / "weights",
        Path(applio_root) / "logs" / model_name,
        Path(applio_root) / "logs",
        work_dir,
    ]

    model = None
    index = None

    for root in roots:
        model = model or newest_file_matching(root, ".pth", model_name)
        index = index or newest_file_matching(root, ".index", model_name)

    if not model:
        raise RuntimeError(f"Applio did not produce a .pth model for {model_name}. Searched: {roots}")
    if not index:
        raise RuntimeError(f"Applio did not produce a .index file for {model_name}. Searched: {roots}")

    return model, index


def build_commands(args, model_name, dataset_dir):
    core = str(Path(args.applio_root) / "core.py")
    py = args.applio_python

    return [
        [
            py, core, "preprocess",
            "--model_name", model_name,
            "--dataset_path", str(dataset_dir),
            "--sample_rate", str(args.sample_rate),
            "--cpu_cores", str(args.cpu_cores),
            "--cut_preprocess", args.cut_preprocess,
        ],
        [
            py, core, "extract",
            "--model_name", model_name,
            "--f0_method", args.f0_method,
            "--cpu_cores", str(args.cpu_cores),
            "--gpu", args.gpu,
            "--sample_rate", str(args.sample_rate),
            "--embedder_model", args.embedder_model,
            "--include_mutes", str(args.include_mutes),
        ],
        [
            py, core, "train",
            "--model_name", model_name,
            "--save_every_epoch", str(args.save_every_epoch),
            "--save_only_latest", args.save_only_latest,
            "--save_every_weights", args.save_every_weights,
            "--total_epoch", str(args.epochs),
            "--sample_rate", str(args.sample_rate),
            "--batch_size", str(args.batch_size),
            "--gpu", args.gpu,
            "--pretrained", args.pretrained,
            "--custom_pretrained", "False",
            "--vocoder", args.vocoder,
            "--cache_data_in_gpu", args.cache_data_in_gpu,
            "--index_algorithm", args.index_algorithm,
        ],
        [
            py, core, "index",
            "--model_name", model_name,
            "--index_algorithm", args.index_algorithm,
        ],
    ]


def upload_artifact(args, headers, owner_key, character_id, job_id, artifact, model_path, index_path, stdout_path, stderr_path, command_path, config_path):
    url = join_url(args.base_url, "/api/characters/applio-training/upload-artifact")

    files = [
        ("model", model_path, "application/octet-stream"),
        ("index", index_path, "application/octet-stream"),
        ("stdout", stdout_path, "text/plain"),
        ("stderr", stderr_path, "text/plain"),
        ("commands", command_path, "application/json"),
    ]

    if config_path and Path(config_path).exists():
        files.append(("config", config_path, "application/json"))

    fields = {
        "owner": owner_key,
        "characterId": character_id,
        "jobId": job_id,
        "artifact": json.dumps(artifact, indent=2),
    }

    return request_multipart(url, headers=headers, fields=fields, files=files, timeout=3600)


def process_once(args):
    headers = {
        "x-otg-owner-key": args.owner_key,
        "x-otg-device-id": args.device_id,
        "x-otg-worker-id": args.worker_id,
    }

    claim = claim_job(args, headers)
    job = claim.get("job") if isinstance(claim, dict) else None

    if not job:
        print("[idle] No queued start_applio_training job available.", flush=True)
        return False

    job_id = clean(job.get("jobId"))
    character_id = clean(job.get("characterId"))
    input_data = job_input(job)

    if not job_id:
        raise RuntimeError("Claimed job is missing jobId.")
    if not character_id:
        raise RuntimeError("Claimed job is missing characterId.")

    print(f"[job] {job_id} character={character_id}", flush=True)

    work_dir = Path(args.work_root) / job_id
    dataset_dir = work_dir / "dataset"
    output_dir = work_dir / "outputs"
    logs_dir = work_dir / "logs"
    logs_dir.mkdir(parents=True, exist_ok=True)
    output_dir.mkdir(parents=True, exist_ok=True)

    stdout_path = logs_dir / "applio-stdout.log"
    stderr_path = logs_dir / "applio-stderr.log"
    command_path = logs_dir / "applio-commands.json"

    model_name = f"voice_model_{safe_segment(character_id)}_{safe_segment(job_id)}"
    training_started_at = utc_now()

    try:
        source_dataset_job_id = clean(input_data.get("sourceDatasetJobId"))
        manifest, manifest_url = fetch_manifest(args, headers, args.owner_key, character_id, source_dataset_job_id)
        clip_count = download_dataset(args, headers, manifest, dataset_dir)

        commands = build_commands(args, model_name, dataset_dir)
        command_payload = {
            "schemaVersion": 1,
            "adapter": "applio_real_training",
            "remoteWorker": True,
            "workerId": args.worker_id,
            "cwd": args.applio_root,
            "modelName": model_name,
            "preparedDatasetPath": str(dataset_dir),
            "commands": commands,
            "createdAt": utc_now(),
        }
        command_path.write_text(json.dumps(command_payload, indent=2), encoding="utf-8")

        for command in commands:
            run_command(args, command, Path(args.applio_root), stdout_path, stderr_path)

        source_model, source_index = discover_outputs(args.applio_root, work_dir, model_name)
        final_model = output_dir / f"{model_name}.pth"
        final_index = output_dir / f"{model_name}.index"
        shutil.copyfile(source_model, final_model)
        shutil.copyfile(source_index, final_index)

        if final_model.stat().st_size <= 0 or final_index.stat().st_size <= 0:
            raise RuntimeError("Copied Applio artifacts are empty.")

        config_path = Path(args.applio_root) / "logs" / model_name / "config.json"
        training_completed_at = utc_now()

        artifact = {
            "schemaVersion": 1,
            "ownerKey": args.owner_key,
            "characterId": character_id,
            "jobId": job_id,
            "createdAt": utc_now(),
            "status": "trained",
            "mock": False,
            "adapter": "applio_real_training",
            "remoteWorker": True,
            "workerId": args.worker_id,
            "dataset": {
                "manifestPath": clean(manifest.get("manifestPath")),
                "manifestUrl": manifest_url,
                "sourceDatasetJobId": clean(manifest.get("jobId") or source_dataset_job_id),
                "clipCount": clip_count,
                "approvedSampleUrl": clean((manifest.get("source") or {}).get("approvedSampleUrl")),
                "preparedDatasetPath": str(dataset_dir),
                "generationMode": clean(manifest.get("generationMode")),
                "provider": clean(manifest.get("provider")),
            },
            "model": {
                "modelName": model_name,
                "sourceModelPath": str(source_model),
                "sourceIndexPath": str(source_index),
                "modelPath": str(final_model),
                "indexPath": str(final_index),
                "expectedModelPath": str(final_model),
                "expectedIndexPath": str(final_index),
                "expectedConfigPath": str(config_path),
                "status": "trained",
            },
            "logs": {
                "logsDir": str(logs_dir),
                "stdoutPath": str(stdout_path),
                "stderrPath": str(stderr_path),
                "commandPath": str(command_path),
            },
            "trainingQualityPreset": clean(input_data.get("trainingQualityPreset") or args.training_quality_preset),
            "epochs": args.epochs,
            "saveEveryEpoch": args.save_every_epoch,
            "estimatedDurationLabel": clean(input_data.get("estimatedDurationLabel")),
            "trainingStartedAt": training_started_at,
            "trainingCompletedAt": training_completed_at,
            "note": "Real Applio training ran on the remote Windows worker and uploaded .pth/.index artifacts to Linux.",
        }

        upload = upload_artifact(
            args,
            headers,
            args.owner_key,
            character_id,
            job_id,
            artifact,
            final_model,
            final_index,
            stdout_path,
            stderr_path,
            command_path,
            config_path,
        )

        result = upload.get("result") if isinstance(upload, dict) else None
        if not isinstance(result, dict):
            raise RuntimeError(f"Upload route did not return result object: {upload}")

        complete_job(args, headers, job_id, result)
        print(f"[done] {job_id} model={final_model} index={final_index}", flush=True)
        return True

    except Exception as error:
        traceback.print_exc()
        fail_job(args, headers, job_id, error, {
            "mock": False,
            "adapter": "applio_real_training",
            "remoteWorker": True,
            "workerId": args.worker_id,
            "status": "failed",
            "currentStage": "failed",
            "trainingStartedAt": training_started_at,
            "trainingFailedAt": utc_now(),
            "localWorkDir": str(work_dir),
        })
        raise


def parse_args():
    parser = argparse.ArgumentParser(description="OTG Windows Applio training worker")
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--owner-key", required=True)
    parser.add_argument("--device-id", required=True)
    parser.add_argument("--worker-id", required=True)
    parser.add_argument("--applio-root", default=r"C:\AI\Voices\Applio")
    parser.add_argument("--applio-python", default=r"C:\AI\Voices\Applio\env\python.exe")
    parser.add_argument("--work-root", default=r"C:\AI\OTG-Worker\applio-training")
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--poll-seconds", type=int, default=20)

    parser.add_argument("--sample-rate", type=int, default=40000)
    parser.add_argument("--epochs", type=int, default=50)
    parser.add_argument("--save-every-epoch", type=int, default=10)
    parser.add_argument("--batch-size", type=int, default=4)
    parser.add_argument("--cpu-cores", type=int, default=8)
    parser.add_argument("--gpu", default="0")
    parser.add_argument("--f0-method", default="rmvpe")
    parser.add_argument("--include-mutes", type=int, default=2)
    parser.add_argument("--embedder-model", default="contentvec")
    parser.add_argument("--cut-preprocess", default="Skip")
    parser.add_argument("--vocoder", default="HiFi-GAN")
    parser.add_argument("--index-algorithm", default="Auto")
    parser.add_argument("--pretrained", default="True")
    parser.add_argument("--save-only-latest", default="False")
    parser.add_argument("--save-every-weights", default="True")
    parser.add_argument("--cache-data-in-gpu", default="True")
    parser.add_argument("--training-quality-preset", default="normal")
    return parser.parse_args()


def main():
    args = parse_args()

    if not Path(args.applio_root).exists():
        raise RuntimeError(f"Applio root does not exist: {args.applio_root}")
    if not Path(args.applio_python).exists():
        raise RuntimeError(f"Applio Python does not exist: {args.applio_python}")
    if not (Path(args.applio_root) / "core.py").exists():
        raise RuntimeError(f"Applio core.py does not exist under: {args.applio_root}")

    print("Starting OTG Applio training worker", flush=True)
    print(f"  BaseUrl: {args.base_url}", flush=True)
    print(f"  OwnerKey: {args.owner_key}", flush=True)
    print(f"  WorkerId: {args.worker_id}", flush=True)
    print(f"  ApplioRoot: {args.applio_root}", flush=True)
    print(f"  ApplioPython: {args.applio_python}", flush=True)
    print(f"  WorkRoot: {args.work_root}", flush=True)
    print(f"  Epochs: {args.epochs}", flush=True)

    while True:
        try:
            processed = process_once(args)
        except Exception as error:
            print(f"[error] {error}", flush=True)
            processed = True

        if args.once:
            return 0

        if not processed:
            time.sleep(max(5, args.poll_seconds))


if __name__ == "__main__":
    raise SystemExit(main())