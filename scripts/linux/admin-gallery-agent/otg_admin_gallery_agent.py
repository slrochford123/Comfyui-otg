#!/usr/bin/env python3
"""Authenticated media browser using one configured filesystem root."""

from __future__ import annotations

import hashlib
import hmac
import json
import mimetypes
import os
from pathlib import Path
import struct
import email.utils
import stat as stat_module
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlparse

ROOT = Path(
    os.environ.get(
        "OTG_ADMIN_GALLERY_AGENT_ROOT",
        "/opt/ComfyUI/output",
    )
).expanduser().resolve(strict=True)
TOKEN = os.environ.get("OTG_ADMIN_GALLERY_AGENT_TOKEN", "").strip()
BIND = os.environ.get("OTG_ADMIN_GALLERY_AGENT_BIND", "100.98.212.116").strip()
PORT = int(os.environ.get("OTG_ADMIN_GALLERY_AGENT_PORT", "8798"))
MIME = {
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif",
    ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime", ".mkv": "video/x-matroska",
    ".avif": "image/avif", ".bmp": "image/bmp", ".tif": "image/tiff", ".tiff": "image/tiff",
    ".heic": "image/heic", ".heif": "image/heif", ".exr": "image/x-exr", ".jxl": "image/jxl", ".svg": "image/svg+xml",
    ".avi": "video/x-msvideo", ".m4v": "video/x-m4v", ".mpeg": "video/mpeg", ".mpg": "video/mpeg",
    ".mp3": "audio/mpeg", ".wav": "audio/wav", ".flac": "audio/flac", ".ogg": "audio/ogg",
    ".opus": "audio/ogg", ".m4a": "audio/mp4", ".aac": "audio/aac", ".aiff": "audio/aiff",
}


def media_kind(name: str) -> str:
    mime = MIME.get(Path(name).suffix.lower(), "application/octet-stream")
    return mime.split("/", 1)[0] if mime.startswith(("image/", "video/", "audio/")) else "other"


def safe_media_path(raw: str) -> tuple[Path, str]:
    # parse_qs already decoded the URL. Preserve literal percent filenames.
    rel = (raw or "").replace("\\", "/")
    parts = rel.split("/")
    if not rel or any(not part or part in {".", ".."} for part in parts) or ":" in parts[0]:
        raise ValueError("invalid relative path")
    candidate = (ROOT / rel).resolve(strict=True)
    candidate.relative_to(ROOT)
    if not candidate.is_file():
        raise ValueError("unsupported or missing media file")
    return candidate, candidate.relative_to(ROOT).as_posix()


def image_dimensions(file_path: Path) -> tuple[int, int] | None:
    try:
        with file_path.open("rb") as handle:
            head = handle.read(32)
            if head.startswith(b"\x89PNG\r\n\x1a\n"):
                return struct.unpack(">II", head[16:24])
            if head[:6] in {b"GIF87a", b"GIF89a"}:
                return struct.unpack("<HH", head[6:10])
            if head.startswith(b"\xff\xd8"):
                handle.seek(2)
                while True:
                    marker = handle.read(1)
                    if not marker:
                        return None
                    if marker != b"\xff":
                        continue
                    marker_type = handle.read(1)
                    while marker_type == b"\xff":
                        marker_type = handle.read(1)
                    if marker_type in {bytes([value]) for value in range(0xC0, 0xC4)} | {bytes([value]) for value in range(0xC5, 0xC8)} | {bytes([value]) for value in range(0xC9, 0xCC)} | {bytes([value]) for value in range(0xCD, 0xD0)}:
                        length = struct.unpack(">H", handle.read(2))[0]
                        data = handle.read(length - 2)
                        return struct.unpack(">HH", data[1:5])[::-1]
                    length_bytes = handle.read(2)
                    if len(length_bytes) != 2:
                        return None
                    handle.seek(struct.unpack(">H", length_bytes)[0] - 2, 1)
    except (OSError, ValueError, struct.error):
        return None
    return None


def list_media(limit: int, offset: int = 0, search: str = "", kind_filter: str = "all", sort: str = "newest") -> tuple[list[dict], int]:
    records: list[dict] = []
    def scan_error(error):
        raise error
    for base, dirs, files in os.walk(ROOT, followlinks=False, onerror=scan_error):
        dirs[:] = sorted(name for name in dirs if not (Path(base) / name).is_symlink())
        for name in sorted(files):
            file_path = Path(base) / name
            if file_path.is_symlink():
                continue
            try:
                resolved = file_path.resolve(strict=True)
                resolved.relative_to(ROOT)
                stat = resolved.stat()
            except FileNotFoundError:
                continue
            if not stat_module.S_ISREG(stat.st_mode):
                continue
            kind = media_kind(resolved.name)
            record = {
                "rel": resolved.relative_to(ROOT).as_posix(),
                "name": resolved.name,
                "kind": kind,
                "mimeType": MIME.get(resolved.suffix.lower(), "application/octet-stream"),
                "bytes": stat.st_size,
                "mtimeMs": stat.st_mtime_ns / 1_000_000,
            }
            if kind == "image":
                dimensions = image_dimensions(resolved)
                if dimensions:
                    record["width"], record["height"] = dimensions
            if kind_filter != "all" and record["kind"] != kind_filter:
                continue
            if search and search.casefold() not in record["rel"].casefold():
                continue
            records.append(record)
    if sort == "oldest":
        records.sort(key=lambda item: (item["mtimeMs"], item["rel"]))
    elif sort == "name":
        records.sort(key=lambda item: (item["name"].casefold(), item["rel"]))
    else:
        records.sort(key=lambda item: (-item["mtimeMs"], item["rel"]))
    return records[offset:offset + limit], len(records)


