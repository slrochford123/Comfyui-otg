#!/usr/bin/env python3
"""Linux LTX character voice worker for ComfyUI-OTG TEST.

Claims only durable character voice jobs with:
  jobType=character_voice_pipeline
  action=create_voice_sample
  provider in {ltx, unnatural_ltx}

The worker uses the Linux RTX 3090 ComfyUI endpoint, validates the workflow
against /object_info before claiming, patches the installed official full LTX 2.3
checkpoint into the model, audio-VAE, and text-projection loaders, renders a
deliberately low-resolution visual carrier, copies node 384 MP3 output, uploads
the sample, and completes the durable job.
"""

from __future__ import annotations

import argparse
import fcntl
import json
import mimetypes
import os
import random
import subprocess
import threading
import time
import traceback
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path
from typing import Any, Dict, Iterable


class WorkerError(RuntimeError):
    pass


class SubmissionUnknownError(WorkerError):
    pass


LTX_VOICE_NEGATIVE_PROMPT = (
    "singing, music, background noise, background noises, sound effects, sound effect, "
    "ambience, crowd noise, overlapping voices, multiple speakers, choir, instrumental, "
    "soundtrack, reverb, echo, muffled speech, distorted speech, whispering, mumbling"
)

FULL_CHECKPOINT_CANDIDATES = (
    "ltx-2.3-22b-dev-fp8.safetensors",
)
TEXT_ENCODER_CANDIDATES = (
    "gemma_3_12B_it_fp8_scaled.safetensors",
)
LORA_CANDIDATES = (
    "ltx-2.3-22b-distilled-lora-384-1.1.safetensors",
)
UPSCALER_CANDIDATES = (
    "ltx-2.3-spatial-upscaler-x2-1.1.safetensors",
)
TEXT_ENCODER_DEVICE = "default"

def clean(value: Any) -> str:
    return str(value or "").strip()


def log(message: str) -> None:
    print(message, flush=True)


def build_url(base_url: str, route: str) -> str:
    return urllib.parse.urljoin(base_url.rstrip("/") + "/", route.lstrip("/"))


def request_json(
    method: str,
    url: str,
    headers: Dict[str, str] | None = None,
    payload: Dict[str, Any] | None = None,
    timeout: int = 300,
) -> Dict[str, Any]:
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(url, data=data, headers=headers or {}, method=method)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read().decode("utf-8", errors="replace")
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        raise WorkerError(f"HTTP {error.code} {url}: {body}") from error
    except urllib.error.URLError as error:
        raise WorkerError(f"Could not reach {url}: {error}") from error


def request_bytes(url: str, timeout: int = 300) -> bytes:
    request = urllib.request.Request(url, method="GET")
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.read()
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        raise WorkerError(f"HTTP {error.code} {url}: {body}") from error
    except urllib.error.URLError as error:
        raise WorkerError(f"Could not reach {url}: {error}") from error


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
            timeout=args.app_timeout_seconds,
        )
    except Exception as error:
        log(f"[warn] Could not checkpoint job {job_id}: {error}")


def acquire_gpu_lock(path_text: str):
    path = Path(path_text).expanduser()
    path.parent.mkdir(parents=True, exist_ok=True)
    handle = path.open("a+")
    log(f"[gpu-lock] Waiting for shared voice GPU lock: {path}")
    fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
    log(f"[gpu-lock] Acquired shared voice GPU lock: {path}")
    return handle


def write_json(path: Path, value: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2), encoding="utf-8")


def load_workflow(path: Path) -> Dict[str, Any]:
    if not path.is_file():
        raise WorkerError(f"LTX voice workflow preset not found: {path}")
    value = json.loads(path.read_text(encoding="utf-8-sig"))
    if not isinstance(value, dict):
        raise WorkerError(f"LTX voice workflow is not an API-format object: {path}")
    return value


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
        if 0 <= number <= 2_147_483_647:
            return number
    except Exception:
        pass
    return random.randint(1, 2_147_483_647)


def options_for_input(object_info: Dict[str, Any], class_type: str, input_name: str) -> list[str]:
    class_info = object_info.get(class_type)
    if not isinstance(class_info, dict):
        return []
    inputs = class_info.get("input")
    if not isinstance(inputs, dict):
        return []
    for section_name in ("required", "optional"):
        section = inputs.get(section_name)
        if not isinstance(section, dict):
            continue
        definition = section.get(input_name)
        if not isinstance(definition, list) or not definition:
            continue
        first = definition[0]
        if isinstance(first, list):
            return [clean(item) for item in first if clean(item)]
        if first == "COMBO" and len(definition) > 1 and isinstance(definition[1], dict):
            values = definition[1].get("options")
            if isinstance(values, list):
                return [clean(item) for item in values if clean(item)]
    return []


def choose_option(options: Iterable[str], candidates: Iterable[str], label: str) -> str:
    available = [clean(value) for value in options if clean(value)]
    expected = [clean(value) for value in candidates if clean(value)]

    # Prefer an exact ComfyUI option match first.
    for candidate in expected:
        if candidate in available:
            return candidate

    # ComfyUI commonly exposes models with their relative model-folder path,
    # while workflow contracts may store only the filename. Match by basename
    # only when that basename resolves to exactly one available option, and
    # return ComfyUI's actual path-qualified option string.
    def option_basename(value: str) -> str:
        return clean(value).replace("\\", "/").rsplit("/", 1)[-1]

    for candidate in expected:
        candidate_basename = option_basename(candidate)
        matches = [
            value
            for value in available
            if option_basename(value) == candidate_basename
        ]

        if len(matches) == 1:
            return matches[0]

        if len(matches) > 1:
            raise WorkerError(
                f"RTX 3090 ComfyUI exposes multiple options matching {label} "
                f"basename {candidate_basename!r}; matches={matches}"
            )

    raise WorkerError(
        f"RTX 3090 ComfyUI does not expose a supported {label}. "
        f"Expected one of {expected}; available={available}"
    )


