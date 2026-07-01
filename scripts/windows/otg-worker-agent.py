#!/usr/bin/env python3
"""Dry-run OTG worker lifecycle agent.

The Linux control plane may request lifecycle actions by worker ID only. This
Phase 1 agent never executes shell commands from the API and defaults to dry-run
completion for every known worker/action pair.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from typing import Any


LOCAL_WORKERS: dict[str, dict[str, Any]] = {
    "voice-ltx": {"platform": "windows", "actions": {"status", "start", "stop", "restart", "ensure-running", "release"}},
    "comfy-3090-sage-video": {"platform": "windows", "actions": {"status", "start", "stop", "restart", "ensure-running", "release"}},
    "qwen3-tts": {"platform": "windows", "actions": {"status", "start", "stop", "restart", "ensure-running", "release"}},
    "xtts": {"platform": "windows", "actions": {"status", "start", "stop", "restart", "ensure-running", "release"}},
    "cozyvoice": {"platform": "windows", "actions": {"status", "start", "stop", "restart", "ensure-running", "release"}},
    "applio": {"platform": "windows", "actions": {"status", "start", "stop", "restart", "ensure-running", "release"}},
    "voice-dataset": {"platform": "windows", "actions": {"status", "start", "stop", "restart", "ensure-running", "release"}},
    "bg-remove": {"platform": "linux", "actions": {"status", "start", "stop", "restart", "ensure-running", "release"}},
}


def mask_token(value: str) -> str:
    if not value:
        return ""
    return "[masked]"


def api_request(base_url: str, path: str, token: str, payload: dict[str, Any]) -> dict[str, Any]:
    url = base_url.rstrip("/") + path
    data = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=data,
        headers={
            "content-type": "application/json",
            "authorization": f"Bearer {token}",
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def local_capabilities(platform: str) -> list[str]:
    return sorted(worker_id for worker_id, spec in LOCAL_WORKERS.items() if spec["platform"] == platform)


def validate_command(command: dict[str, Any], platform: str) -> str | None:
    worker_id = str(command.get("workerId") or "").strip()
    action = str(command.get("action") or "").strip()
    spec = LOCAL_WORKERS.get(worker_id)
    if not spec:
        return f"Unknown local workerId: {worker_id}"
    if spec["platform"] != platform:
        return f"Worker {worker_id} is not available on platform {platform}"
    if action not in spec["actions"]:
        return f"Action {action} is not allowed for worker {worker_id}"
    return None


def complete_dry_run(base_url: str, token: str, agent_id: str, command: dict[str, Any]) -> None:
    result = {
        "dryRun": True,
        "simulated": True,
        "workerId": command["workerId"],
        "action": command["action"],
        "message": "Phase 1 dry-run agent validated the named worker/action and did not start or stop a real process.",
    }
    api_request(
        base_url,
        "/api/worker-control/agent/complete",
        token,
        {"agentId": agent_id, "commandId": command["commandId"], "result": result},
    )


def fail_command(base_url: str, token: str, agent_id: str, command: dict[str, Any], error: str) -> None:
    api_request(
        base_url,
        "/api/worker-control/agent/fail",
        token,
        {"agentId": agent_id, "commandId": command.get("commandId"), "error": error},
    )


def run_once(args: argparse.Namespace, token: str) -> int:
    capabilities = local_capabilities(args.platform)
    response = api_request(
        args.base_url,
        "/api/worker-control/agent/claim",
        token,
        {"agentId": args.agent_id, "platform": args.platform, "capabilities": capabilities},
    )
    command = response.get("command")
    if not command:
        print(f"[idle] no lifecycle command for {args.agent_id}", flush=True)
        return 0

    print(
        f"[claim] commandId={command.get('commandId')} workerId={command.get('workerId')} "
        f"action={command.get('action')} dryRun={command.get('dryRun')}",
        flush=True,
    )
    validation_error = validate_command(command, args.platform)
    if validation_error:
        fail_command(args.base_url, token, args.agent_id, command, validation_error)
        print(f"[fail] {validation_error}", flush=True)
        return 2

    if args.dry_run or command.get("dryRun", True):
        complete_dry_run(args.base_url, token, args.agent_id, command)
        print("[complete] dry-run lifecycle command completed", flush=True)
        return 0

    fail_command(args.base_url, token, args.agent_id, command, "Real lifecycle execution is not implemented in Phase 1.")
    print("[fail] real lifecycle execution is not implemented in Phase 1", flush=True)
    return 2


def main() -> int:
    parser = argparse.ArgumentParser(description="OTG worker-control dry-run agent")
    parser.add_argument("--base-url", default=os.environ.get("OTG_BASE_URL", "http://127.0.0.1:3001"))
    parser.add_argument("--agent-id", default=os.environ.get("OTG_WORKER_CONTROL_AGENT_ID", "windows-main-agent"))
    parser.add_argument("--platform", choices=["windows", "linux"], default="windows")
    parser.add_argument("--poll-seconds", type=int, default=int(os.environ.get("OTG_WORKER_CONTROL_POLL_SECONDS", "5")))
    parser.add_argument("--dry-run", action="store_true", default=True)
    parser.add_argument("--once", action="store_true")
    args = parser.parse_args()

    token = os.environ.get("OTG_WORKER_CONTROL_TOKEN") or os.environ.get("OTG_WORKER_TOKEN") or ""
    if not token.strip():
        print("Missing OTG_WORKER_CONTROL_TOKEN or OTG_WORKER_TOKEN in environment.", file=sys.stderr)
        return 1
    print(f"[start] agent={args.agent_id} platform={args.platform} token={mask_token(token)} dryRun={args.dry_run}", flush=True)

    while True:
        try:
            code = run_once(args, token)
        except urllib.error.HTTPError as exc:
            body = exc.read().decode("utf-8", errors="replace")[:500]
            print(f"[http-error] status={exc.code} body={body}", flush=True)
            code = 1
        except Exception as exc:
            print(f"[error] {exc}", flush=True)
            code = 1
        if args.once:
            return code
        time.sleep(max(1, args.poll_seconds))


if __name__ == "__main__":
    raise SystemExit(main())
