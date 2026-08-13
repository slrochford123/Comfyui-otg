#!/usr/bin/env python3
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

def main() -> int:
    here = Path(__file__).resolve().parent
    bridge = here / "index_tts2_clone_pack_bridge.py"
    if not bridge.exists():
        print(f"IndexTTS2 bridge missing: {bridge}", file=sys.stderr)
        return 2

    cmd = [sys.executable, str(bridge), *sys.argv[1:]]
    return int(subprocess.run(cmd).returncode)

if __name__ == "__main__":
    raise SystemExit(main())
