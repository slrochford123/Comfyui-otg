from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import tempfile
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any


AUDIO_EXTENSIONS = {".wav", ".flac", ".mp3", ".ogg", ".m4a", ".aac"}
REJECTED_STREAM_EXTENSIONS = {".m3u8", ".ts"}


def emit(payload: dict[str, Any]) -> None:
    print(json.dumps(payload, ensure_ascii=True), flush=True)


def normalize_server_url(value: str) -> str:
    value = str(value or "").strip()
    if not value:
        raise ValueError("Missing --server-url")
    return value.rstrip("/")


def require_file(path_value: str, label: str) -> str:
    path = Path(path_value).expanduser().resolve()
    if not path.is_file() or path.stat().st_size <= 0:
        raise FileNotFoundError(f"{label} does not exist or is empty: {path}")
    return str(path)


def is_rejected_stream_candidate(value: str) -> bool:
    text = str(value or "").strip().lower()

    if not text:
        return True

    if "playlist.m3u8" in text:
        return True

    parsed = urllib.parse.urlparse(text)
    decoded_path = urllib.parse.unquote(parsed.path or text).lower()

    if decoded_path.endswith(".m3u8") or decoded_path.endswith(".ts"):
        return True

    if ".m3u8" in decoded_path:
        return True

    return False


def is_audio_like(value: str) -> bool:
    text = str(value or "").strip()
    parsed = urllib.parse.urlparse(text)
    decoded_path = urllib.parse.unquote(parsed.path or text)
    suffix = Path(decoded_path).suffix.lower()
    return suffix in AUDIO_EXTENSIONS


def collect_file_candidates(value: Any) -> list[str]:
    found: list[str] = []

    def add(candidate: Any) -> None:
        if candidate is None:
            return
        text = str(candidate).strip()
        if not text:
            return
        found.append(text)

    def visit(item: Any) -> None:
        if item is None:
            return

        if isinstance(item, (str, os.PathLike)):
            add(item)
            return

        if isinstance(item, dict):
            # Prefer local path before url. URLs can point at stream playlists.
            for key in ("path", "name", "url"):
                if key in item:
                    add(item.get(key))

            for val in item.values():
                if isinstance(val, (list, tuple, dict)):
                    visit(val)
            return

        if isinstance(item, (list, tuple)):
            for sub in item:
                visit(sub)
            return

        for attr in ("path", "name", "url"):
            try:
                add(getattr(item, attr))
            except Exception:
                pass

    visit(value)

    deduped: list[str] = []
    seen: set[str] = set()

    for candidate in found:
        key = candidate.strip()
        if not key or key in seen:
            continue
        seen.add(key)
        deduped.append(candidate)

    return deduped


def prioritized_payloads(result: Any) -> list[Any]:
    # Seed-VC /predict returns two outputs:
    #   [stream_output_audio, full_output_audio]
    # Prefer the second output first, then fall back.
    payloads: list[Any] = []

    if isinstance(result, (list, tuple)):
        if len(result) >= 2:
            payloads.append(result[1])
        if len(result) >= 1:
            payloads.append(result[-1])
            payloads.append(result[0])

    payloads.append(result)

    deduped: list[Any] = []
    seen: set[int] = set()

    for payload in payloads:
        key = id(payload)
        if key in seen:
            continue
        seen.add(key)
        deduped.append(payload)

    return deduped


def download_gradio_file(server_url: str, file_url: str, out_dir: str) -> str:
    if is_rejected_stream_candidate(file_url):
        raise RuntimeError(f"Refusing to download streaming/HLS output instead of full audio: {file_url}")

    parsed = urllib.parse.urlparse(file_url)

    if parsed.scheme in ("http", "https"):
        url = file_url
    elif file_url.startswith("/"):
        url = server_url + file_url
    else:
        url = server_url + "/" + file_url.lstrip("/")

    if is_rejected_stream_candidate(url):
        raise RuntimeError(f"Refusing to download streaming/HLS output instead of full audio: {url}")

    decoded_path = urllib.parse.unquote(parsed.path or file_url)
    suffix = Path(decoded_path).suffix.lower()

    if suffix not in AUDIO_EXTENSIONS:
        suffix = ".wav"

    fd, temp_path = tempfile.mkstemp(prefix="seedvc_download_", suffix=suffix, dir=out_dir)
    os.close(fd)

    with urllib.request.urlopen(url, timeout=300) as response:
        data = response.read()

    with open(temp_path, "wb") as f:
        f.write(data)

    if not os.path.isfile(temp_path) or os.path.getsize(temp_path) <= 0:
        raise RuntimeError(f"Downloaded Gradio file is empty: {url}")

    return temp_path


