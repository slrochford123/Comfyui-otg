#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import mimetypes
import os
import shutil
import subprocess
import sys
import time
import traceback
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path
from typing import Any, Dict, List, Tuple


SOURCE_URL_KEYS = [
    "approvedSampleUrl",
    "approvedSampleURL",
    "tunedVoicePreviewUrl",
    "tunedSampleUrl",
    "baseSampleUrl",
    "sourceSampleUrl",
    "referenceAudioUrl",
]

SOURCE_PATH_KEYS = [
    "approvedSamplePath",
    "tunedVoicePreviewPath",
    "tunedSamplePath",
    "baseSamplePath",
    "sourceSamplePath",
    "referenceWav",
    "referenceWavPath",
    "referenceAudioPath",
]


EMOTION_UTTERANCES = [
    ("neutral", "This is a clear neutral line for the character voice."),
    ("calm", "I am calm now, and I can explain what happened."),
    ("happy", "That is wonderful news, and I cannot stop smiling."),
    ("excited", "This is it, we finally found the answer."),
    ("sad", "I tried to hold on, but everything changed too fast."),
    ("scared", "Please be quiet, I think something is moving outside."),
    ("angry", "No, that is not acceptable, and I will not ignore it."),
    ("whisper", "Keep your voice down, someone may be listening."),
    ("shout", "Run now, get out before the door closes."),
    ("tired", "I need a moment, because this has been a very long day."),
    ("curious", "What is that light doing behind the old wall."),
    ("serious", "Listen carefully, because this decision matters."),
    ("confident", "I know exactly what needs to happen next."),
    ("confused", "Wait, that does not match what we saw before."),
    ("relieved", "It is over now, and we made it through together."),
    ("nervous", "I am trying to stay steady, but my hands are shaking."),
    ("soft", "It is alright, you can rest here for a while."),
    ("urgent", "There is no time left, we have to move immediately."),
    ("suspicious", "Something about this story does not feel right."),
    ("determined", "I will finish this, no matter how difficult it becomes."),
]


def log(message: str) -> None:
    print(message, flush=True)


def clean(value: Any) -> str:
    return str(value or "").strip()


def build_url(base_url: str, path_or_url: str) -> str:
    value = clean(path_or_url)
    if value.startswith("http://") or value.startswith("https://"):
        return value
    return urllib.parse.urljoin(base_url.rstrip("/") + "/", value.lstrip("/"))


def clamp_clip_count(value: Any, fallback: int = 200) -> int:
    try:
        number = int(float(value))
    except Exception:
        number = fallback
    return max(1, min(200, number))


def build_utterances(count: int) -> List[Dict[str, str]]:
    rows: List[Dict[str, str]] = []
    for i in range(count):
        emotion, text = EMOTION_UTTERANCES[i % len(EMOTION_UTTERANCES)]
        take = i // len(EMOTION_UTTERANCES) + 1
        if take > 1:
            text = f"{text} Take {take}, keep the same character voice with {emotion} delivery."
        rows.append({"emotion": emotion, "text": text})
    return rows


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


class TerminatedJob(RuntimeError):
    pass


def auth_headers(args: argparse.Namespace, owner_key: str | None = None) -> Dict[str, str]:
    headers = {
        "x-otg-device-id": args.device_id,
        "x-otg-worker-id": args.worker_id,
    }
    if owner_key:
        headers["x-otg-owner-key"] = owner_key
    token = clean(getattr(args, "worker_token", ""))
    if token:
        headers["authorization"] = f"Bearer {token}"
    return headers


def assert_job_active(args: argparse.Namespace, headers: Dict[str, str], job_id: str) -> None:
    if not job_id:
        return
    data = request_json(
        "GET",
        build_url(args.base_url, f"/api/characters/voice-pipeline/{urllib.parse.quote(job_id)}"),
        headers,
        timeout=60,
    )
    job = data.get("job") if isinstance(data.get("job"), dict) else {}
    status = clean(job.get("status"))
    if status in {"canceled", "cancelled", "terminated", "completed"}:
        raise TerminatedJob(f"Dataset job {job_id} is no longer active; status={status}.")