class Handler(BaseHTTPRequestHandler):
    server_version = "OTGAdminGalleryAgent/1"

    def log_message(self, fmt: str, *args: object) -> None:
        print(f"{self.address_string()} - {fmt % args}", flush=True)

    def authorized(self) -> bool:
        supplied = self.headers.get("Authorization", "")
        expected = f"Bearer {TOKEN}"
        return bool(TOKEN) and hmac.compare_digest(supplied.encode(), expected.encode())

    def require_auth(self) -> bool:
        if self.authorized():
            return True
        self.send_json(401, {"ok": False, "error": "unauthorized"})
        return False

    def send_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, separators=(",", ":")).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "private, no-store, max-age=0")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        self.dispatch(head_only=False)

    def do_HEAD(self) -> None:  # noqa: N802
        self.dispatch(head_only=True)

    def do_DELETE(self) -> None:  # noqa: N802
        if not self.require_auth():
            return
        parsed = urlparse(self.path)
        if parsed.path != "/gallery/file":
            self.send_json(404, {"ok": False, "error": "not found"})
            return
        try:
            file_path, rel = safe_media_path(parse_qs(parsed.query).get("rel", [""])[0])
            if file_path.suffix.lower() not in {".png", ".jpg", ".jpeg", ".webp", ".gif", ".mp4", ".webm", ".mov", ".mkv"}:
                raise ValueError("deletion is not enabled for this file type")
            file_path.unlink()
            self.send_json(200, {"ok": True, "rel": rel})
        except (OSError, ValueError) as error:
            self.send_json(404, {"ok": False, "error": str(error)})

    def dispatch(self, head_only: bool) -> None:
        if not self.require_auth():
            return
        parsed = urlparse(self.path)
        query = parse_qs(parsed.query)
        if parsed.path == "/health":
            self.send_json(200, {"ok": True, "service": "otg-admin-gallery-agent", "rootReady": ROOT.is_dir()})
            return
        if parsed.path == "/gallery/list":
            try:
                limit = min(1000, max(1, int(query.get("limit", ["100"])[0])))
                offset = max(0, int(query.get("offset", ["0"])[0]))
                search = query.get("search", [""])[0][:200]
                kind = query.get("media", ["all"])[0]
                sort = query.get("sort", ["newest"])[0]
                if kind not in {"all", "image", "video", "audio", "other"} or sort not in {"newest", "oldest", "name"}:
                    self.send_json(400, {"ok": False, "error": "invalid gallery filter"})
                    return
                items, count = list_media(limit, offset, search, kind, sort)
                self.send_json(200, {"ok": True, "queryVersion": 3, "offset": offset, "count": count, "hasMore": count > offset + len(items), "items": items})
            except (OSError, ValueError) as error:
                self.send_json(500, {"ok": False, "error": str(error)})
            return
        if parsed.path == "/gallery/file":
            self.serve_file(query.get("rel", [""])[0], head_only)
            return
        self.send_json(404, {"ok": False, "error": "not found"})

    def serve_file(self, raw_rel: str, head_only: bool) -> None:
        try:
            file_path, _ = safe_media_path(raw_rel)
            stat = file_path.stat()
            size = stat.st_size
            etag = f'"{size:x}-{stat.st_mtime_ns:x}"'
            modified = email.utils.formatdate(stat.st_mtime, usegmt=True)
            start, end, partial = 0, size - 1, False
            range_header = self.headers.get("Range")
            if self.headers.get("If-Range") not in {None, etag, modified}:
                range_header = None
            if range_header:
                parsed_range = parse_range(range_header, size)
                if parsed_range is None:
                    self.send_response(416)
                    self.send_header("Content-Range", f"bytes */{size}")
                    self.send_header("Accept-Ranges", "bytes")
                    self.send_header("Content-Length", "0")
                    self.end_headers()
                    return
                start, end = parsed_range
                partial = True
            self.send_response(206 if partial else 200)
            self.send_header("Content-Type", MIME.get(file_path.suffix.lower(), "application/octet-stream"))
            self.send_header("Content-Length", str(end - start + 1))
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("Cache-Control", "private, no-store, max-age=0")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("ETag", etag)
            self.send_header("Last-Modified", modified)
            if media_kind(file_path.name) == "other" or file_path.suffix.lower() == ".svg":
                from urllib.parse import quote
                self.send_header("Content-Disposition", "attachment; filename*=UTF-8''" + quote(file_path.name, safe=""))
            if partial:
                self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
            self.end_headers()
            if head_only:
                return
            remaining = end - start + 1
            with file_path.open("rb") as handle:
                handle.seek(start)
                while remaining:
                    chunk = handle.read(min(1024 * 1024, remaining))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    remaining -= len(chunk)
        except (BrokenPipeError, ConnectionResetError):
            return
        except (OSError, ValueError) as error:
            self.send_json(404, {"ok": False, "error": str(error)})


def parse_range(value: str, size: int) -> tuple[int, int] | None:
    if not value.startswith("bytes=") or "," in value or size <= 0:
        return None
    first, separator, last = value[6:].partition("-")
    if not separator:
        return None
    try:
        if not first:
            suffix = int(last)
            if suffix <= 0:
                return None
            return max(0, size - suffix), size - 1
        start = int(first)
        end = int(last) if last else size - 1
        if start < 0 or start >= size or end < start:
            return None
        return start, min(end, size - 1)
    except ValueError:
        return None


if __name__ == "__main__":
    if not TOKEN:
        raise SystemExit("OTG_ADMIN_GALLERY_AGENT_TOKEN must be configured")
    mimetypes.init()
    print(f"OTG Admin Gallery Agent listening on {BIND}:{PORT}", flush=True)
    ThreadingHTTPServer((BIND, PORT), Handler).serve_forever()
