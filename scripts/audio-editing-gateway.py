"""Forced-command SSH audio protocol. No shell, caller paths, config, or PIDs.

Install beside a trusted engines.json and audio-editing-worker.py. Only the
dedicated SSH key calls this entrypoint. Jobs and cache remain bundle-local.
Compatible with the SLR host's Python 3.10; uses only the standard library.
"""
import base64
import fcntl
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import signal
import stat
import subprocess
import sys
import uuid

PROTOCOL = "slr-audio-v1"
CHUNK = 512 * 1024
MAX_FILE = 750 * 1024 * 1024
EXTENSIONS = r"(?:mp4|webm|mov|mkv|wav|mp3|flac|ogg|m4a|aac)"
PARAMS = {
    "import": set(),
    "extract": {"start", "length", "strength", "engine", "sourceAssetId"},
    "separate": {"engine", "cacheKey"},
    "enhance": {"target", "strength", "engine", "start", "length", "sourceAssetId"},
    "speech": {"text", "description", "instruction", "expression", "seconds", "seed", "variant"},
    "music": {"prompt", "seconds", "seed"},
    "effects": {"mode", "prompt", "seconds", "start", "seed"},
}


def digest(file):
    value = hashlib.sha256()
    with file.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def atomic(file, value):
    temporary = file.with_name(file.name + "." + uuid.uuid4().hex + ".tmp")
    with temporary.open("x") as stream:
        json.dump(value, stream)
    temporary.replace(file)


def object_only(value, allowed):
    if not isinstance(value, dict) or set(value) - set(allowed):
        raise ValueError("Unsupported protocol fields")


