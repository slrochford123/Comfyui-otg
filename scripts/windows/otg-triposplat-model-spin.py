from __future__ import annotations

import hashlib
import json
import mimetypes
import os
import shutil
import time
import urllib.parse
import urllib.request
import uuid
from pathlib import Path
from typing import Any, Dict, Iterable


def log(message: str) -> None:
    print(message, flush=True)


def clean(value: Any) -> str:
    return str(value or "").strip()


def has_bytes(path: Path) -> bool:
    try:
        return path.is_file() and path.stat().st_size > 0
    except OSError:
        return False


def require_file(value: str, label: str) -> Path:
    path = Path(clean(value))
    if not has_bytes(path):
        raise RuntimeError(f"{label} is missing or empty: {path}")
    return path


def require_env(name: str) -> str:
    value = clean(os.environ.get(name))
    if not value:
        raise RuntimeError(f"{name} is required.")
    return value


def read_json(path: Path) -> Dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8-sig"))


def write_json(path: Path, data: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2), encoding="utf-8")


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def find_workflow() -> Path:
    explicit = clean(os.environ.get("OTG_CHARACTER_MODEL_SPIN_WORKFLOW"))
    repo = Path(clean(os.environ.get("OTG_REPO")) or r"C:\AI\OTG-Test2")
    candidates = []
    if explicit:
        candidates.append(Path(explicit))
    candidates.extend([
        repo / "comfy_workflows" / "presets" / "TripoSplat Model Spin.json",
        repo / "comfy_workflows" / "presets" / "ComfyUI_TripoSplat_00001_ (2).json",
    ])
    for candidate in candidates:
        if candidate.is_file():
            return candidate
    raise RuntimeError("TripoSplat model-spin workflow JSON not found. Searched: " + "; ".join(str(p) for p in candidates))


def multipart_upload_image(base_url: str, image_path: Path) -> str:
    boundary = "----otg-triposplat-spin-" + uuid.uuid4().hex
    mime = mimetypes.guess_type(str(image_path))[0] or "application/octet-stream"
    parts: list[bytes] = []

    def add_field(name: str, value: str) -> None:
        parts.append(f"--{boundary}\r\n".encode("utf-8"))
        parts.append(f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode("utf-8"))
        parts.append(value.encode("utf-8"))
        parts.append(b"\r\n")

    def add_file(name: str, path: Path) -> None:
        parts.append(f"--{boundary}\r\n".encode("utf-8"))
        parts.append(
            (
                f'Content-Disposition: form-data; name="{name}"; filename="{path.name}"\r\n'
                f"Content-Type: {mime}\r\n\r\n"
            ).encode("utf-8")
        )
        parts.append(path.read_bytes())
        parts.append(b"\r\n")

    add_file("image", image_path)
    add_field("type", "input")
    add_field("overwrite", "true")
    parts.append(f"--{boundary}--\r\n".encode("utf-8"))

    req = urllib.request.Request(
        urllib.parse.urljoin(base_url.rstrip("/") + "/", "upload/image"),
        data=b"".join(parts),
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=300) as response:
        data = json.loads(response.read().decode("utf-8"))

    name = clean(data.get("name"))
    if not name:
        raise RuntimeError(f"ComfyUI upload did not return image name: {data}")
    return name


def post_json(url: str, payload: Dict[str, Any], timeout: int = 120) -> Dict[str, Any]:
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as response:
        raw = response.read()
        return json.loads(raw.decode("utf-8")) if raw else {}


def get_json(url: str, timeout: int = 120) -> Dict[str, Any]:
    with urllib.request.urlopen(url, timeout=timeout) as response:
        raw = response.read()
        return json.loads(raw.decode("utf-8")) if raw else {}


def patch_workflow(workflow: Dict[str, Any], uploaded_image_name: str, output_prefix: str) -> Dict[str, Any]:
    load_image = workflow.get("99")
    if not isinstance(load_image, dict) or not isinstance(load_image.get("inputs"), dict):
        raise RuntimeError("TripoSplat workflow is missing LoadImage node 99.")
    load_image["inputs"]["image"] = uploaded_image_name

    render = workflow.get("75")
    if not isinstance(render, dict) or not isinstance(render.get("inputs"), dict):
        raise RuntimeError("TripoSplat workflow is missing RenderSplat node 75.")
    render["inputs"]["width"] = int(clean(os.environ.get("OTG_CHARACTER_MODEL_SPIN_WIDTH")) or "768")
    render["inputs"]["height"] = int(clean(os.environ.get("OTG_CHARACTER_MODEL_SPIN_HEIGHT")) or "768")
    render["inputs"]["frames"] = int(clean(os.environ.get("OTG_CHARACTER_MODEL_SPIN_FRAMES")) or "150")
    render["inputs"]["background"] = clean(os.environ.get("OTG_CHARACTER_MODEL_SPIN_BACKGROUND")) or "#000000"

    video = workflow.get("41")
    if isinstance(video, dict) and isinstance(video.get("inputs"), dict):
        video["inputs"]["fps"] = int(clean(os.environ.get("OTG_CHARACTER_MODEL_SPIN_FPS")) or "25")

    save_video = workflow.get("42")
    if not isinstance(save_video, dict) or not isinstance(save_video.get("inputs"), dict):
        raise RuntimeError("TripoSplat workflow is missing SaveVideo node 42.")
    save_video["inputs"]["filename_prefix"] = output_prefix
    save_video["inputs"]["format"] = clean(os.environ.get("OTG_CHARACTER_MODEL_SPIN_FORMAT")) or "auto"
    save_video["inputs"]["codec"] = clean(os.environ.get("OTG_CHARACTER_MODEL_SPIN_CODEC")) or "auto"

    save_glb = workflow.get("51")
    if isinstance(save_glb, dict) and isinstance(save_glb.get("inputs"), dict):
        save_glb["inputs"]["filename_prefix"] = output_prefix.replace("video/", "3d/")

    return workflow


