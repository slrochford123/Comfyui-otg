#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Dict


TERMINAL_STATUSES = {"canceled", "cancelled", "terminated", "completed", "ready_for_review"}
PREVIEW_SCRIPT = "Hello, I am your created character. This is a voice dub test so you can hear the texture and sound of your created character."


class TerminatedJob(RuntimeError):
    pass


def log(message: str) -> None:
    print(message, flush=True)


def clean(value: Any) -> str:
    return str(value or "").strip()


def safe_segment(value: Any) -> str:
    raw = clean(value) or "item"
    return ("".join(ch if ch.isalnum() or ch in "._@-" else "-" for ch in raw)[:160] or "item")


def has_bytes(path: Path) -> bool:
    try:
        return path.is_file() and path.stat().st_size > 0
    except OSError:
        return False


def build_url(base_url: str, path_or_url: str) -> str:
    value = clean(path_or_url)
    if value.startswith("http://") or value.startswith("https://"):
        return value
    return urllib.parse.urljoin(base_url.rstrip("/") + "/", value.lstrip("/"))


def request_json(method: str, url: str, headers: Dict[str, str], payload: Dict[str, Any] | None = None, timeout: int = 120) -> Dict[str, Any]:
    body = None
    req_headers = dict(headers)
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
            "action": "generate_character_preview",
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
        raise TerminatedJob(f"Character preview job {job_id} is no longer active; status={status}.")


def checkpoint(args: argparse.Namespace, owner_key: str, job_id: str, progress: int, stage: str, message: str, result: Dict[str, Any]) -> None:
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
                    "adapter": "character_preview_dub_adapter",
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
        {"jobId": job_id, "result": result, "message": "Character preview dub completed."},
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


def write_json(path: Path, data: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2), encoding="utf-8")


def read_json(path: Path) -> Dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def job_work_dir(args: argparse.Namespace, owner_key: str, character_id: str, job_id: str) -> Path:
    return Path(args.repo) / "data" / "characters" / safe_segment(owner_key) / "character-preview" / safe_segment(character_id) / safe_segment(job_id)


def validate_input(job: Dict[str, Any]) -> Dict[str, Any]:
    job_input = job.get("input") if isinstance(job.get("input"), dict) else {}
    source_image_path = Path(clean(job_input.get("sourceImagePath")))
    model_path = Path(clean(job_input.get("trainedModelPath") or job_input.get("modelPath")))
    index_path = Path(clean(job_input.get("trainedIndexPath") or job_input.get("indexPath")))
    if not has_bytes(source_image_path):
        raise RuntimeError("Character source image is missing. Cannot generate preview.")
    if not has_bytes(model_path) or not has_bytes(index_path):
        raise RuntimeError("Train the voice model before generating the character preview.")
    if job_input.get("trainedArtifactMock") is not False and job_input.get("trainingMock") is not False and job_input.get("artifactMock") is not False:
        raise RuntimeError("Train the voice model before generating the character preview.")
    return {
        **job_input,
        "previewScript": PREVIEW_SCRIPT,
        "sourceImagePath": str(source_image_path),
        "trainedModelPath": str(model_path),
        "trainedIndexPath": str(index_path),
    }


def preview_file_url(owner_key: str, character_id: str, job_id: str, file_name: str = "dubbed-preview.mp4") -> str:
    return (
        "/api/characters/character-preview/file"
        f"?owner={urllib.parse.quote(owner_key)}"
        f"&characterId={urllib.parse.quote(character_id)}"
        f"&jobId={urllib.parse.quote(job_id)}"
        f"&file={urllib.parse.quote(file_name)}"
    )


