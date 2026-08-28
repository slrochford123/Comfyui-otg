#!/usr/bin/env python3
from __future__ import annotations

import argparse
import io
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path
from typing import Any, Dict, List, Tuple

from PIL import Image, ImageOps


def clean(value: Any) -> str:
    return str(value or "").strip()


def log(message: str) -> None:
    print(message, flush=True)


def build_url(base_url: str, path_or_url: str) -> str:
    value = clean(path_or_url)
    if value.startswith("http://") or value.startswith("https://"):
        return value
    return urllib.parse.urljoin(base_url.rstrip("/") + "/", value.lstrip("/"))


def auth_headers(args: argparse.Namespace, owner_key: str | None = None) -> Dict[str, str]:
    headers = {
        "x-otg-device-id": owner_key or args.device_id,
        "x-otg-worker-id": args.worker_id,
    }
    if owner_key:
        headers["x-otg-owner-key"] = owner_key
    if clean(args.worker_token):
        headers["authorization"] = f"Bearer {clean(args.worker_token)}"
    return headers


def request_json(
    method: str,
    url: str,
    headers: Dict[str, str],
    payload: Dict[str, Any] | None = None,
    timeout: int = 120,
) -> Dict[str, Any]:
    body = None
    req_headers = dict(headers)
    if payload is not None:
        body = json.dumps(payload).encode("utf-8")
        req_headers["content-type"] = "application/json"
    request = urllib.request.Request(url, data=body, headers=req_headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read()
            return json.loads(raw.decode("utf-8")) if raw else {}
    except urllib.error.HTTPError as error:
        raw = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {error.code} {url}: {raw}") from error


def request_json_with_status(
    method: str,
    url: str,
    headers: Dict[str, str],
    timeout: int = 120,
) -> Tuple[int, Dict[str, Any]]:
    request = urllib.request.Request(url, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read()
            return response.status, json.loads(raw.decode("utf-8")) if raw else {}
    except urllib.error.HTTPError as error:
        raw = error.read().decode("utf-8", errors="replace")
        try:
            payload = json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            payload = {"ok": False, "error": raw}
        return error.code, payload


def multipart_post(
    url: str,
    headers: Dict[str, str],
    fields: Dict[str, str],
    files: List[Tuple[str, str, bytes, str]],
    timeout: int = 1800,
) -> Dict[str, Any]:
    boundary = "----otg-character-completion-" + uuid.uuid4().hex
    chunks: List[bytes] = []

    for name, value in fields.items():
        chunks.append(f"--{boundary}\r\n".encode("utf-8"))
        chunks.append(f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode("utf-8"))
        chunks.append(str(value).encode("utf-8"))
        chunks.append(b"\r\n")

    for field_name, filename, data, content_type in files:
        chunks.append(f"--{boundary}\r\n".encode("utf-8"))
        chunks.append(
            f'Content-Disposition: form-data; name="{field_name}"; filename="{filename}"\r\n'.encode("utf-8")
        )
        chunks.append(f"Content-Type: {content_type}\r\n\r\n".encode("utf-8"))
        chunks.append(data)
        chunks.append(b"\r\n")

    chunks.append(f"--{boundary}--\r\n".encode("utf-8"))
    body = b"".join(chunks)
    request_headers = dict(headers)
    request_headers["content-type"] = f"multipart/form-data; boundary={boundary}"
    request_headers["content-length"] = str(len(body))
    request = urllib.request.Request(url, data=body, headers=request_headers, method="POST")

    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read()
            return json.loads(raw.decode("utf-8")) if raw else {}
    except urllib.error.HTTPError as error:
        raw = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {error.code} {url}: {raw}") from error


def download_bytes(url: str, headers: Dict[str, str], timeout: int = 300) -> Tuple[bytes, str]:
    request = urllib.request.Request(url, headers=headers, method="GET")
    with urllib.request.urlopen(request, timeout=timeout) as response:
        data = response.read()
        content_type = clean(response.headers.get("content-type")) or "image/png"
    if not data:
        raise RuntimeError(f"Downloaded character card was empty: {url}")
    return data, content_type


ANGLE_ORDER = ("front", "back", "leftProfile", "rightProfile")
ANGLE_OUTPUT_NODES = {
    "front": "439",
    "back": "9001",
    "leftProfile": "9002",
    "rightProfile": "9003",
}


def prepare_seedvr_input_png(data: bytes) -> bytes:
    with Image.open(io.BytesIO(data)) as image:
        source = image.convert("RGB")

        resized = ImageOps.contain(
            source,
            (268, 480),
            Image.Resampling.LANCZOS,
        )

        width, height = resized.size
        x = (268 - width) // 2
        y = (480 - height) // 2

        inner = Image.new("RGB", (268, 480))
        inner.paste(resized, (x, y))

        right = 268 - x - width
        bottom = 480 - y - height

        if x > 0:
            edge = resized.crop((0, 0, 1, height)).resize(
                (x, height), Image.Resampling.NEAREST
            )
            inner.paste(edge, (0, y))

        if right > 0:
            edge = resized.crop((width - 1, 0, width, height)).resize(
                (right, height), Image.Resampling.NEAREST
            )
            inner.paste(edge, (x + width, y))

        if y > 0:
            edge = inner.crop((0, y, 268, y + 1)).resize(
                (268, y), Image.Resampling.NEAREST
            )
            inner.paste(edge, (0, 0))

        if bottom > 0:
            edge = inner.crop((0, y + height - 1, 268, y + height)).resize(
                (268, bottom), Image.Resampling.NEAREST
            )
            inner.paste(edge, (0, y + height))

        canvas = Image.new("RGB", (270, 480))
        canvas.paste(inner, (1, 0))
        canvas.paste(inner.crop((0, 0, 1, 480)), (0, 0))
        canvas.paste(inner.crop((267, 0, 268, 480)), (269, 0))

        output = io.BytesIO()
        canvas.save(output, format="PNG")
        return output.getvalue()


def stitch_character_reference_card(master_images: Dict[str, bytes]) -> bytes:
    positions = {
        "front": (0, 0),
        "back": (540, 0),
        "leftProfile": (0, 960),
        "rightProfile": (540, 960),
    }

    canvas = Image.new("RGB", (1080, 1920))

    for angle in ANGLE_ORDER:
        raw = master_images.get(angle)
        if not raw:
            raise RuntimeError(f"Missing 1080p character reference master: {angle}")

        with Image.open(io.BytesIO(raw)) as image:
            master = image.convert("RGB")
            if master.size != (1080, 1920):
                raise RuntimeError(
                    f"SeedVR character reference contract mismatch for {angle}: "
                    f"expected 1080x1920; received {master.width}x{master.height}."
                )

            tile = master.resize((540, 960), Image.Resampling.LANCZOS)
            canvas.paste(tile, positions[angle])

    output = io.BytesIO()
    canvas.save(output, format="PNG")
    return output.getvalue()


def upload_character_asset_bytes(
    args: argparse.Namespace,
    owner_key: str,
    character_id: str,
    asset_name: str,
    data: bytes,
) -> Dict[str, str]:
    payload = multipart_post(
        build_url(args.base_url, "/api/characters/upload"),
        auth_headers(args, owner_key),
        {},
        [("image", f"{character_id}-{asset_name}.png", data, "image/png")],
        timeout=300,
    )

    if not payload.get("ok"):
        raise RuntimeError(
            f"Character reference upload failed for {asset_name}: "
            f"{json.dumps(payload)[:2000]}"
        )

    server_path = clean(payload.get("serverPath"))
    file_url = clean(payload.get("fileUrl") or payload.get("url"))

    if not server_path:
        raise RuntimeError(
            f"Character reference upload returned no serverPath for {asset_name}."
        )

    return {"serverPath": server_path, "url": file_url}


def claim_job(args: argparse.Namespace) -> Dict[str, Any] | None:
    payload = request_json(
        "POST",
        build_url(args.base_url, "/api/characters/completion/worker/claim"),
        auth_headers(args),
        {"workerId": args.worker_id},
        timeout=60,
    )
    job = payload.get("job")
    return job if isinstance(job, dict) else None


def checkpoint(
    args: argparse.Namespace,
    owner_key: str,
    job_id: str,
    progress: int,
    stage: str,
    message: str,
    result: Dict[str, Any],
) -> None:
    request_json(
        "POST",
        build_url(args.base_url, "/api/characters/completion/worker/checkpoint"),
        auth_headers(args, owner_key),
        {
            "jobId": job_id,
            "progress": progress,
            "message": message,
            "result": {
                **result,
                "remoteWorker": True,
                "workerId": args.worker_id,
                "currentStage": stage,
            },
        },
        timeout=60,
    )


def complete_job(args: argparse.Namespace, owner_key: str, job_id: str, result: Dict[str, Any]) -> None:
    request_json(
        "POST",
        build_url(args.base_url, "/api/characters/completion/worker/complete"),
        auth_headers(args, owner_key),
        {
            "jobId": job_id,
            "message": "Linux Worker Manager completed the character card and saved the character.",
            "result": result,
        },
        timeout=120,
    )


def fail_job(args: argparse.Namespace, owner_key: str, job_id: str, error: str, result: Dict[str, Any]) -> None:
    try:
        request_json(
            "POST",
            build_url(args.base_url, "/api/characters/completion/worker/fail"),
            auth_headers(args, owner_key),
            {"jobId": job_id, "error": error, "result": result},
            timeout=120,
        )
    except Exception as fail_error:
        log(f"[warn] Could not record failed character completion job {job_id}: {fail_error}")


CHARACTER_REFERENCE_WORKFLOWS = {
    "qwen": (
        "internal/character-reference/qwen_character_4angle_lowres",
        "comfy_workflows/internal/character-reference/qwen_character_4angle_lowres.json",
    ),
    "seedvr": (
        "internal/character-reference/seedvr2_character_reference_1080p",
        "comfy_workflows/internal/character-reference/seedvr2_character_reference_1080p.json",
    ),
}


def submit_character_reference_workflow(
    args: argparse.Namespace,
    owner_key: str,
    workflow_kind: str,
    gpu_target: str,
    image_path: str = "",
    image_bytes: bytes | None = None,
    image_filename: str = "character-reference-input.png",
) -> str:
    workflow = CHARACTER_REFERENCE_WORKFLOWS.get(workflow_kind)
    if not workflow:
        raise RuntimeError(f"Unknown character reference workflow kind: {workflow_kind}")

    workflow_id, workflow_file = workflow
    fields = {
        "workflowId": workflow_id,
        "workflowFile": workflow_file,
        "requestKind": f"character-reference-{workflow_kind}",
        "sourceType": f"character-reference-{workflow_kind}",
        "gpuTarget": gpu_target,
        "saveToGallery": "false",
        "save_to_gallery": "false",
        "persistToGallery": "false",
        "addToGallery": "false",
        "copyToGallery": "false",
        "gallery": "false",
        "skipGallery": "true",
        "skipGeneralGallery": "true",
        "assetLibraryOnly": "true",
        "outputLibrary": "characters",
    }

    files = []
    if image_bytes is not None:
        files.append(("imageA", image_filename, image_bytes, "image/png"))
    elif image_path:
        fields["imageAPath"] = image_path
    else:
        raise RuntimeError(
            f"Character reference {workflow_kind} submission requires image_path or image_bytes."
        )

    payload = multipart_post(
        build_url(args.base_url, "/api/comfy"),
        auth_headers(args, owner_key),
        fields,
        files,
        timeout=180,
    )

    prompt_id = clean(payload.get("prompt_id") or payload.get("promptId"))
    if not prompt_id:
        raise RuntimeError(
            f"Character reference {workflow_kind} submission returned no prompt id: "
            f"{json.dumps(payload)[:2000]}"
        )
    return prompt_id


def submit_character_reference_with_fallback(
    args: argparse.Namespace,
    owner_key: str,
    workflow_kind: str,
    image_path: str = "",
    image_bytes: bytes | None = None,
    image_filename: str = "character-reference-input.png",
    preferred_gpu: str = "rtx3090",
) -> Tuple[str, str]:
    primary = preferred_gpu if preferred_gpu in {"rtx3090", "rtx5060ti"} else "rtx3090"
    fallback = "rtx5060ti" if primary == "rtx3090" else "rtx3090"

    message = ""
    for busy_attempt in range(1, 11):
        try:
            prompt_id = submit_character_reference_workflow(
                args,
                owner_key,
                workflow_kind,
                primary,
                image_path=image_path,
                image_bytes=image_bytes,
                image_filename=image_filename,
            )
            return prompt_id, primary
        except RuntimeError as error:
            message = str(error)
            deterministic_busy = (
                "HTTP 409 " in message
                and ("busy" in message.lower() or "resource lock" in message.lower())
            )
            if not deterministic_busy or busy_attempt == 10:
                break
            log(
                f"[busy] {workflow_kind} backend {primary} is finishing its prior "
                f"checkpoint; retry {busy_attempt}/10 in 2 seconds"
            )
            time.sleep(2)

    # Only fail over when the app deterministically rejected the selected
    # backend before Comfy submission. A timeout or transport failure could
    # mean the first prompt was accepted, so retrying would risk duplicates.
    if "HTTP 503 " not in message:
        raise RuntimeError(message)

    log(
        f"[fallback] {workflow_kind} backend {primary} unavailable; "
        f"retrying on {fallback}"
    )

    prompt_id = submit_character_reference_workflow(
        args,
        owner_key,
        workflow_kind,
        fallback,
        image_path=image_path,
        image_bytes=image_bytes,
        image_filename=image_filename,
    )
    return prompt_id, fallback


def character_reference_comfy_base_url(gpu_target: str) -> str:
    target = clean(gpu_target)
    if not target:
        return ""

    config_path = (
        Path(__file__).resolve().parents[2]
        / "config"
        / "comfy-backends.json"
    )

    try:
        data = json.loads(config_path.read_text())
    except Exception:
        return ""

    backends = data.get("backends")
    if not isinstance(backends, list):
        return ""

    for backend in backends:
        if not isinstance(backend, dict):
            continue
        if clean(backend.get("id")) != target:
            continue
        return clean(backend.get("url") or backend.get("baseUrl"))

    return ""


def wait_for_comfy_image(
    args: argparse.Namespace,
    owner_key: str,
    job_id: str,
    prompt_id: str,
    node_id: str,
    progress: int,
    stage: str,
    message: str,
    base_result: Dict[str, Any],
    gpu_target: str = "",
) -> Dict[str, Any]:
    deadline = time.time() + max(300, args.card_timeout_seconds)
    next_checkpoint = 0.0
    last_error = ""

    while time.time() < deadline:
        query = {
            "promptId": prompt_id,
            "nodeId": node_id,
            "t": str(int(time.time() * 1000)),
        }

        comfy_base_url = character_reference_comfy_base_url(gpu_target)
        if comfy_base_url:
            query["comfyBaseUrl"] = comfy_base_url

        params = urllib.parse.urlencode(query)

        status, payload = request_json_with_status(
            "GET",
            build_url(args.base_url, f"/api/comfy/history-image?{params}"),
            auth_headers(args, owner_key),
            timeout=45,
        )

        if status == 200 and payload.get("ok"):
            image_url = clean(payload.get("url") or payload.get("imageUrl"))
            if image_url:
                return {
                    "imageUrl": build_url(args.base_url, image_url),
                    "filename": clean(payload.get("filename") or payload.get("sourceName")),
                    "nodeId": clean(payload.get("nodeId")) or node_id,
                    "comfyBaseUrl": clean(payload.get("comfyBaseUrl")),
                }
        elif status not in {404, 409, 425}:
            last_error = clean(payload.get("error")) or f"HTTP {status}"

        if time.time() >= next_checkpoint:
            checkpoint(
                args,
                owner_key,
                job_id,
                progress,
                stage,
                message,
                {
                    **base_result,
                    "activePromptId": prompt_id,
                    "activeOutputNodeId": node_id,
                    "lastLookupError": last_error,
                },
            )
            next_checkpoint = time.time() + 20

        time.sleep(3)

    raise RuntimeError(
        f"Timed out waiting for Comfy prompt {prompt_id} node {node_id}."
        + (f" Last lookup error: {last_error}" if last_error else "")
    )


def submit_character_card(
    args: argparse.Namespace,
    owner_key: str,
    source_image_path: str,
) -> str:
    fields = {
        "workflowId": "presets/character_card_8_angles_low_angle",
        "workflowLabel": "Characters 8-Angle Character Card",
        "requestKind": "characters-8-angle-card",
        "sourceType": "characters-8-angle-card",
        "imageAPath": source_image_path,
        "loadImageNodeId": "25",
        "saveImageNodeId": "439",
        "characterCardOutputNodeId": "439",
        "saveToGallery": "false",
        "save_to_gallery": "false",
        "persistToGallery": "false",
        "addToGallery": "false",
        "copyToGallery": "false",
        "gallery": "false",
        "skipGallery": "true",
        "skipGeneralGallery": "true",
        "assetLibraryOnly": "true",
        "outputLibrary": "characters",
        "galleryExclusionPolicy": "character-card-only",
    }
    payload = multipart_post(
        build_url(args.base_url, "/api/comfy"),
        auth_headers(args, owner_key),
        fields,
        [],
        timeout=180,
    )
    prompt_id = clean(payload.get("prompt_id") or payload.get("promptId"))
    if not prompt_id:
        raise RuntimeError(f"Character card submission returned no prompt id: {json.dumps(payload)[:2000]}")
    return prompt_id


def wait_for_character_card(
    args: argparse.Namespace,
    owner_key: str,
    job_id: str,
    prompt_id: str,
    base_result: Dict[str, Any],
) -> Dict[str, Any]:
    deadline = time.time() + max(300, args.card_timeout_seconds)
    next_checkpoint = 0.0
    last_error = ""

    while time.time() < deadline:
        params = urllib.parse.urlencode(
            {
                "promptId": prompt_id,
                "nodeId": "439",
                "t": str(int(time.time() * 1000)),
            }
        )
        status, payload = request_json_with_status(
            "GET",
            build_url(args.base_url, f"/api/comfy/history-image?{params}"),
            auth_headers(args, owner_key),
            timeout=45,
        )
        if status == 200 and payload.get("ok"):
            image_url = clean(payload.get("url") or payload.get("imageUrl"))
            if image_url:
                return {
                    "imageUrl": build_url(args.base_url, image_url),
                    "filename": clean(payload.get("filename") or payload.get("sourceName")),
                    "nodeId": clean(payload.get("nodeId")) or "439",
                    "comfyBaseUrl": clean(payload.get("comfyBaseUrl")),
                }
        elif status not in {404, 409, 425}:
            last_error = clean(payload.get("error")) or f"HTTP {status}"

        if time.time() >= next_checkpoint:
            checkpoint(
                args,
                owner_key,
                job_id,
                45,
                "waiting_for_character_card",
                "Character card submitted. Checking both ComfyUI GPUs for final node 439 output.",
                {**base_result, "promptId": prompt_id, "lastLookupError": last_error},
            )
            next_checkpoint = time.time() + 20

        time.sleep(3)

    raise RuntimeError(
        f"Timed out waiting for character card node 439 output for prompt {prompt_id}."
        + (f" Last lookup error: {last_error}" if last_error else "")
    )


def upload_card(
    args: argparse.Namespace,
    owner_key: str,
    character_id: str,
    image_url: str,
) -> Dict[str, Any]:
    data, content_type = download_bytes(image_url, auth_headers(args, owner_key), timeout=300)
    payload = multipart_post(
        build_url(args.base_url, "/api/characters/upload"),
        auth_headers(args, owner_key),
        {},
        [("image", f"{character_id}-character-card.png", data, content_type)],
        timeout=300,
    )
    if not payload.get("ok"):
        raise RuntimeError(f"Character card upload failed: {json.dumps(payload)[:2000]}")
    server_path = clean(payload.get("serverPath"))
    file_url = clean(payload.get("fileUrl") or payload.get("url"))
    if not server_path:
        raise RuntimeError(f"Character card upload returned no serverPath: {json.dumps(payload)[:2000]}")
    return {"serverPath": server_path, "fileUrl": file_url}


def persist_character(
    args: argparse.Namespace,
    owner_key: str,
    job_input: Dict[str, Any],
    card_path: str,
    card_url: str,
    character_references: Dict[str, Any] | None = None,
) -> Dict[str, Any]:
    character_id = clean(job_input.get("characterId") or job_input.get("id"))
    character_name = clean(job_input.get("characterName") or job_input.get("name"))
    source_image_path = clean(
        job_input.get("sourceImagePath")
        or job_input.get("fullBodyImagePath")
        or job_input.get("defaultCharacterSourceImagePath")
        or job_input.get("imagePath")
    )
    description = clean(
        job_input.get("description")
        or job_input.get("globalPromptIdentityBlock")
        or job_input.get("promptReadyDescription")
    )
    metadata = job_input.get("metadata") if isinstance(job_input.get("metadata"), dict) else {}
    voice_settings = job_input.get("voiceSettings") if isinstance(job_input.get("voiceSettings"), dict) else {}
    original_source = clean(job_input.get("originalSourceImagePath")) or source_image_path

    payload = {
        "id": character_id,
        "name": character_name,
        "fullBodyImagePath": source_image_path,
        "imagePath": source_image_path,
        "previewImagePath": source_image_path,
        "transparentImagePath": source_image_path,
        "defaultCharacterImagePath": source_image_path,
        "defaultCharacterPreviewImagePath": source_image_path,
        "defaultCharacterSourceImagePath": source_image_path,
        "backgroundRemovedDefaultImagePath": source_image_path,
        "defaultCharacterImageStatus": "background_removed",
        "characterCardPath": card_path,
        "characterCardWorkflowImagePath": card_path,
        "characterCardPreviewImagePath": card_path,
        "characterCardUrl": card_url,
        "characterReferences": character_references,
        "originalSourceImagePath": original_source,
        "description": description,
        "globalPromptIdentityBlock": description,
        "metadata": {
            **metadata,
            "savedForLater": False,
            "needsCharacterCard": False,
            "needsFinalSave": False,
            "characterStatus": "card_complete",
            "completedByWorkerManager": True,
        },
        "voiceSettings": voice_settings,
        "characterVoiceProfile": None,
        "voicePackPaths": {},
        "voiceStyleDefinition": "",
        "introLine": "",
        "source": "characters_tab_worker_completion",
        "characterStatus": "card_complete",
        "voiceStatus": "none",
        "hasCustomVoice": False,
    }
    response = request_json(
        "POST",
        build_url(args.base_url, "/api/characters"),
        auth_headers(args, owner_key),
        payload,
        timeout=180,
    )
    if not response.get("ok"):
        raise RuntimeError(f"Character save failed: {json.dumps(response)[:2000]}")
    character = response.get("character") if isinstance(response.get("character"), dict) else response
    return character if isinstance(character, dict) else payload


def load_character_reference_asset_bytes(
    args: argparse.Namespace,
    owner_key: str,
    asset: Dict[str, Any],
) -> bytes:
    url = clean(asset.get("url"))
    if url:
        data, _ = download_bytes(
            build_url(args.base_url, url),
            auth_headers(args, owner_key),
            timeout=300,
        )
        return data

    server_path = clean(asset.get("serverPath"))
    if server_path and os.path.isfile(server_path):
        return Path(server_path).read_bytes()

    raise RuntimeError(
        f"Character reference asset is not readable: {json.dumps(asset)[:1000]}"
    )


def find_existing_completed_character(
    args: argparse.Namespace,
    owner_key: str,
    character_id: str,
    job_id: str,
) -> Dict[str, Any] | None:
    response = request_json(
        "GET",
        build_url(args.base_url, "/api/characters"),
        auth_headers(args, owner_key),
        timeout=60,
    )

    items = response.get("items") if isinstance(response.get("items"), list) else []
    for item in items:
        if not isinstance(item, dict):
            continue
        if clean(item.get("id")) != character_id:
            continue

        refs = item.get("characterReferences")
        if (
            isinstance(refs, dict)
            and clean(refs.get("completionJobId")) == job_id
            and clean(refs.get("status")) == "complete"
        ):
            return item

        raise RuntimeError(
            f"Character {character_id} already exists but was not created "
            f"by completion job {job_id}."
        )

    return None


def process_job(args: argparse.Namespace, job: Dict[str, Any]) -> None:
    owner_key = clean(job.get("ownerKey"))
    job_id = clean(job.get("jobId"))
    job_input = job.get("input") if isinstance(job.get("input"), dict) else {}
    character_id = clean(
        job.get("characterId")
        or job_input.get("characterId")
        or job_input.get("id")
    )
    source_image_path = clean(
        job_input.get("sourceImagePath")
        or job_input.get("fullBodyImagePath")
        or job_input.get("defaultCharacterSourceImagePath")
        or job_input.get("imagePath")
    )

    if not owner_key or not job_id or not character_id or not source_image_path:
        raise RuntimeError(
            "Claimed character completion job is missing ownerKey, jobId, "
            "characterId, or sourceImagePath."
        )

    prior_result = job.get("result") if isinstance(job.get("result"), dict) else {}

    prior_refs = prior_result.get("characterReferences")
    refs: Dict[str, Any] = (
        dict(prior_refs)
        if isinstance(prior_refs, dict)
        and prior_refs.get("pipelineVersion") == 1
        else {
            "pipelineVersion": 1,
            "status": "pending",
            "completionJobId": job_id,
            "upscalePromptIds": {},
            "body": {},
        }
    )

    refs["pipelineVersion"] = 1
    refs["completionJobId"] = job_id

    body_refs = refs.get("body")
    if not isinstance(body_refs, dict):
        body_refs = {}
        refs["body"] = body_refs

    upscale_prompt_ids = refs.get("upscalePromptIds")
    if not isinstance(upscale_prompt_ids, dict):
        upscale_prompt_ids = {}
        refs["upscalePromptIds"] = upscale_prompt_ids

    qwen_outputs = prior_result.get("qwenOutputs")
    if not isinstance(qwen_outputs, dict):
        qwen_outputs = {}

    upscale_gpus = prior_result.get("upscaleGpus")
    if not isinstance(upscale_gpus, dict):
        upscale_gpus = {}

    result: Dict[str, Any] = {
        **prior_result,
        "characterId": character_id,
        "sourceImagePath": source_image_path,
        "workerId": args.worker_id,
        "remoteWorker": True,
        "mock": False,
        "characterReferences": refs,
        "qwenOutputs": qwen_outputs,
        "upscaleGpus": upscale_gpus,
    }

    preferred_gpu = clean(
        job_input.get("characterReferenceGpuTarget")
        or job_input.get("gpuTarget")
        or "rtx3090"
    ).lower()
    if preferred_gpu not in {"rtx3090", "rtx5060ti"}:
        preferred_gpu = "rtx3090"

    try:
        checkpoint(
            args,
            owner_key,
            job_id,
            10,
            "preflight",
            "Character reference completion claimed. Resuming durable pipeline state.",
            result,
        )

        qwen_prompt_id = clean(refs.get("anglePromptId"))
        if not qwen_prompt_id:
            refs["status"] = "generating_angles"

            qwen_prompt_id, qwen_gpu = submit_character_reference_with_fallback(
                args,
                owner_key,
                "qwen",
                image_path=source_image_path,
                preferred_gpu=preferred_gpu,
            )

            refs["anglePromptId"] = qwen_prompt_id
            result["qwenGpu"] = qwen_gpu

            checkpoint(
                args,
                owner_key,
                job_id,
                20,
                "generating_angles",
                "Qwen four-angle reference generation submitted.",
                result,
            )

        for angle in ANGLE_ORDER:
            existing_output = qwen_outputs.get(angle)
            if (
                isinstance(existing_output, dict)
                and clean(existing_output.get("imageUrl"))
            ):
                continue

            output = wait_for_comfy_image(
                args,
                owner_key,
                job_id,
                qwen_prompt_id,
                ANGLE_OUTPUT_NODES[angle],
                30,
                "generating_angles",
                f"Waiting for Qwen {angle} reference.",
                result,
                gpu_target=clean(result.get("qwenGpu")),
            )

            qwen_outputs[angle] = output
            result["qwenOutputs"] = qwen_outputs

            checkpoint(
                args,
                owner_key,
                job_id,
                35,
                "generating_angles",
                f"Captured Qwen {angle} reference.",
                result,
            )

        refs["status"] = "upscaling"

        checkpoint(
            args,
            owner_key,
            job_id,
            40,
            "upscaling",
            "Four Qwen body angles are ready. Upscaling references to 1080x1920.",
            result,
        )

        for index, angle in enumerate(ANGLE_ORDER):
            existing_asset = body_refs.get(angle)
            if (
                isinstance(existing_asset, dict)
                and clean(existing_asset.get("serverPath"))
            ):
                continue

            prompt_id = clean(upscale_prompt_ids.get(angle))

            if not prompt_id:
                qwen_output = qwen_outputs.get(angle)
                if not isinstance(qwen_output, dict):
                    raise RuntimeError(f"Missing Qwen output for {angle}.")

                qwen_url = clean(qwen_output.get("imageUrl"))
                if not qwen_url:
                    raise RuntimeError(f"Missing Qwen image URL for {angle}.")

                lowres_bytes, _ = download_bytes(
                    qwen_url,
                    auth_headers(args, owner_key),
                    timeout=300,
                )

                seedvr_input = prepare_seedvr_input_png(lowres_bytes)

                prompt_id, gpu_used = submit_character_reference_with_fallback(
                    args,
                    owner_key,
                    "seedvr",
                    image_bytes=seedvr_input,
                    image_filename=f"{character_id}-{angle}-seedvr-input.png",
                    preferred_gpu=preferred_gpu,
                )

                upscale_prompt_ids[angle] = prompt_id
                upscale_gpus[angle] = gpu_used
                refs["upscalePromptIds"] = upscale_prompt_ids
                result["upscaleGpus"] = upscale_gpus

                checkpoint(
                    args,
                    owner_key,
                    job_id,
                    45 + index * 8,
                    "upscaling",
                    f"SeedVR upscale submitted for {angle}.",
                    result,
                )

            output = wait_for_comfy_image(
                args,
                owner_key,
                job_id,
                prompt_id,
                "9",
                48 + index * 8,
                "upscaling",
                f"Waiting for SeedVR {angle} master.",
                result,
                gpu_target=clean(upscale_gpus.get(angle)),
            )

            master_bytes, _ = download_bytes(
                clean(output.get("imageUrl")),
                auth_headers(args, owner_key),
                timeout=300,
            )

            with Image.open(io.BytesIO(master_bytes)) as master:
                master.load()
                if master.size != (1080, 1920):
                    raise RuntimeError(
                        f"SeedVR {angle} output contract mismatch: "
                        f"expected 1080x1920; received "
                        f"{master.width}x{master.height}."
                    )

            uploaded = upload_character_asset_bytes(
                args,
                owner_key,
                character_id,
                angle,
                master_bytes,
            )

            qwen_output = qwen_outputs.get(angle)
            source_path = (
                clean(qwen_output.get("imageUrl"))
                if isinstance(qwen_output, dict)
                else source_image_path
            )

            body_refs[angle] = {
                "serverPath": clean(uploaded.get("serverPath")),
                "url": clean(uploaded.get("url")),
                "width": 1080,
                "height": 1920,
                "sourcePath": source_path,
                "promptId": prompt_id,
            }

            refs["body"] = body_refs

            checkpoint(
                args,
                owner_key,
                job_id,
                52 + index * 8,
                "upscaling",
                f"Saved 1080x1920 {angle} character master.",
                result,
            )

        refs["status"] = "stitching"

        checkpoint(
            args,
            owner_key,
            job_id,
            84,
            "stitching",
            "Four 1080x1920 masters are ready. Building four-angle Character Card.",
            result,
        )

        card_ref = refs.get("characterCard")
        if not (
            isinstance(card_ref, dict)
            and clean(card_ref.get("serverPath"))
        ):
            master_images: Dict[str, bytes] = {}

            for angle in ANGLE_ORDER:
                asset = body_refs.get(angle)
                if not isinstance(asset, dict):
                    raise RuntimeError(
                        f"Missing persisted character reference master: {angle}"
                    )

                master_images[angle] = load_character_reference_asset_bytes(
                    args,
                    owner_key,
                    asset,
                )

            card_bytes = stitch_character_reference_card(master_images)

            uploaded_card = upload_character_asset_bytes(
                args,
                owner_key,
                character_id,
                "four-angle-card",
                card_bytes,
            )

            card_ref = {
                "serverPath": clean(uploaded_card.get("serverPath")),
                "url": clean(uploaded_card.get("url")),
                "width": 1080,
                "height": 1920,
            }

            refs["characterCard"] = card_ref

            checkpoint(
                args,
                owner_key,
                job_id,
                90,
                "stitching",
                "Four-angle Character Card stitched and saved.",
                result,
            )

        card_path = clean(card_ref.get("serverPath"))
        card_url = clean(card_ref.get("url"))

        if not card_path:
            raise RuntimeError("Final Character Card has no persisted serverPath.")

        completed_at = clean(refs.get("completedAt"))
        if not completed_at:
            completed_at = time.strftime(
                "%Y-%m-%dT%H:%M:%SZ",
                time.gmtime(),
            )

        refs.update(
            {
                "pipelineVersion": 1,
                "status": "complete",
                "completionJobId": job_id,
                "anglePromptId": qwen_prompt_id,
                "upscalePromptIds": upscale_prompt_ids,
                "body": body_refs,
                "characterCard": card_ref,
                "completedAt": completed_at,
            }
        )
        refs.pop("error", None)

        result["characterReferences"] = refs
        result["cardImagePath"] = card_path
        result["cardImageUrl"] = card_url

        # OTG_CHARACTER_REFERENCE_DEFER_FINAL_SAVE_V1
        # The active Character Creator generates the five canonical references
        # before the user enters the final character name/details. In this mode,
        # complete the durable reference job without creating a Character record.
        if job_input.get("deferCharacterSave") is True:
            result.update(
                {
                    "characterId": character_id,
                    "cardImagePath": card_path,
                    "cardImageUrl": card_url,
                    "characterReferences": refs,
                    "deferredCharacterSave": True,
                    "status": "completed",
                    "currentStage": "references_complete",
                    "completedAt": completed_at,
                }
            )
            complete_job(args, owner_key, job_id, result)
            log(
                f"[PASS] Completed deferred five-reference package "
                f"{character_id}; job={job_id}"
            )
            return

        checkpoint(
            args,
            owner_key,
            job_id,
            94,
            "persisting_character",
            "Five character references are complete. Saving canonical character record.",
            result,
        )

        saved_character = find_existing_completed_character(
            args,
            owner_key,
            character_id,
            job_id,
        )

        if saved_character is None:
            saved_character = persist_character(
                args,
                owner_key,
                job_input,
                card_path,
                card_url,
                refs,
            )

        result.update(
            {
                "characterId": character_id,
                "savedCharacterId": clean(saved_character.get("id"))
                or character_id,
                "cardImagePath": card_path,
                "cardImageUrl": card_url,
                "character": saved_character,
                "status": "completed",
                "currentStage": "completed",
                "completedAt": completed_at,
            }
        )

        complete_job(args, owner_key, job_id, result)
        log(
            f"[PASS] Completed five-reference character package "
            f"{character_id}; job={job_id}"
        )

    except Exception as error:
        refs["status"] = "failed"
        refs["error"] = str(error)
        result["characterReferences"] = refs
        result["status"] = "failed"
        result["currentStage"] = "failed"
        result["error"] = str(error)
        fail_job(args, owner_key, job_id, str(error), result)
        raise


def run_once(args: argparse.Namespace) -> int:
    job = claim_job(args)
    if not job:
        log("[idle] No queued character completion job.")
        return 0
    log(f"[claim] job={clean(job.get('jobId'))} owner={clean(job.get('ownerKey'))} character={clean(job.get('characterId'))}")
    process_job(args, job)
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="OTG Linux Worker Manager service for durable character completion")
    parser.add_argument("--base-url", default=os.environ.get("OTG_BASE_URL", "http://100.75.162.64:3001"))
    parser.add_argument("--device-id", default=os.environ.get("OTG_DEVICE_ID", "linux-character-completion"))
    parser.add_argument("--worker-id", default=os.environ.get("OTG_WORKER_ID", "linux-character-completion-worker"))
    parser.add_argument("--worker-token", default=os.environ.get("OTG_WORKER_TOKEN", ""))
    parser.add_argument("--interval-seconds", type=int, default=10)
    parser.add_argument("--card-timeout-seconds", type=int, default=1200)
    parser.add_argument("--once", action="store_true")
    args = parser.parse_args()

    if not clean(args.worker_token):
        raise RuntimeError("Missing OTG_WORKER_TOKEN. The token must be inherited through the Linux systemd environment file.")

    if args.once:
        return run_once(args)

    while True:
        try:
            run_once(args)
        except KeyboardInterrupt:
            return 0
        except Exception as error:
            log(f"[error] {error}")
        time.sleep(max(5, args.interval_seconds))


if __name__ == "__main__":
    raise SystemExit(main())