def resolve_runtime_contract(args: argparse.Namespace, graph: Dict[str, Any]) -> Dict[str, str]:
    object_info = request_json(
        "GET",
        build_url(args.comfy_url, "/object_info"),
        {"content-type": "application/json"},
        None,
        timeout=args.comfy_timeout_seconds,
    )
    required_classes = sorted(
        {
            clean(value.get("class_type"))
            for value in graph.values()
            if isinstance(value, dict) and clean(value.get("class_type"))
        }
    )
    missing = [class_type for class_type in required_classes if class_type not in object_info]
    if missing:
        raise WorkerError(f"RTX 3090 ComfyUI is missing LTX voice node types: {missing}")

    full_checkpoint = choose_option(
        options_for_input(object_info, "CheckpointLoaderSimple", "ckpt_name"),
        FULL_CHECKPOINT_CANDIDATES,
        "official full LTX 2.3 checkpoint",
    )
    contract = {
        "fullCheckpoint": full_checkpoint,
        "textEncoder": choose_option(
            options_for_input(object_info, "LTXAVTextEncoderLoader", "text_encoder"),
            TEXT_ENCODER_CANDIDATES,
            "LTX 2.3 FP8 text encoder",
        ),
        "lora": choose_option(
            options_for_input(object_info, "LoraLoaderModelOnly", "lora_name"),
            LORA_CANDIDATES,
            "LTX 2.3 distilled LoRA",
        ),
        "upscaler": choose_option(
            options_for_input(object_info, "LatentUpscaleModelLoader", "model_name"),
            UPSCALER_CANDIDATES,
            "LTX 2.3 latent upscaler",
        ),
    }

    for class_type in ("LTXVAudioVAELoader", "LTXAVTextEncoderLoader"):
        accepted = options_for_input(object_info, class_type, "ckpt_name")
        if full_checkpoint not in accepted:
            raise WorkerError(
                f"{class_type} does not accept the required full LTX checkpoint "
                f"{full_checkpoint}; available={accepted}"
            )

    encoder_devices = options_for_input(object_info, "LTXAVTextEncoderLoader", "device")
    if TEXT_ENCODER_DEVICE not in encoder_devices:
        raise WorkerError(
            "RTX 3090 ComfyUI does not expose the required LTX text-encoder device: "
            f"{TEXT_ENCODER_DEVICE}; available={encoder_devices}"
        )
    contract["textEncoderDevice"] = TEXT_ENCODER_DEVICE

    log(
        "[contract] nodes=ok "
        f"fullCheckpoint={contract['fullCheckpoint']} "
        f"audioVaeSource={contract['fullCheckpoint']} "
        f"projectionSource={contract['fullCheckpoint']} "
        f"textEncoder={contract['textEncoder']} "
        f"textEncoderDevice={contract['textEncoderDevice']} "
        f"lora={contract['lora']} upscaler={contract['upscaler']}"
    )
    return contract

def patch_workflow(
    graph: Dict[str, Any],
    prompt: str,
    filename_prefix: str,
    request_seed: int,
    contract: Dict[str, str],
    width: int,
    height: int,
    duration_seconds: int,
) -> None:
    if not prompt:
        raise WorkerError("Missing LTX audition prompt.")

    full_checkpoint = contract["fullCheckpoint"]
    set_input(graph, "336", "ckpt_name", full_checkpoint)
    set_input(graph, "342", "lora_name", contract["lora"])
    set_input(graph, "342", "strength_model", 0.5)
    set_input(graph, "368", "model_name", contract["upscaler"])
    set_input(graph, "373", "ckpt_name", full_checkpoint)
    set_input(graph, "374", "text_encoder", contract["textEncoder"])
    set_input(graph, "374", "ckpt_name", full_checkpoint)
    set_input(graph, "374", "device", contract["textEncoderDevice"])

    # LTXAVTextEncoderLoader reads the text-projection weights from its checkpoint
    # input. A transformer-only UNET file does not contain those weights and leaves
    # ComfyUI's projection Linear uninitialized. Keep the official full checkpoint
    # architecture: node 373 supplies MODEL and video VAE, while nodes 336 and 374
    # read the audio VAE and text-projection components from the same checkpoint.
    set_input(graph, "342", "model", ["373", 0])
    for node_id in ("344", "345", "353"):
        set_input(graph, node_id, "vae", ["373", 2])
    graph.pop("385", None)

    set_input(graph, "360", "text", prompt)
    set_input(graph, "370", "text", LTX_VOICE_NEGATIVE_PROMPT)
    set_input(graph, "333", "noise_seed", request_seed)
    set_input(graph, "334", "noise_seed", request_seed)

    # LTX still needs a visual latent carrier, but no visual output is retained.
    # Keep it small to avoid the 24 GB edge condition that previously destabilized ComfyUI.
    set_input(graph, "369", "value", width)
    set_input(graph, "356", "value", height)
    set_input(graph, "357", "value", 1)
    set_input(graph, "358", "value", duration_seconds)
    set_input(graph, "359", "value", True)

    save_audio = node(graph, "384")
    save_audio["inputs"]["quality"] = "320k"
    save_audio["inputs"]["filename_prefix"] = filename_prefix
    if save_audio["inputs"].get("audio") != ["354", 0]:
        save_audio["inputs"]["audio"] = ["354", 0]

    graph.pop("__otg", None)
    log(
        f"[workflow] patched models, prompt, seed={request_seed}, carrier={width}x{height}, "
        f"duration={duration_seconds}s, output=node384"
    )


def queue_counts(queue: Dict[str, Any]) -> tuple[int, int]:
    running = queue.get("queue_running")
    pending = queue.get("queue_pending")
    return (
        len(running) if isinstance(running, list) else 0,
        len(pending) if isinstance(pending, list) else 0,
    )


def wait_for_comfy_idle(args: argparse.Namespace, headers: Dict[str, str], job_id: str) -> None:
    deadline = time.time() + args.comfy_idle_timeout_seconds
    next_checkpoint = 0.0
    while time.time() < deadline:
        queue = request_json(
            "GET",
            build_url(args.comfy_url, "/queue"),
            {"content-type": "application/json"},
            None,
            timeout=args.comfy_timeout_seconds,
        )
        running, pending = queue_counts(queue)
        if running == 0 and pending == 0:
            log("[gpu] RTX 3090 ComfyUI queue is idle.")
            return
        now = time.time()
        if now >= next_checkpoint:
            log(f"[gpu] Waiting for RTX 3090 ComfyUI queue: running={running} pending={pending}")
            checkpoint(
                args,
                headers,
                job_id,
                15,
                "Waiting for the RTX 3090 ComfyUI queue to become idle.",
                {"currentStage": "waiting_for_comfy", "queueRunning": running, "queuePending": pending},
            )
            next_checkpoint = now + 30
        time.sleep(max(2, args.poll_seconds))
    raise WorkerError("Timed out waiting for the RTX 3090 ComfyUI queue to become idle.")


def release_comfy_models(args: argparse.Namespace) -> None:
    try:
        response = request_json(
            "POST",
            build_url(args.comfy_url, "/free"),
            {"content-type": "application/json"},
            {"unload_models": True, "free_memory": True},
            timeout=args.comfy_timeout_seconds,
        )
        log(f"[gpu] Requested ComfyUI model release: {json.dumps(response)}")
    except Exception as error:
        log(f"[warn] ComfyUI model release request failed: {error}")


def query_free_vram_mib() -> int | None:
    try:
        output = subprocess.check_output(
            [
                "nvidia-smi",
                "--query-gpu=memory.free",
                "--format=csv,noheader,nounits",
                "--id=0",
            ],
            text=True,
            timeout=15,
        )
        return int(output.strip().splitlines()[0])
    except Exception:
        return None


def wait_for_free_vram(args: argparse.Namespace) -> int | None:
    deadline = time.time() + args.vram_wait_timeout_seconds
    last = None
    while time.time() < deadline:
        last = query_free_vram_mib()
        if last is None or last >= args.min_free_vram_mib:
            return last
        log(f"[gpu] Waiting for RTX 3090 free VRAM: {last} MiB < {args.min_free_vram_mib} MiB")
        time.sleep(5)
    raise WorkerError(
        f"RTX 3090 did not reach {args.min_free_vram_mib} MiB free VRAM; last={last} MiB."
    )



def require_primary_vram_ready(args: argparse.Namespace) -> int:
    free_vram = query_free_vram_mib()

    if free_vram is None:
        raise WorkerError("primary-unreachable-or-not-ready")

    if free_vram < args.min_free_vram_mib:
        raise WorkerError("primary-busy")

    log(
        f"[gpu] RTX 3090 free VRAM before LTX Voice: "
        f"{free_vram} MiB >= {args.min_free_vram_mib} MiB"
    )
    return free_vram



