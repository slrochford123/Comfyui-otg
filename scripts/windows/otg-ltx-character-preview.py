from __future__ import annotations

import hashlib
import json
import mimetypes
import os
import shutil
import subprocess
import sys
import time
import urllib.parse
import urllib.request
import uuid
from pathlib import Path
from typing import Any, Dict, Iterable, Optional, Tuple


DEFAULT_PREVIEW_SCRIPT = (
    "Hello, I am your created character. This is a voice dub test so you can "
    "hear the texture and sound of your created character."
)


def log(message: str) -> None:
    print(message, flush=True)


def clean(value: Any) -> str:
    return str(value or "").strip()


def require_env(name: str) -> str:
    value = clean(os.environ.get(name))
    if not value:
        raise RuntimeError(f"{name} is required.")
    return value


def require_file(path: str, label: str) -> Path:
    resolved = Path(path)
    if not resolved.is_file():
        raise RuntimeError(f"{label} does not exist: {resolved}")
    if resolved.stat().st_size <= 0:
        raise RuntimeError(f"{label} is empty: {resolved}")
    return resolved


def has_bytes(path: Path) -> bool:
    return path.is_file() and path.stat().st_size > 0


def read_json(path: Path) -> Dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


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
    explicit = clean(os.environ.get("OTG_CHARACTER_PREVIEW_LTX_WORKFLOW"))
    candidates = []
    if explicit:
        candidates.append(Path(explicit))

    repo = Path(clean(os.environ.get("OTG_REPO")) or r"C:\AI\OTG-Test2")
    candidates.extend(
        [
            repo / "comfy_workflows" / "presets" / "Create a Video from Images.json",
            repo / "comfy_workflows" / "presets" / "Create a Video from Pictures.json",
            repo / "comfy_workflows" / "internal" / "production" / "production_ltx23_ia2v_lipsync_api_template.json",
            repo / "comfy_workflows" / "internal" / "characters" / "character_intro_video_ltx23.json",
        ]
    )

    for candidate in candidates:
        if candidate.is_file():
            return candidate

    searched = "\n".join(str(p) for p in candidates)
    raise RuntimeError(f"LTX workflow JSON not found. Searched:\n{searched}")


def build_prompt(script: str) -> str:
    script = clean(script) or DEFAULT_PREVIEW_SCRIPT
    return (
        "Style: cinematic-realistic vertical 9:16 portrait character preview. A single created character "
        "from the reference portrait stands facing the camera in a simple neutral studio setting with soft "
        "lighting. Use portrait/full-body framing with the whole character visible from head to feet when "
        "possible, centered in frame, no horizontal landscape crop, no close-up torso-only crop. "
        "The character makes subtle natural body movement, gentle breathing, small head movement, "
        "and speaks clearly to camera. The audio contains the character speaking exactly: "
        f"\"{script}\" "
        "Use clean synchronized speech audio, natural pacing, clear diction, no music, no singing, "
        "no background crowd, no subtitles, no watermark, no extra characters, no scene cuts."
    )


