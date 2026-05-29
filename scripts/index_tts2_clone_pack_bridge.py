#!/usr/bin/env python3
"""
IndexTTS2 strict same-speaker clone bridge for OTG voice-pack generation.

Purpose:
- Use the approved character reference voice as the only speaker identity source.
- Generate training clips with different phrases/emotions while preserving the exact same speaker.
- Never redesign the speaker per clip.
- Never use random sampling, because IndexTTS2 docs warn random sampling can reduce cloning fidelity.

Expected behavior:
- Input may be JSON via --input-json/--request-json/--request/--payload/stdin, or loose CLI args.
- Output is JSON to stdout.
- Existing OTG workers that call Cosy/Qwen pack bridges are redirected to this bridge by proxy wrappers.
"""

from __future__ import annotations

# OTG_INDEXTTS2_UTF8_STDIO_PATCH_V2
# Windows-safe UTF-8 stdout/stderr for IndexTTS2.
# IndexTTS2 / tokenizer internals may print unicode token markers such as U+2581.
# Without this, Python can die under cp1252/charmap stdout.
import os as _otg_utf8_os
import sys as _otg_utf8_sys

_otg_utf8_os.environ.setdefault("PYTHONUTF8", "1")
_otg_utf8_os.environ.setdefault("PYTHONIOENCODING", "utf-8")

for _otg_stream_name in ("stdout", "stderr"):
    _otg_stream = getattr(_otg_utf8_sys, _otg_stream_name, None)
    if _otg_stream is not None and hasattr(_otg_stream, "reconfigure"):
        try:
            _otg_stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import traceback
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

DEFAULT_INDEX_ROOT = r"C:\AI\Voices\IndexTTS2"
DEFAULT_INDEX_PYTHON = r"C:\AI\Voices\IndexTTS2\.venv\Scripts\python.exe"
DEFAULT_INDEX_CFG = r"C:\AI\Voices\IndexTTS2\checkpoints\config.yaml"
DEFAULT_INDEX_MODEL_DIR = r"C:\AI\Voices\IndexTTS2\checkpoints"

SPEAKER_LOCK = (
    "STRICT_SAME_SPEAKER_CLONE: Use the provided reference.wav as the exact speaker identity. "
    "Preserve the same timbre, vocal texture, accent, vocal age, resonance, pitch range, and microphone character. "
    "Do not invent, redesign, reinterpret, or vary the speaker. Only vary the requested phrase and delivery."
)

DELIVERY_EMOTIONS = [
    ("neutral", [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0]),
    ("happy", [0.75, 0.0, 0.0, 0.0, 0.0, 0.0, 0.15, 0.25]),
    ("excited", [0.85, 0.0, 0.0, 0.0, 0.0, 0.0, 0.35, 0.15]),
    ("sad", [0.0, 0.0, 0.85, 0.0, 0.0, 0.25, 0.0, 0.2]),
    ("angry", [0.0, 0.85, 0.0, 0.0, 0.05, 0.0, 0.0, 0.1]),
    ("afraid", [0.0, 0.0, 0.1, 0.85, 0.0, 0.0, 0.25, 0.1]),
    ("whisper", [0.0, 0.0, 0.15, 0.1, 0.0, 0.15, 0.0, 0.7]),
    ("yelling", [0.1, 0.65, 0.0, 0.1, 0.0, 0.0, 0.35, 0.0]),
    ("fast", [0.25, 0.0, 0.0, 0.0, 0.0, 0.0, 0.25, 0.5]),
    ("slow", [0.0, 0.0, 0.15, 0.0, 0.0, 0.15, 0.0, 0.75]),
    ("serious", [0.0, 0.15, 0.0, 0.0, 0.0, 0.15, 0.0, 0.7]),
    ("warm", [0.45, 0.0, 0.0, 0.0, 0.0, 0.05, 0.0, 0.65]),
]