def submit_comfy(args: argparse.Namespace, graph: Dict[str, Any]) -> str:
    response = request_json(
        "POST",
        build_url(args.comfy_url, "/prompt"),
        {"content-type": "application/json"},
        {
            "client_id": args.comfy_client_id or f"otg-linux-ltx-voice-{uuid.uuid4()}",
            "prompt": graph,
        },
        timeout=args.comfy_timeout_seconds,
    )
    prompt_id = clean(response.get("prompt_id") or response.get("promptId"))
    if not prompt_id:
        raise WorkerError(f"ComfyUI did not return prompt_id: {json.dumps(response, indent=2)}")
    return prompt_id


def history_error_text(entry: Dict[str, Any]) -> str:
    status = entry.get("status") if isinstance(entry.get("status"), dict) else {}
    messages = status.get("messages") if isinstance(status.get("messages"), list) else []
    details = []
    for item in messages:
        if isinstance(item, list) and len(item) >= 2 and str(item[0]).lower() == "execution_error":
            details.append(json.dumps(item[1], ensure_ascii=False))
    return " | ".join(details) or json.dumps(status, ensure_ascii=False)


def history_for_prompt(
    args: argparse.Namespace,
    prompt_id: str,
    headers: Dict[str, str],
    job_id: str,
) -> Dict[str, Any]:
    deadline = time.time() + args.history_timeout_seconds
    history_url = build_url(args.comfy_url, f"/history/{urllib.parse.quote(prompt_id)}")
    consecutive_connection_failures = 0
    next_checkpoint = time.time() + 30

    while time.time() < deadline:
        try:
            history = request_json(
                "GET",
                history_url,
                {"content-type": "application/json"},
                None,
                timeout=args.comfy_timeout_seconds,
            )
            consecutive_connection_failures = 0
        except WorkerError as error:
            consecutive_connection_failures += 1
            log(
                f"[warn] LTX history probe failed ({consecutive_connection_failures}/12): {error}"
            )
            if consecutive_connection_failures >= 12:
                raise WorkerError(
                    "RTX 3090 ComfyUI became unreachable while running LTX Voice. "
                    "The job was stopped instead of being left permanently running."
                ) from error
            time.sleep(max(2, args.poll_seconds))
            continue

        entry = history.get(prompt_id) if isinstance(history, dict) else None
        if isinstance(entry, dict):
            status = entry.get("status") if isinstance(entry.get("status"), dict) else {}
            if status.get("status_str") == "error":
                raise WorkerError(f"ComfyUI LTX voice workflow failed: {history_error_text(entry)}")
            if status.get("completed") is True or entry.get("outputs"):
                return entry

        if time.time() >= next_checkpoint:
            checkpoint(
                args,
                headers,
                job_id,
                55,
                "LTX Voice is still rendering on the RTX 3090.",
                {"currentStage": "comfy_running", "comfyPromptId": prompt_id},
            )
            next_checkpoint = time.time() + 30
        time.sleep(max(2, args.poll_seconds))

    raise WorkerError(f"Timed out waiting for ComfyUI history for prompt {prompt_id}.")


def walk_file_records(value: Any):
    if isinstance(value, list):
        for item in value:
            yield from walk_file_records(item)
    elif isinstance(value, dict):
        filename = clean(value.get("filename") or value.get("name"))
        if filename:
            yield value
        for child in value.values():
            yield from walk_file_records(child)


def find_node_384_audio(entry: Dict[str, Any]) -> Dict[str, str]:
    outputs = entry.get("outputs") if isinstance(entry.get("outputs"), dict) else {}
    node_output = outputs.get("384") if isinstance(outputs.get("384"), dict) else {}
    for item in walk_file_records(node_output):
        filename = clean(item.get("filename") or item.get("name"))
        if not filename.lower().endswith((".mp3", ".wav", ".flac", ".ogg", ".m4a")):
            continue
        return {
            "filename": filename,
            "subfolder": clean(item.get("subfolder")),
            "type": clean(item.get("type")) or "output",
        }
    raise WorkerError(
        "LTX voice workflow completed but node 384 did not return an audio file. "
        f"node384={json.dumps(node_output, ensure_ascii=False)[:4000]}"
    )


def copy_comfy_audio(args: argparse.Namespace, audio: Dict[str, str], output_path: Path) -> None:
    query = urllib.parse.urlencode(
        {
            "filename": audio["filename"],
            "subfolder": audio.get("subfolder", ""),
            "type": audio.get("type", "output"),
        }
    )
    data = request_bytes(
        build_url(args.comfy_url, f"/view?{query}"),
        timeout=args.comfy_timeout_seconds,
    )
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_bytes(data)
    if output_path.stat().st_size < 1024:
        raise WorkerError(
            f"LTX voice audio output is too small to be usable: {output_path.stat().st_size} bytes."
        )


