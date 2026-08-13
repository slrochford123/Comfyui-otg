#!/usr/bin/env python3
"""Compare the installed TEST token to a protected original-token digest."""

from __future__ import annotations

import hashlib
import hmac
import os
import pwd
import re
import stat
from pathlib import Path


ENV_FILE = Path("/etc/otg/character-completion-worker.env")
TOKEN_KEY = "OTG_ADMIN_GALLERY_5060_TOKEN"
DIGEST_OWNER = "shawn-rochford"
DIGEST_FILE = Path("/home/shawn-rochford/.otg-admin-gallery-token-digest")
SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")


def open_regular(path: Path) -> tuple[int, os.stat_result]:
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    file_stat = os.fstat(descriptor)
    if not stat.S_ISREG(file_stat.st_mode):
        os.close(descriptor)
        raise SystemExit(1)
    return descriptor, file_stat


def read_installed_token() -> str:
    descriptor, _ = open_regular(ENV_FILE)
    try:
        found: list[str] = []
        with os.fdopen(descriptor, "r", encoding="utf-8", closefd=False) as handle:
            for raw_line in handle:
                line = raw_line.rstrip("\r\n")
                if line.startswith(TOKEN_KEY + "="):
                    found.append(line.split("=", 1)[1])
    finally:
        os.close(descriptor)
    if len(found) != 1 or not found[0] or "\r" in found[0] or "\n" in found[0]:
        raise SystemExit(1)
    return found[0]


def read_original_digest() -> tuple[str, os.stat_result]:
    descriptor, digest_stat = open_regular(DIGEST_FILE)
    try:
        account = pwd.getpwnam(DIGEST_OWNER)
        if digest_stat.st_uid not in {0, account.pw_uid}:
            raise SystemExit(1)
        if stat.S_IMODE(digest_stat.st_mode) != 0o600:
            raise SystemExit(1)
        with os.fdopen(descriptor, "r", encoding="ascii", closefd=False) as handle:
            digest = handle.read().rstrip("\r\n")
    finally:
        os.close(descriptor)
    if not SHA256_PATTERN.fullmatch(digest):
        raise SystemExit(1)
    return digest, digest_stat


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

    digest_stat: os.stat_result | None = None
    matched = False
    try:
        digest_stat = DIGEST_FILE.lstat()
        expected_digest, opened_digest_stat = read_original_digest()
        if (
            digest_stat.st_dev != opened_digest_stat.st_dev
            or digest_stat.st_ino != opened_digest_stat.st_ino
        ):
            raise SystemExit(1)
        installed_digest = hashlib.sha256(
            read_installed_token().encode("utf-8")
        ).hexdigest()
        matched = hmac.compare_digest(installed_digest, expected_digest)
    except (Exception, SystemExit):
        matched = False
    finally:
        if digest_stat is not None and same_regular_file(DIGEST_FILE, digest_stat):
            DIGEST_FILE.unlink()

    print("TOKEN MATCH" if matched else "TOKEN MISMATCH")
    raise SystemExit(0 if matched else 1)


if __name__ == "__main__":
    main()
