#!/usr/bin/env python3
"""Atomically wire protected Admin Gallery settings into the TEST 3003 env."""

from __future__ import annotations

import os
import pwd
import re
import stat
from pathlib import Path


ENV_FILE = Path("/etc/otg/character-completion-worker.env")
TRANSFER_OWNER = "shawn-rochford"
TRANSFER_FILE = Path("/home/shawn-rochford/.otg-admin-gallery-token-transfer")
SETTINGS = {
    "OTG_ADMIN_GALLERY_3090_ROOT": (
        "/home/shawn-rochford/AI/ComfyUI/ComfyUI/output"
    ),
    "OTG_ADMIN_GALLERY_5060_URL": "http://100.98.212.116:8798",
}
TOKEN_KEY = "OTG_ADMIN_GALLERY_5060_TOKEN"
MANAGED_KEYS = frozenset((*SETTINGS, TOKEN_KEY))
ASSIGNMENT = re.compile(
    r"^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*="
)


def read_transfer_token() -> tuple[str, os.stat_result]:
    descriptor = os.open(TRANSFER_FILE, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        transfer_stat = os.fstat(descriptor)
        account = pwd.getpwnam(TRANSFER_OWNER)
        if not stat.S_ISREG(transfer_stat.st_mode):
            raise SystemExit("Protected token transfer is not a regular file")
        if transfer_stat.st_uid not in {0, account.pw_uid}:
            raise SystemExit("Protected token transfer has an unexpected owner")
        if stat.S_IMODE(transfer_stat.st_mode) != 0o600:
            raise SystemExit("Protected token transfer must have mode 0600")
        with os.fdopen(descriptor, "r", encoding="utf-8", closefd=False) as handle:
            token = handle.read().rstrip("\r\n")
    finally:
        os.close(descriptor)

    if not token or "\n" in token or "\r" in token:
        raise SystemExit("Protected token transfer is empty or malformed")
    return token, transfer_stat


def read_environment() -> tuple[list[str], os.stat_result]:
    descriptor = os.open(ENV_FILE, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        environment_stat = os.fstat(descriptor)
        if not stat.S_ISREG(environment_stat.st_mode):
            raise SystemExit("Target environment is not a regular file")
        with os.fdopen(descriptor, "r", encoding="utf-8", closefd=False) as handle:
            lines = handle.read().splitlines()
    finally:
        os.close(descriptor)
    return lines, environment_stat


def remove_managed_assignments(lines: list[str]) -> list[str]:
    preserved: list[str] = []
    for line in lines:
        match = ASSIGNMENT.match(line)
        if match and match.group(1) in MANAGED_KEYS:
            continue
        preserved.append(line)
    return preserved


def same_file_at_path(path: Path, expected: os.stat_result) -> bool:
    try:
        current = path.lstat()
    except FileNotFoundError:
        return False
    return (
        stat.S_ISREG(current.st_mode)
        and current.st_dev == expected.st_dev
        and current.st_ino == expected.st_ino
    )


def cleanup_transfer(expected: os.stat_result | None) -> None:
    if expected is None or not same_file_at_path(TRANSFER_FILE, expected):
        return
    TRANSFER_FILE.unlink()


def install_environment(token: str, original_stat: os.stat_result) -> None:
    original_lines, checked_stat = read_environment()
    if (
        checked_stat.st_dev != original_stat.st_dev
        or checked_stat.st_ino != original_stat.st_ino
    ):
        raise SystemExit("Target environment changed during validation")

    updated_lines = remove_managed_assignments(original_lines)
    if updated_lines and updated_lines[-1] != "":
        updated_lines.append("")
    updated_lines.extend(
        [
            f"OTG_ADMIN_GALLERY_3090_ROOT={SETTINGS['OTG_ADMIN_GALLERY_3090_ROOT']}",
            f"OTG_ADMIN_GALLERY_5060_URL={SETTINGS['OTG_ADMIN_GALLERY_5060_URL']}",
            f"{TOKEN_KEY}={token}",
        ]
    )
    payload = ("\n".join(updated_lines) + "\n").encode("utf-8")

    temporary = ENV_FILE.with_name(f".{ENV_FILE.name}.gallery-{os.getpid()}.tmp")
    descriptor: int | None = None
    temporary_stat: os.stat_result | None = None
    try:
        descriptor = os.open(
            temporary,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
            0o600,
        )
        temporary_stat = os.fstat(descriptor)
        os.fchmod(descriptor, stat.S_IMODE(original_stat.st_mode))
        os.fchown(descriptor, original_stat.st_uid, original_stat.st_gid)
        with os.fdopen(descriptor, "wb", closefd=False) as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())

        if not same_file_at_path(ENV_FILE, original_stat):
            raise SystemExit("Target environment changed before replacement")
        os.replace(temporary, ENV_FILE)
        directory_descriptor = os.open(ENV_FILE.parent, os.O_RDONLY)
        try:
            os.fsync(directory_descriptor)
        finally:
            os.close(directory_descriptor)
    except BaseException:
        if temporary_stat is not None and same_file_at_path(
            temporary, temporary_stat
        ):
            temporary.unlink()
        raise
    finally:
        if descriptor is not None:
            os.close(descriptor)


def main() -> None:
    if os.geteuid() != 0:
        raise SystemExit("Run this helper as root")

    transfer_stat: os.stat_result | None = None
    try:
        transfer_stat = TRANSFER_FILE.lstat()
        token, opened_transfer_stat = read_transfer_token()
        if (
            transfer_stat.st_dev != opened_transfer_stat.st_dev
            or transfer_stat.st_ino != opened_transfer_stat.st_ino
        ):
            raise SystemExit("Protected token transfer changed during validation")
        _, environment_stat = read_environment()
        install_environment(token, environment_stat)
        print("Protected TEST 3003 Gallery environment updated")
    finally:
        cleanup_transfer(transfer_stat)


if __name__ == "__main__":
    main()
