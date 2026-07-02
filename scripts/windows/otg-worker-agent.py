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
import re
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from typing import Any


LOCAL_WORKERS: dict[str, dict[str, Any]] = {
    "voice-ltx": {"platform": "windows", "actions": {"status", "start", "stop", "restart", "ensure-running", "release"}},
    "comfy-3090-sage-video": {"platform": "windows", "actions": {"status", "start", "stop", "restart", "ensure-running", "release"}},
    "qwen3-tts": {"platform": "windows", "actions": {"status", "start", "stop", "restart", "ensure-running", "release"}},
    "voice-design": {"platform": "windows", "actions": {"status", "start", "stop", "restart", "ensure-running", "release"}},
    "xtts": {"platform": "windows", "actions": {"status", "start", "stop", "restart", "ensure-running", "release"}},
    "cozyvoice": {"platform": "windows", "actions": {"status", "start", "stop", "restart", "ensure-running", "release"}},
    "applio": {"platform": "windows", "actions": {"status", "start", "stop", "restart", "ensure-running", "release"}},
    "voice-dataset": {"platform": "windows", "actions": {"status", "start", "stop", "restart", "ensure-running", "release"}},
    "bg-remove": {"platform": "windows", "actions": {"status", "start", "stop", "restart", "ensure-running", "release"}},
    "whisper": {"platform": "windows", "actions": {"status", "start", "stop", "restart", "ensure-running", "release"}},
    "speaker-diarization": {"platform": "windows", "actions": {"status", "start", "stop", "restart", "ensure-running", "release"}},
    "character-preview": {"platform": "windows", "actions": {"status", "start", "stop", "restart", "ensure-running", "release"}},
    "ace-step": {"platform": "windows", "actions": {"status", "start", "stop", "restart", "ensure-running", "release"}},
}

REAL_ACTION_WORKERS = {"voice-ltx", "qwen3-tts", "voice-design", "voice-dataset", "applio", "xtts", "whisper", "speaker-diarization"}


def mask_token(value: str) -> str:
    if not value:
        return ""
    text = str(value)
    known_tokens = [
        os.environ.get("OTG_WORKER_TOKEN") or "",
        os.environ.get("OTG_WORKER_CONTROL_TOKEN") or "",
    ]
    if any(token and text == token for token in known_tokens):
        return "[masked]"
    for token in known_tokens:
        if token:
            text = text.replace(token, "***MASKED***")
    text = re.sub(r"(?i)(--worker-token\s+)\S+", r"\1***MASKED***", text)
    text = re.sub(r"(?i)(authorization:\s*bearer\s+)\S+", r"\1***MASKED***", text)
    text = re.sub(r"(?i)(bearer\s+)\S+", r"\1***MASKED***", text)
    text = re.sub(r"(?i)(OTG_WORKER_TOKEN=)[^ ;\"]+", r"\1***MASKED***", text)
    text = re.sub(r"(?i)(OTG_WORKER_CONTROL_TOKEN=)[^ ;\"]+", r"\1***MASKED***", text)
    return text


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


def complete_command(base_url: str, token: str, agent_id: str, command: dict[str, Any], result: dict[str, Any]) -> None:
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
        {"agentId": agent_id, "commandId": command.get("commandId"), "error": mask_token(error)},
    )


def parse_manager_json(stdout: str) -> dict[str, Any]:
    text = stdout.strip()
    if not text:
        return {}
    return json.loads(text)


def run_worker_manager(manager_path: str, worker_id: str, manager_action: str) -> dict[str, Any]:
    if manager_action not in {"status", "start", "stop", "restart"}:
        raise RuntimeError(f"Unsupported WorkerManager action: {manager_action}")
    if worker_id not in REAL_ACTION_WORKERS:
        raise RuntimeError(f"Real lifecycle actions are not supported for {worker_id}.")
    command = [
        "powershell.exe",
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        manager_path,
        manager_action,
        worker_id,
        "-json",
    ]
    with tempfile.NamedTemporaryFile("w+", delete=False, encoding="utf-8") as stdout_file, tempfile.NamedTemporaryFile("w+", delete=False, encoding="utf-8") as stderr_file:
        stdout_path = stdout_file.name
        stderr_path = stderr_file.name
        completed = subprocess.run(
            command,
            text=True,
            stdout=stdout_file,
            stderr=stderr_file,
            timeout=120,
            check=False,
        )
    try:
        with open(stdout_path, "r", encoding="utf-8", errors="replace") as handle:
            stdout = handle.read()
        with open(stderr_path, "r", encoding="utf-8", errors="replace") as handle:
            stderr = handle.read()
    finally:
        for file_path in (stdout_path, stderr_path):
            try:
                os.unlink(file_path)
            except OSError:
                pass
    if completed.returncode != 0:
        output = mask_token((stderr or stdout or "").strip())
        raise RuntimeError(output or f"WorkerManager {manager_action} failed with exit code {completed.returncode}.")
    return parse_manager_json(stdout)


