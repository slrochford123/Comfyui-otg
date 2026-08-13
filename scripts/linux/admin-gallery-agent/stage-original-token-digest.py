#!/usr/bin/env python3
"""Silently stage the original Gallery token digest for one-time comparison."""

from __future__ import annotations

import hashlib
import os
import pwd
import stat
from pathlib import Path


SOURCE = Path("/etc/otg/admin-gallery-agent.env")
TOKEN_KEY = "OTG_ADMIN_GALLERY_AGENT_TOKEN"
TRANSFER_OWNER = "slrochford123"
TRANSFER_NAME = ".otg-admin-gallery-token-digest"


def read_token() -> str:
    descriptor = os.open(SOURCE, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        source_stat = os.fstat(descriptor)
        if not stat.S_ISREG(source_stat.st_mode):
            raise SystemExit(1)
        with os.fdopen(descriptor, "r", encoding="utf-8", closefd=False) as handle:
            for raw_line in handle:
                line = raw_line.rstrip("\r\n")
                if line.startswith(TOKEN_KEY + "="):
                    token = line.split("=", 1)[1].strip()
                    if token and "\r" not in token and "\n" not in token:
                        return token
                    break
    finally:
        os.close(descriptor)
    raise SystemExit(1)


def same_regular_file(path: Path, expected: os.stat_result) -> bool:
    try:
        current = path.lstat()
    except FileNotFoundError:
        return False
    return (
        stat.S_ISREG(current.st_mode)
        and current.st_dev == expected.st_dev
        and current.st_ino == expected.st_ino
    )


def main() -> None:
    if os.geteuid() != 0:
        raise SystemExit(1)

    account = pwd.getpwnam(TRANSFER_OWNER)
    target = Path(account.pw_dir) / TRANSFER_NAME
    digest = hashlib.sha256(read_token().encode("utf-8")).hexdigest()
    descriptor: int | None = None
    created_stat: os.stat_result | None = None

    try:
        descriptor = os.open(
            target,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
            0o600,
        )
        created_stat = os.fstat(descriptor)
        os.fchmod(descriptor, 0o600)
        os.fchown(descriptor, account.pw_uid, account.pw_gid)
        with os.fdopen(descriptor, "wb", closefd=False) as handle:
            handle.write(digest.encode("ascii") + b"\n")
            handle.flush()
            os.fsync(handle.fileno())
    except BaseException:
        if descriptor is not None:
            os.close(descriptor)
            descriptor = None
        if created_stat is not None and same_regular_file(target, created_stat):
            target.unlink()
        raise
    finally:
        if descriptor is not None:
            os.close(descriptor)


if __name__ == "__main__":
    main()
