#!/usr/bin/env python3
"""Linux LTX character voice worker with bounded primary-only PROD routing.

Claims only durable character voice jobs with:
  jobType=character_voice_pipeline
  action=create_voice_sample
  provider in {ltx, unnatural_ltx}

The worker uses the Linux RTX 3090 ComfyUI endpoint, validates the workflow
against /object_info before claiming, patches the installed official full LTX 2.3
checkpoint into the model, audio-VAE, and text-projection loaders, renders a
deliberately low-resolution visual carrier, downloads node384 FLAC and converts
it to real PCM WAV, uploads the sample, and completes the durable job. Unknown
ownership remains fenced in a private client journal; it is never replayed.
"""

from __future__ import annotations

import argparse
import copy
import fcntl
import hashlib
import json
import math
import mimetypes
import os
import random
import subprocess
import threading
import tempfile
import time
import traceback
import urllib.error
import urllib.parse
import urllib.request
import uuid
import wave
from pathlib import Path
from typing import Any, Dict, Iterable


class WorkerError(RuntimeError):
    pass


class SubmissionUnknownError(WorkerError):
    pass


class WorkerHTTPError(WorkerError):
    def __init__(self, status: int, url: str, body: Any):
        self.status, self.body = status, body if isinstance(body, dict) else {}
        # Never echo credential-bearing response bodies or headers to journald.
        super().__init__(f"HTTP {status} {urllib.parse.urlsplit(url).path}")


class AdmissionBusyError(WorkerError):
    pass


