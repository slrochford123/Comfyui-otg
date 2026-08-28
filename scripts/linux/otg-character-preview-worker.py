#!/usr/bin/env python3
"""Linux Character Preview Dub worker for ComfyUI-OTG TEST.

Claims only character_voice_pipeline/generate_character_preview jobs. The worker
creates an offline guide line, converts it through the selected real Applio model,
creates a short MP4 from the character source image, muxes the converted speech,
validates both audio and video streams, and completes the durable preview job.
"""
from __future__ import annotations

import argparse
import fcntl
import json
import os
import signal
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
PREVIEW_SCRIPT = (
    "Hello, I am your created character. This is a voice dub test so you can hear "
    "the texture and sound of your created character."
)


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
            "action": "generate_character_preview",
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
        raise TerminatedJob(f"Character preview job {job_id} is no longer active; status={status}.")


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
                    "adapter": "linux_character_preview_dub",
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
        {"jobId": job_id, "result": result, "message": "Linux character preview dub completed."},
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
        raise RuntimeError(f"Downloaded source image is empty: {target}")
    return target


def preview_url(owner_key: str, character_id: str, job_id: str, file_name: str) -> str:
    return (
        "/api/characters/character-preview/file"
        f"?owner={urllib.parse.quote(owner_key)}"
        f"&characterId={urllib.parse.quote(character_id)}"
        f"&jobId={urllib.parse.quote(job_id)}"
        f"&file={urllib.parse.quote(file_name)}"
    )


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
            "Waiting for the RTX 3090 ComfyUI queue before character preview voice conversion.",
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
            handle.write(f"linux-character-preview-worker pid={os.getpid()} job={job_id} acquired={time.time()}\n")
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
                "Waiting for the shared RTX 3090 voice GPU lock before character preview conversion.",
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


def run_checked_command(
    args: argparse.Namespace,
    owner_key: str,
    job_id: str,
    command: list[str],
    cwd: Path,
    stdout_path: Path,
    stderr_path: Path,
    progress: int,
    stage: str,
    message: str,
    base_result: Dict[str, Any],
    timeout_seconds: int,
) -> None:
    stdout_path.parent.mkdir(parents=True, exist_ok=True)
    with stdout_path.open("a", encoding="utf-8") as stdout_file, stderr_path.open("a", encoding="utf-8") as stderr_file:
        stdout_file.write(f"[{now_iso()}] START {stage}: {' '.join(command)}\n")
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
                if time.time() - started >= timeout_seconds:
                    kill_process_group(process)
                    raise RuntimeError(f"{stage} timed out after {timeout_seconds} seconds.")
                time.sleep(max(3, args.heartbeat_seconds))
                assert_job_active(args, owner_key, job_id)
                checkpoint(args, owner_key, job_id, progress, stage, message, base_result)
        except BaseException:
            kill_process_group(process)
            raise
        stdout_file.write(f"[{now_iso()}] EXIT {stage}: {process.returncode}\n")
    if process.returncode != 0:
        raise RuntimeError(f"{stage} exited with code {process.returncode}. stdout={stdout_path}; stderr={stderr_path}")


def audio_duration_seconds(path: Path) -> float:
    result = subprocess.run(
        [
            "ffprobe",
            "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            str(path),
        ],
        capture_output=True,
        text=True,
        timeout=30,
        check=True,
    )
    duration = float(result.stdout.strip())
    if duration <= 0:
        raise RuntimeError(f"Invalid audio duration for {path}: {duration}")
    return duration


def stream_types(path: Path) -> set[str]:
    result = subprocess.run(
        [
            "ffprobe",
            "-v", "error",
            "-show_entries", "stream=codec_type",
            "-of", "csv=p=0",
            str(path),
        ],
        capture_output=True,
        text=True,
        timeout=30,
        check=True,
    )
    return {line.strip() for line in result.stdout.splitlines() if line.strip()}


