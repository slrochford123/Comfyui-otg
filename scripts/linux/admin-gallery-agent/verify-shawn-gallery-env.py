#!/usr/bin/env python3
"""Verify protected TEST 3003 Admin Gallery environment wiring."""

from __future__ import annotations

import hashlib
import os
import re
import stat
from pathlib import Path


ENV_FILE = Path("/etc/otg/character-completion-worker.env")
TRANSFER_FILE = Path("/home/shawn-rochford/.otg-admin-gallery-token-transfer")
EXPECTED = {
    "OTG_ADMIN_GALLERY_3090_ROOT": (
        "/home/shawn-rochford/AI/ComfyUI/ComfyUI/output"
    ),
    "OTG_ADMIN_GALLERY_5060_URL": "http://100.98.212.116:8798",
}
TOKEN_KEY = "OTG_ADMIN_GALLERY_5060_TOKEN"
MANAGED_KEYS = frozenset((*EXPECTED, TOKEN_KEY))
ASSIGNMENT = re.compile(
    r"^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$"
)


def check(condition: bool, label: str, detail: str = "") -> None:
    suffix = f" — {detail}" if detail else ""
    if not condition:
        raise SystemExit(f"FAIL: {label}{suffix}")
    print(f"PASS: {label}{suffix}")


def read_environment() -> tuple[list[str], os.stat_result]:
    descriptor = os.open(ENV_FILE, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        environment_stat = os.fstat(descriptor)
        check(
            stat.S_ISREG(environment_stat.st_mode),
            "environment file type",
            "regular file",
        )
        with os.fdopen(descriptor, "r", encoding="utf-8", closefd=False) as handle:
            lines = handle.read().splitlines()
    finally:
        os.close(descriptor)
    return lines, environment_stat


def managed_values(lines: list[str]) -> dict[str, list[str]]:
    values = {key: [] for key in MANAGED_KEYS}
    for line in lines:
        match = ASSIGNMENT.match(line)
        if match and match.group(1) in values:
            values[match.group(1)].append(match.group(2))
    return values


def main() -> None:
    if os.geteuid() != 0:
        raise SystemExit("Run this helper as root")

    lines, environment_stat = read_environment()
    check(
        environment_stat.st_uid == 0
        and environment_stat.st_gid == 0
        and stat.S_IMODE(environment_stat.st_mode) == 0o600,
        "secure ownership and mode",
        "root:root 0600",
    )

    values = managed_values(lines)
    for key in sorted(MANAGED_KEYS):
        check(len(values[key]) == 1, f"{key} occurs exactly once")

    for key, expected in EXPECTED.items():
        check(values[key][0] == expected, f"{key} exact value")

    token = values[TOKEN_KEY][0]
    check(bool(token), f"{TOKEN_KEY} is non-empty")

    try:
        TRANSFER_FILE.lstat()
    except FileNotFoundError:
        transfer_absent = True
    else:
        transfer_absent = False
    check(transfer_absent, "local temporary token file removed")

    digest = hashlib.sha256(token.encode("utf-8")).hexdigest()
    print(f"TOKEN_SHA256={digest}")


if __name__ == "__main__":
    main()