def validate_result(result_path: Path, owner_key: str, character_id: str, job_id: str) -> Dict[str, Any]:
    if not has_bytes(result_path):
        raise RuntimeError(f"Character preview adapter did not write result JSON: {result_path}")
    result = read_json(result_path)
    video_path = Path(clean(result.get("dubbedPreviewVideoPath") or result.get("outputVideoPath")))
    if not has_bytes(video_path):
        raise RuntimeError(f"Final dubbed preview video is missing or empty: {video_path}")
    video_url = clean(result.get("dubbedPreviewVideoUrl") or result.get("outputVideoUrl")) or preview_file_url(owner_key, character_id, job_id)
    if not video_url or "/mock-assets/" in video_url:
        raise RuntimeError("Final dubbed preview video URL is missing or invalid.")
    return {
        **result,
        "dubbedPreviewVideoPath": str(video_path),
        "dubbedPreviewVideoUrl": video_url,
        "outputBytes": int(video_path.stat().st_size),
        "previewScript": PREVIEW_SCRIPT,
        "mock": False,
        "adapter": clean(result.get("adapter")) or "character_preview_dub_adapter",
        "provider": "character_preview_dub",
        "status": "completed",
        "currentStage": "completed",
    }


def run_adapter(args: argparse.Namespace, owner_key: str, job: Dict[str, Any]) -> Dict[str, Any]:
    job_id = clean(job.get("jobId"))
    character_id = clean(job.get("characterId") or (job.get("input") or {}).get("characterId"))
    if not job_id or not character_id:
        raise RuntimeError("Claimed character preview job is missing jobId or characterId.")

    work_dir = job_work_dir(args, owner_key, character_id, job_id)
    logs_dir = work_dir / "logs"
    input_path = work_dir / "job-input.json"
    result_path = work_dir / "result.json"
    stdout_path = logs_dir / "character-preview-stdout.log"
    stderr_path = logs_dir / "character-preview-stderr.log"
    work_dir.mkdir(parents=True, exist_ok=True)
    logs_dir.mkdir(parents=True, exist_ok=True)

    job_input = validate_input(job)
    base_result = {
        "sourceImagePath": job_input.get("sourceImagePath"),
        "sourceImageUrl": job_input.get("sourceImageUrl"),
        "previewScript": PREVIEW_SCRIPT,
        "trainedArtifactId": job_input.get("trainedArtifactId") or job_input.get("voiceModelArtifactId"),
        "trainedModelPath": job_input.get("trainedModelPath"),
        "trainedIndexPath": job_input.get("trainedIndexPath"),
        "stdoutPath": str(stdout_path),
        "stderrPath": str(stderr_path),
        "workDir": str(work_dir),
    }

    checkpoint(args, owner_key, job_id, 10, "generating_guide_audio", "Character preview dub claimed. Preparing guide speech.", base_result)
    assert_job_active(args, owner_key, job_id)

    adapter = clean(args.adapter_command or os.environ.get("OTG_CHARACTER_PREVIEW_ADAPTER"))
    if not adapter:
        raise RuntimeError("Character Preview Dub adapter is not configured. Set OTG_CHARACTER_PREVIEW_ADAPTER on the Windows worker.")

    write_json(input_path, {
        "schemaVersion": 1,
        "job": job,
        "input": job_input,
        "previewScript": PREVIEW_SCRIPT,
        "ownerKey": owner_key,
        "characterId": character_id,
        "jobId": job_id,
        "workDir": str(work_dir),
        "resultPath": str(result_path),
    })

    env = os.environ.copy()
    env.update({
        "OTG_CHARACTER_PREVIEW_JOB_JSON": str(input_path),
        "OTG_CHARACTER_PREVIEW_RESULT_JSON": str(result_path),
        "OTG_CHARACTER_PREVIEW_WORK_DIR": str(work_dir),
        "OTG_CHARACTER_PREVIEW_SCRIPT": PREVIEW_SCRIPT,
    })

    checkpoint(args, owner_key, job_id, 25, "generating_ltx_preview_video", "Running Windows character preview adapter.", base_result)
    with stdout_path.open("a", encoding="utf-8") as stdout_file, stderr_path.open("a", encoding="utf-8") as stderr_file:
        proc = subprocess.Popen(adapter, cwd=str(work_dir), env=env, stdout=stdout_file, stderr=stderr_file, shell=True)
        try:
            while proc.poll() is None:
                time.sleep(max(5, args.heartbeat_seconds))
                assert_job_active(args, owner_key, job_id)
                checkpoint(args, owner_key, job_id, 50, "converting_voice", "Character preview adapter is still running.", base_result)
        except BaseException:
            if proc.poll() is None:
                if os.name == "nt":
                    subprocess.run(["taskkill", "/PID", str(proc.pid), "/T", "/F"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
                else:
                    proc.kill()
            raise
        if proc.returncode != 0:
            raise RuntimeError(f"Character preview adapter failed with exit code {proc.returncode}. See {stderr_path}")

    checkpoint(args, owner_key, job_id, 85, "muxing_video", "Validating final dubbed preview video.", base_result)
    result = validate_result(result_path, owner_key, character_id, job_id)
    return {**base_result, **result}


def process_job(args: argparse.Namespace, job: Dict[str, Any]) -> None:
    owner_key = clean(job.get("ownerKey") or (job.get("result") if isinstance(job.get("result"), dict) else {}).get("ownerKey"))
    job_id = clean(job.get("jobId"))
    if not owner_key or not job_id:
        raise RuntimeError("Claimed character preview job is missing ownerKey or jobId.")
    try:
        log(f"[job] {job_id} owner={owner_key} character={job.get('characterId')}")
        assert_job_active(args, owner_key, job_id)
        result = run_adapter(args, owner_key, job)
        complete_job(args, owner_key, job_id, result)
        log(f"[done] {job_id} completed")
    except TerminatedJob as error:
        log(f"[stop] {error}")
    except Exception as error:
        log(f"[fail] {job_id}: {error}")
        fail_job(args, owner_key, job_id, str(error), {"mock": False, "adapter": "character_preview_dub_adapter", "status": "failed", "error": str(error)})


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="OTG Windows Character Preview Dub worker")
    parser.add_argument("--repo", default=os.environ.get("OTG_REPO", r"C:\AI\OTG-Test2"))
    parser.add_argument("--base-url", default=os.environ.get("OTG_BASE_URL", "http://127.0.0.1:3001"))
    parser.add_argument("--device-id", default=os.environ.get("OTG_DEVICE_ID", "slrochford"))
    parser.add_argument("--worker-id", default=os.environ.get("OTG_WORKER_ID", "windows-character-preview-worker"))
    parser.add_argument("--worker-token", default=os.environ.get("OTG_WORKER_TOKEN", ""))
    parser.add_argument("--adapter-command", default=os.environ.get("OTG_CHARACTER_PREVIEW_ADAPTER", ""))
    parser.add_argument("--poll-seconds", type=int, default=int(os.environ.get("OTG_CHARACTER_PREVIEW_WORKER_POLL_SECONDS", "30")))
    parser.add_argument("--heartbeat-seconds", type=int, default=int(os.environ.get("OTG_CHARACTER_PREVIEW_WORKER_HEARTBEAT_SECONDS", "20")))
    parser.add_argument("--once", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if not clean(args.worker_token):
        raise RuntimeError("OTG_WORKER_TOKEN is required for universal all-user character preview worker claim mode.")
    log("Starting OTG Character Preview Dub worker")
    log("  Route: character_voice_pipeline / generate_character_preview only")
    log(f"  BaseUrl: {args.base_url}")
    log(f"  WorkerId: {args.worker_id}")
    log(f"  Adapter: {args.adapter_command or os.environ.get('OTG_CHARACTER_PREVIEW_ADAPTER') or 'not configured'}")
    while True:
        try:
            job = claim_job(args)
            if job:
                process_job(args, job)
            else:
                log("[idle] No queued generate_character_preview job available.")
        except Exception as error:
            log(f"[error] {error}")
        if args.once:
            break
        time.sleep(max(1, args.poll_seconds))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        raise SystemExit(130)
