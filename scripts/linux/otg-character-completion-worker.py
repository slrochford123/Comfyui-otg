#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from typing import Any, Dict, List, Tuple


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


def process_job(args: argparse.Namespace, job: Dict[str, Any]) -> None:
    owner_key = clean(job.get("ownerKey"))
    job_id = clean(job.get("jobId"))
    job_input = job.get("input") if isinstance(job.get("input"), dict) else {}
    character_id = clean(job.get("characterId") or job_input.get("characterId") or job_input.get("id"))
    source_image_path = clean(
        job_input.get("sourceImagePath")
        or job_input.get("fullBodyImagePath")
        or job_input.get("defaultCharacterSourceImagePath")
        or job_input.get("imagePath")
    )
    if not owner_key or not job_id or not character_id or not source_image_path:
        raise RuntimeError("Claimed character completion job is missing ownerKey, jobId, characterId, or sourceImagePath.")

    prior_result = job.get("result") if isinstance(job.get("result"), dict) else {}
    result: Dict[str, Any] = {
        **prior_result,
        "characterId": character_id,
        "sourceImagePath": source_image_path,
        "workerId": args.worker_id,
        "remoteWorker": True,
        "mock": False,
    }

    card_path = clean(prior_result.get("cardImagePath") or job_input.get("cardImagePath") or job_input.get("characterCardPath"))
    card_url = clean(prior_result.get("cardImageUrl") or job_input.get("cardImageUrl") or job_input.get("characterCardUrl"))

    try:
        checkpoint(
            args,
            owner_key,
            job_id,
            10,
            "preflight",
            "Worker Manager claimed character completion. Validating source and current durable state.",
            result,
        )

        if not card_path:
            prompt_id = clean(prior_result.get("promptId"))
            if not prompt_id:
                prompt_id = submit_character_card(args, owner_key, source_image_path)
                result["promptId"] = prompt_id
                checkpoint(
                    args,
                    owner_key,
                    job_id,
                    25,
                    "character_card_submitted",
                    "8-angle character card submitted. Waiting for final output.",
                    result,
                )

            output = wait_for_character_card(args, owner_key, job_id, prompt_id, result)
            result.update(output)
            checkpoint(
                args,
                owner_key,
                job_id,
                70,
                "character_card_found",
                "Final character card found. Uploading it into the Characters asset store.",
                result,
            )

            uploaded = upload_card(args, owner_key, character_id, clean(output.get("imageUrl")))
            card_path = clean(uploaded.get("serverPath"))
            card_url = clean(uploaded.get("fileUrl"))
            result["cardImagePath"] = card_path
            result["cardImageUrl"] = card_url
            checkpoint(
                args,
                owner_key,
                job_id,
                85,
                "character_card_uploaded",
                "Character card uploaded. Saving final character record.",
                result,
            )

        saved_character = persist_character(args, owner_key, job_input, card_path, card_url)
        result.update(
            {
                "characterId": character_id,
                "savedCharacterId": clean(saved_character.get("id")) or character_id,
                "cardImagePath": card_path,
                "cardImageUrl": card_url,
                "character": saved_character,
                "status": "completed",
                "currentStage": "completed",
                "completedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            }
        )
        complete_job(args, owner_key, job_id, result)
        log(f"[PASS] Completed character {character_id}; job={job_id}")
    except Exception as error:
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
