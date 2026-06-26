#!/usr/bin/env python3
"""Dedicated OTG Windows worker for LTX Voice create_voice_sample jobs."""

from __future__ import annotations

import argparse
import json
import mimetypes
import os
import random
import shutil
import sys
import time
import traceback
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path
from typing import Any, Dict


class WorkerError(RuntimeError):
    pass


# OTG_LTX_VOICE_NEGATIVE_PROMPT: keep this exact string in sync with LTX_VOICE_NEGATIVE_PROMPT in voiceDesignModels.ts.
LTX_VOICE_NEGATIVE_PROMPT = "singing, music, background noise, background noises, sound effects, sound effect, ambience, crowd noise, overlapping voices, multiple speakers, choir, instrumental, soundtrack, reverb, echo, muffled speech, distorted speech, whispering, mumbling"


def clean(value: Any) -> str:
    return str(value or "").strip()


def log(message: str) -> None:
    print(message, flush=True)


def build_url(base_url: str, route: str) -> str:
    return urllib.parse.urljoin(base_url.rstrip("/") + "/", route.lstrip("/"))


def request_json(method: str, url: str, headers: Dict[str, str], payload: Dict[str, Any], timeout: int = 300) -> Dict[str, Any]:
    data = None if method.upper() == "GET" else json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            raw = response.read().decode("utf-8", errors="replace")
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        raise WorkerError(f"HTTP {error.code} {url}: {body}") from error


def request_bytes(url: str, timeout: int = 300) -> bytes:
    req = urllib.request.Request(url, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            return response.read()
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        raise WorkerError(f"HTTP {error.code} {url}: {body}") from error


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


def checkpoint(args: argparse.Namespace, headers: Dict[str, str], job_id: str, progress: int, message: str, result: Dict[str, Any] | None = None) -> None:
    try:
        request_json(
            "POST",
            build_url(args.base_url, "/api/worker/jobs/checkpoint"),
            headers,
            {"jobId": job_id, "progress": progress, "message": message, "result": result or {}},
            timeout=args.app_timeout_seconds,
        )
    except Exception as error:
        log(f"[warn] Could not checkpoint job {job_id}: {error}")


def write_json(path: Path, value: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2), encoding="utf-8")


def load_workflow(path: Path) -> Dict[str, Any]:
    if not path.is_file():
        raise WorkerError(f"LTX voice workflow preset not found: {path}")
    return json.loads(path.read_text(encoding="utf-8-sig"))


def node(graph: Dict[str, Any], node_id: str) -> Dict[str, Any]:
    value = graph.get(node_id)
    if not isinstance(value, dict) or not isinstance(value.get("inputs"), dict):
        raise WorkerError(f"LTX voice workflow is missing node {node_id}.")
    return value


def set_input(graph: Dict[str, Any], node_id: str, key: str, value: Any) -> None:
    node(graph, node_id)["inputs"][key] = value


def coerce_seed(value: Any) -> int:
    try:
        number = int(str(value).strip())
        if 0 <= number <= 2147483647:
            return number
    except Exception:
        pass
    return random.randint(1, 2147483647)


def patch_workflow(graph: Dict[str, Any], job_id: str, prompt: str, filename_prefix: str, request_seed: int | None = None) -> None:
    if not prompt:
        raise WorkerError("Missing LTX audition prompt.")
    set_input(graph, "360", "text", prompt)
    set_input(graph, "370", "text", LTX_VOICE_NEGATIVE_PROMPT)
    log("[workflow] OTG_LTX_VOICE_NEGATIVE_PROMPT patched into node 370")
    if request_seed is not None:
        set_input(graph, "333", "noise_seed", request_seed)
        set_input(graph, "334", "noise_seed", request_seed)
        log(f"[workflow] patched RandomNoise nodes 333/334 noise_seed={request_seed}")
    set_input(graph, "369", "value", 1920)
    set_input(graph, "356", "value", 1080)
    set_input(graph, "357", "value", 1)
    set_input(graph, "358", "value", 10)
    set_input(graph, "359", "value", True)
    save_audio = node(graph, "384")
    save_audio["inputs"]["quality"] = "320k"
    save_audio["inputs"]["filename_prefix"] = filename_prefix
    graph.pop("__otg", None)


def submit_comfy(args: argparse.Namespace, graph: Dict[str, Any]) -> str:
    payload = {
        "client_id": args.comfy_client_id or f"otg-ltx-voice-{uuid.uuid4()}",
        "prompt": graph,
    }
    response = request_json("POST", build_url(args.comfy_url, "/prompt"), {"content-type": "application/json"}, payload, timeout=args.comfy_timeout_seconds)
    prompt_id = clean(response.get("prompt_id") or response.get("promptId"))
    if not prompt_id:
        raise WorkerError(f"ComfyUI did not return prompt_id: {json.dumps(response, indent=2)}")
    return prompt_id


