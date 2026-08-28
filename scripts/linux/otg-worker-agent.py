#!/usr/bin/env python3
"""Authenticated TEST-only lifecycle agent for the RTX 5060 Ti LTX service."""

from __future__ import annotations

import json
import os
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

BASE_URL = os.environ.get("OTG_BASE_URL", "http://100.75.162.64:3003").rstrip("/")
TOKEN = os.environ.get("OTG_WORKER_CONTROL_TOKEN") or os.environ.get("OTG_WORKER_TOKEN", "")
AGENT_ID = os.environ.get("OTG_WORKER_AGENT_ID", "slr-ltx-5060-agent")
SERVICE = "otg-character-ltx-audio-5060-3003.service"
HEALTH_URL = os.environ.get("OTG_LTX_5060_HEALTH_URL", "http://100.98.212.116:8191/system_stats")
CAPABILITIES = ["ltx-audio-5060"]


def api(path: str, payload: dict[str, Any]) -> dict[str, Any]:
    request = urllib.request.Request(
        urllib.parse.urljoin(BASE_URL + "/", path.lstrip("/")),
        data=json.dumps(payload).encode("utf-8"),
        headers={"content-type": "application/json", "authorization": f"Bearer {TOKEN}"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode("utf-8") or "{}")


def systemctl(*arguments: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["systemctl", *arguments, SERVICE],
        text=True,
        capture_output=True,
        timeout=60,
        check=False,
    )


def active_state() -> str:
    result = systemctl("is-active")
    return result.stdout.strip() or "inactive"


def wait_ready(timeout_seconds: int = 120) -> bool:
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(HEALTH_URL, timeout=5) as response:
                if response.status == 200:
                    return True
        except (urllib.error.URLError, TimeoutError):
            pass
        time.sleep(2)
    return False


def execute(action: str, dry_run: bool) -> dict[str, Any]:
    if dry_run:
        return {"workerId": "ltx-audio-5060", "action": action, "dryRun": True, "realAction": False, "finalState": active_state()}
    normalized = "start" if action == "ensure-running" else "stop" if action == "release" else action
    if normalized == "status":
        state = active_state()
        ready = wait_ready(1) if state == "active" else False
        return {"workerId": "ltx-audio-5060", "action": action, "dryRun": False, "realAction": True, "finalState": state, "health": {"ok": ready, "summary": "8191 ready" if ready else "8191 not ready"}}
    result = systemctl(normalized)
    if result.returncode != 0:
        raise RuntimeError((result.stderr or result.stdout or f"systemctl {normalized} failed").strip())
    state = active_state()
    ready = wait_ready() if normalized in ("start", "restart") else state != "active"
    if not ready:
        raise RuntimeError(f"{SERVICE} did not reach the requested {normalized} state")
    return {"workerId": "ltx-audio-5060", "action": action, "dryRun": False, "realAction": True, "finalState": state, "health": {"ok": ready, "summary": "8191 ready" if state == "active" else "service stopped"}}


def main() -> int:
    if not TOKEN:
        raise RuntimeError("OTG_WORKER_CONTROL_TOKEN or OTG_WORKER_TOKEN is required")
    while True:
        try:
            claimed = api("/api/worker-control/agent/claim", {"agentId": AGENT_ID, "platform": "linux", "capabilities": CAPABILITIES})
            command = claimed.get("command")
            if not isinstance(command, dict):
                time.sleep(2)
                continue
            command_id = str(command.get("commandId") or "")
            try:
                result = execute(str(command.get("action") or "status"), bool(command.get("dryRun")))
                api("/api/worker-control/agent/complete", {"commandId": command_id, "agentId": AGENT_ID, "result": result})
            except Exception as error:
                api("/api/worker-control/agent/fail", {"commandId": command_id, "agentId": AGENT_ID, "error": str(error)})
        except Exception as error:
            print(f"[agent] {error}", flush=True)
            time.sleep(5)


if __name__ == "__main__":
    raise SystemExit(main())
