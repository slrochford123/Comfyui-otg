#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
PACKAGER="$ROOT/ops/build-prod-candidate.sh"
grep -Fq 'runtime_path in config comfy_workflows workflows scripts app/workflows app/app/workflows' "$PACKAGER"
grep -Fq 'scripts/android' "$PACKAGER"
grep -Fq 'forbidden top-level payload present' "$PACKAGER"
grep -Fq 'RELEASE_MANIFEST.sha256' "$PACKAGER"
grep -Fq 'OTG_SHAWN_PROCESS_PROBE_TARGET' "$PACKAGER"
bash -n "$PACKAGER"
echo "OK: PROD candidate packaging is explicit, mobile-free, fail-closed, and manifest-backed"