def queue_prompt(base_url: str, workflow: Dict[str, Any], client_id: str) -> str:
    data = post_json(
        urllib.parse.urljoin(base_url.rstrip("/") + "/", "prompt"),
        {"prompt": workflow, "client_id": client_id},
        timeout=120,
    )
    prompt_id = clean(data.get("prompt_id"))
    if not prompt_id:
        raise RuntimeError(f"ComfyUI did not return prompt_id: {data}")
    return prompt_id


def poll_history(base_url: str, prompt_id: str, timeout_seconds: int) -> Dict[str, Any]:
    deadline = time.time() + timeout_seconds
    url = urllib.parse.urljoin(base_url.rstrip("/") + "/", f"history/{urllib.parse.quote(prompt_id)}")
    while time.time() < deadline:
        data = get_json(url, timeout=120)
        if prompt_id in data:
            return data[prompt_id]
        time.sleep(5)
    raise RuntimeError(f"Timed out waiting for ComfyUI prompt: {prompt_id}")


def iter_output_files(history: Dict[str, Any]) -> Iterable[Dict[str, Any]]:
    outputs = history.get("outputs") or {}
    if not isinstance(outputs, dict):
        return
    for node_id, node_output in outputs.items():
        if not isinstance(node_output, dict):
            continue
        for key in ("videos", "gifs", "images"):
            items = node_output.get(key)
            if isinstance(items, list):
                for item in items:
                    if isinstance(item, dict):
                        filename = clean(item.get("filename"))
                        if filename.lower().endswith((".mp4", ".mov", ".mkv", ".webm")):
                            out = dict(item)
                            out["_node_id"] = node_id
                            yield out


def download_comfy_file(base_url: str, file_info: Dict[str, Any], target: Path) -> None:
    filename = clean(file_info.get("filename"))
    if not filename:
        raise RuntimeError(f"ComfyUI output is missing filename: {file_info}")

    params = urllib.parse.urlencode({
        "filename": filename,
        "subfolder": clean(file_info.get("subfolder")),
        "type": clean(file_info.get("type")) or "output",
    })
    url = urllib.parse.urljoin(base_url.rstrip("/") + "/", f"view?{params}")
    target.parent.mkdir(parents=True, exist_ok=True)

    with urllib.request.urlopen(url, timeout=600) as response:
        with target.open("wb") as out:
            shutil.copyfileobj(response, out)

    if not has_bytes(target):
        raise RuntimeError(f"Downloaded TripoSplat model-spin output is empty: {target}")


def main() -> int:
    source_image = require_file(require_env("OTG_CHARACTER_MODEL_SPIN_SOURCE_IMAGE"), "model spin source image")
    output_video = Path(require_env("OTG_CHARACTER_MODEL_SPIN_OUTPUT_VIDEO"))
    work_dir = Path(clean(os.environ.get("OTG_CHARACTER_MODEL_SPIN_WORK_DIR")) or output_video.parent)
    work_dir.mkdir(parents=True, exist_ok=True)

    comfy_url = clean(os.environ.get("OTG_CHARACTER_MODEL_SPIN_COMFY_URL") or os.environ.get("OTG_CHARACTER_PREVIEW_COMFY_URL")) or "http://127.0.0.1:8188"
    timeout_seconds = int(clean(os.environ.get("OTG_CHARACTER_MODEL_SPIN_TIMEOUT_SECONDS")) or "3600")
    workflow_path = find_workflow()
    workflow = read_json(workflow_path)

    log(f"[model-spin] ComfyUI: {comfy_url}")
    log(f"[model-spin] workflow: {workflow_path}")
    log(f"[model-spin] source image: {source_image}")
    log(f"[model-spin] output target: {output_video}")

    uploaded_name = multipart_upload_image(comfy_url, source_image)
    prefix = "video/OTG-model-spin-" + uuid.uuid4().hex[:12]
    workflow = patch_workflow(workflow, uploaded_name, prefix)

    patched_workflow_path = work_dir / "model-spin-patched-workflow.json"
    write_json(patched_workflow_path, workflow)

    client_id = "otg-model-spin-" + uuid.uuid4().hex
    prompt_id = queue_prompt(comfy_url, workflow, client_id)
    log(f"[model-spin] prompt_id: {prompt_id}")

    history = poll_history(comfy_url, prompt_id, timeout_seconds)
    history_path = work_dir / "model-spin-history.json"
    write_json(history_path, history)

    outputs = list(iter_output_files(history))
    if not outputs:
        raise RuntimeError(f"ComfyUI history did not contain model-spin video output for prompt {prompt_id}. See {history_path}")

    selected = next((item for item in outputs if clean(item.get("_node_id")) == "42"), outputs[-1])
    download_comfy_file(comfy_url, selected, output_video)

    metadata = {
        "adapter": "otg_triposplat_model_spin",
        "workflowPath": str(workflow_path),
        "patchedWorkflowPath": str(patched_workflow_path),
        "historyPath": str(history_path),
        "promptId": prompt_id,
        "sourceImagePath": str(source_image),
        "modelSpinVideoPath": str(output_video),
        "modelSpinVideoBytes": output_video.stat().st_size,
        "modelSpinVideoSha256": sha256_file(output_video),
    }
    write_json(work_dir / "model-spin-result.json", metadata)

    log("[model-spin] PASS")
    log(json.dumps(metadata, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"[model-spin] FAIL: {error}", flush=True)
        raise
