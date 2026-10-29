"""Client for the audio-only SSH gateway; never sends shell or remote paths."""
import base64
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time
import uuid

CHUNK = 512 * 1024


def atomic(file, value):
    temporary = file.with_name(file.name + "." + uuid.uuid4().hex + ".tmp")
    temporary.write_text(json.dumps(value))
    temporary.replace(file)


def digest(file):
    value = hashlib.sha256()
    with file.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def ssh_command(config):
    # Transport configuration is server-owned, never sourced from a job/HTTP.
    for key in ("identityFile", "knownHostsFile"):
        if not Path(config[key]).is_absolute():
            raise ValueError("Absolute trusted SSH configuration required")
    return ["/usr/bin/ssh", "-F", "/dev/null", "-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes",
            "-o", "StrictHostKeyChecking=yes", "-o", "ConnectTimeout=8", "-o", "ServerAliveInterval=10",
            "-o", "ServerAliveCountMax=3", "-o", "ForwardAgent=no", "-o", "ClearAllForwardings=yes",
            "-o", "UserKnownHostsFile=" + config["knownHostsFile"], "-i", config["identityFile"],
            "--", config["host"], "slr-audio-v1"]


def wire_manifest(job):
    params = dict(job["params"])
    if job["operation"] == "speech":
        # The authenticated route already resolved/imported the reference into
        # this session. The worker needs the uploaded audio, not library IDs.
        params.pop("characterId", None)
        params.pop("voiceId", None)
    return {"operation": job["operation"], "gpu": job["gpu"], "params": params}


