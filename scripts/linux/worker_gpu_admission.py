"""Durable, fail-closed RTX3090 admission for fixed-runtime Linux voice workers.

Uses the EXISTING protocol-2 authority; this SQLite file is only a client journal.
No model substitutions, downloads, submissions, or automatic execution recovery.
"""
from __future__ import annotations

import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import subprocess
import time
import urllib.request
import uuid

GPU = "rtx3090"
GPU_UUID = "GPU-c5d34248-3562-c0e1-5fa6-5e10849a72b3"
QUEUES = ("http://100.75.162.64:8188/queue", "http://100.75.162.64:8189/queue")


class AdmissionUnconfirmed(RuntimeError):
    pass


def assert_same_claim(current, claimed, worker_id):
    """Waiting must not revive an expired/canceled/reclaimed app job."""
    if current.get("status") != "running" or current.get("workerId") != worker_id:
        raise AdmissionUnconfirmed("The original worker claim is no longer active.")
    for field in ("attempt", "claimedAt"):
        if claimed.get(field) is not None and current.get(field) != claimed[field]:
            raise AdmissionUnconfirmed("The worker claim changed while awaiting admission.")


def authority_request(packet):
    filename = os.environ.get("OTG_MEDIA_ADMISSION_CONFIG", "")
    if not filename or not Path(filename).is_absolute():
        raise AdmissionUnconfirmed("The existing shared GPU authority config is required.")
    stat = Path(filename).stat()
    if stat.st_mode & 0o022 or stat.st_uid not in (0, os.getuid()):
        raise AdmissionUnconfirmed("Untrusted authority configuration.")
    cfg = json.loads(Path(filename).read_text())
    script = cfg.get("script", "")
    if not script.startswith("/") or not re.fullmatch(r"[A-Za-z0-9_./-]+", script) or ".." in Path(script).parts:
        raise AdmissionUnconfirmed("Invalid installed authority path.")
    if cfg.get("mode") == "ssh":
        target = cfg.get("target", "")
        if not re.fullmatch(r"[A-Za-z0-9_.@:-]+", target) or target.startswith("-"):
            raise AdmissionUnconfirmed("Invalid authority transport.")
        command = ["/usr/bin/ssh", *cfg.get("sshOptions", []), "-o", "BatchMode=yes", "-o", "ConnectTimeout=5",
                   "-o", "ClearAllForwardings=yes", "--", target, "/usr/bin/python3 " + script]
    elif cfg.get("mode") == "local":
        command = ["/usr/bin/python3", script]
    else:
        raise AdmissionUnconfirmed("Unsupported authority transport.")
    try:
        result = subprocess.run(command, input=json.dumps(packet) + "\n", text=True,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=15, check=False)
        response = json.loads(result.stdout)
        if result.returncode or response.get("ok") is not True:
            raise ValueError()
        return response
    except Exception as error:
        # Never print config, SSH arguments, credentials or raw backend responses.
        raise AdmissionUnconfirmed("GPU authority outcome is unconfirmed; reservation is protected.") from error


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def physical_idle():
    """Read both lanes and the fixed GPU identity. No /free or model operation."""
    try:
        opener = urllib.request.build_opener(_NoRedirect)
        for url in QUEUES:
            with opener.open(url, timeout=5) as response:
                state = json.load(response)
            if not isinstance(state.get("queue_running"), list) or not isinstance(state.get("queue_pending"), list):
                return False
            if state["queue_running"] or state["queue_pending"]:
                return False
        devices = subprocess.check_output(["nvidia-smi", "--query-gpu=uuid", "--format=csv,noheader"], text=True, timeout=5).splitlines()
        # These workers use CUDA:0. Require explicit UUID pinning or one physical card.
        visible = os.environ.get("CUDA_VISIBLE_DEVICES")
        if GPU_UUID not in devices or (visible != GPU_UUID and devices != [GPU_UUID]):
            return False
        processes = subprocess.check_output(["nvidia-smi", "--query-compute-apps=pid,gpu_uuid,used_memory", "--format=csv,noheader,nounits"], text=True, timeout=5)
        for line in processes.splitlines():
            pid, gpu, memory = [part.strip() for part in line.split(",")]
            if gpu != GPU_UUID:
                continue
            proc = Path("/proc") / pid
            cmd = (proc / "cmdline").read_bytes().decode(errors="replace")
            comfy = "main.py" in cmd and "comfy" in str((proc / "cwd").resolve()).lower()
            if not comfy and float(memory) > 512:
                return False
        return True
    except Exception:
        return False