def history_for_prompt(args: argparse.Namespace, prompt_id: str) -> Dict[str, Any]:
    deadline = time.time() + args.history_timeout_seconds
    history_url = build_url(args.comfy_url, f"/history/{urllib.parse.quote(prompt_id)}")
    while time.time() < deadline:
        history = request_json("GET", history_url, {"content-type": "application/json"}, {}, timeout=args.comfy_timeout_seconds)
        entry = history.get(prompt_id) if isinstance(history, dict) else None
        if isinstance(entry, dict):
            status = entry.get("status") if isinstance(entry.get("status"), dict) else {}
            if status.get("completed") is True or entry.get("outputs"):
                return entry
            if status.get("status_str") == "error":
                raise WorkerError(f"ComfyUI LTX voice workflow failed: {json.dumps(status, indent=2)}")
        time.sleep(max(1, args.poll_seconds))
    raise WorkerError(f"Timed out waiting for ComfyUI history for prompt {prompt_id}.")


def find_node_384_audio(entry: Dict[str, Any]) -> Dict[str, str]:
    outputs = entry.get("outputs") if isinstance(entry.get("outputs"), dict) else {}
    node_output = outputs.get("384") if isinstance(outputs.get("384"), dict) else {}
    candidates = []
    for key in ("audio", "audios", "mp3", "files"):
        value = node_output.get(key)
        if isinstance(value, list):
            candidates.extend(item for item in value if isinstance(item, dict))
        elif isinstance(value, dict):
            candidates.append(value)
    for item in candidates:
        filename = clean(item.get("filename") or item.get("name"))
        if not filename:
            continue
        return {
            "filename": filename,
            "subfolder": clean(item.get("subfolder")),
            "type": clean(item.get("type")) or "output",
        }
    raise WorkerError("LTX voice workflow completed but no audio output was found.")


def copy_comfy_audio(args: argparse.Namespace, audio: Dict[str, str], output_path: Path) -> None:
    query = urllib.parse.urlencode({
        "filename": audio["filename"],
        "subfolder": audio.get("subfolder", ""),
        "type": audio.get("type", "output"),
    })
    view_url = build_url(args.comfy_url, f"/view?{query}")
    data = request_bytes(view_url, timeout=args.comfy_timeout_seconds)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_bytes(data)
    if not output_path.is_file():
        raise WorkerError("LTX voice audio output was missing after copy.")
    if output_path.stat().st_size <= 0:
        raise WorkerError("LTX voice audio output was empty.")


def multipart_post(url: str, headers: Dict[str, str], fields: Dict[str, str], file_field: str, file_path: Path, timeout: int) -> Dict[str, Any]:
    boundary = f"----otg-ltx-voice-{int(time.time() * 1000)}"
    body = bytearray()
    for key, value in fields.items():
        body.extend(f"--{boundary}\r\n".encode("utf-8"))
        body.extend(f'Content-Disposition: form-data; name="{key}"\r\n\r\n'.encode("utf-8"))
        body.extend(str(value).encode("utf-8"))
        body.extend(b"\r\n")
    mime = mimetypes.guess_type(str(file_path))[0] or "audio/mpeg"
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
            raw = response.read().decode("utf-8", errors="replace")
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as error:
        text = error.read().decode("utf-8", errors="replace")
        raise WorkerError(f"HTTP {error.code} {url}: {text}") from error


