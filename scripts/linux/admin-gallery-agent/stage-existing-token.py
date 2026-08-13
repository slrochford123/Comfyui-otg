#!/usr/bin/env python3
"""Stage the existing TEST Gallery token for a protected one-time transfer."""

from __future__ import annotations

import os
import pwd
import stat
from pathlib import Path


SOURCE = Path("/etc/otg/admin-gallery-agent.env")
TRANSFER_OWNER = "slrochford123"
TRANSFER_NAME = ".otg-admin-gallery-token-transfer"
TOKEN_KEY = "OTG_ADMIN_GALLERY_AGENT_TOKEN"


def read_token() -> str:
    descriptor = os.open(SOURCE, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        source_stat = os.fstat(descriptor)
        if not stat.S_ISREG(source_stat.st_mode):
            raise SystemExit("Protected agent environment is not a regular file")
        with os.fdopen(descriptor, "r", encoding="utf-8", closefd=False) as handle:
            for raw_line in handle:
                line = raw_line.rstrip("\r\n")
                if line.startswith(TOKEN_KEY + "="):
                    token = line.split("=", 1)[1].strip()
                    if token and "\n" not in token and "\r" not in token:
                        return token
                    break
    finally:
        os.close(descriptor)
    raise SystemExit("Existing protected Gallery token is missing")


def main() -> None:
    if os.geteuid() != 0:
        raise SystemExit("Run this helper as root")

    account = pwd.getpwnam(TRANSFER_OWNER)
    target = Path(account.pw_dir) / TRANSFER_NAME
    token = read_token()
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
            handle.write(token.encode("utf-8") + b"\n")
            handle.flush()
            os.fsync(handle.fileno())
    except BaseException:
        if descriptor is not None:
            os.close(descriptor)
            descriptor = None
        if created_stat is not None:
            try:
                current = target.lstat()
            except FileNotFoundError:
                pass
            else:
                if (
                    stat.S_ISREG(current.st_mode)
                    and current.st_dev == created_stat.st_dev
                    and current.st_ino == created_stat.st_ino
                ):
                    target.unlink()
        raise
    finally:
        if descriptor is not None:
            os.close(descriptor)

    print("Protected token transfer file staged with mode 0600")


if __name__ == "__main__":
    main()