def process_job(args: argparse.Namespace, job: Dict[str, Any]) -> None:
    owner_key = clean(job.get("ownerKey"))
    job_id = clean(job.get("jobId"))
    character_id = clean(job.get("characterId") or (job.get("input") or {}).get("characterId"))
    job_input = job.get("input") if isinstance(job.get("input"), dict) else {}
    if not owner_key or not job_id or not character_id:
        raise RuntimeError("Claimed character preview job is missing ownerKey, jobId, or characterId.")

    source_image = Path(clean(job_input.get("sourceImagePath"))).expanduser()
    if not has_bytes(source_image):
        source_url = clean(job_input.get("sourceImageUrl"))
        if not source_url:
            raise RuntimeError("Character source image is missing. Cannot generate preview.")
    model_path = Path(clean(job_input.get("trainedModelPath") or job_input.get("modelPath"))).expanduser()
    index_path = Path(clean(job_input.get("trainedIndexPath") or job_input.get("indexPath"))).expanduser()
    if not has_bytes(model_path) or not has_bytes(index_path):
        raise RuntimeError(f"Trained Applio model/index missing. model={model_path}; index={index_path}")
    if job_input.get("trainedArtifactMock") is not False and job_input.get("trainingMock") is not False and job_input.get("artifactMock") is not False:
        raise RuntimeError("Character preview requires a real trained artifact with mock:false.")

    preview_root = (
        Path(args.data_root).expanduser().resolve()
        / "characters"
        / safe_segment(owner_key)
        / "character-preview"
        / safe_segment(character_id)
        / safe_segment(job_id)
    )
    logs_dir = preview_root / "logs"
    preview_root.mkdir(parents=True, exist_ok=True)
    logs_dir.mkdir(parents=True, exist_ok=True)
    if not has_bytes(source_image):
        source_image = download_file(args, owner_key, clean(job_input.get("sourceImageUrl")), preview_root / "source-image")

    guide_raw = preview_root / "guide-espeak.wav"
    guide_audio = preview_root / "guide.wav"
    dubbed_audio = preview_root / "dubbed-audio.wav"
    raw_preview = preview_root / "raw-preview.mp4"
    final_preview = preview_root / "dubbed-preview.mp4"
    stdout_path = logs_dir / "character-preview-stdout.log"
    stderr_path = logs_dir / "character-preview-stderr.log"
    command_path = logs_dir / "character-preview-commands.json"

    applio_root = Path(args.applio_root).expanduser().resolve()
    applio_python = Path(args.applio_python).expanduser().absolute()
    core_script = Path(args.applio_core).expanduser().resolve()
    if not applio_root.is_dir() or not applio_python.exists() or not core_script.is_file():
        raise RuntimeError(
            f"Applio runtime is incomplete. root={applio_root}; python={applio_python}; core={core_script}"
        )

    base_result = {
        "sourceImagePath": str(source_image),
        "sourceImageUrl": clean(job_input.get("sourceImageUrl")),
        "previewScript": PREVIEW_SCRIPT,
        "trainedArtifactId": clean(job_input.get("trainedArtifactId") or job_input.get("voiceModelArtifactId")),
        "trainedModelPath": str(model_path),
        "trainedIndexPath": str(index_path),
        "workDir": str(preview_root),
        "stdoutPath": str(stdout_path),
        "stderrPath": str(stderr_path),
        "commandPath": str(command_path),
    }

    checkpoint(args, owner_key, job_id, 10, "generating_guide_audio", "Preparing offline guide speech.", base_result)
    espeak_command = [
        "espeak-ng",
        "-v", args.espeak_voice,
        "-s", str(args.espeak_speed),
        "-p", str(args.espeak_pitch),
        "-w", str(guide_raw),
        PREVIEW_SCRIPT,
    ]
    normalize_command = [
        "ffmpeg", "-y", "-v", "error",
        "-i", str(guide_raw),
        "-ac", "1",
        "-ar", "40000",
        "-af", "loudnorm=I=-18:TP=-1.5:LRA=11",
        str(guide_audio),
    ]
    infer_command = [
        str(applio_python),
        str(core_script),
        "infer",
        "--pitch", str(args.pitch),
        "--index_rate", str(args.index_rate),
        "--volume_envelope", "1",
        "--protect", str(args.protect),
        "--f0_method", args.f0_method,
        "--input_path", str(guide_audio),
        "--output_path", str(dubbed_audio),
        "--pth_path", str(model_path),
        "--index_path", str(index_path),
        "--split_audio", "False",
        "--f0_autotune", "False",
        "--clean_audio", "False",
        "--export_format", "WAV",
        "--embedder_model", args.embedder_model,
    ]
    command_path.write_text(
        json.dumps(
            {
                "schemaVersion": 1,
                "adapter": "linux_character_preview_dub",
                "workerId": args.worker_id,
                "jobId": job_id,
                "ownerKey": owner_key,
                "characterId": character_id,
                "previewScript": PREVIEW_SCRIPT,
                "commands": {
                    "guide": espeak_command,
                    "normalizeGuide": normalize_command,
                    "applioInfer": infer_command,
                },
                "startedAt": now_iso(),
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    run_checked_command(
        args, owner_key, job_id, espeak_command, preview_root, stdout_path, stderr_path,
        15, "generating_guide_audio", "Generating guide speech.", base_result, 120,
    )
    run_checked_command(
        args, owner_key, job_id, normalize_command, preview_root, stdout_path, stderr_path,
        20, "normalizing_guide_audio", "Normalizing guide speech for Applio.", base_result, 120,
    )
    if not has_bytes(guide_audio):
        raise RuntimeError(f"Guide speech was not created: {guide_audio}")

    gpu_lock = None
    try:
        gpu_lock = acquire_gpu_lock(args, owner_key, job_id)
        wait_for_comfy_idle(args, owner_key, job_id)
        release_comfy_models(args)
        checkpoint(args, owner_key, job_id, 35, "converting_voice", "Converting guide speech with the trained Applio voice.", base_result)
        run_checked_command(
            args, owner_key, job_id, infer_command, applio_root, stdout_path, stderr_path,
            55, "converting_voice", "Applio character voice conversion is running.", base_result,
            args.inference_timeout_seconds,
        )
    finally:
        if gpu_lock is not None:
            try:
                fcntl.flock(gpu_lock.fileno(), fcntl.LOCK_UN)
            finally:
                gpu_lock.close()
                log("[gpu-lock] Released shared voice GPU lock.")

    if not has_bytes(dubbed_audio):
        raise RuntimeError(f"Applio did not create dubbed preview audio: {dubbed_audio}")
    duration = max(2.0, audio_duration_seconds(dubbed_audio) + 0.15)
    filter_graph = (
        f"scale={args.width}:{args.height}:force_original_aspect_ratio=decrease,"
        f"pad={args.width}:{args.height}:(ow-iw)/2:(oh-ih)/2:color=black,"
        "format=yuv420p"
    )
    raw_command = [
        "ffmpeg", "-y", "-v", "error",
        "-loop", "1",
        "-framerate", str(args.fps),
        "-i", str(source_image),
        "-vf", filter_graph,
        "-t", f"{duration:.3f}",
        "-r", str(args.fps),
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-tune", "stillimage",
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        "-an",
        str(raw_preview),
    ]
    mux_command = [
        "ffmpeg", "-y", "-v", "error",
        "-i", str(raw_preview),
        "-i", str(dubbed_audio),
        "-map", "0:v:0",
        "-map", "1:a:0",
        "-c:v", "copy",
        "-c:a", "aac",
        "-b:a", "192k",
        "-shortest",
        "-movflags", "+faststart",
        str(final_preview),
    ]
    command_record = json.loads(command_path.read_text(encoding="utf-8"))
    command_record["commands"]["rawPreview"] = raw_command
    command_record["commands"]["mux"] = mux_command
    command_path.write_text(json.dumps(command_record, indent=2), encoding="utf-8")

    checkpoint(args, owner_key, job_id, 70, "generating_preview_video", "Creating the source-image preview video.", base_result)
    run_checked_command(
        args, owner_key, job_id, raw_command, preview_root, stdout_path, stderr_path,
        75, "generating_preview_video", "Source-image preview generation is running.", base_result, 600,
    )
    checkpoint(args, owner_key, job_id, 88, "muxing_video", "Muxing the trained voice into the preview video.", base_result)
    run_checked_command(
        args, owner_key, job_id, mux_command, preview_root, stdout_path, stderr_path,
        90, "muxing_video", "Final preview mux is running.", base_result, 600,
    )

    if not has_bytes(raw_preview) or not has_bytes(final_preview):
        raise RuntimeError(f"Preview output is missing. raw={raw_preview}; final={final_preview}")
    raw_streams = stream_types(raw_preview)
    final_streams = stream_types(final_preview)
    if "video" not in raw_streams:
        raise RuntimeError(f"Raw preview is missing a video stream: {raw_preview}")
    if not {"video", "audio"}.issubset(final_streams):
        raise RuntimeError(f"Dubbed preview must contain video and audio streams. streams={sorted(final_streams)}")

    result = {
        **base_result,
        "adapter": "linux_character_preview_dub",
        "provider": "character_preview_dub",
        "mock": False,
        "remoteWorker": True,
        "workerId": args.worker_id,
        "status": "completed",
        "currentStage": "completed",
        "guideAudioPath": str(guide_audio),
        "guideAudioUrl": preview_url(owner_key, character_id, job_id, "guide.wav"),
        "dubbedAudioPath": str(dubbed_audio),
        "dubbedAudioUrl": preview_url(owner_key, character_id, job_id, "dubbed-audio.wav"),
        "rawPreviewVideoPath": str(raw_preview),
        "rawPreviewVideoUrl": preview_url(owner_key, character_id, job_id, "raw-preview.mp4"),
        "rawPreviewBytes": raw_preview.stat().st_size,
        "rawPreviewVideoBytes": raw_preview.stat().st_size,
        "dubbedPreviewVideoPath": str(final_preview),
        "dubbedPreviewVideoUrl": preview_url(owner_key, character_id, job_id, "dubbed-preview.mp4"),
        "outputVideoPath": str(final_preview),
        "outputVideoUrl": preview_url(owner_key, character_id, job_id, "dubbed-preview.mp4"),
        "outputBytes": final_preview.stat().st_size,
        "dubbedPreviewVideoBytes": final_preview.stat().st_size,
        "videoBytes": final_preview.stat().st_size,
        "durationSeconds": round(audio_duration_seconds(final_preview), 3),
        "completedAt": now_iso(),
    }
    complete_job(args, owner_key, job_id, result)
    log(f"[complete] {job_id} video={result['dubbedPreviewVideoUrl']} bytes={result['outputBytes']}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Dedicated OTG Linux Character Preview Dub worker")
    parser.add_argument("--base-url", default=os.environ.get("OTG_BASE_URL", "http://100.75.162.64:3001"))
    parser.add_argument("--device-id", default=os.environ.get("OTG_DEVICE_ID", "linux-character-preview"))
    parser.add_argument("--worker-id", default=os.environ.get("OTG_WORKER_ID", "linux-character-preview-worker"))
    parser.add_argument("--worker-token", default=os.environ.get("OTG_WORKER_TOKEN", ""))
    parser.add_argument("--data-root", default=os.environ.get("OTG_DATA_DIR", "/home/shawn-rochford/AI/runtime/test/data"))
    parser.add_argument("--applio-root", default=os.environ.get("APPLIO_ROOT", "/home/shawn-rochford/AI/runtime/test/Applio"))
    parser.add_argument("--applio-python", default=os.environ.get("APPLIO_PYTHON", "/home/shawn-rochford/AI/runtime/test/Applio/.venv/bin/python"))
    parser.add_argument("--applio-core", default=os.environ.get("APPLIO_CORE_SCRIPT", "/home/shawn-rochford/AI/runtime/test/Applio/core.py"))
    parser.add_argument("--comfy-url", default=os.environ.get("OTG_PRIMARY_COMFY_URL", "http://100.75.162.64:8188"))
    parser.add_argument("--gpu-lock-file", default=os.environ.get("OTG_VOICE_GPU_LOCK_FILE", "/home/shawn-rochford/AI/runtime/test/voice-gpu.lock"))
    parser.add_argument("--pitch", type=int, default=int(os.environ.get("APPLIO_PREVIEW_PITCH", "0")))
    parser.add_argument("--index-rate", type=float, default=float(os.environ.get("APPLIO_PREVIEW_INDEX_RATE", "0.75")))
    parser.add_argument("--protect", type=float, default=float(os.environ.get("APPLIO_PREVIEW_PROTECT", "0.33")))
    parser.add_argument("--f0-method", default=os.environ.get("APPLIO_PREVIEW_F0_METHOD", "rmvpe"))
    parser.add_argument("--embedder-model", default=os.environ.get("APPLIO_PREVIEW_EMBEDDER", "contentvec"))
    parser.add_argument("--espeak-voice", default=os.environ.get("OTG_PREVIEW_ESPEAK_VOICE", "en-us"))
    parser.add_argument("--espeak-speed", type=int, default=int(os.environ.get("OTG_PREVIEW_ESPEAK_SPEED", "155")))
    parser.add_argument("--espeak-pitch", type=int, default=int(os.environ.get("OTG_PREVIEW_ESPEAK_PITCH", "50")))
    parser.add_argument("--width", type=int, default=int(os.environ.get("OTG_PREVIEW_WIDTH", "1280")))
    parser.add_argument("--height", type=int, default=int(os.environ.get("OTG_PREVIEW_HEIGHT", "720")))
    parser.add_argument("--fps", type=int, default=int(os.environ.get("OTG_PREVIEW_FPS", "24")))
    parser.add_argument("--poll-seconds", type=int, default=int(os.environ.get("OTG_CHARACTER_PREVIEW_WORKER_POLL_SECONDS", "15")))
    parser.add_argument("--heartbeat-seconds", type=int, default=int(os.environ.get("OTG_CHARACTER_PREVIEW_WORKER_HEARTBEAT_SECONDS", "15")))
    parser.add_argument("--inference-timeout-seconds", type=int, default=int(os.environ.get("OTG_CHARACTER_PREVIEW_INFERENCE_TIMEOUT_SECONDS", "1200")))
    parser.add_argument("--comfy-idle-timeout-seconds", type=int, default=int(os.environ.get("OTG_CHARACTER_PREVIEW_COMFY_IDLE_TIMEOUT_SECONDS", "1800")))
    parser.add_argument("--gpu-lock-wait-seconds", type=int, default=int(os.environ.get("OTG_CHARACTER_PREVIEW_GPU_LOCK_WAIT_SECONDS", "21600")))
    parser.add_argument("--once", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if not clean(args.worker_token):
        raise RuntimeError("OTG_WORKER_TOKEN is required for universal all-owner character preview claim mode.")
    log("Starting dedicated OTG Linux Character Preview Dub worker")
    log("  Route: character_voice_pipeline / generate_character_preview only")
    log(f"  BaseUrl: {args.base_url}")
    log(f"  WorkerId: {args.worker_id}")
    log(f"  DataRoot: {args.data_root}")
    while True:
        job: Dict[str, Any] | None = None
        try:
            job = claim_job(args)
            if not job:
                log("[idle] No queued generate_character_preview job available.")
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
                            "adapter": "linux_character_preview_dub",
                            "mock": False,
                            "remoteWorker": True,
                            "workerId": args.worker_id,
                            "status": "failed",
                            "failedAt": now_iso(),
                            "message": str(error),
                        },
                    )
                except Exception as report_error:
                    log(f"[warn] Could not report failed preview job: {report_error}")
            log(f"[failed] {job_id}: {error}")
            traceback.print_exc()
            if args.once:
                return 1
            time.sleep(max(5, args.poll_seconds))


if __name__ == "__main__":
    raise SystemExit(main())
