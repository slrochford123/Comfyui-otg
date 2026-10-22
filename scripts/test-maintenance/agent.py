#!/usr/bin/env python3
"""Fixed-purpose TEST maintenance agent. No user-controlled commands or targets."""
import fcntl
import hmac
import http.server
import json
import os
import socket
import subprocess
import time
import urllib.request

SERVICE = "comfyui-5060.service"
COMFY = "http://127.0.0.1:8188"
ACTIONS = {"status", "reset_comfy", "free_vram"}
TOKEN = os.environ.get("OTG_TEST_MAINTENANCE_TOKEN", "")

def command(args, timeout=10):
    return subprocess.run(args, stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=timeout, check=True).stdout.strip()

def comfy(route):
    with urllib.request.urlopen(COMFY + route, timeout=3) as response:
        return json.load(response)

def status():
    try:
        state = command(["/usr/bin/systemctl", "is-active", SERVICE])
    except (subprocess.SubprocessError, OSError):
        state = "inactive"
    try:
        q = comfy("/queue")
        if not isinstance(q.get("queue_running"), list) or not isinstance(q.get("queue_pending"), list):
            raise ValueError("Invalid queue")
        comfy("/system_stats")
        ready = ("busy" if q["queue_running"] or q["queue_pending"] else "ready") if state == "active" else "unmanaged"
    except Exception:
        ready = "offline"
    try:
        fields = command(["/usr/bin/nvidia-smi", "--id=0", "--query-gpu=name,memory.used,memory.total", "--format=csv,noheader,nounits"]).split(",")
        gpu = {"name": fields[0].strip(), "usedMiB": int(fields[1]), "totalMiB": int(fields[2])}
    except Exception:
        gpu = {"name":"RTX 5060 Ti", "usedMiB":None, "totalMiB":None}
    return {"host":socket.gethostname(), "target":"5060ti", "services":{"comfy8188":{"state":state,"http":ready},"h38189":{"state":"not-applicable","http":"not-applicable"}},"gpu":gpu}

def operate(action):
    if action not in ACTIONS:
        return 400, {"ok":False,"error":"Unknown maintenance action."}
    if action == "status":
        return 200, {"ok":True,"status":status()}
    lock = open("/run/lock/otg-test-5060-maintenance.lock", "a")
    try:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return 409, {"ok":False,"error":"Maintenance is already in progress."}
        current = status()
        if current["services"]["comfy8188"]["state"] != "active" and current["services"]["comfy8188"]["http"] != "offline":
            return 409, {"ok":False,"error":"A live worker is not managed by the expected TEST service. Maintenance refused."}
        if current["services"]["comfy8188"]["state"] == "active":
            try:
                q = comfy("/queue")
                if q.get("queue_running") or q.get("queue_pending"):
                    return 409, {"ok":False,"error":"Worker is busy. Wait for jobs to finish before maintenance."}
                if not isinstance(q.get("queue_running"), list) or not isinstance(q.get("queue_pending"), list):
                    raise ValueError("Missing queue")
            except Exception:
                return 409, {"ok":False,"error":"Cannot verify the active worker queue. Maintenance refused."}
        # Only the systemd cgroup for the fixed Comfy service is affected.
        command(["/usr/bin/systemctl", "stop", SERVICE], timeout=125)
        if action == "reset_comfy":
            command(["/usr/bin/systemctl", "start", SERVICE], timeout=30)
            deadline = time.monotonic() + 150
            while time.monotonic() < deadline:
                current = status()
                if current["services"]["comfy8188"]["http"] == "ready":
                    return 200, {"ok":True,"action":action,"status":current}
                time.sleep(1)
            return 503, {"ok":False,"error":"Worker restart did not reach readiness. Check the TEST maintenance journal.","status":status()}
        current = status()
        if current["services"]["comfy8188"]["state"] == "active":
            return 503, {"ok":False,"error":"Worker did not stop.","status":current}
        return 200, {"ok":True,"action":action,"status":current}
    except (subprocess.SubprocessError, OSError):
        return 503, {"ok":False,"error":"Fixed TEST worker operation failed. Inspect the maintenance service journal."}
    finally:
        lock.close()

class Handler(http.server.BaseHTTPRequestHandler):
    server_version = "TESTMaintenance/1"
    def log_message(self, fmt, *args):
        pass  # Never log request headers or credentials.
    def reply(self, code, payload):
        raw = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)
    def do_POST(self):
        supplied = self.headers.get("Authorization", "")
        if not TOKEN or not hmac.compare_digest(supplied, "Bearer " + TOKEN):
            return self.reply(401, {"ok":False,"error":"Unauthorized"})
        if self.path != "/maintenance":
            return self.reply(404, {"ok":False,"error":"Not found"})
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if size < 1 or size > 1024:
                raise ValueError("size")
            body = json.loads(self.rfile.read(size))
            if not isinstance(body, dict) or set(body) != {"action"} or not isinstance(body["action"], str):
                raise ValueError("body")
        except (ValueError, TypeError):
            return self.reply(400, {"ok":False,"error":"Invalid maintenance request."})
        code, payload = operate(body["action"])
        self.reply(code, payload)
    def do_GET(self):
        self.reply(405, {"ok":False,"error":"Use authenticated POST."})

if __name__ == "__main__":
    if len(TOKEN) < 32:
        raise SystemExit("A TEST maintenance token of at least 32 characters is required.")
    http.server.ThreadingHTTPServer(("100.98.212.116", 8799), Handler).serve_forever()
