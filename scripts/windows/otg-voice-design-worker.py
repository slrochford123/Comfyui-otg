#!/usr/bin/env python3
"""Dedicated OTG Windows worker for Character Voice Lab voice design jobs.

This supervisor intentionally claims only:
  jobType=character_voice_pipeline
  action=create_voice_sample

The Linux host remains the control plane. Qwen3-TTS/CosyVoice generation runs
on the Windows execution PC only after a queued job is claimed.
"""

from __future__ import annotations

import argparse
import json
import mimetypes
import os
import subprocess
import sys
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


def request_json(method: str, url: str, headers: Dict[str, str], payload: Dict[str, Any], timeout: int = 300) -> Dict[str, Any]:
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            raw = response.read().decode("utf-8")
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        raise WorkerError(f"HTTP {error.code} {url}: {body}") from error


def checkpoint(args: argparse.Namespace, headers: Dict[str, str], job_id: str, progress: int, message: str, result: Dict[str, Any] | None = None) -> None:
    payload = {
        "jobId": job_id,
        "progress": progress,
        "message": message,
        "result": result or {},
    }
    try:
        request_json(
            "POST",
            build_url(args.base_url, "/api/worker/jobs/checkpoint"),
            headers,
            payload,
            timeout=args.upload_timeout_seconds,
        )
    except Exception as error:
        log(f"[warn] Could not checkpoint job {job_id}: {error}")


def multipart_post(url: str, headers: Dict[str, str], fields: Dict[str, str], file_field: str, file_path: Path, timeout: int) -> Dict[str, Any]:
    boundary = f"----otg-voice-design-{int(time.time() * 1000)}"
    body = bytearray()
    for key, value in fields.items():
        body.extend(f"--{boundary}\r\n".encode("utf-8"))
        body.extend(f'Content-Disposition: form-data; name="{key}"\r\n\r\n'.encode("utf-8"))
        body.extend(str(value).encode("utf-8"))
        body.extend(b"\r\n")

    mime = mimetypes.guess_type(str(file_path))[0] or "audio/wav"
    body.extend(f"--{boundary}\r\n".encode("utf-8"))
    body.extend(f'Content-Disposition: form-data; name="{file_field}"; filename="{file_path.name}"\r\n'.encode("utf-8"))
    body.extend(f"Content-Type: {mime}\r\n\r\n".encode("utf-8"))
    body.extend(file_path.read_bytes())
    body.extend(b"\r\n")
    body.extend(f"--{boundary}--\r\n".encode("utf-8"))

    request_headers = {k: v for k, v in headers.items() if k.lower() != "content-type"}
    request_headers["content-type"] = f"multipart/form-data; boundary={boundary}"
    req = urllib.request.Request(url, data=bytes(body), headers=request_headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            raw = response.read().decode("utf-8")
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as error:
        text = error.read().decode("utf-8", errors="replace")
        raise WorkerError(f"HTTP {error.code} {url}: {text}") from error


def require_file(path_text: str, label: str) -> Path:
    path = Path(path_text).expanduser()
    if not path.exists():
        raise WorkerError(f"{label} not found: {path}")
    return path


def first_text(job_input: Dict[str, Any], *keys: str, default: str = "Hello, this is the selected character voice.") -> str:
    for key in keys:
        value = clean(job_input.get(key))
        if value:
            return value
    return default


def normalize_language(value: Any) -> str:
    language = clean(value)
    return language or "English"


def write_json(path: Path, value: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2), encoding="utf-8")


def run_bridge(command: list[str], cwd: Path, env: Dict[str, str], output_wav: Path, timeout: int) -> None:
    log(f"[bridge] {' '.join(command)}")
    result = subprocess.run(command, cwd=str(cwd), env=env, timeout=timeout)
    if result.returncode != 0:
        raise WorkerError(f"Voice design bridge failed with exit code {result.returncode}.")
    if not output_wav.exists() or output_wav.stat().st_size <= 0:
        raise WorkerError(f"Voice design bridge did not create a non-empty WAV: {output_wav}")