DEFAULT_PHRASES = [
    "I know exactly what happened here.",
    "This does not change the plan.",
    "We need to move before they notice us.",
    "I did not expect it to end like this.",
    "Keep your voice down and listen carefully.",
    "That was the first mistake.",
    "I can feel the pressure building.",
    "No one gets left behind.",
    "Tell me the truth this time.",
    "Everything depends on this moment.",
    "I remember the sound of the rain.",
    "You are not seeing the whole picture.",
    "This room feels colder than before.",
    "Do not make me repeat myself.",
    "We have one chance to get this right.",
    "I never said it would be easy.",
    "Step back and let me handle this.",
    "There is something wrong with that signal.",
    "I have been waiting for this answer.",
    "The choice is yours now.",
]

def eprint(*args: Any) -> None:
    print(*args, file=sys.stderr, flush=True)

def load_json_file(path: Path) -> Any:
    # Windows PowerShell 5 may write JSON with a UTF-8 BOM.
    # utf-8-sig accepts both BOM and non-BOM UTF-8.
    with path.open("r", encoding="utf-8-sig") as f:
        return json.load(f)

def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2), encoding="utf-8")

def normalize_path(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip().strip('"')

def pick_first_existing_path(payload: Dict[str, Any], keys: List[str]) -> str:
    for key in keys:
        value = normalize_path(payload.get(key))
        if value and Path(value).exists():
            return str(Path(value).resolve())
    return ""

def parse_unknown_args(argv: List[str]) -> Dict[str, str]:
    out: Dict[str, str] = {}
    i = 0
    while i < len(argv):
        token = argv[i]
        if token.startswith("--"):
            key = token[2:].replace("-", "_")
            if i + 1 < len(argv) and not argv[i + 1].startswith("--"):
                out[key] = argv[i + 1]
                i += 2
            else:
                out[key] = "1"
                i += 1
        else:
            i += 1
    return out

def read_payload(args: argparse.Namespace, unknown: Dict[str, str]) -> Dict[str, Any]:
    candidates = [
        args.params_json,
        args.input_json,
        args.request_json,
        args.request,
        args.payload,
        unknown.get("params_json"),
        unknown.get("input_json"),
        unknown.get("request_json"),
        unknown.get("request"),
        unknown.get("payload"),
        unknown.get("manifest"),
    ]

    for candidate in candidates:
        if candidate:
            p = Path(candidate)
            if p.exists() and p.is_file():
                data = load_json_file(p)
                if isinstance(data, dict):
                    data.setdefault("__input_json_path", str(p.resolve()))
                    return data

    if not sys.stdin.isatty():
        raw = sys.stdin.read().strip()
        if raw:
            data = json.loads(raw)
            if isinstance(data, dict):
                return data

    return {}

def safe_clip_id(value: Any, index: int) -> str:
    raw = normalize_path(value) or f"clip_{index + 1:03d}"
    base = re.sub(r"[^a-zA-Z0-9_-]+", "_", raw).strip("_")
    return base or f"clip_{index + 1:03d}"

def collect_clips(payload: Dict[str, Any], unknown: Dict[str, str], output_dir: Path) -> List[Dict[str, Any]]:
    raw = (
        payload.get("clips")
        or payload.get("items")
        or payload.get("tasks")
        or payload.get("utterances")
        or payload.get("segments")
        or []
    )

    clips: List[Dict[str, Any]] = []

    if isinstance(raw, list):
        for index, item in enumerate(raw):
            if isinstance(item, str):
                item = {"text": item}
            if not isinstance(item, dict):
                continue

            clip_id = safe_clip_id(item.get("id") or item.get("clipId") or item.get("clip_id") or item.get("name"), index)
            text = normalize_path(item.get("text") or item.get("phrase") or item.get("transcript") or item.get("line"))
            if not text:
                continue

            delivery = normalize_path(item.get("delivery") or item.get("emotion") or item.get("style") or item.get("tone"))
            output_path = normalize_path(
                item.get("outputPath")
                or item.get("output_path")
                or item.get("outputWav")
                or item.get("output_wav")
                or item.get("path")
                or item.get("wavPath")
            )

            if not output_path:
                output_path = str(output_dir / "clips" / f"{clip_id}.wav")

            clips.append({
                "id": clip_id,
                "text": text,
                "delivery": delivery or DELIVERY_EMOTIONS[index % len(DELIVERY_EMOTIONS)][0],
                "outputPath": output_path,
            })

    if clips:
        return clips

    count = int(payload.get("count") or payload.get("clipCount") or unknown.get("count") or 200)
    count = max(1, min(count, 2000))

    for index in range(count):
        phrase = DEFAULT_PHRASES[index % len(DEFAULT_PHRASES)]
        delivery = DELIVERY_EMOTIONS[index % len(DELIVERY_EMOTIONS)][0]
        clip_id = f"clip_{index + 1:03d}"
        clips.append({
            "id": clip_id,
            "text": phrase,
            "delivery": delivery,
            "outputPath": str(output_dir / "clips" / f"{clip_id}.wav"),
        })

    return clips

def emotion_vector(delivery: str) -> List[float]:
    key = delivery.lower().strip()
    for name, vector in DELIVERY_EMOTIONS:
        if name in key:
            return vector
    return DELIVERY_EMOTIONS[0][1]

def resolve_reference(payload: Dict[str, Any], unknown: Dict[str, str]) -> str:
    keys = [
        "referenceWav",
        "reference_wav",
        "referenceAudio",
        "referenceAudioPath",
        "sourceWav",
        "source_wav",
        "sourcePath",
        "sourceAudioPath",
        "promptWav",
        "prompt_wav",
        "speakerWav",
        "speaker_wav",
        "approvedSamplePath",
        "approvedVoicePath",
    ]

    cli_keys = [
        "reference_wav",
        "reference",
        "source_wav",
        "source",
        "prompt_wav",
        "speaker_wav",
        "approved_sample_path",
    ]

    for key in cli_keys:
        value = normalize_path(unknown.get(key))
        if value and Path(value).exists():
            return str(Path(value).resolve())

    value = pick_first_existing_path(payload, keys)
    if value:
        return value

    input_path = payload.get("__input_json_path")
    if input_path:
        base = Path(input_path).resolve().parent
        possible = [
            base / "source" / "source.wav",
            base / "reference.wav",
            base / "source.wav",
            base.parent / "source" / "source.wav",
        ]
        for p in possible:
            if p.exists():
                return str(p.resolve())

    raise RuntimeError("Missing approved reference voice WAV. IndexTTS2 clone pack requires reference.wav/source.wav for every clip.")

def resolve_output_dir(payload: Dict[str, Any], unknown: Dict[str, str], reference_path: str) -> Path:
    for key in ["output_dir", "outputDir", "out_dir", "dataset_dir", "datasetDir", "work_dir", "workDir"]:
        value = normalize_path(unknown.get(key) or payload.get(key))
        if value:
            return Path(value).resolve()

    input_path = payload.get("__input_json_path")
    if input_path:
        return Path(input_path).resolve().parent

    return Path(reference_path).resolve().parent.parent / "indextts2-clone-pack"

def find_python(index_root: Path) -> str:
    env_value = normalize_path(os.environ.get("INDEXTTS2_PYTHON"))
    if env_value and Path(env_value).exists():
        return env_value

    candidates = [
        index_root / ".venv" / "Scripts" / "python.exe",
        index_root / "venv" / "Scripts" / "python.exe",
        index_root / "env" / "Scripts" / "python.exe",
        Path(DEFAULT_INDEX_PYTHON),
        Path(sys.executable),
    ]

    for p in candidates:
        if p.exists():
            return str(p.resolve())

    return sys.executable

def run_in_subprocess(index_root: Path, python_exe: str, request_path: Path) -> Dict[str, Any]:
    worker_path = Path(__file__).resolve()
    cmd = [
        python_exe,
        str(worker_path),
        "--run-worker",
        "--request-json",
        str(request_path),
    ]

    env = os.environ.copy()
    current_pythonpath = env.get("PYTHONPATH", "")
    env["PYTHONPATH"] = str(index_root) + (os.pathsep + current_pythonpath if current_pythonpath else "")

    completed = subprocess.run(
        cmd,
        cwd=str(index_root),
        env=env,
        text=True,
        capture_output=True,
    )

    if completed.returncode != 0:
        raise RuntimeError(
            "IndexTTS2 subprocess failed.\n"
            f"Command: {' '.join(cmd)}\n"
            f"STDOUT:\n{completed.stdout}\n"
            f"STDERR:\n{completed.stderr}"
        )

    stdout = completed.stdout.strip()
    if not stdout:
        raise RuntimeError("IndexTTS2 subprocess returned empty stdout.")

    try:
        return json.loads(stdout.splitlines()[-1])
    except Exception as exc:
        raise RuntimeError(f"Could not parse IndexTTS2 subprocess JSON output: {stdout}") from exc

def generate_with_index(payload: Dict[str, Any]) -> Dict[str, Any]:
    index_root = Path(normalize_path(os.environ.get("INDEXTTS2_ROOT")) or DEFAULT_INDEX_ROOT).resolve()
    cfg_path = Path(normalize_path(os.environ.get("INDEXTTS2_CFG")) or DEFAULT_INDEX_CFG).resolve()
    model_dir = Path(normalize_path(os.environ.get("INDEXTTS2_MODEL_DIR")) or DEFAULT_INDEX_MODEL_DIR).resolve()

    reference_path = Path(payload["referencePath"]).resolve()
    output_dir = Path(payload["outputDir"]).resolve()
    clips = payload["clips"]

    if not index_root.exists():
      raise RuntimeError(f"INDEXTTS2_ROOT not found: {index_root}")
    if not cfg_path.exists():
      raise RuntimeError(f"IndexTTS2 config not found: {cfg_path}")
    if not model_dir.exists():
      raise RuntimeError(f"IndexTTS2 model_dir not found: {model_dir}")
    if not reference_path.exists():
      raise RuntimeError(f"Reference WAV not found: {reference_path}")

    sys.path.insert(0, str(index_root))

    # --- OTG PATCH: force UTF-8 stdio for IndexTTS2 on Windows ---
    import os as _otg_os
    import sys as _otg_sys

    _otg_os.environ.setdefault("PYTHONUTF8", "1")
    _otg_os.environ.setdefault("PYTHONIOENCODING", "utf-8")
    for _otg_stream_name in ("stdout", "stderr"):
        _otg_stream = getattr(_otg_sys, _otg_stream_name, None)
        if _otg_stream is not None and hasattr(_otg_stream, "reconfigure"):
            try:
                _otg_stream.reconfigure(encoding="utf-8", errors="replace")
            except Exception:
                pass
    # --- /OTG PATCH ---
    from indextts.infer_v2 import IndexTTS2  # type: ignore

    use_fp16 = os.environ.get("INDEXTTS2_USE_FP16", "0").strip() in {"1", "true", "TRUE", "yes"}
    use_cuda_kernel = os.environ.get("INDEXTTS2_USE_CUDA_KERNEL", "0").strip() in {"1", "true", "TRUE", "yes"}
    use_deepspeed = os.environ.get("INDEXTTS2_USE_DEEPSPEED", "0").strip() in {"1", "true", "TRUE", "yes"}
    emo_alpha = float(os.environ.get("INDEXTTS2_EMO_ALPHA", "0.45"))

    tts = IndexTTS2(
        cfg_path=str(cfg_path),
        model_dir=str(model_dir),
        use_fp16=use_fp16,
        use_cuda_kernel=use_cuda_kernel,
        use_deepspeed=use_deepspeed,
    )

    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "clips").mkdir(parents=True, exist_ok=True)

    generated: List[Dict[str, Any]] = []

    for index, clip in enumerate(clips):
        output_path = Path(clip["outputPath"]).resolve()
        output_path.parent.mkdir(parents=True, exist_ok=True)

        text = str(clip["text"]).strip()
        delivery = str(clip.get("delivery") or "neutral").strip()
        vector = emotion_vector(delivery)

        # Keep speaker identity fixed with spk_audio_prompt. Use emotion vectors for delivery.
        # use_random=False is mandatory for clone consistency.
        tts.infer(
            spk_audio_prompt=str(reference_path),
            text=text,
            output_path=str(output_path),
            emo_vector=vector,
            emo_alpha=emo_alpha,
            use_random=False,
            verbose=True,
        )

        if not output_path.exists() or output_path.stat().st_size <= 0:
            raise RuntimeError(f"IndexTTS2 did not create a valid clip: {output_path}")

        generated.append({
            "id": clip["id"],
            "status": "ready",
            "text": text,
            "delivery": delivery,
            "outputPath": str(output_path),
            "bytes": output_path.stat().st_size,
            "speakerReferencePath": str(reference_path),
            "speakerLockMode": "strict_same_speaker_indextts2_clone",
            "provider": "indextts2",
            "adapter": "indextts2",
            "mock": False,
        })

    result = {
        "ok": True,
        "mock": False,
        "provider": "indextts2",
        "adapter": "indextts2",
        "speakerReferencePath": str(reference_path),
        "speakerLockMode": "strict_same_speaker_indextts2_clone",
        "identityPolicy": "same_reference_voice_for_all_clips",
        "count": len(generated),
        "clips": generated,
        "outputDir": str(output_dir),
    }

    write_json(output_dir / "indextts2_clone_result.json", result)
    return result

