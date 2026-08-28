#!/usr/bin/env python3
"""Runtime verification for the TEST RTX 5060 Ti Admin Gallery agent."""

from __future__ import annotations

import http.client
import json
import os
from pathlib import Path
from urllib.parse import quote


HOST = "100.98.212.116"
PORT = 8798
ENV_FILE = Path("/etc/otg/admin-gallery-agent.env")
ROOT = Path("/opt/ComfyUI/output")
EXPECTED_ROOT = "/mnt/otg_fast/comfyui/output"
EXPECTED_MEDIA_COUNT = 427
MEDIA_COUNT_TOLERANCE = 25


def read_protected_token() -> str:
    for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        if line.startswith("OTG_ADMIN_GALLERY_AGENT_TOKEN="):
            token = line.split("=", 1)[1].strip()
            if token:
                return token
            break
    raise SystemExit("FAIL: protected token is missing")


TOKEN = read_protected_token()


def request(
    path: str,
    *,
    auth: str = "valid",
    headers: dict[str, str] | None = None,
) -> tuple[int, dict[str, str], bytes]:
    connection = http.client.HTTPConnection(HOST, PORT, timeout=30)
    sent_headers = dict(headers or {})

    if auth == "valid":
        sent_headers["Authorization"] = "Bearer " + TOKEN
    elif auth == "invalid":
        sent_headers["Authorization"] = "Bearer deliberately-invalid"
    elif auth != "missing":
        raise ValueError("unsupported authentication test mode")

    try:
        connection.request("GET", path, headers=sent_headers)
        response = connection.getresponse()
        body = response.read()
        response_headers = {
            key.lower(): value for key, value in response.getheaders()
        }
        return response.status, response_headers, body
    finally:
        connection.close()


def check(condition: bool, label: str, detail: str = "") -> None:
    suffix = f" — {detail}" if detail else ""
    if not condition:
        raise SystemExit(f"FAIL: {label}{suffix}")
    print(f"PASS: {label}{suffix}")


def main() -> None:
    status, _, body = request("/health")
    health = json.loads(body)
    check(
        status == 200
        and health.get("ok") is True
        and health.get("rootReady") is True,
        "authenticated health",
        "HTTP 200; ok=true; rootReady=true",
    )

    status, _, _ = request("/health", auth="missing")
    check(status == 401, "missing-auth rejection", f"HTTP {status}")

    status, _, _ = request("/health", auth="invalid")
    check(status == 401, "invalid-token rejection", f"HTTP {status}")

    status, _, body = request("/gallery/list?limit=1000")
    listing = json.loads(body)
    items = listing.get("items", [])
    count = listing.get("count")
    check(
        status == 200
        and listing.get("ok") is True
        and isinstance(items, list),
        "recursive listing",
        f"HTTP {status}",
    )

    check(
        bool(items)
        and any("/" in str(item.get("rel", "")) for item in items),
        "returned media",
        "nested relative paths present",
    )

    if isinstance(count, int):
        count_detail = (
            f"actual={count}; expected≈{EXPECTED_MEDIA_COUNT}; "
            f"delta={count - EXPECTED_MEDIA_COUNT:+d}"
        )
    else:
        count_detail = f"invalid count value: {count!r}"
    check(
        isinstance(count, int)
        and abs(count - EXPECTED_MEDIA_COUNT) <= MEDIA_COUNT_TOLERANCE,
        "media count",
        count_detail,
    )

    images = [
        item
        for item in items
        if item.get("mimeType") in {"image/png", "image/jpeg", "image/webp"}
    ]
    check(bool(images), "image candidate", "PNG/JPEG/WebP item present")
    image = images[0]
    status, image_headers, image_body = request(
        "/gallery/file?rel=" + quote(str(image["rel"]), safe="")
    )
    image_length = image_headers.get("content-length", "")
    image_mime = image_headers.get("content-type", "")
    check(
        status == 200
        and image_mime in {"image/png", "image/jpeg", "image/webp"}
        and image_length.isdigit()
        and len(image_body) == int(image_length),
        "image retrieval",
        f"HTTP {status}; bytes={len(image_body)}; MIME={image_mime or 'missing'}",
    )

    videos = [item for item in items if item.get("mimeType") == "video/mp4"]
    check(bool(videos), "MP4 candidate", "video/mp4 item present")
    video = videos[0]
    status, video_headers, video_body = request(
        "/gallery/file?rel=" + quote(str(video["rel"]), safe=""),
        headers={"Range": "bytes=0-1023"},
    )
    check(status == 206, "MP4 Range", f"HTTP {status}")

    content_range = video_headers.get("content-range", "")
    check(
        content_range.startswith("bytes 0-1023/"),
        "Content-Range",
        content_range or "missing",
    )

    accept_ranges = video_headers.get("accept-ranges", "")
    check(
        accept_ranges.lower() == "bytes",
        "Accept-Ranges",
        accept_ranges or "missing",
    )

    video_mime = video_headers.get("content-type", "")
    check(video_mime == "video/mp4", "video MIME", video_mime or "missing")
    check(
        len(video_body) == 1024,
        "MP4 Range body",
        f"{len(video_body)} bytes",
    )

    status, _, _ = request(
        "/gallery/file?rel=" + quote("../etc/passwd", safe="")
    )
    check(status == 404, "traversal rejection", f"HTTP {status}")

    probe = ROOT / ".otg-gallery-escape-probe.png"
    check(
        not probe.exists() and not probe.is_symlink(),
        "symlink probe path",
        "available",
    )
    try:
        probe.symlink_to("/etc/hosts")
        status, _, _ = request(
            "/gallery/file?rel=" + quote(probe.name, safe="")
        )
        check(status == 404, "symlink escape rejection", f"HTTP {status}")
    finally:
        if probe.is_symlink():
            probe.unlink()

    plain_status, _, plain_body = request(
        "/gallery/list?limit=1"
    )

    override_status, _, override_body = request(
        "/gallery/list?limit=1&root=%2Fetc"
    )

    check(
        plain_status == 200
        and override_status == 200
        and plain_body == override_body,
        "client root override ignored",
        (
            f"normal=HTTP {plain_status}; override=HTTP {override_status}; "
            "bodies identical"
        ),
    )

    real_root = os.path.realpath("/opt/ComfyUI/output")
    check(
        real_root == EXPECTED_ROOT,
        "canonical root resolution",
        f"{ROOT} -> {real_root}",
    )

    print("ALL AGENT RUNTIME CHECKS PASSED")


if __name__ == "__main__":
    main()
