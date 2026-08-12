#!/usr/bin/env bash
set -Eeuo pipefail

readonly EXPECTED_SOURCE_DIR="/home/shawn-rochford/AI/work/OTG-Test2"
readonly VERIFIED_TEST_RELEASE="/home/shawn-rochford/AI/deploy/otg-test/releases/prod-ready-20260718-231300"

confirm_prod=false
expected_host=""
prod_service=""
prod_current_link=""
prod_releases_dir=""
prod_base_url=""

usage() {
  cat <<'USAGE'
Usage:
  sudo ./ops/promote-dual-gpu-routing-to-prod.sh --confirm-prod \
    --expected-host HOST --prod-service SERVICE \
    --prod-current-link ABSOLUTE_PATH --prod-releases-dir ABSOLUTE_PATH \
    --prod-base-url URL

The values must be copied from a read-only inspection of the actual PROD host.
This script never copies TEST data, databases, sessions, output/history, or secrets.
USAGE
}

die() {
  printf 'PROD PROMOTION FAILED: %s\n' "$*" >&2
  exit 1
}

while (($#)); do
  case "$1" in
    --confirm-prod) confirm_prod=true; shift ;;
    --expected-host) expected_host=${2:-}; shift 2 ;;
    --prod-service) prod_service=${2:-}; shift 2 ;;
    --prod-current-link) prod_current_link=${2:-}; shift 2 ;;
    --prod-releases-dir) prod_releases_dir=${2:-}; shift 2 ;;
    --prod-base-url) prod_base_url=${2:-}; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done

$confirm_prod || die "--confirm-prod is required"
[[ -n "$expected_host" && -n "$prod_service" && -n "$prod_current_link" && -n "$prod_releases_dir" && -n "$prod_base_url" ]] || {
  usage >&2
  die "all discovered PROD values are required"
}
[[ $prod_current_link == /* && $prod_releases_dir == /* ]] || die "PROD paths must be absolute"
[[ $(pwd -P) == "$EXPECTED_SOURCE_DIR" ]] || die "run from $EXPECTED_SOURCE_DIR"
[[ $(hostname -f 2>/dev/null || hostname) == "$expected_host" || $(hostname) == "$expected_host" ]] || die "host mismatch; expected $expected_host"
[[ $EUID -eq 0 ]] || die "run as root so systemd and the PROD symlink can be changed explicitly"
command -v rsync >/dev/null || die "rsync is required"
command -v node >/dev/null || die "Node.js is required"
command -v curl >/dev/null || die "curl is required"

systemctl cat "$prod_service" >/dev/null 2>&1 || die "PROD service does not exist: $prod_service"
[[ -L "$prod_current_link" ]] || die "PROD current path is not a symlink: $prod_current_link"
[[ -d "$prod_releases_dir" ]] || die "PROD releases directory is missing: $prod_releases_dir"

previous_release=$(readlink -f "$prod_current_link")
[[ -n "$previous_release" && -d "$previous_release" && -f "$previous_release/server.js" ]] || die "current PROD release is invalid"
case "$previous_release/" in
  "$prod_releases_dir"/*/) ;;
  *) die "current PROD release is outside $prod_releases_dir" ;;
esac

[[ -d "$VERIFIED_TEST_RELEASE" && -f "$VERIFIED_TEST_RELEASE/server.js" ]] || die "verified TEST release is missing"
[[ -f "$VERIFIED_TEST_RELEASE/RELEASE_VERIFICATION.json" ]] || die "TEST live-verification record is missing"
node -e '
  const fs = require("fs");
  const record = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  if (record?.liveTest?.status !== "passed") throw new Error("TEST live verification has not passed");
  if (record?.sourceValidation?.tests !== "passed" || record?.sourceValidation?.typecheck !== "passed" || record?.sourceValidation?.build !== "passed") {
    throw new Error("TEST source validation is incomplete");
  }
' "$VERIFIED_TEST_RELEASE/RELEASE_VERIFICATION.json" || die "TEST release has not passed every gate"

test_data_root="/home/shawn-rochford/AI/runtime/test/data"
case "$prod_releases_dir/" in
  "$test_data_root"/*) die "PROD releases directory points into TEST data" ;;
esac

timestamp=$(date +%Y%m%d-%H%M%S)
new_release="$prod_releases_dir/prod-dual-gpu-routing-$timestamp"
[[ ! -e "$new_release" ]] || die "proposed PROD release already exists: $new_release"
mkdir -p "$new_release"

rsync -a \
  --exclude='.env' --exclude='.env.*' --exclude='data/' --exclude='*.db' \
  --exclude='*.sqlite' --exclude='*.sqlite3' --exclude='.otg-patch-backups/' \
  --exclude='*backup*/' --exclude='PREVIOUS_RELEASE.txt' \
  "$VERIFIED_TEST_RELEASE/" "$new_release/"