class WorkerGpuAdmission:
    def __init__(self, worker_id, job_id, *, journal=None, request=None, probe=None, sleep=time.sleep):
        filename = journal or os.environ.get("OTG_WORKER_GPU_ADMISSION_DB", "")
        if not filename or not Path(filename).is_absolute():
            raise AdmissionUnconfirmed("A persistent worker GPU admission journal is required.")
        self.request, self.probe, self.sleep = request or authority_request, probe or physical_idle, sleep
        self.key = hashlib.sha256((worker_id + "\0" + job_id).encode()).hexdigest()
        Path(filename).parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.guard = open(str(filename) + "." + self.key + ".lock", "a")
        os.chmod(self.guard.name, 0o600)
        try:
            fcntl.flock(self.guard.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except Exception:
            self.guard.close()
            raise AdmissionUnconfirmed("Another process owns this worker/job admission attempt.")
        self.db = sqlite3.connect(filename, timeout=10)
        os.chmod(filename, 0o600)
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA synchronous=FULL")
        self.db.execute("CREATE TABLE IF NOT EXISTS attempts (job_key TEXT PRIMARY KEY, owner TEXT UNIQUE NOT NULL, phase TEXT NOT NULL, ticket INTEGER, token INTEGER, pid INTEGER NOT NULL, updated REAL NOT NULL)")
        with self.db:
            self.db.execute("INSERT OR IGNORE INTO attempts(job_key,owner,phase,pid,updated) VALUES(?,?,'waiting',?,?)",
                            (self.key, str(uuid.uuid4()), os.getpid(), time.time()))

    def row(self):
        return dict(self.db.execute("SELECT * FROM attempts WHERE job_key=?", (self.key,)).fetchone())

    def save(self, phase, **values):
        if set(values) - {"ticket", "token"}:
            raise ValueError("Invalid journal fields")
        with self.db:
            self.db.execute("UPDATE attempts SET phase=?,updated=?" + "".join("," + key + "=?" for key in values) + " WHERE job_key=?",
                            [phase, time.time(), *values.values(), self.key])

    def call(self, action, **extra):
        return self.request({"action": action, "gpu": GPU, "owner": self.row()["owner"], **extra})

    def acquire(self, assert_active=lambda: None):
        row = self.row()
        if row["phase"] in ("executing", "unknown", "released", "canceled"):
            raise AdmissionUnconfirmed("Prior execution is terminal or unconfirmed; automatic replay is forbidden.")
        if row["phase"] == "releasing":
            self.finish(cleanup_confirmed=True)
            raise AdmissionUnconfirmed("Prior completed execution was reconciled; it will not be replayed.")
        while True:
            try:
                assert_active()
            except BaseException:
                self.cancel_unstarted()
                raise
            row = self.row()
            if row["phase"] == "waiting":
                ticket = self.call("enqueue", gpus=[GPU])
                if ticket.get("state") != "waiting" or type(ticket.get("ticket")) is not int or ticket["ticket"] < 1:
                    raise AdmissionUnconfirmed("Waiting ticket cannot be confirmed; no execution is authorized.")
                self.save("waiting", ticket=ticket["ticket"])
                if not self.probe():
                    self.sleep(2)
                    continue
                self.save("admitting")  # Durable before possibly-lost grant response.
            if self.row()["phase"] == "admitting":
                grant = self.call("acquire", ticket=self.row()["ticket"])
                if grant.get("granted") is False:
                    self.save("waiting")
                    self.sleep(2)
                    continue
                if grant.get("granted") is not True or type(grant.get("token")) is not int or grant["token"] < 1:
                    raise AdmissionUnconfirmed("Invalid GPU grant; outcome remains protected.")
                self.save("granted", token=grant["token"])
            if self.row()["phase"] == "granted" and self.probe():
                # Cancellation/reclaim can arrive during the final physical probe.
                try:
                    assert_active()
                except BaseException:
                    self.cancel_unstarted()
                    raise
                return self
            self.sleep(2)

    def begin(self):
        if self.row()["phase"] != "granted":
            raise AdmissionUnconfirmed("Execution requires an unstarted durable grant.")
        status = self.call("status")
        if status.get("owned") is not True or status.get("busy") is not True:
            raise AdmissionUnconfirmed("GPU ownership could not be confirmed before execution.")
        self.save("executing")  # BEFORE flock, /free, imports/model load or subprocesses.

    def cancel_unstarted(self):
        row = self.row()
        if row["phase"] == "waiting":
            # Enqueue is idempotent and recovers a lost initial registration reply.
            ticket = self.call("enqueue", gpus=[GPU])
            result = self.call("cancel", ticket=ticket["ticket"])
            if result.get("done") is not True:
                raise AdmissionUnconfirmed("Waiting cancellation is unconfirmed.")
            self.save("canceled")
            return True
        if row["phase"] == "granted":
            return self.finish(cleanup_confirmed=True)
        # Admitting can own an unknown token; cancel must not guess/release it.
        return False

    def finish(self, *, cleanup_confirmed):
        row = self.row()
        if row["phase"] in ("released", "canceled"):
            return True
        if row["phase"] == "waiting":
            return self.cancel_unstarted()
        if row["phase"] == "admitting":
            return False
        if row["phase"] == "granted":
            cleanup_confirmed = True  # begin() never authorized GPU work.
        if not cleanup_confirmed:
            self.save("unknown")
            return False
        if row["phase"] not in ("executing", "granted", "releasing") or not row["token"]:
            return False
        self.save("releasing")  # Retry only release after crash, never the model work.
        if not self.probe():
            return False
        result = self.call("release", token=row["token"])
        if result.get("done") is not True:
            raise AdmissionUnconfirmed("GPU release is unconfirmed; same-token retry is required.")
        self.save("released")
        return True

    def close(self):
        self.db.close()
        fcntl.flock(self.guard.fileno(), fcntl.LOCK_UN)
        self.guard.close()
