#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from urllib.parse import urlparse
from pathlib import Path
from typing import Any, Dict


PREVIEW_SCRIPT = "Hello, I am your created character. This is a voice dub test so you can hear the texture and sound of your created character."


def clean(value: Any) -> str:
    return str(value or "").strip()



def normalize_qwen_synthesize_url(url: str) -> str:
    value = clean(url)
    if not value:
        return "http://127.0.0.1:7863/synthesize"

    parsed = urlparse(value)
    if parsed.scheme in {"http", "https"} and parsed.netloc and parsed.path.strip("/") == "":
        return value.rstrip("/") + "/synthesize"

    return value
def has_bytes(path: Path) -> bool:
    try:
        return path.is_file() and path.stat().st_size > 0
    except OSError:
        return False


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def write_json(path: Path, data: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + f".{os.getpid()}.tmp")
    tmp.write_text(json.dumps(data, indent=2), encoding="utf-8")
    tmp.replace(path)


def read_json(path: Path) -> Dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def append_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8", errors="replace") as handle:
        handle.write(text)


def require_env_path(name: str, must_exist: bool = True) -> Path:
    value = clean(os.environ.get(name))
    if not value:
        raise RuntimeError(f"{name} is required.")
    path = Path(value)
    if must_exist and not has_bytes(path):
        raise RuntimeError(f"{name} is missing or empty: {path}")
    return path


def run_shell_command(command: str, cwd: Path, env: Dict[str, str], stdout_path: Path, stderr_path: Path, timeout_seconds: int, stage: str) -> None:
    stdout_path.parent.mkdir(parents=True, exist_ok=True)
    stderr_path.parent.mkdir(parents=True, exist_ok=True)

    append_text(stdout_path, f"\n[{time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}] START {stage}: {command}\n")

    stderr_start = stderr_path.stat().st_size if stderr_path.exists() else 0

    with stdout_path.open("a", encoding="utf-8", errors="replace") as stdout_handle, stderr_path.open("a", encoding="utf-8", errors="replace") as stderr_handle:
        proc = subprocess.Popen(
            command,
            cwd=str(cwd),
            env=env,
            stdout=stdout_handle,
            stderr=stderr_handle,
            shell=True,
            text=True,
        )

        started = time.time()
        while proc.poll() is None:
            if time.time() - started > timeout_seconds:
                if os.name == "nt":
                    subprocess.run(
                        ["taskkill", "/PID", str(proc.pid), "/T", "/F"],
                        stdout=subprocess.DEVNULL,
                        stderr=subprocess.DEVNULL,
                        check=False,
                    )
                else:
                    proc.kill()
                raise RuntimeError(f"{stage} timed out after {timeout_seconds}s.")
            time.sleep(0.25)

        return_code = proc.returncode

    append_text(stdout_path, f"\nEXIT {stage}: {return_code}\n")

    stderr_text = ""
    try:
        with stderr_path.open("rb") as stderr_read:
            stderr_read.seek(stderr_start)
            stderr_text = stderr_read.read().decode("utf-8", errors="replace")
    except OSError:
        stderr_text = ""

    if return_code != 0:
        raise RuntimeError(f"{stage} failed with exit code {return_code}. stdout={stdout_path}; stderr={stderr_path}")

    if "Traceback (most recent call last)" in stderr_text or "ValueError:" in stderr_text:
        raise RuntimeError(f"{stage} reported a traceback. stdout={stdout_path}; stderr={stderr_path}")

