#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
REPO_DIR=${REPO_DIR:-$(cd -- "$SCRIPT_DIR/../.." && pwd)}
DEPLOY_ROOT=/home/shawn-rochford/AI/deploy/otg-test
RELEASES_DIR=$DEPLOY_ROOT/releases
REL_ID=${1:-test-$(date -u +%Y%m%dT%H%M%SZ)}
ENV_FILE=${ENV_FILE:-/home/shawn-rochford/AI/runtime/test/config/app-env/.env.local}
OUT_DIR=$RELEASES_DIR/$REL_ID
STAGE_DIR=$RELEASES_DIR/.${REL_ID}.partial.$$

if [ "$EUID" -eq 0 ]; then
  echo "FAIL: build-test-release.sh must run unprivileged, not as root." >&2
  exit 1
fi
case "$REL_ID" in
  *[!A-Za-z0-9._-]*|'') echo "FAIL: invalid release id: $REL_ID" >&2; exit 2 ;;
esac
if [ -e "$OUT_DIR" ]; then
  echo "FAIL: TEST release already exists: $OUT_DIR" >&2
  exit 1
fi

cleanup() {
  rm -rf -- "$STAGE_DIR"
}
trap cleanup EXIT

cd "$REPO_DIR"
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

if [ "${OTG_WORKER_CONTROL_ENABLED:-}" != "1" ]; then
  echo "FAIL: canonical TEST requires OTG_WORKER_CONTROL_ENABLED=1 in $ENV_FILE" >&2
  exit 1
fi
if [ -z "${OTG_WORKER_CONTROL_TOKEN:-${OTG_WORKER_TOKEN:-}}" ]; then
  echo "FAIL: canonical TEST worker-control authentication token is not configured in $ENV_FILE" >&2
  exit 1
fi

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh"
NODE_VER=$(tr -d '\r\n\t ' < .nvmrc)
command -v nvm >/dev/null 2>&1 && nvm use "$NODE_VER" >/dev/null

npm ci --include=dev
npm run build

mkdir -p -m 700 "$RELEASES_DIR" "$STAGE_DIR"
cp -a .next/standalone/. "$STAGE_DIR/"
mkdir -p "$STAGE_DIR/.next"
cp -a .next/static "$STAGE_DIR/.next/static"

for runtime_path in public config comfy_workflows workflows scripts app/workflows app/app/workflows; do
  if [ ! -e "$runtime_path" ]; then
    echo "FAIL: required TEST runtime source path is missing: $REPO_DIR/$runtime_path" >&2
    exit 1
  fi
  mkdir -p "$STAGE_DIR/$(dirname "$runtime_path")"
  rm -rf -- "$STAGE_DIR/$runtime_path"
  cp -a "$runtime_path" "$STAGE_DIR/$runtime_path"
done

node -v > "$STAGE_DIR/.build.node"
npm -v > "$STAGE_DIR/.build.npm"
printf '%s\n' "$REL_ID" > "$STAGE_DIR/.release_id"

mv -- "$STAGE_DIR" "$OUT_DIR"
trap - EXIT
echo "OK: built TEST release $REL_ID at $OUT_DIR"
