#!/usr/bin/env python3
import argparse
import hashlib
import json
import os
import subprocess
import sys
import time
import traceback
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


def now_iso():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def ensure_dir(path):
    Path(path).mkdir(parents=True, exist_ok=True)


def clean(value):
    return str(value or "").strip()


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def has_bytes(path):
    p = Path(path)
    return p.is_file() and p.stat().st_size > 0


def join_url(base_url, path):
    base = base_url.rstrip("/")
    if path.startswith("http://") or path.startswith("https://"):
        return path
    return base + "/" + path.lstrip("/")


def request_json(method, url, headers=None, payload=None, timeout=120):
    body = None
    req_headers = dict(headers or {})
    if payload is not None:
        body = json.dumps(payload).encode("utf-8")
        req_headers["content-type"] = "application/json"

    req = urllib.request.Request(url, data=body, headers=req_headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            raw = response.read().decode("utf-8", errors="replace")
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as error:
        raw = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {error.code} {url}: {raw}") from error


def download_file(base_url, path_or_url, target, headers):
    url = join_url(base_url, path_or_url)
    ensure_dir(Path(target).parent)
    req = urllib.request.Request(url, headers=headers, method="GET")
    with urllib.request.urlopen(req, timeout=180) as response:
        with open(target, "wb") as f:
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                f.write(chunk)
    if not has_bytes(target):
        raise RuntimeError(f"Downloaded file is empty: {target}")
    return str(target)


def append_text(path, text):
    ensure_dir(Path(path).parent)
    with open(path, "a", encoding="utf-8", errors="replace") as f:
        f.write(text)


def run_command(command, cwd, stdout_path, stderr_path, timeout_seconds):
    append_text(stdout_path, "\n\n===== " + " ".join(command) + " =====\n")
    append_text(stderr_path, "\n\n===== " + " ".join(command) + " =====\n")
    print("[run] " + " ".join(command), flush=True)

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

    started = time.time()
    stdout_lines = []
    stderr_lines = []

    while True:
        if process.poll() is not None:
            break
        if time.time() - started > timeout_seconds:
            try:
                process.kill()
            finally:
                raise RuntimeError(f"Applio inference timed out after {timeout_seconds}s")

        out = process.stdout.readline() if process.stdout else ""
        if out:
            stdout_lines.append(out)
            append_text(stdout_path, out)
            print("[stdout] " + out.rstrip(), flush=True)

        err = process.stderr.readline() if process.stderr else ""
        if err:
            stderr_lines.append(err)
            append_text(stderr_path, err)
            print("[stderr] " + err.rstrip(), flush=True)

        if not out and not err:
            time.sleep(0.25)

    remaining_out, remaining_err = process.communicate(timeout=30)
    if remaining_out:
        stdout_lines.append(remaining_out)
        append_text(stdout_path, remaining_out)
    if remaining_err:
        stderr_lines.append(remaining_err)
        append_text(stderr_path, remaining_err)

    rc = process.returncode
    append_text(stdout_path, f"\nEXIT infer: {rc}\n")
    if rc != 0:
        raise RuntimeError(f"Command failed with exit code {rc}: {' '.join(command)}")

    stderr_joined = "".join(stderr_lines)
    if "Traceback (most recent call last)" in stderr_joined:
        raise RuntimeError(f"Applio inference reported traceback. stderr: {stderr_path}")

    return {
        "exitCode": rc,
        "stdout": "".join(stdout_lines),
        "stderr": stderr_joined,
    }


def find_local_model(applio_root, input_data):
    artifact_id = clean(input_data.get("voiceModelArtifactId") or input_data.get("trainedArtifactId"))
    model_path = clean(input_data.get("trainedModelPath") or input_data.get("modelPath"))
    index_path = clean(input_data.get("trainedIndexPath") or input_data.get("indexPath"))

    candidates = []

    if artifact_id:
        root = Path(applio_root) / "logs" / artifact_id
        candidates.append((
            root / f"{artifact_id}_50e_450s.pth",
            root / f"{artifact_id}.index",
        ))
        candidates.append((
            root / f"{artifact_id}.pth",
            root / f"{artifact_id}.index",
        ))

    if model_path:
        model_name = Path(model_path).stem
        root = Path(applio_root) / "logs" / model_name
        candidates.append((
            root / f"{model_name}_50e_450s.pth",
            root / f"{model_name}.index",
        ))
        candidates.append((
            root / f"{model_name}.pth",
            root / f"{model_name}.index",
        ))

    for pth, idx in candidates:
        if has_bytes(pth) and has_bytes(idx):
            return str(pth), str(idx)

    raise RuntimeError(
        "Could not find local Windows Applio model/index. "
        f"artifact_id={artifact_id}; trainedModelPath={model_path}; trainedIndexPath={index_path}"
    )


def multipart_upload(url, fields, files, headers, timeout=300):
    boundary = "----otg-applio-inference-" + hashlib.sha256(str(time.time()).encode()).hexdigest()
    body = bytearray()

    def add_part_header(name, filename=None, content_type=None):
        body.extend(f"--{boundary}\r\n".encode())
        if filename:
            body.extend(f'Content-Disposition: form-data; name="{name}"; filename="{filename}"\r\n'.encode())
            body.extend(f"Content-Type: {content_type or 'application/octet-stream'}\r\n\r\n".encode())
        else:
            body.extend(f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode())

    for name, value in fields.items():
        add_part_header(name)
        body.extend(str(value).encode("utf-8"))
        body.extend(b"\r\n")

    for name, file_path in files.items():
        p = Path(file_path)
        if not p.exists():
            continue
        add_part_header(name, p.name, "application/octet-stream")
        body.extend(p.read_bytes())
        body.extend(b"\r\n")

    body.extend(f"--{boundary}--\r\n".encode())

    req_headers = dict(headers or {})
    req_headers["content-type"] = f"multipart/form-data; boundary={boundary}"
    req_headers["content-length"] = str(len(body))

    req = urllib.request.Request(url, data=bytes(body), headers=req_headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            raw = response.read().decode("utf-8", errors="replace")
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as error:
        raw = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {error.code} {url}: {raw}") from error


def process_once(args):
    headers = {
        "x-otg-owner-key": args.owner_key,
        "x-otg-device-id": args.device_id,
        "x-otg-worker-id": args.worker_id,
    }

    claim = request_json(
        "POST",
        join_url(args.base_url, "/api/characters/voice-pipeline/worker/claim"),
        headers=headers,
        payload={"workerId": args.worker_id, "action": "test_trained_voice"},
        timeout=120,
    )

    job = claim.get("job")
    if not job:
        print("[idle] No queued test_trained_voice job available.", flush=True)
        return False

    job_id = clean(job.get("jobId"))
    owner_key = clean(job.get("ownerKey") or args.owner_key)
    character_id = clean(job.get("characterId") or (job.get("input") or {}).get("characterId"))
    input_data = job.get("input") or {}

    print(f"[job] {job_id} character={character_id}", flush=True)

    work_dir = Path(args.work_root) / job_id
    input_dir = work_dir / "input"
    output_dir = work_dir / "output"
    logs_dir = work_dir / "logs"
    ensure_dir(input_dir)
    ensure_dir(output_dir)
    ensure_dir(logs_dir)

    stdout_path = logs_dir / "applio-infer-stdout.log"
    stderr_path = logs_dir / "applio-infer-stderr.log"
    command_path = logs_dir / "applio-infer-command.json"
    output_path = output_dir / "output.wav"

    input_audio_url = clean(input_data.get("inputAudioUrl"))
    if not input_audio_url:
        # Fallback: Linux absolute paths are not directly accessible from Windows.
        # The UI should send inputAudioUrl. Fail loudly if it does not.
        raise RuntimeError("Missing inputAudioUrl for remote Applio inference worker.")

    input_audio_path = input_dir / "input.wav"
    print(f"[download] {input_audio_url}", flush=True)
    download_file(args.base_url, input_audio_url, input_audio_path, headers)

    pth_path, index_path = find_local_model(args.applio_root, input_data)

    command = [
        args.applio_python,
        str(Path(args.applio_root) / "core.py"),
        "infer",
        "--pitch", str(args.pitch),
        "--index_rate", str(args.index_rate),
        "--volume_envelope", "1",
        "--protect", str(args.protect),
        "--f0_method", args.f0_method,
        "--input_path", str(input_audio_path),
        "--output_path", str(output_path),
        "--pth_path", pth_path,
        "--index_path", index_path,
        "--split_audio", "False",
        "--f0_autotune", "False",
        "--clean_audio", "False",
        "--export_format", "WAV",
        "--embedder_model", args.embedder_model,
    ]

    command_record = {
        "adapter": "applio_real_inference",
        "remoteWorker": True,
        "workerId": args.worker_id,
        "jobId": job_id,
        "ownerKey": owner_key,
        "characterId": character_id,
        "cwd": args.applio_root,
        "python": args.applio_python,
        "args": command[1:],
        "inputAudioPath": str(input_audio_path),
        "outputAudioPath": str(output_path),
        "trainedModelPath": pth_path,
        "trainedIndexPath": index_path,
        "startedAt": now_iso(),
    }
    Path(command_path).write_text(json.dumps(command_record, indent=2), encoding="utf-8")

    started = time.time()
    run_command(command, args.applio_root, stdout_path, stderr_path, args.timeout_seconds)

    if not has_bytes(output_path):
        raise RuntimeError(f"Applio inference did not create output audio: {output_path}")

    input_sha = sha256_file(input_audio_path)
    output_sha = sha256_file(output_path)
    if input_sha == output_sha:
        raise RuntimeError("Applio inference output is byte-identical to input audio.")

    completed_at = now_iso()
    elapsed_ms = int((time.time() - started) * 1000)
    output_bytes = Path(output_path).stat().st_size

    command_record.update({
        "completedAt": completed_at,
        "elapsedMs": elapsed_ms,
        "exitCode": 0,
        "inputSha256": input_sha,
        "outputSha256": output_sha,
        "outputBytes": output_bytes,
    })
    Path(command_path).write_text(json.dumps(command_record, indent=2), encoding="utf-8")

    upload_url = join_url(args.base_url, "/api/characters/applio-inference/upload-result")
    uploaded = multipart_upload(
        upload_url,
        fields={"characterId": character_id, "jobId": job_id},
        files={
            "output.wav": output_path,
            "applio-infer-stdout.log": stdout_path,
            "applio-infer-stderr.log": stderr_path,
            "applio-infer-command.json": command_path,
        },
        headers=headers,
        timeout=300,
    )

    result = {
        "adapter": "applio_real_inference",
        "mock": False,
        "provider": "applio",
        "remoteWorker": True,
        "workerId": args.worker_id,
        "status": "completed",
        "trainedArtifactId": clean(input_data.get("trainedArtifactId") or input_data.get("voiceModelArtifactId")),
        "trainedModelPath": pth_path,
        "trainedIndexPath": index_path,
        "inputAudioPath": str(input_audio_path),
        "inputAudioUrl": input_audio_url,
        "outputAudioPath": uploaded.get("outputAudioPath"),
        "outputAudioUrl": uploaded.get("outputAudioUrl"),
        "outputBytes": uploaded.get("outputBytes") or output_bytes,
        "outputDir": uploaded.get("outputDir"),
        "logsPath": uploaded.get("logsPath"),
        "stdoutPath": uploaded.get("stdoutPath"),
        "stderrPath": uploaded.get("stderrPath"),
        "commandPath": uploaded.get("commandPath"),
        "exitCode": 0,
        "inputSha256": input_sha,
        "outputSha256": output_sha,
        "startedAt": command_record["startedAt"],
        "completedAt": completed_at,
        "elapsedMs": elapsed_ms,
        "elapsedLabel": f"{round(elapsed_ms / 1000)}s",
        "localWorkDir": str(work_dir),
    }

    complete = request_json(
        "POST",
        join_url(args.base_url, "/api/characters/voice-pipeline/worker/complete"),
        headers=headers,
        payload={
            "jobId": job_id,
            "message": f"Remote Windows Applio inference completed. outputAudioUrl: {result['outputAudioUrl']}",
            "result": result,
        },
        timeout=120,
    )

    print(json.dumps({"completed": complete.get("ok"), "jobId": job_id, "outputAudioUrl": result["outputAudioUrl"]}, indent=2), flush=True)
    return True


def fail_job(args, job_id, error, partial_result=None):
    headers = {
        "x-otg-owner-key": args.owner_key,
        "x-otg-device-id": args.device_id,
        "x-otg-worker-id": args.worker_id,
    }
    if not job_id:
        print(f"[error] {error}", flush=True)
        return
    try:
        request_json(
            "POST",
            join_url(args.base_url, "/api/characters/voice-pipeline/worker/fail"),
            headers=headers,
            payload={
                "jobId": job_id,
                "error": error,
                "message": error,
                "result": partial_result or {
                    "adapter": "applio_real_inference",
                    "mock": False,
                    "remoteWorker": True,
                    "workerId": args.worker_id,
                    "status": "failed",
                    "failedAt": now_iso(),
                },
            },
            timeout=120,
        )
    except Exception as fail_error:
        print(f"[error] Could not report failure: {fail_error}", flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--owner-key", required=True)
    parser.add_argument("--device-id", required=True)
    parser.add_argument("--worker-id", required=True)
    parser.add_argument("--applio-root", default=r"C:\AI\Voices\Applio")
    parser.add_argument("--applio-python", default=r"C:\AI\Voices\Applio\env\python.exe")
    parser.add_argument("--work-root", default=r"C:\AI\OTG-Worker\applio-inference")
    parser.add_argument("--pitch", type=int, default=0)
    parser.add_argument("--index-rate", type=float, default=0.75)
    parser.add_argument("--protect", type=float, default=0.33)
    parser.add_argument("--f0-method", default="rmvpe")
    parser.add_argument("--embedder-model", default="contentvec")
    parser.add_argument("--timeout-seconds", type=int, default=600)
    parser.add_argument("--poll-seconds", type=int, default=20)
    parser.add_argument("--once", action="store_true")
    args = parser.parse_args()

    print("Starting OTG Applio inference worker", flush=True)
    print(f"  BaseUrl: {args.base_url}", flush=True)
    print(f"  OwnerKey: {args.owner_key}", flush=True)
    print(f"  WorkerId: {args.worker_id}", flush=True)
    print(f"  ApplioRoot: {args.applio_root}", flush=True)
    print(f"  WorkRoot: {args.work_root}", flush=True)

    if not Path(args.applio_python).is_file():
        raise RuntimeError(f"Applio Python missing: {args.applio_python}")
    if not (Path(args.applio_root) / "core.py").is_file():
        raise RuntimeError(f"Applio core.py missing under: {args.applio_root}")

    while True:
        job_id = ""
        try:
            processed = process_once(args)
        except Exception as error:
            traceback.print_exc()
            fail_job(args, job_id, str(error))
            processed = False

        if args.once:
            return 0
        if not processed:
            time.sleep(max(1, args.poll_seconds))


if __name__ == "__main__":
    raise SystemExit(main())