def resolve_candidate(server_url: str, candidate: str, out_dir: str) -> str | None:
    candidate = str(candidate or "").strip()

    if not candidate or is_rejected_stream_candidate(candidate):
        return None

    path = Path(candidate).expanduser()

    if path.is_file() and path.stat().st_size > 0:
        return str(path.resolve())

    if candidate.startswith(("http://", "https://", "/gradio_api/", "gradio_api/")):
        return download_gradio_file(server_url, candidate, out_dir)

    return None


def resolve_output_audio_path(server_url: str, result: Any, out_dir: str) -> str:
    all_candidates: list[str] = []

    for payload in prioritized_payloads(result):
        all_candidates.extend(collect_file_candidates(payload))

    filtered: list[str] = []
    for candidate in all_candidates:
        if is_rejected_stream_candidate(candidate):
            continue
        filtered.append(candidate)

    if not filtered:
        raise RuntimeError(
            "Seed-VC returned only stream/HLS candidates or no file candidates. "
            f"Raw result: {repr(result)[:4000]}"
        )

    audio_like = [c for c in filtered if is_audio_like(c)]
    ordered = audio_like + [c for c in filtered if c not in audio_like]

    errors: list[str] = []

    for candidate in ordered:
        try:
            resolved = resolve_candidate(server_url, candidate, out_dir)
            if resolved and os.path.isfile(resolved) and os.path.getsize(resolved) > 0:
                return resolved
        except Exception as exc:
            errors.append(f"{candidate}: {type(exc).__name__}: {exc}")

    raise RuntimeError(
        "Seed-VC returned candidates, but none resolved to a valid full audio file. "
        f"Candidates: {ordered!r}. Errors: {errors!r}. Raw result: {repr(result)[:4000]}"
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Call local Seed-VC Gradio API and copy full output audio.")
    parser.add_argument("--server-url", required=True)
    parser.add_argument("--source", required=True)
    parser.add_argument("--reference", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--steps", type=int, default=30)
    parser.add_argument("--length-adjust", type=float, default=1.0)
    parser.add_argument("--intelligibility", type=float, default=0.0)
    parser.add_argument("--similarity", type=float, default=0.7)
    parser.add_argument("--top-p", type=float, default=0.9)
    parser.add_argument("--temperature", type=float, default=1.0)
    parser.add_argument("--repetition-penalty", type=float, default=1.0)
    parser.add_argument("--convert-style", action="store_true")
    parser.add_argument("--anonymization-only", action="store_true")
    args = parser.parse_args()

    try:
        os.environ.setdefault("PYTHONIOENCODING", "utf-8")
        os.environ.setdefault("PYTHONUTF8", "1")

        from gradio_client import Client, handle_file

        server_url = normalize_server_url(args.server_url)
        source = require_file(args.source, "Source audio")
        reference = require_file(args.reference, "Reference audio")

        out_path = Path(args.out).expanduser().resolve()
        out_path.parent.mkdir(parents=True, exist_ok=True)

        # Important: Seed-VC returns two audio outputs:
        #   1. streaming HLS playlist output
        #   2. full completed audio output
        #
        # gradio_client's default behavior tries to download returned files automatically.
        # That incorrectly grabs the first HLS playlist.m3u8 and fails with HTTP 403.
        # Keep raw FileData instead, then resolve the second/full audio output ourselves.
        client = Client(server_url, download_files=False)

        result = client.predict(
            handle_file(source),
            handle_file(reference),
            int(args.steps),
            float(args.length_adjust),
            float(args.intelligibility),
            float(args.similarity),
            float(args.top_p),
            float(args.temperature),
            float(args.repetition_penalty),
            bool(args.convert_style),
            bool(args.anonymization_only),
            api_name="/predict",
        )

        output_candidate = resolve_output_audio_path(server_url, result, str(out_path.parent))
        shutil.copyfile(output_candidate, out_path)

        if not out_path.is_file() or out_path.stat().st_size <= 0:
            raise RuntimeError(f"Seed-VC output copy failed: {out_path}")

        emit(
            {
                "ok": True,
                "serverUrl": server_url,
                "apiName": "/predict",
                "source": source,
                "reference": reference,
                "out": str(out_path),
                "copiedFrom": output_candidate,
                "bytes": out_path.stat().st_size,
                "rawResultType": type(result).__name__,
            }
        )
        return 0

    except Exception as exc:
        emit(
            {
                "ok": False,
                "error": str(exc),
                "errorType": type(exc).__name__,
            }
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