def generate_qwen(args: argparse.Namespace, job: Dict[str, Any], job_input: Dict[str, Any], work_dir: Path) -> Dict[str, Any]:
    if clean(os.environ.get("OTG_ENABLE_REAL_QWEN3_VOICE_SAMPLE")) != "1":
        raise WorkerError("OTG_ENABLE_REAL_QWEN3_VOICE_SAMPLE=1 is required for Qwen3-TTS voice design worker generation.")

    qwen_root = require_file(args.qwen_root, "QWEN_TTS_ROOT")
    qwen_python = require_file(args.qwen_python, "QWEN_TTS_PYTHON")
    qwen_bridge = require_file(args.qwen_bridge, "QWEN_TTS_BRIDGE")
    output_wav = work_dir / "sample.wav"
    stdout_log = work_dir / "logs" / "qwen3-stdout.log"
    stderr_log = work_dir / "logs" / "qwen3-stderr.log"
    params_path = work_dir / "qwen3_sample_params.json"
    stdout_log.parent.mkdir(parents=True, exist_ok=True)

    text = first_text(job_input, "sampleText", "previewText", "text")
    params = {
        "engine": "qwen3",
        "model_id": clean(job_input.get("modelId")) or clean(os.environ.get("QWEN_TTS_MODEL_ID")),
        "qwen_tts_root": str(qwen_root),
        "output_wav": str(output_wav),
        "text": text,
        "sample_text": text,
        "preview_text": first_text(job_input, "previewText", "sampleText", "text", default=text),
        "language": normalize_language(job_input.get("language")),
        "dtype": clean(os.environ.get("QWEN_TTS_DTYPE")) or "auto",
        "qwen_instruction": clean(job_input.get("voiceInstruction") or job_input.get("instruct") or job_input.get("prompt")),
        "voice_instruction": clean(job_input.get("voiceInstruction") or job_input.get("instruct") or job_input.get("prompt")),
        "voice_design": job_input.get("voiceDesign") if isinstance(job_input.get("voiceDesign"), dict) else None,
        "qwen_design_record": job_input.get("qwenVoiceDesignRecord") if isinstance(job_input.get("qwenVoiceDesignRecord"), dict) else None,
        "source_job_id": clean(job.get("jobId")),
        "character_id": clean(job.get("characterId")),
        "seed": clean(job_input.get("seed") or job_input.get("requestSeed")),
        "request_seed": clean(job_input.get("requestSeed") or job_input.get("seed")),
        "input": job_input,
    }
    write_json(params_path, params)

    env = os.environ.copy()
    site_packages = clean(args.qwen_site_packages)
    if site_packages:
        env["PYTHONPATH"] = site_packages + (os.pathsep + env["PYTHONPATH"] if env.get("PYTHONPATH") else "")
    env["HF_HUB_DISABLE_SYMLINKS_WARNING"] = "1"

    run_bridge(
        [str(qwen_python), str(qwen_bridge), "--params-json", str(params_path), "--stdout-log", str(stdout_log), "--stderr-log", str(stderr_log)],
        qwen_root,
        env,
        output_wav,
        args.sample_timeout_seconds,
    )
    return {
        "provider": "qwen3",
        "adapter": "qwen3_real_voice_sample",
        "sample": output_wav,
        "paramsPath": str(params_path),
        "stdoutPath": str(stdout_log),
        "stderrPath": str(stderr_log),
        "logsPath": str(stdout_log.parent),
        "outputDir": str(work_dir),
    }


def generate_cosy(args: argparse.Namespace, job: Dict[str, Any], job_input: Dict[str, Any], work_dir: Path) -> Dict[str, Any]:
    if clean(os.environ.get("OTG_ENABLE_REAL_COSY_VOICE_SAMPLE")) != "1":
        raise WorkerError("OTG_ENABLE_REAL_COSY_VOICE_SAMPLE=1 is required for CosyVoice voice design worker generation.")

    cosy_root = require_file(args.cosy_root, "COSYVOICE_ROOT")
    cosy_python = require_file(args.cosy_python, "COSYVOICE_PYTHON")
    cosy_bridge = require_file(args.cosy_bridge, "COSYVOICE_BRIDGE")
    output_wav = work_dir / "sample.wav"
    stdout_log = work_dir / "logs" / "cosyvoice-stdout.log"
    stderr_log = work_dir / "logs" / "cosyvoice-stderr.log"
    params_path = work_dir / "cosy_sample_params.json"
    stdout_log.parent.mkdir(parents=True, exist_ok=True)

    instruction = clean(job_input.get("voiceInstruction") or job_input.get("prompt") or job_input.get("instruct"))
    text = first_text(job_input, "sampleText", "previewText", "text")
    params = {
        "engine": "cosy",
        "model_id": clean(job_input.get("modelId")) or clean(os.environ.get("COSYVOICE_MODEL_ID")),
        "cosyvoice_root": str(cosy_root),
        "output_wav": str(output_wav),
        "text": text,
        "instruction": instruction,
        "prompt": clean(job_input.get("prompt")) or instruction,
        "prompt_wav": clean(job_input.get("referenceWav") or job_input.get("promptWav") or job_input.get("referenceAudioPath")),
        "language": normalize_language(job_input.get("language")),
        "source_job_id": clean(job.get("jobId")),
        "character_id": clean(job.get("characterId")),
        "seed": clean(job_input.get("seed") or job_input.get("requestSeed")),
        "request_seed": clean(job_input.get("requestSeed") or job_input.get("seed")),
        "input": job_input,
    }
    write_json(params_path, params)

    env = os.environ.copy()
    site_packages = clean(args.cosy_site_packages)
    if site_packages:
        env["PYTHONPATH"] = site_packages + (os.pathsep + env["PYTHONPATH"] if env.get("PYTHONPATH") else "")
    env["HF_HUB_DISABLE_SYMLINKS_WARNING"] = "1"

    run_bridge(
        [str(cosy_python), str(cosy_bridge), "--params-json", str(params_path), "--stdout-log", str(stdout_log), "--stderr-log", str(stderr_log)],
        cosy_root,
        env,
        output_wav,
        args.sample_timeout_seconds,
    )
    return {
        "provider": "cosy",
        "adapter": "cosy_real_voice_sample",
        "sample": output_wav,
        "paramsPath": str(params_path),
        "stdoutPath": str(stdout_log),
        "stderrPath": str(stderr_log),
        "logsPath": str(stdout_log.parent),
        "outputDir": str(work_dir),
    }