class Gateway:
    def __init__(self, bundle):
        self.bundle = Path(bundle).resolve(strict=True)
        self.config = json.loads((self.bundle / "engines.json").read_text())
        self.jobs = self.bundle / "jobs"
        self.jobs.mkdir(mode=0o700, exist_ok=True)
        if self.jobs.is_symlink():
            raise ValueError("Unsafe job root")

    def job(self, identifier):
        if not isinstance(identifier, str) or str(uuid.UUID(identifier)) != identifier:
            raise ValueError("Invalid job identifier")
        root = self.jobs / identifier
        if root.is_symlink() or not root.is_dir() or root.resolve().parent != self.jobs:
            raise ValueError("Unknown job")
        return root

    def input_file(self, root, name):
        if not isinstance(name, str) or not re.fullmatch(r"source\." + EXTENSIONS, name):
            raise ValueError("Unsupported input filename")
        file = root / "inputs" / name
        if (root / "inputs").is_symlink() or file.is_symlink():
            raise ValueError("Unsafe input")
        return file

    def manifest(self, root, raw):
        object_only(raw, {"operation", "gpu", "params", "input"})
        operation = raw.get("operation")
        if operation not in PARAMS:
            raise ValueError("Unsupported audio operation")
        params = raw.get("params", {})
        object_only(params, PARAMS[operation])
        for key, value in params.items():
            if key in {"seconds", "start", "length", "seed", "strength"}:
                maximum = 2147483647 if key == "seed" else 1 if key == "strength" else 7200
                if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not 0 <= value <= maximum:
                    raise ValueError("Invalid numeric parameter")
            elif not isinstance(value, str) or len(value) > 16000 or "\x00" in value:
                raise ValueError("Invalid text parameter")
        enums = {"target": {"speech", "effects", "music"}, "variant": {"base", "flash"}, "mode": {"manual", "automatic"}}
        for key, values in enums.items():
            if key in params and params[key] not in values:
                raise ValueError("Unsupported audio setting")
        if "engine" in params and params["engine"] not in ({"tiger", "bandit"} if operation == "separate" else {"ffmpeg", "mossformer"}):
            raise ValueError("Unsupported engine")
        for key in ({"speech": ["text", "instruction", "seconds"], "music": ["prompt", "seconds"], "effects": ["prompt", "seconds", "mode"]}.get(operation, [])):
            if key not in params:
                raise ValueError("Missing required audio parameter")
        gpu = raw.get("gpu")
        ai = operation in {"separate", "speech", "music", "effects"} or operation == "enhance" and params.get("engine") == "mossformer"
        if gpu != self.config["localGpu"] and (gpu != "cpu" or ai):
            raise ValueError("GPU is not available on this audio worker")
        capability = "speech-base" if operation == "speech" and params.get("variant") == "base" else "enhance-mossformer" if operation == "enhance" and params.get("engine") == "mossformer" else "separate-bandit" if operation == "separate" and params.get("engine") == "bandit" else operation
        if ai and not self.config.get("verified", {}).get(capability, {}).get(gpu):
            raise ValueError("Engine is not qualified on this worker")
        source = None
        if raw.get("input") is not None:
            item = raw["input"]
            object_only(item, {"name", "bytes", "sha256"})
            source = self.input_file(root, item.get("name"))
            if not isinstance(item.get("bytes"), int) or not 0 < item["bytes"] <= MAX_FILE or not re.fullmatch(r"[a-f0-9]{64}", str(item.get("sha256"))):
                raise ValueError("Invalid input receipt")
            if not source.is_file() or source.stat().st_size != item["bytes"] or digest(source) != item["sha256"]:
                raise ValueError("Input checksum mismatch")
        if operation in {"import", "extract", "enhance", "separate"} or operation == "effects" and params.get("mode") == "automatic":
            if source is None:
                raise ValueError("Source media is required")
        return {"id": root.name, "operation": operation, "gpu": gpu, "params": params,
                "session": {}, "source": str(source) if source else None, "remoteLeaseSeconds": 60}

    def artifacts(self, root):
        result = json.loads((root / "result.json").read_text())
        files = {}
        for index, asset in enumerate(result.get("assets", [])):
            file = Path(asset["file"])
            # The worker writes flat output files. Never expose a general reader.
            if file.parent != root or file.is_symlink() or not file.is_file() or not stat.S_ISREG(file.stat().st_mode):
                raise ValueError("Unsafe output artifact")
            files[str(index)] = {"file": file, "bytes": file.stat().st_size, "sha256": digest(file)}
        return result, files

    def handle(self, packet):
        object_only(packet, {"action", "id", "name", "offset", "data", "manifest", "artifact"})
        action = packet.get("action")
        shapes = {"probe": set(), "create": {"id"}, "upload": {"id", "name", "offset", "data"},
                  "run": {"id", "manifest"}, "status": {"id"}, "cancel": {"id"},
                  "result": {"id"}, "download": {"id", "artifact", "offset"}}
        if action not in shapes or set(packet) != {"action"} | shapes[action]:
            raise ValueError("Unsupported audio protocol action")
        if action == "probe":
            return {"protocol": PROTOCOL, "gpu": self.config["localGpu"], "workerReady": (self.bundle / "audio-editing-worker.py").is_file(), "restricted": True}
        if action == "create":
            identifier = packet["id"]
            if not isinstance(identifier, str) or str(uuid.UUID(identifier)) != identifier:
                raise ValueError("Invalid job identifier")
            root = self.jobs / identifier
            root.mkdir(mode=0o700, exist_ok=True)
            root = self.job(identifier)
            (root / "inputs").mkdir(mode=0o700, exist_ok=True)
            (root / "temp").mkdir(mode=0o700, exist_ok=True)
            return {"id": identifier}
        root = self.job(packet["id"])
        if action in {"upload", "run"}:
            with (root / "protocol.lock").open("a") as lock:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                if (root / "request.json").exists() or (root / "cancel").exists():
                    raise ValueError("Job is already sealed or canceled")
                if action == "upload":
                    file = self.input_file(root, packet["name"])
                    offset = packet["offset"]
                    if type(offset) is not int or offset < 0 or offset != (file.stat().st_size if file.exists() else 0):
                        raise ValueError("Unexpected upload offset")
                    data = base64.b64decode(packet["data"], validate=True)
                    if not 0 < len(data) <= CHUNK or offset + len(data) > MAX_FILE:
                        raise ValueError("Upload exceeds media limit")
                    if any(p.name != file.name for p in (root / "inputs").iterdir()):
                        raise ValueError("Only one job source is supported")
                    if shutil.disk_usage(root).free < len(data) + 1024 ** 3:
                        raise ValueError("Insufficient experimental disk space")
                    fd = os.open(file, os.O_WRONLY | os.O_CREAT | os.O_APPEND | os.O_NOFOLLOW, 0o600)
                    with os.fdopen(fd, "ab") as stream:
                        stream.write(data)
                    return {"bytes": offset + len(data)}
                try:
                    manifest = self.manifest(root, packet["manifest"])
                except (ValueError, TypeError, KeyError):
                    return {"executionRejected": True, "error": "Audio manifest failed validation"}
                atomic(root / "request.json", manifest)
                return self.run(root)
        if action == "cancel":
            # The native worker checks this marker. Never accept or signal PIDs.
            (root / "cancel").touch(mode=0o600)
            return {"cancelRequested": True}
        if action == "status":
            (root / "transport-heartbeat").touch(mode=0o600)
            file = root / "status.json"
            state = json.loads(file.read_text()) if file.exists() else {"id": root.name, "status": "queued", "stage": "Waiting for isolated worker", "progress": 0}
            exited = (root / "exit.json").is_file()
            if state["status"] in {"completed", "failed", "canceled"} and not exited:
                state.update(status="running", stage="Waiting for isolated worker to release resources")
            return {"state": state, "workerExited": exited}
        if action == "result":
            state = json.loads((root / "status.json").read_text())
            if state["status"] != "completed" or not (root / "exit.json").is_file():
                raise ValueError("No completed output")
            result, files = self.artifacts(root)
            for index, asset in enumerate(result["assets"]):
                asset.pop("file", None)
                asset["artifact"] = str(index)
            return {"result": result, "files": {key: {k: v for k, v in item.items() if k != "file"} for key, item in files.items()}}
        if action == "download":
            # Resolve only indices of completed, worker-authored result assets.
            if json.loads((root / "status.json").read_text())["status"] != "completed" or not (root / "exit.json").is_file():
                raise ValueError("No completed output")
            result = json.loads((root / "result.json").read_text())
            index = packet["artifact"]
            if not isinstance(index, str) or not re.fullmatch(r"0|[1-9][0-9]{0,2}", index) or int(index) >= len(result["assets"]):
                raise ValueError("Unknown artifact")
            file = Path(result["assets"][int(index)]["file"])
            if file.parent != root or file.is_symlink() or not file.is_file():
                raise ValueError("Unsafe output artifact")
            offset = packet["offset"]
            if type(offset) is not int or not 0 <= offset <= file.stat().st_size:
                raise ValueError("Invalid download offset")
            with file.open("rb") as stream:
                stream.seek(offset)
                data = stream.read(CHUNK)
            return {"data": base64.b64encode(data).decode(), "bytes": len(data)}

    def run(self, root):
        cache = self.bundle / "engine-cache"
        env = {"PATH": "/usr/local/bin:/usr/bin:/bin", "LANG": "C.UTF-8", "HOME": str(self.bundle),
               "OTG_AUDIO_ENGINE_CONFIG": str(self.bundle / "engines.json"), "TMPDIR": str(root / "temp"),
               "HF_HUB_OFFLINE": "1", "TRANSFORMERS_OFFLINE": "1", "OMP_NUM_THREADS": "4", "MKL_NUM_THREADS": "4"}
        for key, name in {"HF_HOME": "huggingface", "TORCH_HOME": "torch", "TRITON_CACHE_DIR": "triton", "XDG_CACHE_HOME": "xdg"}.items():
            directory = cache / name
            directory.mkdir(mode=0o700, parents=True, exist_ok=True)
            env[key] = str(directory)
        (root / "transport-heartbeat").touch(mode=0o600)
        with (root / "worker.log").open("ab") as log:
            child = subprocess.Popen([self.config["python"], str(self.bundle / "audio-editing-worker.py"), str(root / "request.json")],
                                     env=env, stdin=subprocess.DEVNULL, stdout=log, stderr=log)
            def stop(_signum, _frame):
                (root / "cancel").touch(mode=0o600)
                if child.poll() is None:
                    child.terminate()
            previous = {number: signal.signal(number, stop) for number in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP)}
            try:
                child.wait(timeout=7200)
            except subprocess.TimeoutExpired:
                stop(None, None)
                child.wait(timeout=30)
            finally:
                for number, handler in previous.items():
                    signal.signal(number, handler)
            atomic(root / "exit.json", {"exitCode": child.returncode})
        return {"exitCode": child.returncode}


def main():
    os.umask(0o077)
    if len(sys.argv) != 1 or os.environ.get("SSH_ORIGINAL_COMMAND") != PROTOCOL:
        raise ValueError("Only the restricted audio protocol is permitted")
    raw = sys.stdin.buffer.readline(1024 * 1024 + 1)
    if len(raw) > 1024 * 1024 or not raw.endswith(b"\n"):
        raise ValueError("Invalid protocol message size")
    result = Gateway(Path(__file__).parent).handle(json.loads(raw))
    print(json.dumps({"ok": True, **result}), flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # No tracebacks, config paths, environment, or subprocess output on SSH.
        print(json.dumps({"ok": False, "error": str(error) if isinstance(error, ValueError) else "Restricted audio operation failed"}), flush=True)
        sys.exit(1)