def status_state(status: dict[str, Any]) -> str:
    return str(status.get("state") or "").strip().lower()


def real_lifecycle_result(args: argparse.Namespace, command: dict[str, Any]) -> dict[str, Any]:
    worker_id = str(command.get("workerId") or "").strip()
    action = str(command.get("action") or "").strip()
    if worker_id not in REAL_ACTION_WORKERS:
        supported = ", ".join(sorted(REAL_ACTION_WORKERS))
        raise RuntimeError(f"Real lifecycle actions are only supported for {supported} in Phase 2A, not {worker_id}.")

    manager_path = args.worker_manager_path
    if not os.path.isfile(manager_path):
        raise RuntimeError(f"WorkerManager path not found: {manager_path}")

    message = ""
    if action == "status":
        final = run_worker_manager(manager_path, worker_id, "status")
        message = "WorkerManager status checked."
    elif action == "ensure-running":
        current = run_worker_manager(manager_path, worker_id, "status")
        state = status_state(current)
        if state == "running":
            final = current
            message = f"{worker_id} already running under WorkerManager."
        elif state == "stopped":
            run_worker_manager(manager_path, worker_id, "start")
            final = run_worker_manager(manager_path, worker_id, "status")
            message = f"{worker_id} started by WorkerManager."
        else:
            raise RuntimeError(f"Refusing ensure-running because {worker_id} state is {state or 'unknown'}.")
    elif action == "start":
        run_worker_manager(manager_path, worker_id, "start")
        final = run_worker_manager(manager_path, worker_id, "status")
        message = f"{worker_id} start requested through WorkerManager."
    elif action in {"stop", "release"}:
        run_worker_manager(manager_path, worker_id, "stop")
        final = run_worker_manager(manager_path, worker_id, "status")
        message = f"{worker_id} stopped by WorkerManager."
    elif action == "restart":
        run_worker_manager(manager_path, worker_id, "restart")
        final = run_worker_manager(manager_path, worker_id, "status")
        message = f"{worker_id} restarted by WorkerManager."
    else:
        raise RuntimeError(f"Unsupported lifecycle action for WorkerManager: {action}")

    health = final.get("health") if isinstance(final.get("health"), dict) else {}
    return {
        "workerId": worker_id,
        "action": action,
        "dryRun": False,
        "realAction": True,
        "managerPath": manager_path,
        "finalState": final.get("state"),
        "pid": final.get("pid"),
        "health": {
            "ok": health.get("ok"),
            "summary": health.get("summary"),
        },
        "message": message,
    }


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

    if not args.allow_real_actions:
        fail_command(args.base_url, token, args.agent_id, command, "Real lifecycle execution requires --allow-real-actions.")
        print("[fail] real lifecycle execution requires --allow-real-actions", flush=True)
        return 2

    try:
        result = real_lifecycle_result(args, command)
        complete_command(args.base_url, token, args.agent_id, command, result)
        print(f"[complete] real lifecycle command completed state={result.get('finalState')}", flush=True)
        return 0
    except Exception as exc:
        error = mask_token(str(exc))
        fail_command(args.base_url, token, args.agent_id, command, error)
        print(f"[fail] {error}", flush=True)
        return 2


def main() -> int:
    parser = argparse.ArgumentParser(description="OTG worker-control dry-run agent")
    parser.add_argument("--base-url", default=os.environ.get("OTG_BASE_URL", "http://127.0.0.1:3001"))
    parser.add_argument("--agent-id", default=os.environ.get("OTG_WORKER_CONTROL_AGENT_ID", "windows-main-agent"))
    parser.add_argument("--platform", choices=["windows", "linux"], default="windows")
    parser.add_argument("--poll-seconds", type=int, default=int(os.environ.get("OTG_WORKER_CONTROL_POLL_SECONDS", "5")))
    parser.add_argument("--worker-manager-path", default=os.environ.get("OTG_WORKER_MANAGER_PATH", r"C:\AI\OTG-WorkerManager\worker-manager.ps1"))
    parser.add_argument("--dry-run", action="store_true", default=False)
    parser.add_argument("--allow-real-actions", action="store_true", default=False)
    parser.add_argument("--once", action="store_true")
    args = parser.parse_args()

    token = os.environ.get("OTG_WORKER_CONTROL_TOKEN") or os.environ.get("OTG_WORKER_TOKEN") or ""
    if not token.strip():
        print("Missing OTG_WORKER_CONTROL_TOKEN or OTG_WORKER_TOKEN in environment.", file=sys.stderr)
        return 1
    effective_dry_run = args.dry_run or not args.allow_real_actions
    args.dry_run = effective_dry_run
    print(
        f"[start] agent={args.agent_id} platform={args.platform} token={mask_token(token)} "
        f"dryRun={args.dry_run} allowRealActions={args.allow_real_actions}",
        flush=True,
    )

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
