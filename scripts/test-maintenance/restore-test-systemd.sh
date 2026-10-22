#!/usr/bin/env bash
# Same guarded runtime validation for an in-place managed TEST restart.
set -euo pipefail
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
release="$(readlink -f /home/shawn-rochford/AI/deploy/otg-test/current)"
exec /usr/bin/python3 "$script_dir/../deploy/activate_test_release.py" \
  --expected-current "$release" --candidate "$release"