def main():
    request = Path(sys.argv[1]).resolve(strict=True)
    root = request.parent
    job = json.loads(request.read_text())
    if str(uuid.UUID(job["id"])) != job["id"] or root.name != job["id"]:
        raise ValueError("Invalid audio job identity")
    config = json.loads(Path(os.environ["OTG_AUDIO_ENGINE_CONFIG"]).read_text())
    transport = config["transports"][job["gpu"]]
    if transport.get("protocol") != "slr-audio-v1" or not transport.get("qualified"):
        raise ValueError("Restricted audio transport is not qualified")
    ssh = ssh_command(transport)
    interrupted = False
    submitted = False
    child = None

    def stop(_number, _frame):
        nonlocal interrupted
        interrupted = True
        # Do not kill the SSH supervisor: it must confirm remote child exit.
        (root / "cancel").touch(mode=0o600)

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)

    def rpc(packet, timeout=30):
        response = subprocess.run(ssh, input=(json.dumps(packet) + "\n").encode(), capture_output=True, timeout=timeout)
        value = json.loads(response.stdout)
        if response.returncode or not value.get("ok"):
            raise RuntimeError(value.get("error", "Restricted audio protocol failed"))
        return value

    def status(stage, progress=0, state="running"):
        atomic(root / "status.json", {"id": job["id"], "status": state, "stage": stage, "progress": progress})

    try:
        status("Preparing restricted audio transfer", 1)
        rpc({"action": "create", "id": job["id"]})
        manifest = wire_manifest(job)
        if job.get("source"):
            file = Path(job["source"]).resolve(strict=True)
            if not file.is_relative_to(root.parent.parent.resolve()):
                raise ValueError("Audio source is outside the owning session")
            name = "source" + file.suffix.lower()
            manifest["input"] = {"name": name, "bytes": file.stat().st_size, "sha256": digest(file)}
            offset = 0
            with file.open("rb") as stream:
                for data in iter(lambda: stream.read(CHUNK), b""):
                    if interrupted or (root / "cancel").exists():
                        raise InterruptedError("Canceled before audio execution")
                    receipt = rpc({"action": "upload", "id": job["id"], "name": name, "offset": offset, "data": base64.b64encode(data).decode()})
                    offset += len(data)
                    if receipt.get("bytes") != offset:
                        raise ValueError("Audio upload receipt mismatch")
        if interrupted or (root / "cancel").exists():
            raise InterruptedError("Canceled before audio execution")
        # Persist before submission. A lost SSH response is NOT proof of failure.
        atomic(root / "remote-execution.json", {"protocol": "slr-audio-v1", "id": job["id"], "outcome": "pending"})
        submitted = True
        with (root / "restricted-transport.log").open("ab") as log:
            child = subprocess.Popen(ssh, stdin=subprocess.PIPE, stdout=log, stderr=log)
            child.stdin.write((json.dumps({"action": "run", "id": job["id"], "manifest": manifest}) + "\n").encode())
            child.stdin.close()
            cancel_sent = False
            started = time.monotonic()
            while True:
                if interrupted or (root / "cancel").exists() or time.monotonic() - started > 7200:
                    if not cancel_sent:
                        try:
                            rpc({"action": "cancel", "id": job["id"]})
                            cancel_sent = True
                        except Exception:
                            pass
                try:
                    response = rpc({"action": "status", "id": job["id"]})
                    state = response["state"]
                    if response.get("workerExited"):
                        atomic(root / "remote-execution.json", {"protocol": "slr-audio-v1", "id": job["id"], "outcome": "exited"})
                        break
                    atomic(root / "status.json", state)
                    # A rejected run never launched a model. Publish failure only
                    # when its actual structured rejection has been received.
                    if child.poll() is not None:
                        lines = (root / "restricted-transport.log").read_text(errors="replace").splitlines()
                        try:
                            rejected = json.loads(lines[-1])
                        except (ValueError, IndexError):
                            rejected = {}
                        if rejected.get("executionRejected") is True:
                            atomic(root / "remote-execution.json", {"protocol": "slr-audio-v1", "id": job["id"], "outcome": "rejected"})
                            raise ValueError(rejected.get("error", "Remote audio job rejected"))
                        # One final read closes the race where run exited just
                        # after the status snapshot. No second submission occurs.
                        final = rpc({"action": "status", "id": job["id"]})
                        if final.get("workerExited"):
                            state = final["state"]
                            atomic(root / "remote-execution.json", {"protocol": "slr-audio-v1", "id": job["id"], "outcome": "exited"})
                            break
                        status("Remote execution is unconfirmed; GPU reservation retained. No duplicate job will be submitted.")
                        return 2
                except ValueError:
                    raise
                except Exception:
                    status("Remote execution is unconfirmed; GPU reservation retained. No duplicate job will be submitted.")
                    if child.poll() is not None:
                        # Exit with an unresolved receipt. App reconciliation must
                        # retain unknown outcome, not mark the job failed/retryable.
                        return 2
                time.sleep(2)
        if child is not None:
            child.wait(timeout=30)
        if state["status"] == "completed":
            status("Retrieving verified audio artifacts", 98)
            response = rpc({"action": "result", "id": job["id"]})
            result = response["result"]
            destination = root / "remote-output"
            destination.mkdir(mode=0o700, exist_ok=True)
            for asset in result["assets"]:
                key = asset.pop("artifact")
                receipt = response["files"][key]
                # Preserve only the trusted worker-generated media suffix.
                suffix = ".mp4" if asset.get("kind") == "video" else ".wav"
                file = destination / (str(int(key)) + suffix)
                offset = 0
                with file.open("xb") as stream:
                    while offset < receipt["bytes"]:
                        packet = rpc({"action": "download", "id": job["id"], "artifact": key, "offset": offset})
                        data = base64.b64decode(packet["data"], validate=True)
                        if not data or len(data) > CHUNK or offset + len(data) > receipt["bytes"]:
                            raise ValueError("Invalid audio download size")
                        stream.write(data)
                        offset += len(data)
                if digest(file) != receipt["sha256"]:
                    raise ValueError("Audio download checksum mismatch")
                asset["file"] = str(file)
            atomic(root / "result.json", result)
        atomic(root / "status.json", state)
        return 0 if state["status"] == "completed" else 1
    except Exception as error:
        unresolved = submitted and json.loads((root / "remote-execution.json").read_text()).get("outcome") == "pending"
        if unresolved:
            status("Remote execution is unconfirmed; reservation retained. No automatic retry.")
            return 2
        status("Restricted audio operation: " + str(error), state="canceled" if isinstance(error, InterruptedError) else "failed")
        return 1


if __name__ == "__main__":
    sys.exit(main())