def upload_sample(args: argparse.Namespace, headers: Dict[str, str], character_id: str, job_id: str, generated: Dict[str, Any]) -> Dict[str, Any]:
    sample_path = generated["sample"]
    fields = {
        "characterId": character_id,
        "jobId": job_id,
        "provider": generated["provider"],
        "adapter": generated["adapter"],
    }
    response = multipart_post(
        build_url(args.base_url, "/api/characters/voice-sample/upload"),
        headers,
        fields,
        "file",
        sample_path,
        args.upload_timeout_seconds,
    )
    if not response.get("ok"):
        raise WorkerError(f"Voice sample upload failed: {json.dumps(response, indent=2)}")
    return response


def process_one(args: argparse.Namespace) -> int:
    claim_headers = auth_headers(args)
    job_id = ""
    owner_key = ""
    try:
        claim = request_json(
            "POST",
            build_url(args.base_url, "/api/worker/jobs/claim"),
            claim_headers,
            {
                "jobType": "character_voice_pipeline",
                "action": "create_voice_sample",
                "claimScope": "all_owners",
                "workerId": args.worker_id,
            },
        )
        job = claim.get("job")
        if not isinstance(job, dict):
            log("[idle] No queued create_voice_sample job available.")
            return 0

        job_id = clean(job.get("jobId"))
        owner_key = clean(job.get("ownerKey"))
        character_id = clean(job.get("characterId"))
        job_input = job.get("input") if isinstance(job.get("input"), dict) else {}
        provider = clean(job_input.get("provider")).lower()
        if not job_id or not owner_key or not character_id:
            raise WorkerError(f"Invalid claimed voice design job: {job}")
        if provider not in {"qwen3", "cosy"}:
            raise WorkerError(f"Unsupported voice design provider for worker: {provider}")

        headers = auth_headers(args, owner_key)
        work_dir = Path(args.work_root).expanduser().resolve() / owner_key / character_id / job_id
        work_dir.mkdir(parents=True, exist_ok=True)
        log(f"[claim] {job_id} owner={owner_key} character={character_id} provider={provider}")
        seed = clean(job_input.get("seed") or job_input.get("requestSeed"))

        checkpoint(
            args,
            headers,
            job_id,
            12,
            "Voice creating started.",
            {
                "remoteWorker": True,
                "workerId": args.worker_id,
                "provider": provider,
                "currentStage": "started",
                "seed": seed,
            },
        )
        checkpoint(
            args,
            headers,
            job_id,
            35,
            f"Generating {('Qwen3-TTS' if provider == 'qwen3' else 'CosyVoice')} voice sample on the Windows worker.",
            {
                "remoteWorker": True,
                "workerId": args.worker_id,
                "provider": provider,
                "currentStage": "voice_generation",
                "seed": seed,
            },
        )

        generated = generate_qwen(args, job, job_input, work_dir) if provider == "qwen3" else generate_cosy(args, job, job_input, work_dir)
        checkpoint(
            args,
            headers,
            job_id,
            80,
            "Voice sample generated. Uploading to the app.",
            {
                "remoteWorker": True,
                "workerId": args.worker_id,
                "provider": generated["provider"],
                "adapter": generated["adapter"],
                "currentStage": "uploading",
                "seed": seed,
                "outputDir": generated["outputDir"],
                "logsPath": generated["logsPath"],
                "paramsPath": generated["paramsPath"],
            },
        )
        upload = upload_sample(args, headers, character_id, job_id, generated)
        checkpoint(
            args,
            headers,
            job_id,
            95,
            "Voice sample uploaded. Finalizing playable result.",
            {
                "remoteWorker": True,
                "workerId": args.worker_id,
                "provider": generated["provider"],
                "adapter": generated["adapter"],
                "currentStage": "finalizing",
                "seed": seed,
                "samplePath": upload.get("samplePath"),
                "sampleUrl": upload.get("sampleUrl"),
                "outputBytes": upload.get("outputBytes"),
            },
        )
        result = {
            "mock": False,
            "provider": generated["provider"],
            "adapter": generated["adapter"],
            "remoteWorker": True,
            "workerId": args.worker_id,
            "seed": seed,
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
            "completedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
        complete = request_json(
            "POST",
            build_url(args.base_url, "/api/worker/jobs/complete"),
            headers,
            {"jobId": job_id, "result": result, "message": "Remote Windows voice design sample completed."},
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
                    {"jobId": job_id, "error": str(error), "result": {"remoteWorker": True, "workerId": args.worker_id, "error": text}},
                    timeout=args.upload_timeout_seconds,
                )
            except Exception as fail_error:
                log(f"[warn] Could not mark job failed: {fail_error}")
        return 1


def main() -> int:
    parser = argparse.ArgumentParser(description="Dedicated OTG voice design Windows worker")
    parser.add_argument("--base-url", default=os.environ.get("OTG_BASE_URL", "http://127.0.0.1:3001"))
    parser.add_argument("--device-id", default=os.environ.get("OTG_DEVICE_ID", "slrochford"))
    parser.add_argument("--worker-id", default=os.environ.get("OTG_WORKER_ID", "windows-voice-design-worker"))
    parser.add_argument("--worker-token", default=os.environ.get("OTG_WORKER_TOKEN", ""))
    parser.add_argument("--work-root", default=os.environ.get("OTG_VOICE_DESIGN_WORK_ROOT", r"C:\AI\OTG-Worker\voice-design"))
    parser.add_argument("--qwen-root", default=os.environ.get("QWEN_TTS_ROOT", r"C:\AI\voices\qwen 3"))
    parser.add_argument("--qwen-python", default=os.environ.get("QWEN_TTS_PYTHON", r"C:\Users\SLRoc\miniconda3\envs\qwen3tts-repair\python.exe"))
    parser.add_argument("--qwen-site-packages", default=os.environ.get("QWEN_TTS_SITE_PACKAGES", ""))
    parser.add_argument("--qwen-bridge", default=os.environ.get("QWEN_TTS_BRIDGE", r"C:\AI\OTG-Test2\scripts\qwen3_voice_design_preview.py"))
    parser.add_argument("--cosy-root", default=os.environ.get("COSYVOICE_ROOT", r"C:\AI\Voices\CosyVoice"))
    parser.add_argument("--cosy-python", default=os.environ.get("COSYVOICE_PYTHON", r"C:\AI\Voices\CosyVoice\.venv\Scripts\python.exe"))
    parser.add_argument("--cosy-site-packages", default=os.environ.get("COSYVOICE_SITE_PACKAGES", ""))
    parser.add_argument("--cosy-bridge", default=os.environ.get("COSYVOICE_BRIDGE", r"C:\AI\OTG-Test2\scripts\cosy_voice_sample_bridge.py"))
    parser.add_argument("--sample-timeout-seconds", type=int, default=int(os.environ.get("OTG_VOICE_DESIGN_SAMPLE_TIMEOUT_SECONDS", "1800")))
    parser.add_argument("--upload-timeout-seconds", type=int, default=int(os.environ.get("OTG_VOICE_DESIGN_UPLOAD_TIMEOUT_SECONDS", "300")))
    parser.add_argument("--poll-seconds", type=int, default=int(os.environ.get("OTG_VOICE_DESIGN_POLL_SECONDS", "30")))
    parser.add_argument("--once", action="store_true")
    args = parser.parse_args()

    if not args.worker_token:
        raise WorkerError("Missing --worker-token/OTG_WORKER_TOKEN. Voice design worker requires token-protected universal claim.")

    while True:
        code = process_one(args)
        if args.once:
            return code
        time.sleep(max(1, args.poll_seconds))


if __name__ == "__main__":
    raise SystemExit(main())