def upload_sample(args: argparse.Namespace, headers: Dict[str, str], character_id: str, job_id: str, sample_path: Path, provider: str, adapter: str) -> Dict[str, Any]:
    response = multipart_post(
        build_url(args.base_url, "/api/characters/voice-sample/upload"),
        headers,
        {"characterId": character_id, "jobId": job_id, "provider": provider, "adapter": adapter},
        "file",
        sample_path,
        args.app_timeout_seconds,
    )
    if not response.get("ok"):
        raise WorkerError(f"LTX voice sample upload failed: {json.dumps(response, indent=2)}")
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
                "providers": ["ltx", "unnatural_ltx"],
            },
            timeout=args.app_timeout_seconds,
        )
        job = claim.get("job")
        if not isinstance(job, dict):
            log("[idle] No queued LTX create_voice_sample job available.")
            return 0

        job_id = clean(job.get("jobId"))
        owner_key = clean(job.get("ownerKey"))
        character_id = clean(job.get("characterId"))
        job_input = job.get("input") if isinstance(job.get("input"), dict) else {}
        provider = clean(job_input.get("provider")).lower()
        if provider not in ("ltx", "unnatural_ltx"):
            raise WorkerError(f"Unsupported provider for LTX worker: {provider}")
        if not job_id or not owner_key or not character_id:
            raise WorkerError(f"Invalid claimed LTX voice job: {job}")
        is_unnatural = provider == "unnatural_ltx" or clean(job_input.get("voiceMode")) == "unnatural_voice" or clean(job_input.get("source")) == "unnatural_voice_preset"
        adapter = "ltx_unnatural_voice_sample" if is_unnatural else "ltx_audio_voice_sample"
        filename_prefix = f"audio/otg_unnatural_voice_{job_id}" if is_unnatural else f"audio/otg_ltx_voice_{job_id}"
        output_name = "unnatural-ltx-voice.mp3" if is_unnatural else "ltx-voice.mp3"
        preset_id = clean(job_input.get("presetId"))
        preset_name = clean(job_input.get("presetName"))
        preset_category = clean(job_input.get("presetCategory"))

        headers = auth_headers(args, owner_key)
        work_dir = Path(args.work_root).expanduser().resolve() / owner_key / character_id / job_id
        final_dir = Path(args.repo).resolve() / "data" / "characters" / owner_key / character_id / "voices" / job_id
        sample_path = final_dir / output_name
        work_dir.mkdir(parents=True, exist_ok=True)
        final_dir.mkdir(parents=True, exist_ok=True)

        prompt = clean(job_input.get("prompt") if is_unnatural else job_input.get("ltxAuditionPrompt") or job_input.get("voiceInstruction") or job_input.get("prompt"))
        if is_unnatural and (not preset_id or not preset_name or not preset_category or not prompt):
            raise WorkerError("Unnatural voice preset not found.")
        if not prompt:
            raise WorkerError("Missing LTX audition prompt.")
        request_seed = coerce_seed(job_input.get("requestSeed") or job_input.get("seed")) if is_unnatural else None
        log(f"[claim] {job_id} owner={owner_key} character={character_id} provider={provider}")
        if is_unnatural:
            log(f"[unnatural] preset={preset_name} category={preset_category} seed={request_seed}")
        log(f"[prompt] received {len(prompt)} characters")
        checkpoint(args, headers, job_id, 12, "Unnatural voice creating started." if is_unnatural else "LTX voice creating started.", {"provider": provider, "adapter": adapter, "currentStage": "started", "workerId": args.worker_id, "presetName": preset_name, "presetCategory": preset_category, "requestSeed": request_seed})

        graph = load_workflow(Path(args.workflow_path))
        patch_workflow(graph, job_id, prompt, filename_prefix, request_seed)
        patched_workflow_path = work_dir / "ltx_voice_workflow_patched.json"
        write_json(patched_workflow_path, graph)
        log(f"[workflow] patched {patched_workflow_path} prefix={filename_prefix}")
        checkpoint(args, headers, job_id, 25, "Unnatural voice workflow patched." if is_unnatural else "LTX voice workflow patched.", {"provider": provider, "adapter": adapter, "currentStage": "workflow_patched", "sourceWorkflowPath": args.workflow_path, "requestSeed": request_seed})

        try:
            prompt_id = submit_comfy(args, graph)
            log(f"[comfy] submitted prompt_id={prompt_id}")
            checkpoint(args, headers, job_id, 40, "Unnatural voice workflow submitted to ComfyUI." if is_unnatural else "LTX voice workflow submitted to ComfyUI.", {"provider": provider, "adapter": adapter, "currentStage": "comfy_submitted", "comfyPromptId": prompt_id, "requestSeed": request_seed})

            history = history_for_prompt(args, prompt_id)
        except Exception as comfy_error:
            if is_unnatural:
                raise WorkerError(f"Unnatural voice generation failed. Check ComfyUI/LTX workflow and try again. Detail: {comfy_error}") from comfy_error
            raise
        history_path = work_dir / "ltx_voice_history.json"
        write_json(history_path, history)
        log(f"[history] completed prompt_id={prompt_id}")
        checkpoint(args, headers, job_id, 75, "Unnatural voice workflow completed. Copying audio output." if is_unnatural else "LTX voice workflow completed. Copying audio output.", {"provider": provider, "adapter": adapter, "currentStage": "history_completed", "comfyPromptId": prompt_id, "requestSeed": request_seed})

        try:
            audio = find_node_384_audio(history)
        except WorkerError as audio_error:
            if is_unnatural:
                raise WorkerError("Unnatural voice workflow completed but no audio output was found.") from audio_error
            raise
        copy_comfy_audio(args, audio, sample_path)
        if sample_path.stat().st_size <= 0:
            raise WorkerError("LTX voice audio output was empty.")
        shutil.copy2(sample_path, work_dir / output_name)
        log(f"[audio] copied {sample_path} bytes={sample_path.stat().st_size}")
        checkpoint(args, headers, job_id, 88, "Unnatural voice audio copied. Uploading playable sample." if is_unnatural else "LTX voice audio copied. Uploading playable sample.", {"provider": provider, "adapter": adapter, "currentStage": "audio_copied", "samplePath": str(sample_path), "comfyPromptId": prompt_id, "requestSeed": request_seed})

        upload = upload_sample(args, headers, character_id, job_id, sample_path, provider, adapter)
        result = {
            "mock": False,
            "provider": provider,
            "adapter": adapter,
            "remoteWorker": True,
            "workerId": args.worker_id,
            "voiceMode": "unnatural_voice" if is_unnatural else "ltx_voice",
            "source": "unnatural_voice_preset" if is_unnatural else "ltx_voice_design",
            "presetId": preset_id if is_unnatural else "",
            "presetName": preset_name if is_unnatural else "",
            "presetCategory": preset_category if is_unnatural else "",
            "sampleLine": clean(job_input.get("sampleLine") or job_input.get("sampleText") or job_input.get("text")),
            "requestSeed": request_seed,
            "samplePath": str(sample_path),
            "sampleUrl": upload.get("sampleUrl"),
            "outputAudioPath": str(sample_path),
            "outputAudioUrl": upload.get("sampleUrl"),
            "uploadedSamplePath": upload.get("samplePath"),
            "outputBytes": upload.get("outputBytes") or sample_path.stat().st_size,
            "sourceWorkflowPath": args.workflow_path,
            "patchedWorkflowPath": str(patched_workflow_path),
            "historyPath": str(history_path),
            "comfyPromptId": prompt_id,
            "completedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
        complete = request_json(
            "POST",
            build_url(args.base_url, "/api/worker/jobs/complete"),
            headers,
            {"jobId": job_id, "result": result, "message": "Unnatural voice audio sample completed." if is_unnatural else "LTX voice audio sample completed."},
            timeout=args.app_timeout_seconds,
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
                    {"jobId": job_id, "error": str(error), "result": {"provider": "unnatural_ltx" if "Unnatural" in str(error) else "ltx", "adapter": "ltx_unnatural_voice_sample" if "Unnatural" in str(error) else "ltx_audio_voice_sample", "mock": False, "remoteWorker": True, "workerId": args.worker_id, "error": text}},
                    timeout=args.app_timeout_seconds,
                )
            except Exception as fail_error:
                log(f"[warn] Could not mark LTX job failed: {fail_error}")
        return 1


def main() -> int:
    parser = argparse.ArgumentParser(description="Dedicated OTG LTX Voice Windows worker")
    parser.add_argument("--repo", default=os.environ.get("OTG_REPO", r"C:\AI\OTG-Test2"))
    parser.add_argument("--base-url", default=os.environ.get("OTG_BASE_URL", "http://127.0.0.1:3001"))
    parser.add_argument("--device-id", default=os.environ.get("OTG_DEVICE_ID", "slrochford"))
    parser.add_argument("--worker-id", default=os.environ.get("OTG_WORKER_ID", "windows-voice-ltx-worker"))
    parser.add_argument("--worker-token", default=os.environ.get("OTG_WORKER_TOKEN", ""))
    parser.add_argument("--work-root", default=os.environ.get("OTG_VOICE_LTX_WORK_ROOT", r"C:\AI\OTG-Test2\data\characters\_worker_voice_ltx"))
    parser.add_argument("--workflow-path", default=os.environ.get("OTG_LTX_VOICE_WORKFLOW_PATH", r"C:\AI\OTG-Test2\comfy_workflows\presets\LTX Voice Sample.json"))
    parser.add_argument("--comfy-url", default=os.environ.get("OTG_LTX_COMFY_URL") or os.environ.get("COMFYUI_VIDEO_URL") or os.environ.get("COMFYUI_URL") or "http://127.0.0.1:8188")
    parser.add_argument("--comfy-client-id", default=os.environ.get("OTG_LTX_COMFY_CLIENT_ID", ""))
    parser.add_argument("--comfy-timeout-seconds", type=int, default=int(os.environ.get("OTG_LTX_COMFY_TIMEOUT_SECONDS", "300")))
    parser.add_argument("--history-timeout-seconds", type=int, default=int(os.environ.get("OTG_LTX_HISTORY_TIMEOUT_SECONDS", "1800")))
    parser.add_argument("--app-timeout-seconds", type=int, default=int(os.environ.get("OTG_LTX_APP_TIMEOUT_SECONDS", "300")))
    parser.add_argument("--poll-seconds", type=int, default=int(os.environ.get("OTG_LTX_POLL_SECONDS", "5")))
    parser.add_argument("--once", action="store_true")
    args = parser.parse_args()

    if not args.worker_token:
        raise WorkerError("Missing --worker-token/OTG_WORKER_TOKEN. LTX worker requires token-protected universal claim.")

    while True:
        code = process_one(args)
        if args.once:
            return code
        time.sleep(max(1, args.poll_seconds))


if __name__ == "__main__":
    raise SystemExit(main())
