#!/usr/bin/env bash
set -euo pipefail

REL_ID=${1:-}
if [ -z "$REL_ID" ]; then
  echo "Usage: 08-promote-to-prod.sh <release_id>" >&2
  exit 1
fi

REL_DIR="/opt/otg/releases/$REL_ID"
if [ ! -d "$REL_DIR" ]; then
  echo "Release not found: $REL_DIR" >&2
  exit 1
fi

ln -sfn "$REL_DIR" /opt/otg/current-prod
sudo systemctl restart otg-prod

BASE_URL=${BASE_URL:-http://127.0.0.1:3000}
/opt/otg/repo/ops/ubuntu/05-smoke-test.sh "$BASE_URL"

echo "OK: prod promoted -> $REL_ID"
