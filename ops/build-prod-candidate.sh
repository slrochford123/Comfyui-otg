#!/usr/bin/env bash
set -Eeuo pipefail

# Build a sealed, standalone PROD candidate from a clean source checkout.
# The source-copy list is intentionally explicit; mobile/source/state content
# must never enter a server release by accident.

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
REPO_DIR=${REPO_DIR:-$(cd -- "$SCRIPT_DIR/.." && pwd)}
CANDIDATES_ROOT=${CANDIDATES_ROOT:-/home/slrochford123/AI/deploy/otg-prod-candidates}
PROD_BUILD_ENV_FILE=${PROD_BUILD_ENV_FILE:-/opt/otg/env/.env.prod}
RELEASE_ID=${RELEASE_ID:-}
EXPECTED_COMMIT=${EXPECTED_COMMIT:-}
NODE_REQUIRED=v20.20.2
STAGE_DIR=""

die() { printf 'PROD CANDIDATE BUILD FAILED: %s\n' "$*" >&2; exit 1; }
cleanup() { [ -z "$STAGE_DIR" ] || [ ! -e "$STAGE_DIR" ] || rm -rf -- "$STAGE_DIR"; }
trap cleanup EXIT

[ "$EUID" -ne 0 ] || die "run unprivileged; activation is a separate sudo transaction"
[ -n "$RELEASE_ID" ] || die "RELEASE_ID is required"
[ -n "$EXPECTED_COMMIT" ] || die "EXPECTED_COMMIT is required"
case "$RELEASE_ID" in *[!A-Za-z0-9._-]*|'') die "invalid release ID" ;; esac

cd "$REPO_DIR"
[ -d .git ] || die "source checkout is not a Git worktree"
[ "$(git rev-parse HEAD)" = "$EXPECTED_COMMIT" ] || die "source commit is not $EXPECTED_COMMIT"
[ -z "$(git status --porcelain)" ] || die "source worktree is dirty"
[ -r "$PROD_BUILD_ENV_FILE" ] || die "PROD build environment file is not readable"
set -a
# shellcheck disable=SC1090
source "$PROD_BUILD_ENV_FILE"
set +a
[ -n "${AUTH_SECRET:-}" ] || die "PROD build environment does not provide AUTH_SECRET"

export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
[ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh"
command -v nvm >/dev/null 2>&1 && nvm use 20.20.2 >/dev/null || true
[ "$(node -v)" = "$NODE_REQUIRED" ] || die "Node must be $NODE_REQUIRED (found $(node -v))"

OUT_DIR="$CANDIDATES_ROOT/$RELEASE_ID"
[ ! -e "$OUT_DIR" ] || die "candidate already exists: $OUT_DIR"
mkdir -p "$CANDIDATES_ROOT"
STAGE_DIR=$(mktemp -d "$CANDIDATES_ROOT/.${RELEASE_ID}.stage.XXXXXX")

npm ci --include=dev
set +e
npm run build
build_status=$?
set -e
if [ "$build_status" -eq 139 ]; then
  printf 'PROD CANDIDATE BUILD: retrying one native build after segmentation fault\n' >&2
  npm run build
elif [ "$build_status" -ne 0 ]; then
  exit "$build_status"
fi

copy_required() {
  local source=$1 target=$2
  [ -e "$source" ] || die "required source path missing: $source"
  if [ -d "$source" ]; then
    mkdir -p "$STAGE_DIR/$target"
    cp -a "$source/." "$STAGE_DIR/$target/"
  else
    mkdir -p "$(dirname "$STAGE_DIR/$target")"
    cp -a "$source" "$STAGE_DIR/$target"
  fi
}

copy_required .next/standalone/. .
copy_required .next/static .next/static
copy_required public public
for runtime_path in config comfy_workflows workflows app/workflows app/app/workflows; do
  copy_required "$runtime_path" "$runtime_path"
done

# Capability evidence is operational metadata, not a PROD runtime input. Keep
# support measurements but omit machine-local test-output paths.
node - "$STAGE_DIR/config/comfy-workflow-capabilities.json" <<'NODE'
const fs = require("node:fs");
const file = process.argv[2];
const document = JSON.parse(fs.readFileSync(file, "utf8"));
function scrub(value) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) { for (const item of value) scrub(item); return; }
  if (Object.prototype.hasOwnProperty.call(value, "outputPaths")) delete value.outputPaths;
  for (const child of Object.values(value)) scrub(child);
}
scrub(document);
fs.writeFileSync(file, `${JSON.stringify(document, null, 2)}\n`);
NODE