def main() -> int:
    parser = argparse.ArgumentParser(add_help=True)
    parser.add_argument("--params-json", default="")
    parser.add_argument("--input-json", default="")
    parser.add_argument("--request-json", default="")
    parser.add_argument("--request", default="")
    parser.add_argument("--payload", default="")
    parser.add_argument("--stdout-log", default="")
    parser.add_argument("--stderr-log", default="")
    parser.add_argument("--run-worker", action="store_true")
    known, rest = parser.parse_known_args()
    unknown = parse_unknown_args(rest)

    payload = read_payload(known, unknown)

    if known.run_worker:
        result = generate_with_index(payload)
        print(json.dumps(result, ensure_ascii=False))
        return 0

    reference = resolve_reference(payload, unknown)
    output_dir = resolve_output_dir(payload, unknown, reference)
    clips = collect_clips(payload, unknown, output_dir)

    if not clips:
        raise RuntimeError("No clips were provided or generated for IndexTTS2 clone pack.")

    request = {
        "referencePath": reference,
        "outputDir": str(output_dir),
        "speakerLockMode": "strict_same_speaker_indextts2_clone",
        "identityPolicy": "same_reference_voice_for_all_clips",
        "speakerInstruction": SPEAKER_LOCK,
        "clips": clips,
    }

    request_path = output_dir / "indextts2_clone_request.json"
    write_json(request_path, request)

    index_root = Path(normalize_path(os.environ.get("INDEXTTS2_ROOT")) or DEFAULT_INDEX_ROOT).resolve()
    python_exe = find_python(index_root)

    # If already running inside the IndexTTS2 environment, direct run is allowed.
    if Path(sys.executable).resolve() == Path(python_exe).resolve():
        result = generate_with_index(request)
    else:
        result = run_in_subprocess(index_root, python_exe, request_path)

    line = json.dumps(result, ensure_ascii=False)
    if known.stdout_log:
        Path(known.stdout_log).parent.mkdir(parents=True, exist_ok=True)
        Path(known.stdout_log).write_text(line + "\n", encoding="utf-8")
    print(line)
    return 0

if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        error_payload = json.dumps({
            "ok": False,
            "mock": False,
            "provider": "indextts2",
            "adapter": "indextts2",
            "error": str(exc),
            "traceback": traceback.format_exc(),
        }, ensure_ascii=False)
        stderr_log = ""
        try:
            if "--stderr-log" in sys.argv:
                stderr_log = sys.argv[sys.argv.index("--stderr-log") + 1]
        except Exception:
            stderr_log = ""
        if stderr_log:
            Path(stderr_log).parent.mkdir(parents=True, exist_ok=True)
            Path(stderr_log).write_text(error_payload + "\n", encoding="utf-8")
        print(error_payload)
        raise
