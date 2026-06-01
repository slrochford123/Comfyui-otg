#!/usr/bin/env python3
"""Coordinator for OTG Windows worker adapters.

The Linux server is the control plane. This script runs on the main Windows PC
and dispatches durable jobs to existing local adapters. It intentionally keeps
the heavy model work outside the Linux host.
"""

from __future__ import annotations

import argparse
import subprocess
import sys
import time
from pathlib import Path


ADAPTERS = [
    {
        "name": "IndexTTS2 dataset",
        "script": Path("scripts/windows/indextts2-dataset-worker.py"),
    },
    {
        "name": "Applio training",
        "script": Path("scripts/windows/applio-training-worker.py"),
    },
    {
        "name": "Applio inference",
        "script": Path("scripts/windows/applio-inference-worker.py"),
    },
]


def run_adapter(args: argparse.Namespace, adapter: dict[str, object]) -> int:
    script = args.repo / adapter["script"]
    if not script.exists():
        print(f"[skip] Missing {adapter['name']} adapter: {script}", flush=True)
        return 0

    command = [
        sys.executable,
        str(script),
        "--base-url",
        args.base_url,
        "--owner-key",
        args.owner_key,
        "--worker-id",
        f"{args.worker_id}-{str(adapter['name']).lower().replace(' ', '-')}",
    ]
    print(f"[run] {adapter['name']}", flush=True)
    completed = subprocess.run(command, cwd=args.repo)
    return completed.returncode


def run_once(args: argparse.Namespace) -> int:
    exit_code = 0
    for adapter in ADAPTERS:
        code = run_adapter(args, adapter)
        if code != 0:
            exit_code = code
            if args.stop_on_error:
                return exit_code
    return exit_code


def main() -> int:
    parser = argparse.ArgumentParser(description="OTG Windows worker coordinator")
    parser.add_argument("--repo", default=r"C:\AI\OTG-Test2")
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--owner-key", required=True)
    parser.add_argument("--worker-id", default="windows-main-pc")
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--interval-seconds", type=int, default=30)
    parser.add_argument("--stop-on-error", action="store_true")
    args = parser.parse_args()
    args.repo = Path(args.repo).resolve()

    if args.once:
        return run_once(args)

    while True:
        code = run_once(args)
        if code != 0 and args.stop_on_error:
            return code
        time.sleep(max(5, args.interval_seconds))


if __name__ == "__main__":
    raise SystemExit(main())
