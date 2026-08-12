#!/usr/bin/env python3
"""Dedicated OTG Windows worker for Character Voice Lab dataset jobs.

This process intentionally claims only:
  jobType=character_voice_pipeline
  action=generate_training_dataset

The Linux host remains the control plane. IndexTTS2 generation runs on the
Windows execution PC through the existing dataset adapter.
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path


def env_default(name: str, fallback: str) -> str:
    return os.environ.get(name, fallback)


def build_command(args: argparse.Namespace, adapter: Path) -> list[str]:
    command = [
        sys.executable,
        str(adapter),
        "--base-url",
        args.base_url,
        "--owner-key",
        args.owner_key,
        "--device-id",
        args.device_id,
        "--worker-id",
        args.worker_id,
        "--index-root",
        args.index_root,
        "--index-python",
        args.index_python,
        "--work-root",
        args.work_root,
        "--upload-chunk-size",
        str(args.upload_chunk_size),
        "--max-clips",
        str(args.max_clips),
        "--clip-timeout-seconds",
        str(args.clip_timeout_seconds),
        "--upload-timeout-seconds",
        str(args.upload_timeout_seconds),
        "--poll-seconds",
        str(args.poll_seconds),
    ]
    if args.once:
        command.append("--once")
    if args.regenerate:
        command.append("--regenerate")
    if args.worker_token.strip():
        command.append("--universal-claim")
    return command


def main() -> int:
    parser = argparse.ArgumentParser(description="Dedicated OTG voice dataset Windows worker")
    parser.add_argument("--repo", default=env_default("OTG_REPO", r"C:\AI\OTG-Test2"))
    parser.add_argument("--base-url", default=env_default("OTG_BASE_URL", "http://127.0.0.1:3001"))
    parser.add_argument("--owner-key", default=env_default("OTG_OWNER_KEY", ""))
    parser.add_argument("--device-id", default=env_default("OTG_DEVICE_ID", "slrochford"))
    parser.add_argument("--worker-id", default=env_default("OTG_WORKER_ID", "windows-voice-dataset-worker"))
    parser.add_argument("--worker-token", default=env_default("OTG_WORKER_TOKEN", ""))
    parser.add_argument("--index-root", default=env_default("INDEXTTS2_ROOT", r"C:\AI\Voices\IndexTTS2"))
    parser.add_argument("--index-python", default=env_default("INDEXTTS2_PYTHON", r"C:\AI\Voices\IndexTTS2\.venv\Scripts\python.exe"))
    parser.add_argument("--work-root", default=env_default("OTG_INDEXTTS2_WORK_ROOT", r"C:\AI\OTG-Worker\voice-datasets"))
    parser.add_argument("--upload-chunk-size", type=int, default=int(env_default("OTG_INDEXTTS2_UPLOAD_CHUNK_SIZE", "10")))
    parser.add_argument("--max-clips", type=int, default=int(env_default("OTG_INDEXTTS2_MAX_CLIPS", "0")))
    parser.add_argument("--clip-timeout-seconds", type=int, default=int(env_default("OTG_INDEXTTS2_CLIP_TIMEOUT_SECONDS", "900")))
    parser.add_argument("--upload-timeout-seconds", type=int, default=int(env_default("OTG_INDEXTTS2_UPLOAD_TIMEOUT_SECONDS", "1800")))
    parser.add_argument("--poll-seconds", type=int, default=int(env_default("OTG_INDEXTTS2_POLL_SECONDS", "30")))
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--regenerate", action="store_true")
    args = parser.parse_args()

    if not args.worker_token.strip() and not args.owner_key.strip():
        raise RuntimeError("Missing --worker-token/OTG_WORKER_TOKEN. Owner-scoped legacy mode requires --owner-key.")

    repo = Path(args.repo).resolve()
    adapter = repo / "scripts" / "windows" / "indextts2-dataset-worker.py"
    if not adapter.exists():
        raise FileNotFoundError(f"IndexTTS2 dataset adapter not found: {adapter}")

    command = build_command(args, adapter)
    print("[start] OTG dedicated voice dataset worker", flush=True)
    print(f"[route] character_voice_pipeline / generate_training_dataset only", flush=True)
    print(f"[repo] {repo}", flush=True)
    print(f"[base-url] {args.base_url}", flush=True)
    print(f"[claim] {'all owners via OTG_WORKER_TOKEN' if args.worker_token.strip() else 'owner scoped'}", flush=True)
    print(f"[worker-id] {args.worker_id}", flush=True)
    return subprocess.run(command, cwd=str(repo)).returncode


if __name__ == "__main__":
    raise SystemExit(main())