printf '%s\n' "$previous_release" > "$new_release/PREVIOUS_RELEASE.txt"

[[ -f "$new_release/server.js" && -d "$new_release/node_modules" && -d "$new_release/.next/static" ]] || die "standalone runtime is incomplete"
[[ -d "$new_release/public" && -d "$new_release/config" && -d "$new_release/comfy_workflows" ]] || die "required runtime assets are incomplete"
[[ -f "$new_release/config/comfy-backends.json" && -f "$new_release/config/comfy-workflow-capabilities.json" ]] || die "capability manifests are missing"

if find "$new_release" -type f \( -name '.env' -o -name '.env.*' -o -name '*.db' -o -name '*.sqlite' -o -name '*.sqlite3' \) -print -quit | grep -q .; then
  die "release contains an environment or database file"
fi
if find "$new_release" -type d \( -name data -o -iname '*backup*' -o -name '.otg-patch-backups' \) -print -quit | grep -q .; then
  die "release contains data or backup directories"
fi

node - "$new_release" <<'NODE'
const fs = require("fs");
const path = require("path");
const root = process.argv[2];
const backend = JSON.parse(fs.readFileSync(path.join(root, "config/comfy-backends.json"), "utf8"));
const workflows = JSON.parse(fs.readFileSync(path.join(root, "config/comfy-workflow-capabilities.json"), "utf8"));
if (!backend.manifestVersion || backend.manifestVersion !== workflows.manifestVersion) throw new Error("capability manifest version mismatch");
function visit(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) visit(filename);
    else if (entry.name.endsWith(".json")) JSON.parse(fs.readFileSync(filename, "utf8").replace(/^\uFEFF/, ""));
  }
}
visit(path.join(root, "comfy_workflows"));
visit(path.join(root, "workflows"));
NODE

health_check() {
  local root_code status_code workflows_code html static_path static_code
  root_code=$(curl --max-time 15 -sS -o /tmp/otg-prod-promotion-root.html -w '%{http_code}' "$prod_base_url/" || true)
  status_code=$(curl --max-time 15 -sS -o /tmp/otg-prod-promotion-status.json -w '%{http_code}' "$prod_base_url/api/comfy-status" || true)
  workflows_code=$(curl --max-time 15 -sS -o /tmp/otg-prod-promotion-workflows.json -w '%{http_code}' "$prod_base_url/api/workflows" || true)
  [[ $root_code =~ ^(200|301|302|307|308)$ && $status_code == 200 && $workflows_code == 200 ]] || return 1
  html=$(</tmp/otg-prod-promotion-root.html)
  static_path=$(printf '%s' "$html" | grep -oE '/_next/static/[^"'"'"' ]+' | head -n 1 || true)
  if [[ -n "$static_path" ]]; then
    static_code=$(curl --max-time 15 -sS -o /dev/null -w '%{http_code}' "$prod_base_url$static_path" || true)
    [[ $static_code == 200 ]] || return 1
  fi
}

switched=false
rollback_on_error() {
  local exit_code=$?
  if $switched; then
    rollback_link="${prod_current_link}.rollback-$timestamp"
    ln -s "$previous_release" "$rollback_link"
    mv -Tf "$rollback_link" "$prod_current_link"
    systemctl restart "$prod_service" || true
    if health_check; then
      printf 'PROD PROMOTION FAILED: rolled back successfully to %s\n' "$previous_release" >&2
    else
      printf 'PROD PROMOTION FAILED: rollback health check also failed; inspect %s immediately\n' "$prod_service" >&2
    fi
  else
    printf 'PROD PROMOTION FAILED: PROD symlink was not changed\n' >&2
  fi
  exit "$exit_code"
}
trap rollback_on_error ERR

started_at=$(date --iso-8601=seconds)
next_link="${prod_current_link}.next-$timestamp"
ln -s "$new_release" "$next_link"
mv -Tf "$next_link" "$prod_current_link"
switched=true
systemctl restart "$prod_service"

for _ in $(seq 1 30); do
  systemctl is-active --quiet "$prod_service" && break
  sleep 1
done
systemctl is-active --quiet "$prod_service"
health_check
if journalctl -u "$prod_service" --since "$started_at" --no-pager | grep -Eqi '(uncaught|unhandled|startup exception|failed to start|cannot find module|syntaxerror)'; then
  printf 'PROD PROMOTION FAILED: startup exceptions detected in the PROD journal\n' >&2
  false
fi

trap - ERR
printf 'PROD PROMOTION SUCCEEDED: %s -> %s\n' "$prod_current_link" "$new_release"
printf 'PROD PREVIOUS RELEASE: %s\n' "$previous_release"
printf 'PROD HEALTH CHECKS PASSED: %s\n' "$prod_base_url"