def multipart_post(
    url: str,
    headers: Dict[str, str],
    fields: Dict[str, str],
    file_field: str,
    file_path: Path,
    timeout: int,
) -> Dict[str, Any]:
    boundary = f"----otg-linux-ltx-voice-{int(time.time() * 1000)}"
    body = bytearray()
    for key, value in fields.items():
        body.extend(f"--{boundary}\r\n".encode("utf-8"))
        body.extend(f'Content-Disposition: form-data; name="{key}"\r\n\r\n'.encode("utf-8"))
        body.extend(str(value).encode("utf-8"))
        body.extend(b"\r\n")
    mime = mimetypes.guess_type(str(file_path))[0] or "audio/mpeg"
    body.extend(f"--{boundary}\r\n".encode("utf-8"))
    body.extend(
        f'Content-Disposition: form-data; name="{file_field}"; filename="{file_path.name}"\r\n'.encode(
            "utf-8"
        )
    )
    body.extend(f"Content-Type: {mime}\r\n\r\n".encode("utf-8"))
    body.extend(file_path.read_bytes())
    body.extend(b"\r\n")
    body.extend(f"--{boundary}--\r\n".encode("utf-8"))

    request_headers = {key: value for key, value in headers.items() if key.lower() != "content-type"}
    request_headers["content-type"] = f"multipart/form-data; boundary={boundary}"
    request = urllib.request.Request(url, data=bytes(body), headers=request_headers, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read().decode("utf-8", errors="replace")
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as error:
        body_text = error.read().decode("utf-8", errors="replace")
        raise WorkerError(f"HTTP {error.code} {url}: {body_text}") from error
    except urllib.error.URLError as error:
        raise WorkerError(f"Could not reach {url}: {error}") from error


def upload_sample(
    args: argparse.Namespace,
    headers: Dict[str, str],
    character_id: str,
    job_id: str,
    sample_path: Path,
    provider: str,
    adapter: str,
) -> Dict[str, Any]:
    response = multipart_post(
        build_url(args.base_url, "/api/characters/voice-sample/upload"),
        headers,
        {
            "characterId": character_id,
            "jobId": job_id,
            "provider": provider,
            "adapter": adapter,
        },
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
    provider = "ltx"
    gpu_lock = None
    try:
        source_graph = load_workflow(Path(args.workflow_path))
        try:
            contract = resolve_runtime_contract(args, source_graph)
        except Exception as error:
            log(f"[blocked] LTX Voice contract is not ready; leaving jobs queued: {error}")
            return 0

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

        is_unnatural = (
            provider == "unnatural_ltx"
            or clean(job_input.get("voiceMode")) == "unnatural_voice"
            or clean(job_input.get("source")) == "unnatural_voice_preset"
        )
        adapter = "ltx_unnatural_voice_sample" if is_unnatural else "ltx_audio_voice_sample"
        filename_prefix = (
            f"audio/otg_unnatural_voice_{job_id}"
            if is_unnatural
            else f"audio/otg_ltx_voice_{job_id}"
        )
        output_name = "unnatural-ltx-voice.mp3" if is_unnatural else "ltx-voice.mp3"
        preset_id = clean(job_input.get("presetId"))
        preset_name = clean(job_input.get("presetName"))
        preset_category = clean(job_input.get("presetCategory"))
        prompt = clean(
            job_input.get("prompt")
            if is_unnatural
            else job_input.get("ltxAuditionPrompt")
            or job_input.get("voiceInstruction")
            or job_input.get("prompt")
        )
        if is_unnatural and (not preset_id or not preset_name or not preset_category or not prompt):
            raise WorkerError("Unnatural voice preset not found.")
        if not prompt:
            raise WorkerError("Missing LTX audition prompt.")

        seed = coerce_seed(job_input.get("requestSeed") or job_input.get("seed"))
        headers = auth_headers(args, owner_key)
        work_dir = Path(args.work_root).expanduser().resolve() / owner_key / character_id / job_id
        work_dir.mkdir(parents=True, exist_ok=True)
        sample_path = work_dir / output_name

        log(f"[claim] {job_id} owner={owner_key} character={character_id} provider={provider}")
        checkpoint(
            args,
            headers,
            job_id,
            10,
            "Linux LTX Voice worker claimed the character voice job.",
            {
                "provider": provider,
                "adapter": adapter,
                "remoteWorker": True,
                "platform": "linux",
                "workerId": args.worker_id,
                "currentStage": "claimed",
            },
        )

        gpu_lock = acquire_gpu_lock(args.gpu_lock_file)
        wait_for_comfy_idle(args, headers, job_id)
        release_comfy_models(args)
        free_vram = wait_for_free_vram(args)
        if free_vram is not None:
            log(f"[gpu] RTX 3090 free VRAM before LTX Voice: {free_vram} MiB")

        graph = load_workflow(Path(args.workflow_path))
        patch_workflow(
            graph,
            prompt,
            filename_prefix,
            seed,
            contract,
            args.carrier_width,
            args.carrier_height,
            args.duration_seconds,
        )
        patched_workflow_path = work_dir / "ltx_voice_workflow_patched.json"
        write_json(patched_workflow_path, graph)
        checkpoint(
            args,
            headers,
            job_id,
            28,
            "LTX Voice workflow validated and patched for the Linux RTX 3090.",
            {
                "provider": provider,
                "adapter": adapter,
                "currentStage": "workflow_patched",
                "sourceWorkflowPath": args.workflow_path,
                "patchedWorkflowPath": str(patched_workflow_path),
                "selectedModels": contract,
                "carrierWidth": args.carrier_width,
                "carrierHeight": args.carrier_height,
                "durationSeconds": args.duration_seconds,
                "requestSeed": seed,
                "freeVramMiB": free_vram,
            },
        )

        prompt_id = submit_comfy(args, graph)
        log(f"[comfy] submitted prompt_id={prompt_id}")
        checkpoint(
            args,
            headers,
            job_id,
            40,
            "LTX Voice workflow submitted to the RTX 3090 ComfyUI lane.",
            {
                "provider": provider,
                "adapter": adapter,
                "currentStage": "comfy_submitted",
                "comfyPromptId": prompt_id,
            },
        )

        history = history_for_prompt(args, prompt_id, headers, job_id)
        history_path = work_dir / "ltx_voice_history.json"
        write_json(history_path, history)
        audio = find_node_384_audio(history)
        copy_comfy_audio(args, audio, sample_path)
        log(f"[audio] node384={audio} sample={sample_path} bytes={sample_path.stat().st_size}")

        fcntl.flock(gpu_lock.fileno(), fcntl.LOCK_UN)
        gpu_lock.close()
        gpu_lock = None
        log("[gpu-lock] Released shared voice GPU lock.")

        checkpoint(
            args,
            headers,
            job_id,
            85,
            "LTX Voice MP3 generated. Uploading the playable sample.",
            {
                "provider": provider,
                "adapter": adapter,
                "currentStage": "uploading",
                "comfyPromptId": prompt_id,
                "samplePath": str(sample_path),
                "outputBytes": sample_path.stat().st_size,
            },
        )
        upload = upload_sample(
            args,
            headers,
            character_id,
            job_id,
            sample_path,
            provider,
            adapter,
        )
        result = {
            "mock": False,
            "provider": provider,
            "adapter": adapter,
            "remoteWorker": True,
            "platform": "linux",
            "workerId": args.worker_id,
            "voiceMode": "unnatural_voice" if is_unnatural else "ltx_voice",
            "source": "unnatural_voice_preset" if is_unnatural else "ltx_voice_design",
            "presetId": preset_id if is_unnatural else "",
            "presetName": preset_name if is_unnatural else "",
            "presetCategory": preset_category if is_unnatural else "",
            "sampleLine": clean(
                job_input.get("sampleLine")
                or job_input.get("sampleText")
                or job_input.get("text")
            ),
            "requestSeed": seed,
            "samplePath": upload.get("samplePath"),
            "sampleUrl": upload.get("sampleUrl"),
            "uploadId": upload.get("uploadId"),
            "outputAudioPath": upload.get("samplePath"),
            "outputAudioUrl": upload.get("sampleUrl"),
            "outputBytes": upload.get("outputBytes") or sample_path.stat().st_size,
            "sourceWorkflowPath": args.workflow_path,
            "patchedWorkflowPath": str(patched_workflow_path),
            "historyPath": str(history_path),
            "comfyPromptId": prompt_id,
            "comfyBaseUrl": args.comfy_url,
            "outputNodeId": "384",
            "selectedModels": contract,
            "carrierWidth": args.carrier_width,
            "carrierHeight": args.carrier_height,
            "durationSeconds": args.duration_seconds,
            "completedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
        complete = request_json(
            "POST",
            build_url(args.base_url, "/api/worker/jobs/complete"),
            headers,
            {
                "jobId": job_id,
                "result": result,
                "message": (
                    "Linux Unnatural LTX character voice sample completed."
                    if is_unnatural
                    else "Linux LTX character voice sample completed."
                ),
            },
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
                    {
                        "jobId": job_id,
                        "error": str(error),
                        "result": {
                            "provider": provider,
                            "adapter": (
                                "ltx_unnatural_voice_sample"
                                if provider == "unnatural_ltx"
                                else "ltx_audio_voice_sample"
                            ),
                            "mock": False,
                            "remoteWorker": True,
                            "platform": "linux",
                            "workerId": args.worker_id,
                            "error": text,
                        },
                    },
                    timeout=args.app_timeout_seconds,
                )
            except Exception as fail_error:
                log(f"[warn] Could not mark LTX job failed: {fail_error}")
        return 1
    finally:
        if gpu_lock is not None:
            try:
                fcntl.flock(gpu_lock.fileno(), fcntl.LOCK_UN)
                gpu_lock.close()
                log("[gpu-lock] Released shared voice GPU lock after failure.")
            except Exception:
                pass


def acquire_cluster_gpu_lease(
    args: argparse.Namespace,
    job_id: str,
    lock_id: str,
    resource_name: str,
) -> Dict[str, Any]:
    response = request_json(
        "POST",
        build_url(args.base_url, "/api/worker-control/resource-lock/acquire"),
        auth_headers(args),
        {
            "lockId": lock_id,
            "ownerId": job_id,
            "workerId": args.worker_id,
            "resourceName": resource_name,
            # Safety backstop if the app/control-plane heartbeat channel is
            # interrupted after 8191 submission. Normal cleanup releases this
            # immediately; expiry must never race a still-running LTX job.
            "ttlSeconds": 21600,
        },
        timeout=args.app_timeout_seconds,
    )
    lease = response.get("lock")
    if not isinstance(lease, dict) or not clean(lease.get("fencingToken")):
        raise WorkerError(f"Cluster GPU resource lease {lock_id} is unavailable.")
    return lease


def heartbeat_cluster_gpu_lease(args: argparse.Namespace, job_id: str, lease: Dict[str, Any]) -> None:
    request_json(
        "POST",
        build_url(args.base_url, "/api/worker-control/resource-lock/heartbeat"),
        auth_headers(args),
        {
            "lockId": lease["lockId"],
            "ownerId": job_id,
            "fencingToken": lease["fencingToken"],
            "ttlSeconds": 21600,
        },
        timeout=args.app_timeout_seconds,
    )


def release_cluster_gpu_lease(args: argparse.Namespace, job_id: str, lease: Dict[str, Any]) -> None:
    request_json(
        "POST",
        build_url(args.base_url, "/api/worker-control/resource-lock/release"),
        auth_headers(args),
        {"lockId": lease["lockId"], "ownerId": job_id, "fencingToken": lease["fencingToken"]},
        timeout=args.app_timeout_seconds,
    )


def lease_heartbeat_loop(
    args: argparse.Namespace,
    job_id: str,
    lease: Dict[str, Any],
    stop: threading.Event,
) -> None:
    while not stop.wait(30):
        try:
            heartbeat_cluster_gpu_lease(args, job_id, lease)
        except Exception as error:
            log(f"[lease] heartbeat failed: {error}")


def enqueue_lifecycle(args: argparse.Namespace, action: str, job_id: str) -> str:
    response = request_json(
        "POST",
        build_url(args.base_url, "/api/worker-control/enqueue"),
        auth_headers(args),
        {
            "workerId": "ltx-audio-5060",
            "action": action,
            "requestedBy": args.worker_id,
            "dryRun": False,
            "reason": f"LTX fallback job {job_id}",
            "jobId": job_id,
            "leaseSeconds": 180,
        },
        timeout=args.app_timeout_seconds,
    )
    command = response.get("command")
    command_id = clean(command.get("id")) if isinstance(command, dict) else ""
    if not command_id:
        raise WorkerError(f"Could not queue remote lifecycle action {action}.")
    return command_id


def wait_lifecycle(args: argparse.Namespace, command_id: str, timeout_seconds: int = 180) -> None:
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        status = request_json(
            "GET",
            build_url(args.base_url, "/api/worker-control/status"),
            auth_headers(args),
            None,
            timeout=args.app_timeout_seconds,
        )
        commands = status.get("commands") if isinstance(status.get("commands"), list) else []
        command = next((item for item in commands if isinstance(item, dict) and clean(item.get("id")) == command_id), None)
        if isinstance(command, dict):
            state = clean(command.get("status"))
            if state == "complete":
                return
            if state in ("failed", "expired"):
                raise WorkerError(f"Remote 8191 lifecycle failed: {command.get('error') or state}")
        time.sleep(2)
    raise WorkerError("Timed out waiting for authenticated remote 8191 lifecycle control.")


def verify_5060_queue_idle(args: argparse.Namespace) -> None:
    queue = request_json("GET", build_url(args.fallback_image_url, "/queue"), {}, None, timeout=args.comfy_timeout_seconds)
    running, pending = queue_counts(queue)
    if running or pending:
        raise WorkerError(f"RTX 5060 Ti image lane is busy: running={running} pending={pending}")


def verify_split_aux_workflow(path_text: str) -> tuple[Dict[str, Any], Dict[str, Any]]:
    graph = load_workflow(Path(path_text))
    serialized = json.dumps(graph)
    required = (
        "ltx-2.3-22b-distilled-1.1-Q3_K_S.gguf",
        "gemma_3_12B_it_fp4_mixed.safetensors",
        "ltx-2.3_text_projection_bf16.safetensors",
        "LTX23_audio_vae_bf16.safetensors",
    )
    missing = [name for name in required if name not in serialized]
    forbidden = (
        "ltx-2.3-22b-dev-nvfp4.safetensors",
        "ltx-2.3-22b-distilled-lora-384-1.1.safetensors",
    )
    present_forbidden = [name for name in forbidden if name in serialized]
    metadata = graph.get("__otg") if isinstance(graph.get("__otg"), dict) else {
        # The proven slr artifact is intentionally copied byte-for-byte and has
        # no repository-only metadata wrapper. Its fixed API-node contract is
        # validated below before these bindings are trusted.
        "promptNodeId": "4",
        "negativeNodeId": "5",
        "seedNodeIds": ["8"],
        "outputNodeId": "18",
    }
    if missing or present_forbidden:
        raise WorkerError(f"5060 split-aux workflow contract failed: missing={missing} forbidden={present_forbidden}")
    for field in ("promptNodeId", "negativeNodeId", "seedNodeIds", "outputNodeId"):
        if field not in metadata:
            raise WorkerError(f"5060 split-aux workflow is missing __otg.{field}.")
    expected_classes = {
        clean(metadata["promptNodeId"]): "CLIPTextEncode",
        clean(metadata["negativeNodeId"]): "CLIPTextEncode",
        clean(metadata["outputNodeId"]): "SaveAudio",
    }
    for node_id in metadata["seedNodeIds"]:
        expected_classes[clean(node_id)] = "RandomNoise"
    invalid_nodes = [
        f"{node_id}:{clean(graph.get(node_id, {}).get('class_type'))}"
        for node_id, expected in expected_classes.items()
        if clean(graph.get(node_id, {}).get("class_type")) != expected
    ]
    if invalid_nodes:
        raise WorkerError(f"5060 split-aux workflow binding contract failed: {invalid_nodes}")
    return graph, metadata


def patch_split_aux_workflow(
    graph: Dict[str, Any],
    metadata: Dict[str, Any],
    prompt: str,
    filename_prefix: str,
    seed: int,
) -> None:
    set_input(graph, clean(metadata["promptNodeId"]), "text", prompt)
    set_input(graph, clean(metadata["negativeNodeId"]), "text", LTX_VOICE_NEGATIVE_PROMPT)
    for node_id in metadata["seedNodeIds"]:
        seed_node = node(graph, clean(node_id))
        key = "noise_seed" if "noise_seed" in seed_node["inputs"] else "seed"
        seed_node["inputs"][key] = seed
    output = node(graph, clean(metadata["outputNodeId"]))
    output["inputs"]["filename_prefix"] = filename_prefix
    graph.pop("__otg", None)


def fail_claimed_job(
    args: argparse.Namespace,
    owner_key: str,
    job_id: str,
    provider: str,
    error: Exception,
    metadata: Dict[str, Any],
) -> None:
    request_json(
        "POST",
        build_url(args.base_url, "/api/worker/jobs/fail"),
        auth_headers(args, owner_key),
        {
            "jobId": job_id,
            "error": str(error),
            "result": {
                "provider": provider,
                "adapter": "ltx_unnatural_voice_sample" if provider == "unnatural_ltx" else "ltx_audio_voice_sample",
                "mock": False,
                "remoteWorker": True,
                "platform": "linux",
                "workerId": args.worker_id,
                **metadata,
                "diagnosticReason": str(error),
            },
        },
        timeout=args.app_timeout_seconds,
    )


def requeue_claimed_job(
    args: argparse.Namespace,
    owner_key: str,
    job_id: str,
    message: str,
    result: Dict[str, Any] | None = None,
) -> None:
    request_json(
        "POST",
        build_url(args.base_url, "/api/worker/jobs/requeue"),
        auth_headers(args, owner_key),
        {
            "jobId": job_id,
            "message": message,
            "result": result or {},
        },
        timeout=args.app_timeout_seconds,
    )


def retryable_pre_submit_failure(
    error: Exception,
    metadata: Dict[str, Any],
) -> bool:
    if clean(metadata.get("submissionState")) != "pre_submit":
        return False

    primary_reason = clean(
        metadata.get("fallbackReason")
    ).lower()

    # Primary GPU contention means any fallback inability should
    # leave the job queued for the primary rather than fail it.
    if primary_reason in (
        "primary-busy",
        "primary-resource-locked",
    ):
        return True

    text = str(error).lower()

    retry_tokens = (
        "primary-busy",
        "primary-resource-locked",
        "is busy",
        "externally occupied",
        "resource lease",
        "resource-locked",
        "image lane is busy",
        "temporarily unavailable",
        "timed out",
        "timeout",
        "connection refused",
        "connection reset",
        "network is unreachable",
    )

    return any(token in text for token in retry_tokens)


def process_claimed_ltx25_voice_creator(
    args: argparse.Namespace,
    job_id: str,
    owner_key: str,
    job_input: Dict[str, Any],
) -> int:
    creator_request = (
        job_input.get("creatorRequest")
        if isinstance(job_input.get("creatorRequest"), dict)
        else None
    )

    if creator_request is None:
        error = WorkerError(
            "Queued LTX 2.5 Voice Creator job is missing creatorRequest."
        )

        fail_claimed_job(
            args,
            owner_key,
            job_id,
            "ltx",
            error,
            {
                "preferredGpu": "3090",
                "submissionState": "pre_submit",
                "queueKind": "ltx25_voice_creator",
            },
        )
        return 1

    headers = auth_headers(args, owner_key)
    headers["x-otg-worker-direct"] = "1"
    headers["x-otg-device-id"] = args.device_id
    headers["x-otg-worker-id"] = args.worker_id

    log(
        f"[creator] claimed durable LTX 2.5 audition job={job_id}"
    )

    try:
        result = request_json(
            "POST",
            build_url(args.base_url, "/api/voices/creator"),
            headers,
            creator_request,
            timeout=max(
                args.app_timeout_seconds,
                args.history_timeout_seconds,
            ),
        )

        if not result.get("ok"):
            raise WorkerError(
                clean(result.get("error"))
                or "Queued LTX 2.5 Voice Creator request failed."
            )

        final_result = dict(result)
        final_result.update(
            {
                "remoteWorker": True,
                "platform": "linux",
                "workerId": args.worker_id,
                "queueKind": "ltx25_voice_creator",
            }
        )

        complete = request_json(
            "POST",
            build_url(
                args.base_url,
                "/api/worker/jobs/complete",
            ),
            auth_headers(args, owner_key),
            {
                "jobId": job_id,
                "result": final_result,
                "message": (
                    "Queued LTX 2.5 Character Voice audition completed."
                ),
            },
            timeout=args.app_timeout_seconds,
        )

        log(
            f"[creator-complete] job={job_id} "
            f"{json.dumps(complete, indent=2)}"
        )
        return 0

    except Exception as error:
        text = str(error)
        lower = text.lower()

        retryable = (
            "retryable" in lower
            or (
                "409" in lower
                and any(
                    token in lower
                    for token in (
                        "busy",
                        "occupied",
                        "locked",
                        "resource",
                        "unavailable",
                    )
                )
            )
        )

        if retryable:
            message = (
                "Waiting for an available compatible Linux "
                "Character Voice GPU."
            )

            requeue_claimed_job(
                args,
                owner_key,
                job_id,
                message,
                {
                    "preferredGpu": "3090",
                    "submissionState": "pre_submit",
                    "queueKind": "ltx25_voice_creator",
                    "lastRetryReason": text[:1000],
                },
            )

            log(
                f"[creator-requeue] job={job_id}: {message}"
            )
            return 0

        log(
            f"[creator-error] job={job_id}: "
            f"{text}\n{traceback.format_exc()}"
        )

        fail_claimed_job(
            args,
            owner_key,
            job_id,
            "ltx",
            error,
            {
                "preferredGpu": "3090",
                "submissionState": "failed",
                "queueKind": "ltx25_voice_creator",
            },
        )
        return 1


def process_one_failover(args: argparse.Namespace) -> int:
    job_id = ""
    owner_key = ""
    provider = "ltx"
    active_gpu_lease = None
    heartbeat_stop = threading.Event()
    heartbeat_thread = None
    fallback_started = False
    metadata: Dict[str, Any] = {
        "preferredGpu": "3090",
        "actualGpu": None,
        "backend": None,
        "fallbackReason": None,
        "backendEndpoint": None,
        "backendService": None,
        "submissionId": None,
        "promptId": None,
        "submissionState": "pre_submit",
    }
    try:
        claim = request_json(
            "POST",
            build_url(args.base_url, "/api/worker/jobs/claim"),
            auth_headers(args),
            {"jobType": "character_voice_pipeline", "action": "create_voice_sample", "claimScope": "all_owners", "workerId": args.worker_id, "providers": ["ltx", "unnatural_ltx"]},
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
        if provider not in ("ltx", "unnatural_ltx") or not job_id or not owner_key or not character_id:
            raise WorkerError(f"Invalid claimed LTX voice job: {job}")

        if clean(job_input.get("queueKind")) == "ltx25_voice_creator":
            return process_claimed_ltx25_voice_creator(
                args,
                job_id,
                owner_key,
                job_input,
            )

        is_unnatural = provider == "unnatural_ltx" or clean(job_input.get("voiceMode")) == "unnatural_voice"
        adapter = "ltx_unnatural_voice_sample" if is_unnatural else "ltx_audio_voice_sample"
        prompt = clean(job_input.get("prompt") if is_unnatural else job_input.get("ltxAuditionPrompt") or job_input.get("voiceInstruction") or job_input.get("prompt"))
        if not prompt:
            raise WorkerError("Missing LTX audition prompt.")
        seed = coerce_seed(job_input.get("requestSeed") or job_input.get("seed"))
        headers = auth_headers(args, owner_key)
        work_dir = Path(args.work_root).expanduser().resolve() / owner_key / character_id / job_id
        work_dir.mkdir(parents=True, exist_ok=True)
        filename_prefix = f"audio/otg_{'unnatural_' if is_unnatural else ''}ltx_voice_{job_id}"

        checkpoint(args, headers, job_id, 10, "LTX failover worker claimed the voice job.", {**metadata, "provider": provider, "adapter": adapter, "currentStage": "claimed"})

        primary_failure = ""
        primary_graph = None
        primary_contract = None
        try:
            request_json("GET", build_url(args.comfy_url, "/system_stats"), {}, None, timeout=10)
            primary_graph = load_workflow(Path(args.workflow_path))
            primary_contract = resolve_runtime_contract(args, primary_graph)
            try:
                active_gpu_lease = acquire_cluster_gpu_lease(
                    args, job_id, "gpu:shawn-3090", "video"
                )
            except Exception as error:
                raise WorkerError("primary-resource-locked") from error
            queue = request_json("GET", build_url(args.comfy_url, "/queue"), {}, None, timeout=10)
            running, pending = queue_counts(queue)
            if running or pending:
                raise WorkerError("primary-busy")

            require_primary_vram_ready(args)
        except Exception as error:
            primary_failure = clean(error)
            if "primary-resource-locked" not in primary_failure and "primary-busy" not in primary_failure:
                primary_failure = "primary-unreachable-or-not-ready"
            if active_gpu_lease is not None:
                release_cluster_gpu_lease(args, job_id, active_gpu_lease)
                active_gpu_lease = None

        using_fallback = bool(primary_failure)
        if using_fallback:
            metadata.update({"actualGpu": "5060-ti", "backend": "fallback", "fallbackReason": primary_failure, "backendEndpoint": args.fallback_comfy_url, "backendService": "otg-character-ltx-audio-5060-3003.service"})
            checkpoint(args, headers, job_id, 18, "Primary unavailable before submission; preparing RTX 5060 Ti fallback.", metadata)
            active_gpu_lease = acquire_cluster_gpu_lease(
                args, job_id, "gpu:slr-5060", "ltx-fallback"
            )
            heartbeat_thread = threading.Thread(target=lease_heartbeat_loop, args=(args, job_id, active_gpu_lease, heartbeat_stop), daemon=True)
            heartbeat_thread.start()
            verify_5060_queue_idle(args)
            graph, fallback_meta = verify_split_aux_workflow(args.fallback_workflow_path)
            command_id = enqueue_lifecycle(args, "ensure-running", job_id)
            wait_lifecycle(args, command_id)
            fallback_started = True
            fallback_args = argparse.Namespace(**vars(args))
            fallback_args.comfy_url = args.fallback_comfy_url
            request_json("GET", build_url(fallback_args.comfy_url, "/system_stats"), {}, None, timeout=10)
            patch_split_aux_workflow(graph, fallback_meta, prompt, filename_prefix, seed)
            patched_workflow_path = work_dir / "ltx_voice_5060_split_aux_patched.json"
            write_json(patched_workflow_path, graph)
            active_args = fallback_args
        else:
            heartbeat_thread = threading.Thread(target=lease_heartbeat_loop, args=(args, job_id, active_gpu_lease, heartbeat_stop), daemon=True)
            heartbeat_thread.start()
            metadata.update({"actualGpu": "3090", "backend": "primary", "fallbackReason": None, "backendEndpoint": args.comfy_url, "backendService": "otg-comfyui.service"})
            graph = load_workflow(Path(args.workflow_path))
            patch_workflow(graph, prompt, filename_prefix, seed, primary_contract, args.carrier_width, args.carrier_height, args.duration_seconds)
            patched_workflow_path = work_dir / "ltx_voice_workflow_patched.json"
            write_json(patched_workflow_path, graph)
            active_args = args

        output_extension = ".flac" if using_fallback else ".mp3"
        sample_path = work_dir / (f"unnatural-ltx-voice{output_extension}" if is_unnatural else f"ltx-voice{output_extension}")

        checkpoint(args, headers, job_id, 28, "LTX workflow validated before submission.", {**metadata, "currentStage": "workflow_patched", "patchedWorkflowPath": str(patched_workflow_path)})
        try:
            prompt_id = submit_comfy(active_args, graph)
        except Exception as error:
            if not using_fallback:
                metadata["submissionState"] = "submission_unknown"
                checkpoint(args, headers, job_id, 40, "Primary submission outcome is unknown; fallback forbidden.", metadata)
                raise SubmissionUnknownError(str(error)) from error
            metadata["submissionState"] = "failed"
            raise
        metadata.update({"submissionId": prompt_id, "promptId": prompt_id, "submissionState": "submitted"})
        checkpoint(args, headers, job_id, 40, "LTX prompt submitted exactly once.", {**metadata, "currentStage": "submitted"})

        history = history_for_prompt(active_args, prompt_id, headers, job_id)
        history_path = work_dir / "ltx_voice_history.json"
        write_json(history_path, history)
        output_node = "384" if not using_fallback else clean(fallback_meta["outputNodeId"])
        audio = find_node_384_audio(history) if output_node == "384" else find_audio_for_node(history, output_node)
        copy_comfy_audio(active_args, audio, sample_path)
        checkpoint(args, headers, job_id, 80, "LTX output collected; persisting voice sample.", {**metadata, "currentStage": "output_collected", "outputBytes": sample_path.stat().st_size})
        upload = upload_sample(args, headers, character_id, job_id, sample_path, provider, adapter)
        result = {
            "mock": False, "provider": provider, "adapter": adapter, "remoteWorker": True, "platform": "linux", "workerId": args.worker_id,
            **metadata,
            "samplePath": upload.get("samplePath"), "sampleUrl": upload.get("sampleUrl"), "outputAudioPath": upload.get("samplePath"), "outputAudioUrl": upload.get("sampleUrl"),
            "outputBytes": upload.get("outputBytes") or sample_path.stat().st_size, "patchedWorkflowPath": str(patched_workflow_path), "historyPath": str(history_path),
            "comfyPromptId": prompt_id, "comfyBaseUrl": active_args.comfy_url, "outputNodeId": output_node,
        }
        result["submissionState"] = "completed"
        request_json("POST", build_url(args.base_url, "/api/worker/jobs/complete"), headers, {"jobId": job_id, "result": result, "message": "Linux LTX character voice sample completed."}, timeout=args.app_timeout_seconds)
        metadata["submissionState"] = "completed"
        log(f"[complete] job={job_id} backend={metadata['backend']} prompt={prompt_id}")
        return 0
    except Exception as error:
        log(f"[error] {error}\n{traceback.format_exc()}")

        if (
            job_id
            and owner_key
            and retryable_pre_submit_failure(error, metadata)
        ):
            message = (
                "Waiting for an available compatible Linux "
                "Character Voice GPU."
            )

            try:
                requeue_claimed_job(
                    args,
                    owner_key,
                    job_id,
                    message,
                    {
                        **metadata,
                        "submissionState": "pre_submit",
                        "lastRetryReason": str(error)[:1000],
                    },
                )

                log(
                    f"[requeue] job={job_id}: {message}"
                )
                return 0

            except Exception as requeue_error:
                log(
                    "[warn] Could not immediately requeue "
                    f"LTX job: {requeue_error}"
                )

        if job_id and owner_key:
            if metadata.get("submissionState") != "submission_unknown":
                metadata["submissionState"] = "failed"

            try:
                fail_claimed_job(
                    args,
                    owner_key,
                    job_id,
                    provider,
                    error,
                    metadata,
                )
            except Exception as fail_error:
                log(
                    f"[warn] Could not mark LTX job failed: "
                    f"{fail_error}"
                )

        return 1
    finally:
        if active_gpu_lease is not None:
            heartbeat_stop.set()
            if heartbeat_thread is not None:
                heartbeat_thread.join(timeout=2)
            try:
                released_lock_id = clean(active_gpu_lease.get("lockId"))
                release_cluster_gpu_lease(args, job_id, active_gpu_lease)
                log(f"[gpu-lock] Released {released_lock_id} after output persistence and job finalization.")
            except Exception as release_error:
                log(f"[warn] Could not release cluster GPU lease: {release_error}")
        if fallback_started:
            try:
                enqueue_lifecycle(args, "release", job_id)
            except Exception as stop_error:
                log(f"[warn] Could not queue 8191 idle release: {stop_error}")


def find_audio_for_node(entry: Dict[str, Any], output_node: str) -> Dict[str, str]:
    outputs = entry.get("outputs") if isinstance(entry.get("outputs"), dict) else {}
    node_output = outputs.get(output_node) if isinstance(outputs.get(output_node), dict) else {}
    for item in walk_file_records(node_output):
        filename = clean(item.get("filename") or item.get("name"))
        if filename.lower().endswith((".mp3", ".wav", ".flac", ".ogg", ".m4a")):
            return {"filename": filename, "subfolder": clean(item.get("subfolder")), "type": clean(item.get("type")) or "output"}
    raise WorkerError(f"LTX fallback output node {output_node} did not return audio.")


def main() -> int:
    parser = argparse.ArgumentParser(description="ComfyUI-OTG TEST Linux LTX Voice worker")
    parser.add_argument("--base-url", default=os.environ.get("OTG_BASE_URL", "http://100.75.162.64:3001"))
    parser.add_argument("--device-id", default=os.environ.get("OTG_DEVICE_ID", "linux-ltx-voice"))
    parser.add_argument("--worker-id", default=os.environ.get("OTG_WORKER_ID", "linux-ltx-voice-worker"))
    parser.add_argument("--worker-token", default=os.environ.get("OTG_WORKER_TOKEN", ""))
    parser.add_argument(
        "--work-root",
        default=os.environ.get(
            "OTG_VOICE_LTX_WORK_ROOT",
            "/home/shawn-rochford/AI/runtime/test/ltx-voice-jobs",
        ),
    )
    parser.add_argument(
        "--workflow-path",
        default=os.environ.get(
            "OTG_LTX_VOICE_WORKFLOW_PATH",
            "/home/shawn-rochford/AI/deploy/otg-test/current/comfy_workflows/presets/LTX Voice Sample.json",
        ),
    )
    parser.add_argument(
        "--comfy-url",
        default=os.environ.get("OTG_LTX_COMFY_URL", "http://100.75.162.64:8188"),
    )
    parser.add_argument("--fallback-comfy-url", default=os.environ.get("OTG_LTX_FALLBACK_COMFY_URL", "http://100.98.212.116:8191"))
    parser.add_argument("--fallback-image-url", default=os.environ.get("OTG_LTX_FALLBACK_IMAGE_URL", "http://100.98.212.116:8188"))
    parser.add_argument(
        "--fallback-workflow-path",
        default=os.environ.get("OTG_LTX_FALLBACK_WORKFLOW_PATH", str(Path(__file__).resolve().parents[2] / "comfy_workflows/internal/characters/ltx_voice_5060_split_aux_api.json")),
    )
    parser.add_argument("--comfy-client-id", default=os.environ.get("OTG_LTX_COMFY_CLIENT_ID", ""))
    parser.add_argument(
        "--comfy-timeout-seconds",
        type=int,
        default=int(os.environ.get("OTG_LTX_COMFY_TIMEOUT_SECONDS", "300")),
    )
    parser.add_argument(
        "--history-timeout-seconds",
        type=int,
        default=int(os.environ.get("OTG_LTX_HISTORY_TIMEOUT_SECONDS", "1800")),
    )
    parser.add_argument(
        "--app-timeout-seconds",
        type=int,
        default=int(os.environ.get("OTG_LTX_APP_TIMEOUT_SECONDS", "300")),
    )
    parser.add_argument(
        "--comfy-idle-timeout-seconds",
        type=int,
        default=int(os.environ.get("OTG_LTX_COMFY_IDLE_TIMEOUT_SECONDS", "1800")),
    )
    parser.add_argument(
        "--vram-wait-timeout-seconds",
        type=int,
        default=int(os.environ.get("OTG_LTX_VRAM_WAIT_TIMEOUT_SECONDS", "300")),
    )
    parser.add_argument(
        "--min-free-vram-mib",
        type=int,
        default=int(os.environ.get("OTG_LTX_MIN_FREE_VRAM_MIB", "22000")),
    )
    parser.add_argument(
        "--carrier-width",
        type=int,
        default=int(os.environ.get("OTG_LTX_VOICE_CARRIER_WIDTH", "384")),
    )
    parser.add_argument(
        "--carrier-height",
        type=int,
        default=int(os.environ.get("OTG_LTX_VOICE_CARRIER_HEIGHT", "224")),
    )
    parser.add_argument(
        "--duration-seconds",
        type=int,
        default=int(os.environ.get("OTG_LTX_VOICE_DURATION_SECONDS", "10")),
    )
    parser.add_argument(
        "--gpu-lock-file",
        default=os.environ.get(
            "OTG_VOICE_GPU_LOCK_FILE",
            "/home/shawn-rochford/AI/runtime/test/voice-gpu.lock",
        ),
    )
    parser.add_argument(
        "--poll-seconds",
        type=int,
        default=int(os.environ.get("OTG_LTX_POLL_SECONDS", "10")),
    )
    parser.add_argument("--once", action="store_true")
    args = parser.parse_args()

    if not args.worker_token:
        raise WorkerError(
            "Missing --worker-token/OTG_WORKER_TOKEN. LTX worker requires token-protected universal claim."
        )
    if args.comfy_url.rstrip("/") != "http://100.75.162.64:8188":
        raise WorkerError(
            "Linux LTX Voice is restricted to the RTX 3090 ComfyUI endpoint "
            "http://100.75.162.64:8188 in TEST."
        )
    if args.carrier_width % 32 or args.carrier_height % 32:
        raise WorkerError("LTX Voice carrier width and height must be divisible by 32.")

    while True:
        code = process_one_failover(args)
        if args.once:
            return code
        time.sleep(max(1, args.poll_seconds))


if __name__ == "__main__":
    raise SystemExit(main())
