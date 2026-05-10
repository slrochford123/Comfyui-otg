import argparse
import json
import os
import shutil
import sys
from pathlib import Path


def pick_output_path(value):
    if isinstance(value, str) and value and os.path.exists(value):
        return value
    if isinstance(value, dict):
        for key in ("path", "name"):
            vv = value.get(key)
            if isinstance(vv, str) and vv and os.path.exists(vv):
                return vv
    if isinstance(value, (list, tuple)):
        for item in value:
            found = pick_output_path(item)
            if found:
                return found
    return None


def main():
    parser = argparse.ArgumentParser()
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
        from gradio_client import Client, handle_file
    except Exception as e:
        print(json.dumps({"ok": False, "error": f"gradio_client import failed: {e}"}))
        return 1

    try:
        client = Client(args.server_url)
        result = client.predict(
            handle_file(args.source),
            handle_file(args.reference),
            args.steps,
            args.length_adjust,
            args.intelligibility,
            args.similarity,
            args.top_p,
            args.temperature,
            args.repetition_penalty,
            args.convert_style,
            args.anonymization_only,
            fn_index=0,
        )
        output_path = pick_output_path(result)
        if not output_path:
            print(json.dumps({"ok": False, "error": "No output file path returned", "raw": repr(result)[:4000]}))
            return 2

        out = Path(args.out)
        out.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(output_path, out)
        print(json.dumps({"ok": True, "output_path": str(out)}))
        return 0
    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)}))
        return 3


if __name__ == "__main__":
    raise SystemExit(main())