# Only scripts called by PROD application routes are runtime payload. Windows,
# Android, TEST launchers, patch scripts, and development helpers stay out.
for runtime_script in \
  scripts/qwen3_voice_design_preview.py \
  scripts/index_tts2_clone_pack_bridge.py \
  scripts/process_pedalboard_voice_fx.py \
  scripts/process_voice_fx.py \
  scripts/otg_texture_mesh.py \
  scripts/whisper/transcribe.py \
  scripts/wan2gp/run-job.mjs \
  scripts/seedvc/dub.py \
  scripts/qwen3tts/generate.py; do
  copy_required "$runtime_script" "$runtime_script"
done

# Android helpers, source trees, state, tests, and build caches are not server runtime.
rm -rf -- "$STAGE_DIR/scripts/android" "$STAGE_DIR/.next/cache" "$STAGE_DIR/.git" "$STAGE_DIR/android" "$STAGE_DIR/data" "$STAGE_DIR/tests" "$STAGE_DIR/coverage"

for forbidden in android .git data tests coverage; do
  [ ! -e "$STAGE_DIR/$forbidden" ] || die "forbidden top-level payload present: $forbidden"
done
for required in server.js .next/static public node_modules config comfy_workflows workflows scripts app/workflows app/app/workflows; do
  [ -e "$STAGE_DIR/$required" ] || die "final payload missing: $required"
done
if find "$STAGE_DIR" -type f \( -name '.env' -o -name '.env.*' -o -name '*.db' -o -name '*.db-*' -o -name '*.sqlite' -o -name '*.sqlite-*' -o -name '*.sqlite3' -o -name '*.sqlite3-*' -o -name '*.bak' -o -name '*.backup' \) -print -quit | grep -q .; then
  die "final payload contains a secret, database, or backup file"
fi
for secret_value in "${AUTH_SECRET:-}" "${OTG_JWT_SECRET:-}" "${OTG_WORKER_TOKEN:-}"; do
  [ -z "$secret_value" ] || ! grep -RFl -- "$secret_value" "$STAGE_DIR" >/dev/null || die "a configured secret was embedded in the final payload"
done
if find "$STAGE_DIR" -mindepth 1 -maxdepth 1 -type d \( -name '.git' -o -name 'android' -o -name 'data' -o -name 'tests' -o -name 'coverage' \) -print -quit | grep -q .; then
  die "final payload contains a forbidden top-level source/state directory"
fi
if find "$STAGE_DIR" -type d -iname '*backup*' -print -quit | grep -q .; then
  die "final payload contains a backup directory"
fi
if rg -l 'OTG-Test2|OTG-Test-Runtime|runtime/test|deploy/otg-test' "$STAGE_DIR" --glob '!RELEASE_MANIFEST.sha256' --glob '!.next/cache/**' | grep -q .; then
  die "TEST worktree/runtime path shipped in final payload"
fi

probe_bundle=$(grep -RFl 'OTG_SHAWN_PROCESS_PROBE_TARGET' "$STAGE_DIR/.next/server" | head -n 1 || true)
[ -n "$probe_bundle" ] || die "compiled Shawn remote-occupancy probe is absent"
grep -RFl '/api/worker-control/status' "$STAGE_DIR/.next/server" >/dev/null || die "compiled WorkerManager status route is absent"
grep -RFl 'gpu:slr-5060' "$STAGE_DIR/.next/server" >/dev/null || die "compiled SLR lane routing is absent"
grep -RFl 'qwen_cluster_busy' "$STAGE_DIR/.next/server" >/dev/null || die "compiled Qwen routing is absent"

printf '%s\n' "$RELEASE_ID" > "$STAGE_DIR/.release_id"
printf '%s\n' "$EXPECTED_COMMIT" > "$STAGE_DIR/.build.commit"
git rev-parse HEAD^{tree} > "$STAGE_DIR/.build.tree"
node -v > "$STAGE_DIR/.build.node"
npm -v > "$STAGE_DIR/.build.npm"
(cd "$STAGE_DIR" && find . -type f ! -name 'RELEASE_MANIFEST.sha256' -printf '%P\n' | LC_ALL=C sort | while IFS= read -r path; do sha256sum -- "$path"; done) > "$STAGE_DIR/RELEASE_MANIFEST.sha256"
chmod go-w "$STAGE_DIR"

mv -- "$STAGE_DIR" "$OUT_DIR"
STAGE_DIR=""
trap - EXIT
printf 'PROD CANDIDATE BUILT: %s\nSOURCE COMMIT: %s\nNODE: %s\n' "$OUT_DIR" "$EXPECTED_COMMIT" "$NODE_REQUIRED"