def multipart_upload_image(base_url: str, image_path: Path) -> str:
    boundary = "----otg-ltx-preview-" + uuid.uuid4().hex
    mime = mimetypes.guess_type(str(image_path))[0] or "application/octet-stream"

    parts = []

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

    body = b"".join(parts)
    req = urllib.request.Request(
        urllib.parse.urljoin(base_url.rstrip("/") + "/", "upload/image"),
        data=body,
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


def patch_workflow(workflow: Dict[str, Any], uploaded_image_name: str, prompt: str, output_prefix: str) -> Dict[str, Any]:
    # Known LTX 2.3 v1.1 workflow nodes from the uploaded preset:
    # 187 and 411 are LoadImage, 767 is Text Prompt, 180 is VHS_VideoCombine.
    for node_id in ("187", "411"):
        node = workflow.get(node_id)
        if isinstance(node, dict) and isinstance(node.get("inputs"), dict):
            node["inputs"]["image"] = uploaded_image_name

    prompt_node = workflow.get("767")
    if isinstance(prompt_node, dict) and isinstance(prompt_node.get("inputs"), dict):
        prompt_node["inputs"]["value"] = prompt
    else:
        raise RuntimeError("Workflow is missing node 767 Text Prompt.")

    video_node = workflow.get("180")
    if isinstance(video_node, dict) and isinstance(video_node.get("inputs"), dict):
        video_node["inputs"]["filename_prefix"] = output_prefix
        video_node["inputs"]["format"] = "video/h264-mp4"
        video_node["inputs"]["save_output"] = True
        video_node["inputs"]["trim_to_audio"] = False
    else:
        raise RuntimeError("Workflow is missing node 180 VHS_VideoCombine.")

    # Character previews must default to vertical portrait video.
    # Nodes 199/200 are the known width/height controls in the uploaded LTX 2.3 v1.1 workflow.
    # Env vars remain available for explicit test overrides.
    width = clean(os.environ.get("OTG_CHARACTER_PREVIEW_LTX_WIDTH")) or "720"
    height = clean(os.environ.get("OTG_CHARACTER_PREVIEW_LTX_HEIGHT")) or "1280"
    frames = clean(os.environ.get("OTG_CHARACTER_PREVIEW_LTX_FRAMES"))
    steps = clean(os.environ.get("OTG_CHARACTER_PREVIEW_LTX_STEPS"))

    if "199" in workflow:
        workflow["199"]["inputs"]["value"] = int(width)
    if "200" in workflow:
        workflow["200"]["inputs"]["value"] = int(height)
    if frames and "1175" in workflow:
        workflow["1175"]["inputs"]["value"] = int(frames)
    if steps and "816" in workflow:
        workflow["816"]["inputs"]["value"] = int(steps)

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
    for node_output in outputs.values():
        if not isinstance(node_output, dict):
            continue
        for key in ("videos", "gifs", "images"):
            items = node_output.get(key)
            if isinstance(items, list):
                for item in items:
                    if isinstance(item, dict):
                        filename = clean(item.get("filename"))
                        if filename.lower().endswith((".mp4", ".mov", ".mkv", ".webm")):
                            yield item


def download_comfy_file(base_url: str, file_info: Dict[str, Any], target: Path) -> None:
    filename = clean(file_info.get("filename"))
    if not filename:
        raise RuntimeError(f"ComfyUI output is missing filename: {file_info}")

    params = urllib.parse.urlencode(
        {
            "filename": filename,
            "subfolder": clean(file_info.get("subfolder")),
            "type": clean(file_info.get("type")) or "output",
        }
    )
    url = urllib.parse.urljoin(base_url.rstrip("/") + "/", f"view?{params}")
    target.parent.mkdir(parents=True, exist_ok=True)

    with urllib.request.urlopen(url, timeout=600) as response:
        with target.open("wb") as out:
            shutil.copyfileobj(response, out)

    if not has_bytes(target):
        raise RuntimeError(f"Downloaded ComfyUI output is empty: {target}")


def run_command(args: list[str], label: str) -> None:
    log("[run] " + " ".join(args))
    process = subprocess.run(args, text=True, capture_output=True)
    if process.stdout:
        log(process.stdout)
    if process.stderr:
        log(process.stderr)
    if process.returncode != 0:
        raise RuntimeError(f"{label} failed with exit code {process.returncode}")


def ffprobe_has_audio(video_path: Path) -> bool:
    args = [
        "ffprobe",
        "-v",
        "error",
        "-select_streams",
        "a:0",
        "-show_entries",
        "stream=codec_type",
        "-of",
        "json",
        str(video_path),
    ]
    process = subprocess.run(args, text=True, capture_output=True)
    if process.returncode != 0:
        return False
    try:
        data = json.loads(process.stdout or "{}")
    except json.JSONDecodeError:
        return False
    streams = data.get("streams") or []
    return bool(streams)


def extract_audio(raw_video: Path, audio_out: Path) -> None:
    if not ffprobe_has_audio(raw_video):
        raise RuntimeError(f"LTX raw preview video has no audio stream: {raw_video}")

    audio_out.parent.mkdir(parents=True, exist_ok=True)
    args = [
        "ffmpeg",
        "-y",
        "-i",
        str(raw_video),
        "-vn",
        "-ac",
        "1",
        "-ar",
        "44100",
        "-sample_fmt",
        "s16",
        str(audio_out),
    ]
    run_command(args, "FFmpeg audio extraction")
    if not has_bytes(audio_out):
        raise RuntimeError(f"Extracted LTX source audio is empty: {audio_out}")


def main() -> int:
    source_image = require_file(require_env("OTG_CHARACTER_PREVIEW_SOURCE_IMAGE"), "source image")
    raw_video = Path(require_env("OTG_CHARACTER_PREVIEW_RAW_VIDEO"))
    guide_audio_value = clean(os.environ.get("OTG_CHARACTER_PREVIEW_GUIDE_AUDIO"))
    guide_audio = Path(guide_audio_value) if guide_audio_value else None

    script = clean(os.environ.get("OTG_CHARACTER_PREVIEW_SCRIPT")) or DEFAULT_PREVIEW_SCRIPT
    comfy_url = clean(os.environ.get("OTG_CHARACTER_PREVIEW_COMFY_URL")) or "http://127.0.0.1:8188"
    timeout_seconds = int(clean(os.environ.get("OTG_CHARACTER_PREVIEW_LTX_TIMEOUT_SECONDS")) or "3600")

    workflow_path = find_workflow()
    workflow = read_json(workflow_path)

    work_dir = Path(clean(os.environ.get("OTG_CHARACTER_PREVIEW_WORK_DIR")) or raw_video.parent)
    work_dir.mkdir(parents=True, exist_ok=True)

    prompt = build_prompt(script)
    prompt_record = work_dir / "ltx-prompt.txt"
    prompt_record.write_text(prompt, encoding="utf-8")

    log(f"[ltx] ComfyUI: {comfy_url}")
    log(f"[ltx] workflow: {workflow_path}")
    log(f"[ltx] source image: {source_image}")
    log(f"[ltx] raw video target: {raw_video}")

    uploaded_name = multipart_upload_image(comfy_url, source_image)
    log(f"[ltx] uploaded image name: {uploaded_name}")

    prefix = "OTG-character-preview-" + uuid.uuid4().hex[:12]
    workflow = patch_workflow(workflow, uploaded_name, prompt, prefix)

    patched_workflow_path = work_dir / "ltx-patched-workflow.json"
    write_json(patched_workflow_path, workflow)

    client_id = "otg-character-preview-" + uuid.uuid4().hex
    prompt_id = queue_prompt(comfy_url, workflow, client_id)
    log(f"[ltx] prompt_id: {prompt_id}")

    history = poll_history(comfy_url, prompt_id, timeout_seconds)
    history_path = work_dir / "ltx-history.json"
    write_json(history_path, history)

    outputs = list(iter_output_files(history))
    if not outputs:
        raise RuntimeError(f"ComfyUI history did not contain an MP4 output for prompt {prompt_id}. See {history_path}")

    # Prefer the newest listed MP4 from the final combine node when possible.
    selected = outputs[-1]
    download_comfy_file(comfy_url, selected, raw_video)

    if not has_bytes(raw_video):
        raise RuntimeError(f"LTX raw preview video missing or empty: {raw_video}")

    if guide_audio:
        log(f"[ltx] extracting LTX-generated source audio to: {guide_audio}")
        extract_audio(raw_video, guide_audio)

    metadata = {
        "adapter": "otg_ltx_character_preview",
        "workflowPath": str(workflow_path),
        "patchedWorkflowPath": str(patched_workflow_path),
        "historyPath": str(history_path),
        "promptPath": str(prompt_record),
        "promptId": prompt_id,
        "sourceImagePath": str(source_image),
        "rawPreviewVideoPath": str(raw_video),
        "rawPreviewVideoBytes": raw_video.stat().st_size,
        "guideAudioPath": str(guide_audio) if guide_audio else None,
        "guideAudioBytes": guide_audio.stat().st_size if guide_audio and guide_audio.exists() else None,
        "rawPreviewVideoSha256": sha256_file(raw_video),
    }
    write_json(work_dir / "ltx-character-preview-result.json", metadata)

    log("[ltx] PASS")
    log(json.dumps(metadata, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"[ltx] FAIL: {error}", file=sys.stderr, flush=True)
        raise