class OwnershipJournal:
    """Client-side crash fence, not a second admission authority.

    No automatic recovery/expiry: an uncertain claim, grant or submit requires
    reconciliation with the app and the existing protocol-2 authority.
    """
    def __init__(self, path: Path):
        self.path = path
        self.lock = None
        self.state: Dict[str, Any] = {}

    def __enter__(self):
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        st = self.path.parent.stat()
        if self.path.parent.is_symlink() or st.st_uid != os.getuid() or st.st_mode & 0o077:
            raise WorkerError("LTX journal directory must be private and owned by the worker.")
        fd = os.open(str(self.path) + ".lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
        self.lock = os.fdopen(fd, "a+")
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            if self.path.exists():
                if self.path.is_symlink() or self.path.stat().st_mode & 0o077:
                    raise WorkerError("Untrusted LTX ownership journal.")
                self.state = json.loads(self.path.read_text())
                if not isinstance(self.state, dict) or self.state.get("phase") != "settled":
                    raise WorkerError("LTX ownership needs manual reconciliation; no job will be claimed.")
        except BaseException:
            self.lock.close()
            raise
        return self

    def write(self, phase: str, **fields: Any) -> None:
        self.state.update(fields)
        self.state.update(phase=phase, updatedAt=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
        fd, name = tempfile.mkstemp(prefix=".ltx-state-", dir=self.path.parent)
        try:
            with os.fdopen(fd, "w") as out:
                json.dump(self.state, out, sort_keys=True)
                out.flush()
                os.fsync(out.fileno())
            os.replace(name, self.path)
            directory = os.open(self.path.parent, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
        finally:
            if os.path.exists(name):
                os.unlink(name)

    def __exit__(self, *_):
        if self.lock is not None:
            self.lock.close()


def journal_phase(args: argparse.Namespace, phase: str, **fields: Any) -> None:
    args.ownership_journal.write(phase, **fields)


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
PRIMARY_GPU_UUID = "GPU-c5d34248-3562-c0e1-5fa6-5e10849a72b3"


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_args, **_kwargs):
        return None

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
        with urllib.request.build_opener(NoRedirect).open(request, timeout=timeout) as response:
            raw = response.read().decode("utf-8", errors="replace")
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        try:
            body = json.loads(body)
        except ValueError:
            body = {}
        raise WorkerHTTPError(error.code, url, body) from error
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


def resolve_runtime_contract(args: argparse.Namespace, graph: Dict[str, Any], object_info=None) -> Dict[str, str]:
    object_info = object_info if object_info is not None else request_json(
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


def validate_graph_schema(graph: Dict[str, Any], schema: Dict[str, Any]) -> Dict[str, int]:
    """Read-only API-graph checks, including this graph's V3 dynamic inputs.

    This is NOT Comfy execution/VRAM qualification and never POSTs /prompt.
    Unknown schema constructs fail closed instead of treating them as valid.
    """
    definitions, required = {}, {}
    links = enums = 0
    for node_id, entry in graph.items():
        if not isinstance(entry, dict) or entry.get("class_type") not in schema:
            raise WorkerError(f"Unknown graph node {node_id}")
        ins = entry.get("inputs", {})
        definitions[node_id], required[node_id] = {}, set()

        def expand(groups, prefix=""):
            for group in ("required", "optional"):
                for name, definition in groups.get(group, {}).items():
                    key = prefix + name
                    kind = definition[0]
                    options = definition[1] if len(definition) > 1 else {}
                    if kind == "COMFY_AUTOGROW_V3":
                        template = options["template"]
                        names = template["names"]
                        sub = template["input"]["required"]
                        if len(sub) != 1:
                            raise WorkerError("Unqualified autogrow schema")
                        present = [k for k in ins if k.startswith(key + ".")]
                        if len(present) < template.get("min", 0):
                            raise WorkerError(f"Missing autogrow inputs {node_id}:{key}")
                        for child in present:
                            if child[len(key) + 1:] not in names:
                                raise WorkerError(f"Unknown autogrow input {node_id}:{child}")
                            definitions[node_id][child] = next(iter(sub.values()))
                        continue
                    definitions[node_id][key] = definition
                    if group == "required":
                        required[node_id].add(key)
                    if kind == "COMFY_DYNAMICCOMBO_V3":
                        selected = next((o for o in options["options"] if o["key"] == ins.get(key)), None)
                        if not selected:
                            raise WorkerError(f"Invalid dynamic enum {node_id}:{key}")
                        definitions[node_id][key] = [[o["key"] for o in options["options"]]]
                        expand(selected["inputs"], key + ".")
        expand(schema[entry["class_type"]]["input"])
        if required[node_id] - ins.keys() or ins.keys() - definitions[node_id].keys():
            raise WorkerError(f"Graph inputs differ from schema at node {node_id}")

    def output_type(source, index, seen=None):
        seen = set() if seen is None else seen
        if source in seen:
            raise WorkerError("Cyclic match-type graph")
        seen.add(source)
        if source not in graph or type(index) is not int or index < 0:
            raise WorkerError("Invalid graph link source/index")
        info = schema[graph[source]["class_type"]]
        outputs = info.get("output", [])
        if index >= len(outputs):
            raise WorkerError("Graph link output index out of range")
        kind = outputs[index]
        if kind == "COMFY_MATCHTYPE_V3":
            matches = [k for k, d in definitions[source].items() if d[0] == "COMFY_MATCHTYPE_V3"]
            if len(matches) != 1:
                raise WorkerError("Unqualified match-type output")
            ref = graph[source]["inputs"][matches[0]]
            if not isinstance(ref, list) or len(ref) != 2:
                raise WorkerError("Match-type input must link")
            return output_type(str(ref[0]), ref[1], seen)
        return kind

    edges = {n: [] for n in graph}
    for node_id, entry in graph.items():
        for key, value in entry["inputs"].items():
            definition = definitions[node_id][key]
            kind, options = definition[0], definition[1] if len(definition) > 1 else {}
            enum = kind if isinstance(kind, list) else options.get("options") if kind == "COMBO" else None
            if isinstance(value, list):
                if len(value) != 2:
                    raise WorkerError(f"Invalid link at {node_id}:{key}")
                source, index = str(value[0]), value[1]
                actual = output_type(source, index)
                accepted = options["template"]["allowed_types"] if kind == "COMFY_MATCHTYPE_V3" else kind
                if enum is not None or not isinstance(accepted, str) or actual not in accepted.split(","):
                    raise WorkerError(f"Graph link type mismatch at {node_id}:{key}: {actual} -> {accepted}")
                edges[node_id].append(source)
                links += 1
            elif enum is not None:
                if value not in enum:
                    raise WorkerError(f"Invalid enum at {node_id}:{key}")
                enums += 1
            else:
                valid = {"INT": type(value) is int, "FLOAT": type(value) in (float, int),
                         "STRING": isinstance(value, str), "BOOLEAN": type(value) is bool}
                if not isinstance(kind, str) or not any(valid.get(k, False) for k in kind.split(",")):
                    raise WorkerError(f"Invalid literal at {node_id}:{key}")
                if type(value) in (float, int):
                    if not math.isfinite(value) or value < options.get("min", -math.inf) or value > options.get("max", math.inf):
                        raise WorkerError(f"Literal out of range at {node_id}:{key}")
    visited, visiting = set(), set()
    def visit(n):
        if n in visiting:
            raise WorkerError("Cyclic workflow graph")
        if n not in visited:
            visiting.add(n)
            for source in edges[n]:
                visit(source)
            visiting.remove(n)
            visited.add(n)
    for n in graph:
        visit(n)
    return {"nodes": len(graph), "links": links, "enums": enums}


def verify_qualification_manifest(args: argparse.Namespace) -> None:
    path = Path(args.qualification_manifest)
    if not path.is_file() or path.is_symlink() or path.stat().st_mode & 0o022 or path.stat().st_uid not in (0, os.getuid()):
        raise WorkerError("Missing or untrusted LTX qualification manifest")
    manifest = json.loads(path.read_text())
    if manifest.get("schema") != 1 or manifest.get("primary") != args.comfy_url:
        raise WorkerError("LTX qualification manifest is not for this primary")
    for item in manifest["bundle"]:
        file = path.parent / item["path"]
        if ".." in Path(item["path"]).parts or Path(item["path"]).is_absolute():
            raise WorkerError("Invalid bundle path")
        if not file.is_file() or hashlib.sha256(file.read_bytes()).hexdigest() != item["sha256"]:
            raise WorkerError("LTX pinned dependency changed")
    workflow = path.parent / manifest["workflow"]
    if workflow.resolve() != Path(args.workflow_path).resolve():
        raise WorkerError("LTX workflow differs from qualified bundle")
    for item in manifest["models"]:
        model = Path(item["path"])
        st = model.stat()
        if str(model.resolve()) != item["canonical"] or st.st_size != item["size"] or st.st_mtime_ns != item["mtime_ns"]:
            raise WorkerError("LTX qualified model file changed")
        with model.open("rb") as stream:
            if hashlib.sha256(stream.read(item["header_bytes"])).hexdigest() != item["header_sha256"]:
                raise WorkerError("LTX model header changed")
    converter = manifest.get("audio_converter", {})
    if converter.get("path") != "/usr/bin/ffmpeg" or hashlib.sha256(Path("/usr/bin/ffmpeg").read_bytes()).hexdigest() != converter.get("sha256"):
        raise WorkerError("Qualified CPU audio converter is missing or changed")


def preclaim_qualification(args: argparse.Namespace):
    flag = getattr(args, "fallback_setting", None)
    if flag not in (None, "0", "1"):
        raise WorkerError("OTG_LTX_5060_FALLBACK_ENABLED must be exactly 0 or 1")
    args.fallback_enabled = flag == "1"
    if "prod" in args.worker_id.lower() and flag != "0":
        raise WorkerError("PROD LTX requires explicit OTG_LTX_5060_FALLBACK_ENABLED=0")
    if "prod" in args.worker_id.lower() and args.base_url != "http://127.0.0.1:3030":
        raise WorkerError("PROD LTX requires the managed private loopback forward")
    verify_qualification_manifest(args)
    health = request_json("GET", build_url(args.base_url, "/api/healthz"), {}, timeout=10)
    status = request_json("GET", build_url(args.base_url, "/api/worker-control/status"), auth_headers(args), timeout=15)
    if health.get("ok") is not True or status.get("ok") is not True or status.get("enabled") is not True:
        raise WorkerError("App health or authenticated worker control unavailable")
    graph = load_workflow(Path(args.workflow_path))
    schema = request_json("GET", build_url(args.comfy_url, "/object_info"), {}, timeout=30)
    contract = resolve_runtime_contract(args, graph, schema)
    patched = copy.deepcopy(graph)
    patch_workflow(patched, "Qualification only; not submitted.", "audio/qualification-only", 42, contract,
                   args.carrier_width, args.carrier_height, args.duration_seconds)
    validate_graph_schema(patched, schema)
    return graph, contract

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
    save_audio["class_type"] = "SaveAudio"
    # Current ComfyUI SaveAudio emits FLAC. The worker converts that container
    # to real PCM WAV after download; never rename FLAC bytes with a .wav suffix.
    save_audio["_meta"] = {"title": "Save Audio (FLAC; worker converts to WAV)"}
    save_audio["inputs"] = {"filename_prefix": filename_prefix, "audio": save_audio.get("inputs", {}).get("audio", ["354", 0])}
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
                f"--id={PRIMARY_GPU_UUID}",
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
    persist_audio_as_wav(data, output_path)
    if output_path.stat().st_size < 1024:
        raise WorkerError(
            f"LTX voice audio output is too small to be usable: {output_path.stat().st_size} bytes."
        )


def persist_audio_as_wav(data: bytes, output_path: Path) -> None:
    """CPU-only container conversion; no models, CUDA or generated speech."""
    if output_path.suffix.lower() != ".wav":
        raise WorkerError("LTX sample destination must be WAV")
    if data.startswith(b"RIFF") and data[8:12] == b"WAVE":
        output_path.write_bytes(data)
    elif data.startswith(b"fLaC"):
        source = output_path.with_suffix(".source.flac")
        source.write_bytes(data)  # Retain the authentic Comfy output for recovery.
        fd, temporary = tempfile.mkstemp(prefix=".ltx-pcm-", suffix=".wav", dir=output_path.parent)
        os.close(fd)
        try:
            result = subprocess.run(["/usr/bin/ffmpeg", "-nostdin", "-hide_banner", "-v", "error",
                "-y", "-i", str(source), "-map", "0:a:0", "-vn", "-c:a", "pcm_s16le", temporary],
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=120)
            if result.returncode:
                raise WorkerError("LTX FLAC-to-WAV conversion failed; original FLAC retained")
            with wave.open(temporary, "rb") as stream:
                if stream.getnframes() < 1 or stream.getcomptype() != "NONE":
                    raise WorkerError("LTX conversion did not produce PCM WAV")
            os.replace(temporary, output_path)
        finally:
            if os.path.exists(temporary):os.unlink(temporary)
    else:
        raise WorkerError("LTX node384 output is not qualified FLAC/WAV; refusing mislabeled upload")
    try:
        with wave.open(str(output_path), "rb") as stream:
            if stream.getnframes() < 1:raise WorkerError("Empty LTX WAV sample")
    except (wave.Error, EOFError) as error:
        raise WorkerError("Invalid LTX WAV sample") from error


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
    mime = "audio/wav" if file_path.suffix.lower() == ".wav" else mimetypes.guess_type(str(file_path))[0] or "application/octet-stream"
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
        output_name = "unnatural-ltx-voice.wav" if is_unnatural else "ltx-voice.wav"
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
            "LTX Voice WAV generated. Uploading the playable sample.",
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
    journal_phase(args, "admitting", jobId=job_id, lockId=lock_id)
    try:
        return _acquire_cluster_gpu_lease(args, job_id, lock_id, resource_name)
    except WorkerHTTPError as error:
        if error.status != 409:
            raise SubmissionUnknownError("GPU admission outcome unconfirmed; reconcile before retry") from error
        # A waiting token cancels only an ungranted ticket. A race to a grant
        # returns 409 and MUST leave the journal fenced instead of guessing.
        detail = error.body.get("detail") or {}
        token = detail.get("waitingToken") if isinstance(detail, dict) else None
        if token:
            journal_phase(args, "canceling_wait", waitingToken=token)
            try:
                release_cluster_gpu_lease(args, job_id, {"lockId": lock_id, "fencingToken": token})
            except Exception as uncertain:
                raise SubmissionUnknownError("Waiting ownership is unconfirmed") from uncertain
        journal_phase(args, "pre_submit", lease=None)
        raise AdmissionBusyError("primary-resource-locked") from error
    except SubmissionUnknownError:
        raise
    except Exception as error:
        raise SubmissionUnknownError("GPU admission outcome unconfirmed; reconcile before retry") from error


def _acquire_cluster_gpu_lease(args, job_id, lock_id, resource_name):
    response = request_json(
        "POST",
        build_url(args.base_url, "/api/worker-control/resource-lock/acquire"),
        auth_headers(args),
        {
            "lockId": lock_id,
            "ownerId": job_id,
            "workerId": args.worker_id,
            "resourceName": resource_name,
            # Protocol-2 ownership is persistent; this legacy TTL field never
            # authorizes expiry/replay of an uncertain or running generation.
            "ttlSeconds": 21600,
        },
        timeout=args.app_timeout_seconds,
    )
    lease = response.get("lock")
    if (not isinstance(lease, dict) or not clean(lease.get("fencingToken"))
            or lease.get("lockId") != lock_id or lease.get("ownerId") != job_id
            or lease.get("workerId") != args.worker_id or lease.get("persistent") is not True):
        raise SubmissionUnknownError("GPU response is not this worker's persistent fenced reservation")
    journal_phase(args, "pre_submit", lease=lease)
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
    response = request_json(
        "POST",
        build_url(args.base_url, "/api/worker-control/resource-lock/release"),
        auth_headers(args),
        {"lockId": lease["lockId"], "ownerId": job_id, "fencingToken": lease["fencingToken"]},
        timeout=args.app_timeout_seconds,
    )
    if response.get("released") is not True:
        raise SubmissionUnknownError("GPU release was not confirmed")


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
    if not getattr(args, "fallback_enabled", False):
        raise WorkerError("8191 fallback is disabled; lifecycle actions forbidden")
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
    response = request_json(
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
    if response.get("ok") is not True:
        raise SubmissionUnknownError("Job failure update was not confirmed")


def requeue_claimed_job(
    args: argparse.Namespace,
    owner_key: str,
    job_id: str,
    message: str,
    result: Dict[str, Any] | None = None,
) -> None:
    response = request_json(
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
    if response.get("ok") is not True:
        raise SubmissionUnknownError("Job requeue was not confirmed")


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
        "primary-unreachable-or-not-ready",
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
        journal_phase(args, "settled", lease=None)
        return 1

    headers = auth_headers(args, owner_key)
    headers["x-otg-worker-direct"] = "1"
    headers["x-otg-device-id"] = args.device_id
    headers["x-otg-worker-id"] = args.worker_id

    log(
        f"[creator] claimed durable LTX 2.5 audition job={job_id}"
    )

    try:
        journal_phase(args, "creator_submitting", jobId=job_id, ownerKey=owner_key)
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

        journal_phase(args, "creator_finalizing")
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
        if complete.get("ok") is not True:
            raise SubmissionUnknownError("Creator finalization was not confirmed")
        journal_phase(args, "settled", lease=None)
        return 0

    except Exception as error:
        text = str(error)
        retryable = (isinstance(error, WorkerHTTPError) and error.status == 409
                     and error.body.get("retryable") is True and error.body.get("submitted") is False)

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
            journal_phase(args, "settled", lease=None)
            return 0

        log(
            f"[creator-error] job={job_id}: "
            f"{text}\n{traceback.format_exc()}"
        )

        journal_phase(args, "submission_unknown")
        checkpoint(args, auth_headers(args, owner_key), job_id, 40,
                   "Creator response is unconfirmed; manual reconciliation required, no automatic retry.",
                   {"submissionState": "submission_unknown", "queueKind": "ltx25_voice_creator"})
        return 1


def process_one_failover(args: argparse.Namespace) -> int:
    try:
        with OwnershipJournal(Path(args.ownership_state)) as journal:
            args.ownership_journal = journal
            graph, contract = preclaim_qualification(args)
            return _process_one_failover(args, graph, contract)
    except Exception as error:
        log(f"[blocked] LTX pre-claim safety gate: {error}")
        return 1


def _process_one_failover(args, qualified_graph, qualified_contract) -> int:
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
        journal_phase(args, "claiming", lease=None, jobId=None, ownerKey=None, workerId=args.worker_id)
        claim = request_json(
            "POST",
            build_url(args.base_url, "/api/worker/jobs/claim"),
            auth_headers(args),
            {"jobType": "character_voice_pipeline", "action": "create_voice_sample", "claimScope": "all_owners", "workerId": args.worker_id, "providers": ["ltx", "unnatural_ltx"]},
            timeout=args.app_timeout_seconds,
        )
        job = claim.get("job")
        if claim.get("ok") is not True:
            raise SubmissionUnknownError("Claim response is unconfirmed")
        if not isinstance(job, dict):
            journal_phase(args, "settled", lease=None)
            log("[idle] No queued LTX create_voice_sample job available.")
            return 0

        job_id = clean(job.get("jobId"))
        owner_key = clean(job.get("ownerKey"))
        character_id = clean(job.get("characterId"))
        job_input = job.get("input") if isinstance(job.get("input"), dict) else {}
        provider = clean(job_input.get("provider")).lower()
        if provider not in ("ltx", "unnatural_ltx") or not job_id or not owner_key or not character_id:
            raise WorkerError(f"Invalid claimed LTX voice job: {job}")
        journal_phase(args, "claimed", jobId=job_id, ownerKey=owner_key)

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
        primary_graph = qualified_graph
        primary_contract = qualified_contract
        try:
            request_json("GET", build_url(args.comfy_url, "/system_stats"), {}, None, timeout=10)
            active_gpu_lease = acquire_cluster_gpu_lease(args, job_id, "gpu:shawn-3090", "video")
            queue = request_json("GET", build_url(args.comfy_url, "/queue"), {}, None, timeout=10)
            running, pending = queue_counts(queue)
            if running or pending:
                raise WorkerError("primary-busy")
            for queue_key in ("queue_running", "queue_pending"):
                if not isinstance(queue.get(queue_key), list):
                    raise WorkerError("primary-unreachable-or-not-ready")
            sibling = request_json("GET", "http://100.75.162.64:8189/queue", {}, timeout=10)
            if any(not isinstance(sibling.get(k), list) for k in ("queue_running", "queue_pending")):
                raise WorkerError("primary-unreachable-or-not-ready")
            if any(queue_counts(sibling)):
                raise WorkerError("primary-busy")

            require_primary_vram_ready(args)
        except SubmissionUnknownError:
            metadata["submissionState"] = "admission_unknown"
            raise
        except Exception as error:
            primary_failure = clean(error)
            if "primary-resource-locked" not in primary_failure and "primary-busy" not in primary_failure:
                primary_failure = "primary-unreachable-or-not-ready"
            if active_gpu_lease is not None:
                journal_phase(args, "releasing", lease=active_gpu_lease)
                try:
                    release_cluster_gpu_lease(args, job_id, active_gpu_lease)
                except Exception as uncertain:
                    metadata["submissionState"] = "release_unknown"
                    raise SubmissionUnknownError("Pre-submit GPU release is unconfirmed") from uncertain
                active_gpu_lease = None
                journal_phase(args, "pre_submit", lease=None)

        using_fallback = bool(primary_failure)
        if using_fallback and not args.fallback_enabled:
            metadata.update(fallbackReason=primary_failure, fallbackDisabled=True)
            # No 5060 lease, workflow load, 8191 probe or lifecycle command.
            raise WorkerError(primary_failure)
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
            graph = copy.deepcopy(primary_graph)
            patch_workflow(graph, prompt, filename_prefix, seed, primary_contract, args.carrier_width, args.carrier_height, args.duration_seconds)
            patched_workflow_path = work_dir / "ltx_voice_workflow_patched.json"
            write_json(patched_workflow_path, graph)
            active_args = args

        output_extension = ".wav"
        sample_path = work_dir / (f"unnatural-ltx-voice{output_extension}" if is_unnatural else f"ltx-voice{output_extension}")

        checkpoint(args, headers, job_id, 28, "LTX workflow validated before submission.", {**metadata, "currentStage": "workflow_patched", "patchedWorkflowPath": str(patched_workflow_path)})
        try:
            journal_phase(args, "submitting", lease=active_gpu_lease, backend=active_args.comfy_url)
            metadata["submissionState"] = "submitting"
            prompt_id = submit_comfy(active_args, graph)
        except Exception as error:
            metadata["submissionState"] = "submission_unknown"
            journal_phase(args, "submission_unknown")
            checkpoint(args, headers, job_id, 40, "Submission outcome is unknown; retry and fallback forbidden.", metadata)
            raise SubmissionUnknownError(str(error)) from error
        metadata.update({"submissionId": prompt_id, "promptId": prompt_id, "submissionState": "submitted"})
        journal_phase(args, "submitted", promptId=prompt_id)
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
        journal_phase(args, "finalizing")
        complete = request_json("POST", build_url(args.base_url, "/api/worker/jobs/complete"), headers, {"jobId": job_id, "result": result, "message": "Linux LTX character voice sample completed."}, timeout=args.app_timeout_seconds)
        if complete.get("ok") is not True:
            raise SubmissionUnknownError("Job finalization was not confirmed")
        metadata["submissionState"] = "completed"
        log(f"[complete] job={job_id} backend={metadata['backend']} prompt={prompt_id}")
        return 0
    except Exception as error:
        log(f"[error] {error}\n{traceback.format_exc()}")

        if (isinstance(error, SubmissionUnknownError) or metadata["submissionState"] != "pre_submit"
                or args.ownership_journal.state.get("phase") in ("claiming", "admitting", "canceling_wait", "releasing")):
            metadata["submissionState"] = "submission_unknown"
            journal_phase(args, "submission_unknown")
            if job_id and owner_key:
                checkpoint(args, auth_headers(args, owner_key), job_id, 40,
                           "Ownership or execution is unconfirmed; retained for manual reconciliation.", metadata)
            return 1

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
                if active_gpu_lease is None:
                    journal_phase(args, "settled", lease=None)
                return 0

            except Exception as requeue_error:
                log(
                    "[warn] Could not immediately requeue "
                    f"LTX job: {requeue_error}"
                )
                journal_phase(args, "requeue_unknown")
                metadata["submissionState"] = "submission_unknown"
                return 1

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
                if active_gpu_lease is None:
                    journal_phase(args, "settled", lease=None)
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
                if metadata["submissionState"] not in ("pre_submit", "completed", "failed"):
                    log("[fenced] Retaining cluster GPU lease; no retry/release after uncertain execution.")
                else:
                    journal_phase(args, "releasing", lease=active_gpu_lease)
                    released_lock_id = clean(active_gpu_lease.get("lockId"))
                    release_cluster_gpu_lease(args, job_id, active_gpu_lease)
                    journal_phase(args, "settled", lease=None)
                    log(f"[gpu-lock] Confirmed release of {released_lock_id}.")
            except Exception as release_error:
                log(f"[warn] Could not release cluster GPU lease: {release_error}")
        if fallback_started and args.ownership_journal.state.get("phase") == "settled":
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
    parser.add_argument("--fallback-setting", default=os.environ.get("OTG_LTX_5060_FALLBACK_ENABLED"))
    parser.add_argument("--qualification-manifest", default=os.environ.get("OTG_LTX_QUALIFICATION_MANIFEST", ""))
    parser.add_argument("--ownership-state", default=os.environ.get("OTG_LTX_OWNERSHIP_STATE", "/home/shawn-rochford/AI/runtime/prod/ltx-worker-ownership/state.json"))
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