def checkpoint_job(args: argparse.Namespace, headers: Dict[str, str], job_id: str, generated_count: int, requested_count: int, message: str) -> None:
    if not job_id:
        return
    progress = 5
    if requested_count > 0:
        progress = max(5, min(99, int((generated_count / requested_count) * 100)))
    try:
        request_json(
            "POST",
            build_url(args.base_url, "/api/worker/jobs/checkpoint"),
            headers,
            {
                "jobId": job_id,
                "progress": progress,
                "message": message,
                "result": {
                    "remoteWorker": True,
                    "workerId": args.worker_id,
                    "provider": "indextts2",
                    "requestedClipCount": requested_count,
                    "generatedClipCount": generated_count,
                    "currentClipId": f"clip_{generated_count:03d}" if generated_count else "",
                },
            },
            timeout=60,
        )
    except TerminatedJob:
        raise
    except Exception as error:
        log(f"[warn] Could not checkpoint job {job_id}: {error}")


def download_file(url: str, target: Path, headers: Dict[str, str], timeout: int = 300) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(url, headers=headers, method="GET")
    with urllib.request.urlopen(req, timeout=timeout) as response:
        with target.open("wb") as handle:
            shutil.copyfileobj(response, handle)
    if not target.exists() or target.stat().st_size <= 0:
        raise RuntimeError(f"Downloaded file is empty: {target}")


def copy_local_source(source: Path, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, target)
    if not target.exists() or target.stat().st_size <= 0:
        raise RuntimeError(f"Copied source voice is empty: {target}")


def resolve_source_sample(args: argparse.Namespace, headers: Dict[str, str], job_input: Dict[str, Any], work_dir: Path) -> Tuple[Path, str]:
    source_path = work_dir / "source.wav"

    for key in SOURCE_PATH_KEYS:
        value = clean(job_input.get(key))
        if not value:
            continue
        candidate = Path(value).expanduser()
        if candidate.exists() and candidate.is_file() and candidate.stat().st_size > 0:
            log(f"[source] using local {key}: {candidate}")
            copy_local_source(candidate, source_path)
            return source_path, str(candidate)
        log(f"[source] local candidate from {key} is not readable on this Windows worker: {value}")

    for key in SOURCE_URL_KEYS:
        value = clean(job_input.get(key))
        if not value:
            continue
        url = build_url(args.base_url, value)
        log(f"[download] using {key}: {url}")
        download_file(url, source_path, headers)
        return source_path, value

    raise RuntimeError(
        "Claimed dataset job has no readable approved reference sample. "
        "Expected one of path fields "
        + ", ".join(SOURCE_PATH_KEYS)
        + " or URL fields "
        + ", ".join(SOURCE_URL_KEYS)
        + "."
    )