def post_form(url: str, fields: Dict[str, str], timeout_seconds: int) -> Dict[str, Any]:
    body = urllib.parse.urlencode(fields).encode("utf-8")
    req = urllib.request.Request(url, data=body, headers={"content-type": "application/x-www-form-urlencoded"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout_seconds) as response:
            raw = response.read().decode("utf-8", errors="replace")
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as error:
        raw = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {error.code} {url}: {raw}") from error


def generate_guide_audio(work_dir: Path, script: str, guide_audio: Path, logs: Dict[str, Path]) -> str:
    tts_command = clean(os.environ.get("OTG_CHARACTER_PREVIEW_TTS_COMMAND"))
    env = os.environ.copy()
    env.update({
        "OTG_CHARACTER_PREVIEW_SCRIPT": script,
        "OTG_CHARACTER_PREVIEW_GUIDE_AUDIO": str(guide_audio),
    })
    if tts_command:
        run_shell_command(
            tts_command,
            work_dir,
            env,
            logs["stdout"],
            logs["stderr"],
            int(os.environ.get("OTG_CHARACTER_PREVIEW_TTS_TIMEOUT_SECONDS", "900")),
            "tts",
        )
        provider = "command"
    else:
        qwen_url = normalize_qwen_synthesize_url(os.environ.get("QWEN3_TTS_API_URL") or os.environ.get("QWEN3_TTS_URL") or "http://127.0.0.1:7863/synthesize")
        response = post_form(qwen_url, {
            "text": script,
            "output_path": str(guide_audio),
            "language": os.environ.get("QWEN3_TTS_LANGUAGE", "English"),
            "speaker": os.environ.get("QWEN3_TTS_PREVIEW_SPEAKER", "Ryan"),
            "instruct": os.environ.get("OTG_CHARACTER_PREVIEW_TTS_INSTRUCT", "Create a clear neutral guide narration voice for voice conversion."),
        }, int(os.environ.get("OTG_CHARACTER_PREVIEW_TTS_TIMEOUT_SECONDS", "900")))
        if response.get("ok") is not True:
            raise RuntimeError(f"Qwen3 TTS API failed: {response}")
        provider = "qwen3_tts_api"
    if not has_bytes(guide_audio):
        raise RuntimeError(f"Guide TTS did not write audio: {guide_audio}")
    return provider


def generate_ltx_video(work_dir: Path, source_image: Path, guide_audio: Path, raw_video: Path, script: str, logs: Dict[str, Path]) -> None:
    command = clean(os.environ.get("OTG_CHARACTER_PREVIEW_LTX_COMMAND"))
    if not command:
        raise RuntimeError("Character preview LTX command is not configured.")
    env = os.environ.copy()
    env.update({
        "OTG_CHARACTER_PREVIEW_SOURCE_IMAGE": str(source_image),
        "OTG_CHARACTER_PREVIEW_GUIDE_AUDIO": str(guide_audio),
        "OTG_CHARACTER_PREVIEW_RAW_VIDEO": str(raw_video),
        "OTG_CHARACTER_PREVIEW_SCRIPT": script,
    })
    run_shell_command(
        command,
        work_dir,
        env,
        logs["stdout"],
        logs["stderr"],
        int(os.environ.get("OTG_CHARACTER_PREVIEW_LTX_TIMEOUT_SECONDS", "1800")),
        "ltx",
    )
    if not has_bytes(raw_video):
        raise RuntimeError(f"LTX preview video was not written: {raw_video}")

def generate_model_spin(work_dir: Path, source_image: Path, model_spin_video: Path, logs: Dict[str, Path]) -> None:
    command = clean(os.environ.get("OTG_CHARACTER_MODEL_SPIN_COMMAND"))
    if not command:
        repo = Path(clean(os.environ.get("OTG_REPO")) or r"C:\AI\OTG-Test2")
        ps1 = repo / "scripts" / "windows" / "otg-triposplat-model-spin.ps1"
        command = f'powershell -NoProfile -ExecutionPolicy Bypass -File "{ps1}"'

    env = os.environ.copy()
    env.update({
        "OTG_CHARACTER_MODEL_SPIN_SOURCE_IMAGE": str(source_image),
        "OTG_CHARACTER_MODEL_SPIN_OUTPUT_VIDEO": str(model_spin_video),
        "OTG_CHARACTER_MODEL_SPIN_WORK_DIR": str(work_dir),
    })

    run_shell_command(
        command,
        work_dir,
        env,
        logs["stdout"],
        logs["stderr"],
        int(os.environ.get("OTG_CHARACTER_MODEL_SPIN_TIMEOUT_SECONDS", "3600")),
        "model_spin",
    )

    if not has_bytes(model_spin_video):
        raise RuntimeError(f"TripoSplat model spin video was not written: {model_spin_video}")


def infer_script_from_env(applio_root: Path) -> Path:
    explicit = clean(os.environ.get("APPLIO_INFER_SCRIPT"))
    if explicit:
        explicit_path = Path(explicit)
        if explicit_path.exists():
            return explicit_path
    core = applio_root / "core.py"
    if core.exists():
        return core
    raise RuntimeError(f"APPLIO_INFER_SCRIPT is not set and APPLIO_ROOT/core.py was not found: {core}")


def convert_voice(work_dir: Path, guide_audio: Path, dubbed_audio: Path, model_path: Path, index_path: Path, logs: Dict[str, Path]) -> None:
    command = clean(os.environ.get("OTG_CHARACTER_PREVIEW_APPLIO_COMMAND"))
    env = os.environ.copy()
    env.update({
        "OTG_CHARACTER_PREVIEW_GUIDE_AUDIO": str(guide_audio),
        "OTG_CHARACTER_PREVIEW_DUBBED_AUDIO": str(dubbed_audio),
        "OTG_CHARACTER_PREVIEW_TRAINED_MODEL": str(model_path),
        "OTG_CHARACTER_PREVIEW_TRAINED_INDEX": str(index_path),
    })
    if command:
        run_shell_command(
            command,
            work_dir,
            env,
            logs["stdout"],
            logs["stderr"],
            int(os.environ.get("OTG_CHARACTER_PREVIEW_APPLIO_TIMEOUT_SECONDS", "900")),
            "applio",
        )
    else:
        applio_root = Path(clean(os.environ.get("APPLIO_ROOT")) or r"C:\AI\Voices\Applio")
        python = Path(clean(os.environ.get("APPLIO_PYTHON")) or r"C:\AI\Voices\Applio\env\python.exe")
        infer_script = infer_script_from_env(applio_root)
        if not python.exists():
            raise RuntimeError(f"APPLIO_PYTHON does not exist: {python}")
        args = [
            str(python),
            str(infer_script),
            "infer",
            "--pitch", clean(os.environ.get("APPLIO_INFER_PITCH")) or "0",
            "--index_rate", clean(os.environ.get("APPLIO_INFER_INDEX_RATE")) or "0.75",
            "--volume_envelope", "1",
            "--protect", clean(os.environ.get("APPLIO_INFER_PROTECT")) or "0.33",
            "--f0_method", clean(os.environ.get("APPLIO_INFER_F0_METHOD")) or "rmvpe",
            "--input_path", str(guide_audio),
            "--output_path", str(dubbed_audio),
            "--pth_path", str(model_path),
            "--index_path", str(index_path),
            "--split_audio", "False",
            "--f0_autotune", "False",
            "--clean_audio", "False",
            "--export_format", "WAV",
            "--embedder_model", "contentvec",
        ]
        run_shell_command(
            subprocess.list2cmdline(args),
            applio_root,
            env,
            logs["stdout"],
            logs["stderr"],
            int(os.environ.get("OTG_CHARACTER_PREVIEW_APPLIO_TIMEOUT_SECONDS", "900")),
            "applio",
        )
    if not has_bytes(dubbed_audio):
        raise RuntimeError(f"Applio did not write dubbed audio: {dubbed_audio}")
    if sha256(guide_audio) == sha256(dubbed_audio):
        raise RuntimeError("Applio dubbed audio is byte-identical to the guide audio.")


def mux_video(work_dir: Path, raw_video: Path, dubbed_audio: Path, final_video: Path, logs: Dict[str, Path]) -> None:
    ffmpeg = clean(os.environ.get("FFMPEG_PATH") or os.environ.get("OTG_FFMPEG_PATH") or "ffmpeg")
    args = [
        ffmpeg,
        "-y",
        "-i", str(raw_video),
        "-i", str(dubbed_audio),
        "-map", "0:v:0",
        "-map", "1:a:0",
        "-c:v", "copy",
        "-c:a", "aac",
        "-shortest",
        str(final_video),
    ]
    run_shell_command(
        subprocess.list2cmdline(args),
        work_dir,
        os.environ.copy(),
        logs["stdout"],
        logs["stderr"],
        int(os.environ.get("OTG_CHARACTER_PREVIEW_MUX_TIMEOUT_SECONDS", "600")),
        "ffmpeg_mux",
    )
    if not has_bytes(final_video):
        raise RuntimeError(f"FFmpeg did not write final dubbed preview video: {final_video}")


def preview_file_url(owner_key: str, character_id: str, job_id: str) -> str:
    return (
        "/api/characters/character-preview/file"
        f"?owner={urllib.parse.quote(owner_key)}"
        f"&characterId={urllib.parse.quote(character_id)}"
        f"&jobId={urllib.parse.quote(job_id)}"
        "&file=dubbed-preview.mp4"
    )


def main() -> int:
    job_json = require_env_path("OTG_CHARACTER_PREVIEW_JOB_JSON")
    result_json = require_env_path("OTG_CHARACTER_PREVIEW_RESULT_JSON", must_exist=False)
    work_dir = Path(clean(os.environ.get("OTG_CHARACTER_PREVIEW_WORK_DIR")) or result_json.parent)
    script = clean(os.environ.get("OTG_CHARACTER_PREVIEW_SCRIPT")) or PREVIEW_SCRIPT
    payload = read_json(job_json)
    input_data = payload.get("input") if isinstance(payload.get("input"), dict) else {}
    owner_key = clean(payload.get("ownerKey"))
    character_id = clean(payload.get("characterId"))
    job_id = clean(payload.get("jobId"))
    if not owner_key or not character_id or not job_id:
        raise RuntimeError("Character preview adapter input is missing ownerKey, characterId, or jobId.")

    source_image = Path(clean(input_data.get("sourceImagePath")))
    model_path = Path(clean(input_data.get("trainedModelPath") or input_data.get("modelPath")))
    index_path = Path(clean(input_data.get("trainedIndexPath") or input_data.get("indexPath")))
    if not has_bytes(source_image):
        raise RuntimeError("Character source image is missing. Cannot generate preview.")
    if not has_bytes(model_path):
        raise RuntimeError(f"Trained Applio .pth model is missing or empty: {model_path}")
    if not has_bytes(index_path):
        raise RuntimeError(f"Trained Applio .index is missing or empty: {index_path}")

    work_dir.mkdir(parents=True, exist_ok=True)
    logs_dir = work_dir / "logs"
    logs_dir.mkdir(parents=True, exist_ok=True)
    logs = {
        "stdout": logs_dir / "character-preview-adapter-stdout.log",
        "stderr": logs_dir / "character-preview-adapter-stderr.log",
    }
    guide_audio = work_dir / "guide.wav"
    raw_video = work_dir / "raw-preview.mp4"
    dubbed_audio = work_dir / "dubbed.wav"
    final_video = work_dir / "dubbed-preview.mp4"
    model_spin_video = work_dir / "model-spin.mp4"

    guide_provider = generate_guide_audio(work_dir, script, guide_audio, logs)
    generate_ltx_video(work_dir, source_image, guide_audio, raw_video, script, logs)
    convert_voice(work_dir, guide_audio, dubbed_audio, model_path, index_path, logs)
    mux_video(work_dir, raw_video, dubbed_audio, final_video, logs)
    generate_model_spin(work_dir, source_image, model_spin_video, logs)

    result = {
        "adapter": "character_preview_dub_adapter",
        "mock": False,
        "provider": "character_preview_dub",
        "sourceImagePath": str(source_image),
        "sourceImageUrl": clean(input_data.get("sourceImageUrl")),
        "previewScript": script,
        "guideAudioPath": str(guide_audio),
        "guideAudioUrl": preview_file_url(owner_key, character_id, job_id).replace("file=dubbed-preview.mp4", "file=guide.wav"),
        "guideTtsProvider": guide_provider,
        "rawPreviewVideoPath": str(raw_video),
        "rawPreviewVideoUrl": preview_file_url(owner_key, character_id, job_id).replace("file=dubbed-preview.mp4", "file=raw-preview.mp4"),
        "modelSpinVideoPath": str(model_spin_video),
        "modelSpinVideoUrl": preview_file_url(owner_key, character_id, job_id).replace("file=dubbed-preview.mp4", "file=model-spin.mp4"),
        "modelSpinVideoBytes": model_spin_video.stat().st_size,
        "dubbedAudioPath": str(dubbed_audio),
        "dubbedAudioUrl": preview_file_url(owner_key, character_id, job_id).replace("file=dubbed-preview.mp4", "file=dubbed-audio.wav"),
        "dubbedPreviewVideoPath": str(final_video),
        "dubbedPreviewVideoUrl": preview_file_url(owner_key, character_id, job_id),
        "trainedModelPath": str(model_path),
        "trainedIndexPath": str(index_path),
        "outputBytes": final_video.stat().st_size,
        "currentStage": "completed",
        "stdoutPath": str(logs["stdout"]),
        "stderrPath": str(logs["stderr"]),
    }
    write_json(result_json, result)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(str(error), file=sys.stderr, flush=True)
        raise SystemExit(1)



