#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
REPO_DIR=${REPO_DIR:-$(cd -- "$SCRIPT_DIR/../.." && pwd)}
DEPLOY_ROOT=/home/shawn-rochford/AI/deploy/otg-test
REL_ID=${1:-test-$(date -u +%Y%m%dT%H%M%SZ)}

if [ "$EUID" -eq 0 ]; then
  echo "FAIL: run the TEST build/materialization as shawn-rochford, not root." >&2
  echo "The script may elevate only the final transactional activation step." >&2
  exit 1
fi

case "$REL_ID" in
  *[!A-Za-z0-9._-]*|'') echo "FAIL: invalid release id: $REL_ID" >&2; exit 2 ;;
esac

REPO_DIR="$REPO_DIR" \
ENV_FILE=${ENV_FILE:-/home/shawn-rochford/AI/runtime/test/config/app-env/.env.local} \
  "$SCRIPT_DIR/build-test-release.sh" "$REL_ID"

release_dir="$DEPLOY_ROOT/releases/$REL_ID"
"$SCRIPT_DIR/10-validate-test-release.sh" "$release_dir"
sudo "$SCRIPT_DIR/11-activate-test-release.sh" "$release_dir"