def multipart_post(url: str, headers: Dict[str, str], fields: Dict[str, str], files: List[Tuple[str, Path, str]], timeout: int = 1800) -> Dict[str, Any]:
    boundary = "----otg-indextts2-" + uuid.uuid4().hex
    chunks: List[bytes] = []

    for name, value in fields.items():
        chunks.append(f"--{boundary}\r\n".encode("utf-8"))
        chunks.append(f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode("utf-8"))
        chunks.append(str(value).encode("utf-8"))
        chunks.append(b"\r\n")

    for name, file_path, content_type in files:
        chunks.append(f"--{boundary}\r\n".encode("utf-8"))
        chunks.append(f'Content-Disposition: form-data; name="{name}"; filename="{file_path.name}"\r\n'.encode("utf-8"))
        chunks.append(f"Content-Type: {content_type}\r\n\r\n".encode("utf-8"))
        chunks.append(file_path.read_bytes())
        chunks.append(b"\r\n")

    chunks.append(f"--{boundary}--\r\n".encode("utf-8"))
    body = b"".join(chunks)

    req_headers = dict(headers)
    req_headers["content-type"] = f"multipart/form-data; boundary={boundary}"
    req_headers["content-length"] = str(len(body))

    req = urllib.request.Request(url, data=body, headers=req_headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            raw = response.read()
            return json.loads(raw.decode("utf-8")) if raw else {}
    except urllib.error.HTTPError as error:
        raw = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {error.code} {url}: {raw}") from error


def run_indextts2(index_root: Path, index_python: Path, source_voice: Path, text: str, output_path: Path, timeout_seconds: int) -> None:
    generate_py = index_root / "generate.py"
    if not index_python.exists():
        raise FileNotFoundError(f"IndexTTS2 Python not found: {index_python}")
    if not generate_py.exists():
        raise FileNotFoundError(f"IndexTTS2 generate.py not found: {generate_py}")
    if not source_voice.exists():
        raise FileNotFoundError(f"Source voice sample not found: {source_voice}")

    output_path.parent.mkdir(parents=True, exist_ok=True)

    cmd = [
        str(index_python),
        str(generate_py),
        "--text", text,
        "--voice", str(source_voice),
        "--output", str(output_path),
        "--language", "en",
    ]

    log(f"[generate] {output_path.name}")
    result = subprocess.run(cmd, cwd=str(index_root), capture_output=True, text=True, timeout=timeout_seconds)

    output_path.with_suffix(".stdout.log").write_text(result.stdout or "", encoding="utf-8")
    output_path.with_suffix(".stderr.log").write_text(result.stderr or "", encoding="utf-8")

    if result.returncode != 0:
        raise RuntimeError(f"IndexTTS2 failed for {output_path.name}; exit={result.returncode}; stderr={output_path.with_suffix('.stderr.log')}")
    if not output_path.exists() or output_path.stat().st_size <= 0:
        raise RuntimeError(f"IndexTTS2 did not create output: {output_path}")


def make_manifest(owner_key: str, character_id: str, job_id: str, source_url: str, utterances: List[Dict[str, str]], ready_count: int) -> Dict[str, Any]:
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    clips = []

    for index, row in enumerate(utterances):
        clip_number = index + 1
        clip_id = f"clip_{clip_number:03d}"
        ready = clip_number <= ready_count
        clips.append({
            "clipId": clip_id,
            "index": index,
            "text": row["text"],
            "emotion": row["emotion"],
            "status": "ready" if ready else "pending",
            "expectedAudioPath": "",
            "expectedAudioUrl": None,
            "generatorProvider": "indextts2" if ready else None,
            "updatedAt": now,
        })

    return {
        "schemaVersion": 1,
        "ownerKey": owner_key,
        "characterId": character_id,
        "jobId": job_id,
        "createdAt": now,
        "source": {
            "approvedSampleUrl": source_url,
            "originalSourceUrl": source_url,
            "sourceFormat": ".wav",
            "sampleRate": 24000,
            "channels": 1,
        },
        "logs": {},
        "generationMode": "real",
        "provider": "indextts2",
        "startedAt": now,
        "completedAt": now if ready_count == len(utterances) else None,
        "requestedClipCount": len(utterances),
        "generatedClipCount": ready_count,
        "clips": clips,
        "status": "voice_pack_ready" if ready_count == len(utterances) else "manifest_ready",
        "mock": False,
        "note": "Generated on Windows RTX 3090 IndexTTS2 worker using varied phrase/emotion prompts.",
    }


def upload_batch(args: argparse.Namespace, headers: Dict[str, str], character_id: str, job_id: str, manifest: Dict[str, Any], source_path: Path, clip_paths: List[Path]) -> Dict[str, Any]:
    url = build_url(args.base_url, "/api/characters/training-dataset/upload-batch")
    fields = {
        "characterId": character_id,
        "jobId": job_id,
        "manifest": json.dumps(manifest),
    }

    files: List[Tuple[str, Path, str]] = []
    if source_path.exists():
        files.append(("source.wav", source_path, "audio/wav"))

    for clip_path in clip_paths:
        files.append((clip_path.stem, clip_path, mimetypes.guess_type(str(clip_path))[0] or "audio/wav"))

    log(f"[upload] {job_id}: {len(clip_paths)} clips")
    response = multipart_post(url, headers, fields, files, timeout=args.upload_timeout_seconds)
    if not response.get("ok"):
        raise RuntimeError(f"Upload failed: {json.dumps(response, indent=2)}")
    return response


def assert_manifest_complete(upload_response: Dict[str, Any], requested_count: int) -> Dict[str, Any]:
    manifest = upload_response.get("manifest")
    if not isinstance(manifest, dict):
        raise RuntimeError("Remote upload did not return a training dataset manifest.")

    clips = manifest.get("clips")
    if not isinstance(clips, list):
        raise RuntimeError("Remote training dataset manifest has no clips array.")

    ready_count = 0
    for clip in clips:
        if isinstance(clip, dict) and clip.get("status") == "ready":
            ready_count += 1

    generated_count = int(manifest.get("generatedClipCount") or ready_count or 0)
    if manifest.get("generationMode") != "real" or manifest.get("provider") != "indextts2":
        raise RuntimeError("Remote manifest is not a real IndexTTS2 dataset manifest.")
    if generated_count < requested_count or ready_count < requested_count:
        raise RuntimeError(f"Remote manifest is incomplete: ready={ready_count}, generated={generated_count}, requested={requested_count}.")
    if manifest.get("status") != "voice_pack_ready":
        raise RuntimeError(f"Remote manifest status is not voice_pack_ready: {manifest.get('status')}")

    return manifest


def mark_failed(args: argparse.Namespace, headers: Dict[str, str], job_id: str, error: str) -> None:
    if not job_id:
        return
    try:
        request_json(
            "POST",
            build_url(args.base_url, "/api/characters/voice-pipeline/worker/fail"),
            headers,
            {
                "jobId": job_id,
                "error": error,
                "result": {
                    "remoteWorker": True,
                    "workerId": args.worker_id,
                    "localError": error,
                },
            },
        )
    except Exception as fail_error:
        log(f"[warn] Could not mark job failed: {fail_error}")


def process_one(args: argparse.Namespace) -> int:
    headers = auth_headers(args, None if args.universal_claim else args.owner_key)

    job_id = ""
    try:
        claim = request_json(
            "POST",
            build_url(args.base_url, "/api/worker/jobs/claim"),
            headers,
            {
                "jobType": "character_voice_pipeline",
                "action": "generate_training_dataset",
                "claimScope": "all_owners" if args.universal_claim else "owner",
                "workerId": args.worker_id,
            },
        )

        job = claim.get("job")
        if not job:
            log("[idle] No queued generate_training_dataset job available.")
            return 0

        job_id = clean(job.get("jobId"))
        owner_key = clean(job.get("ownerKey")) or clean(job.get("owner_key")) or args.owner_key
        character_id = clean(job.get("characterId"))
        job_input = job.get("input") if isinstance(job.get("input"), dict) else {}

        if not job_id or not character_id:
            raise RuntimeError(f"Invalid claimed job: {job}")
        if not owner_key:
            raise RuntimeError(f"Claimed job did not include ownerKey: {job}")

        headers = auth_headers(args, owner_key)

        requested_count = clamp_clip_count(job_input.get("requestedClipCount") or job_input.get("clipCount"), 200)
        if args.max_clips > 0:
            requested_count = min(requested_count, args.max_clips)

        utterances = build_utterances(requested_count)
        work_dir = Path(args.work_root).resolve() / job_id
        clips_dir = work_dir / "clips"
        source_path = work_dir / "source.wav"
        manifest_path = work_dir / "manifest.json"

        work_dir.mkdir(parents=True, exist_ok=True)
        clips_dir.mkdir(parents=True, exist_ok=True)

        log(f"[job] {job_id} character={character_id} clips={requested_count}")
        source_path, source_ref = resolve_source_sample(args, headers, job_input, work_dir)

        generated: List[Path] = []
        pending_upload: List[Path] = []
        job_result = job.get("result") if isinstance(job.get("result"), dict) else {}
        try:
            ready_count = max(0, min(requested_count, int(job_result.get("generatedClipCount") or 0)))
        except Exception:
            ready_count = 0
        if ready_count:
            log(f"[resume] server already has {ready_count}/{requested_count} ready clips; continuing at clip {ready_count + 1}.")
            checkpoint_job(
                args,
                headers,
                job_id,
                ready_count,
                requested_count,
                f"Resuming dataset from {ready_count} / {requested_count} ready clips.",
            )
        index_root = Path(args.index_root).resolve()
        index_python = Path(args.index_python).resolve()
        last_upload: Dict[str, Any] | None = None

        for i, row in enumerate(utterances, start=1):
            clip_id = f"clip_{i:03d}"
            output_path = clips_dir / f"{clip_id}.wav"
            assert_job_active(args, headers, job_id)

            if i <= ready_count and not args.regenerate:
                log(f"[remote-skip] {clip_id}")
                continue

            if output_path.exists() and output_path.stat().st_size > 0 and not args.regenerate:
                log(f"[skip] {clip_id}")
            else:
                run_indextts2(index_root, index_python, source_path, row["text"], output_path, args.clip_timeout_seconds)

            generated.append(output_path)
            pending_upload.append(output_path)
            ready_count = max(ready_count, i)
            checkpoint_job(
                args,
                headers,
                job_id,
                ready_count,
                requested_count,
                f"Generated {ready_count} / {requested_count} clips. Provider: indextts2.",
            )

            if len(pending_upload) >= args.upload_chunk_size:
                assert_job_active(args, headers, job_id)
                manifest = make_manifest(owner_key, character_id, job_id, source_ref, utterances, ready_count)
                manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
                last_upload = upload_batch(args, headers, character_id, job_id, manifest, source_path, pending_upload)
                pending_upload = []

        if pending_upload:
            assert_job_active(args, headers, job_id)
            manifest = make_manifest(owner_key, character_id, job_id, source_ref, utterances, ready_count)
            manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
            last_upload = upload_batch(args, headers, character_id, job_id, manifest, source_path, pending_upload)

        final_manifest = make_manifest(owner_key, character_id, job_id, source_ref, utterances, ready_count)
        manifest_path.write_text(json.dumps(final_manifest, indent=2), encoding="utf-8")
        if last_upload is None:
            raise RuntimeError("No clip batch was uploaded for this dataset job.")
        remote_manifest = assert_manifest_complete(last_upload, requested_count)

        complete_result = {
            "mock": False,
            "adapter": "dataset_manifest",
            "provider": "indextts2",
            "remoteWorker": True,
            "workerId": args.worker_id,
            "clipCount": requested_count,
            "requestedClipCount": requested_count,
            "generatedClipCount": ready_count,
            "generationMode": "real",
            "status": "voice_pack_ready",
            "localWorkDir": str(work_dir),
            "manifestStatus": remote_manifest.get("status"),
        }

        complete = request_json(
            "POST",
            build_url(args.base_url, "/api/characters/voice-pipeline/worker/complete"),
            headers,
            {
                "jobId": job_id,
                "result": complete_result,
                "message": f"Remote Windows IndexTTS2 dataset completed: {ready_count}/{requested_count} clips.",
            },
        )
        log(f"[complete] {json.dumps(complete, indent=2)}")
        return 0

    except TerminatedJob as error:
        log(f"[terminated] {error}")
        return 0
    except Exception as error:
        text = f"{error}\n{traceback.format_exc()}"
        log(f"[error] {text}")
        mark_failed(args, headers, job_id, text)
        return 1


def main() -> int:
    parser = argparse.ArgumentParser(description="OTG Windows RTX 3090 IndexTTS2 dataset worker")
    parser.add_argument("--base-url", default=os.environ.get("OTG_BASE_URL", "https://comf-otg.comfyui-otg.win"))
    parser.add_argument("--owner-key", default=os.environ.get("OTG_OWNER_KEY", ""))
    parser.add_argument("--device-id", default=os.environ.get("OTG_DEVICE_ID", "slrochford"))
    parser.add_argument("--worker-id", default=os.environ.get("OTG_WORKER_ID", "windows-rtx3090-indextts2"))
    parser.add_argument("--worker-token", default=os.environ.get("OTG_WORKER_TOKEN", ""))
    parser.add_argument("--index-root", default=os.environ.get("INDEXTTS2_ROOT", r"C:\AI\Voices\IndexTTS2"))
    parser.add_argument("--index-python", default=os.environ.get("INDEXTTS2_PYTHON", r"C:\AI\Voices\IndexTTS2\.venv\Scripts\python.exe"))
    parser.add_argument("--work-root", default=os.environ.get("OTG_INDEXTTS2_WORK_ROOT", r"C:\AI\OTG-Worker\indextts2-datasets"))
    parser.add_argument("--upload-chunk-size", type=int, default=int(os.environ.get("OTG_INDEXTTS2_UPLOAD_CHUNK_SIZE", "10")))
    parser.add_argument("--max-clips", type=int, default=int(os.environ.get("OTG_INDEXTTS2_MAX_CLIPS", "0")))
    parser.add_argument("--clip-timeout-seconds", type=int, default=int(os.environ.get("OTG_INDEXTTS2_CLIP_TIMEOUT_SECONDS", "900")))
    parser.add_argument("--upload-timeout-seconds", type=int, default=int(os.environ.get("OTG_INDEXTTS2_UPLOAD_TIMEOUT_SECONDS", "1800")))
    parser.add_argument("--poll-seconds", type=int, default=int(os.environ.get("OTG_INDEXTTS2_POLL_SECONDS", "30")))
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--regenerate", action="store_true")
    parser.add_argument("--universal-claim", action="store_true")

    args = parser.parse_args()

    if args.upload_chunk_size < 1 or args.upload_chunk_size > 50:
        raise ValueError("--upload-chunk-size must be between 1 and 50")

    while True:
        code = process_one(args)
        if args.once:
            return code
        time.sleep(max(5, args.poll_seconds))


if __name__ == "__main__":
    raise SystemExit(main())
