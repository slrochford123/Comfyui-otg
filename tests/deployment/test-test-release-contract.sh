#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
VALIDATOR="$REPO_ROOT/ops/ubuntu/10-validate-test-release.sh"
ACTIVATOR="$REPO_ROOT/ops/ubuntu/11-activate-test-release.sh"
TEST_BUILDER="$REPO_ROOT/ops/ubuntu/build-test-release.sh"
DEPLOY_DRIVER="$REPO_ROOT/ops/ubuntu/12-deploy-test-release.sh"
TEST_RUNTIME_DIR="$REPO_ROOT/ops/ubuntu/test-runtime"
TEST_RUNTIME_INSTALLER="$REPO_ROOT/ops/ubuntu/13-install-test-runtime.sh"
LIVE_DEPLOY_ROOT=/home/shawn-rochford/AI/deploy/otg-test
FIXTURE_ROOT=$(mktemp -d)
trap 'rm -rf -- "$FIXTURE_ROOT"' EXIT

deploy_root="$FIXTURE_ROOT/deploy"
release="$deploy_root/releases/complete"
previous="$deploy_root/releases/previous"
units="$FIXTURE_ROOT/units"
mkdir -p "$release" "$previous" "$units"
ln -s "$previous" "$deploy_root/current"

while IFS= read -r contract_line || [ -n "$contract_line" ]; do
  case "$contract_line" in ""|'#'*) continue ;; esac
  [[ "$contract_line" == *$'\t'* ]]
  kind=${contract_line%%$'\t'*}
  relative_path=${contract_line#*$'\t'}
  [ -n "$relative_path" ]
  [[ "$relative_path" != *$'\t'* ]]
  case "$kind" in
    file) mkdir -p "$release/$(dirname "$relative_path")"; printf 'fixture\n' > "$release/$relative_path" ;;
    tree) mkdir -p "$release/$relative_path"; printf 'fixture\n' > "$release/$relative_path/.contract-fixture" ;;
  esac
done < "$REPO_ROOT/ops/ubuntu/test-release-payload.contract"

space_path='comfy_workflows/presets/3D Model.json'
[ -s "$release/$space_path" ] || { echo "FAIL: spaced contract fixture was not materialized" >&2; exit 1; }

worker_relative=scripts/linux/fixture-worker.py
mkdir -p "$release/scripts/linux"
cat > "$units/otg-character-fixture.service" <<UNIT
[Service]
ExecStart=/usr/bin/python3 $deploy_root/current/$worker_relative
UNIT

set +e
OTG_TEST_CURRENT_LINK="$deploy_root/current" OTG_TEST_UNIT_DIR="$units" \
  OTG_TEST_DEPLOY_ROOT="$deploy_root" OTG_TEST_SKIP_RUNTIME_VERIFY=1 \
  "$ACTIVATOR" "$release" >"$FIXTURE_ROOT/rejected.out" 2>&1
rejected_status=$?
set -e
[ "$rejected_status" -ne 0 ] || { echo "FAIL: missing worker release was accepted" >&2; exit 1; }
[ "$(readlink -f "$deploy_root/current")" = "$previous" ] || { echo "FAIL: symlink changed before validation" >&2; exit 1; }
grep -Fq "systemd-referenced worker executable missing" "$FIXTURE_ROOT/rejected.out"

printf '#!/usr/bin/env python3\n' > "$release/$worker_relative"
OTG_TEST_CURRENT_LINK="$deploy_root/current" OTG_TEST_UNIT_DIR="$units" \
  "$VALIDATOR" "$release" >/dev/null

rm -f -- "$release/$space_path"
set +e
OTG_TEST_CURRENT_LINK="$deploy_root/current" OTG_TEST_UNIT_DIR="$units" \
  "$VALIDATOR" "$release" >"$FIXTURE_ROOT/space-rejected.out" 2>&1
space_rejected_status=$?
set -e
[ "$space_rejected_status" -ne 0 ] || { echo "FAIL: missing spaced contract path was accepted" >&2; exit 1; }
grep -Fq "required nonempty file missing: $space_path" "$FIXTURE_ROOT/space-rejected.out"
printf 'fixture\n' > "$release/$space_path"
OTG_TEST_CURRENT_LINK="$deploy_root/current" OTG_TEST_UNIT_DIR="$units" \
  "$VALIDATOR" "$release" >/dev/null

OTG_TEST_CURRENT_LINK="$deploy_root/current" OTG_TEST_UNIT_DIR="$units" \
  OTG_TEST_DEPLOY_ROOT="$deploy_root" OTG_TEST_SKIP_RUNTIME_VERIFY=1 \
  "$ACTIVATOR" "$release" >/dev/null
[ "$(readlink -f "$deploy_root/current")" = "$release" ] || { echo "FAIL: complete release was not activated" >&2; exit 1; }

# Force post-switch health verification to fail and prove automatic rollback.
rollback_candidate="$deploy_root/releases/rollback-candidate"
cp -a "$release" "$rollback_candidate"
set +e
OTG_TEST_CURRENT_LINK="$deploy_root/current" OTG_TEST_UNIT_DIR="$units" \
  OTG_TEST_DEPLOY_ROOT="$deploy_root" OTG_TEST_SKIP_RUNTIME_VERIFY=1 OTG_TEST_FORCE_POST_SWITCH_FAILURE=1 \
  "$ACTIVATOR" "$rollback_candidate" >"$FIXTURE_ROOT/rollback.out" 2>&1
rollback_status=$?
set -e
[ "$rollback_status" -ne 0 ] || { echo "FAIL: failed health verification did not fail activation" >&2; exit 1; }
[ "$(readlink -f "$deploy_root/current")" = "$release" ] || { echo "FAIL: failed activation did not restore previous release" >&2; exit 1; }
grep -Fq "rolling TEST back" "$FIXTURE_ROOT/rollback.out"

  # OTG_TEST_RUNTIME_DURABILITY_V1_START
  next_env_package='node_modules/@next/env/package.json'
  next_env_index='node_modules/@next/env/dist/index.js'

  grep -Fq $'file\tnode_modules/@next/env/package.json' \
    "$REPO_ROOT/ops/ubuntu/test-release-payload.contract"
  grep -Fq $'file\tnode_modules/@next/env/dist/index.js' \
    "$REPO_ROOT/ops/ubuntu/test-release-payload.contract"

  [ -s "$release/$next_env_package" ] || {
    echo "FAIL: @next/env package fixture was not materialized" >&2
    exit 1
  }

  [ -s "$release/$next_env_index" ] || {
    echo "FAIL: @next/env runtime entrypoint fixture was not materialized" >&2
    exit 1
  }

  rm -f -- "$release/$next_env_index"

  set +e
  OTG_TEST_CURRENT_LINK="$deploy_root/current" OTG_TEST_UNIT_DIR="$units" \
    "$VALIDATOR" "$release" >"$FIXTURE_ROOT/next-env-rejected.out" 2>&1
  next_env_rejected_status=$?
  set -e

  [ "$next_env_rejected_status" -ne 0 ] || {
    echo "FAIL: missing @next/env runtime entrypoint was accepted" >&2
    exit 1
  }

  grep -Fq \
    "required nonempty file missing: $next_env_index" \
    "$FIXTURE_ROOT/next-env-rejected.out"

  mkdir -p "$release/$(dirname "$next_env_index")"
  printf 'fixture\n' > "$release/$next_env_index"

  OTG_TEST_CURRENT_LINK="$deploy_root/current" OTG_TEST_UNIT_DIR="$units" \
    "$VALIDATOR" "$release" >/dev/null

  node --check "$TEST_RUNTIME_DIR/launch.cjs" >/dev/null
  bash -n "$TEST_RUNTIME_DIR/otg-wait-for-tailscale-ip.sh"
  bash -n "$TEST_RUNTIME_INSTALLER"

  grep -Fq 'paths: [deployRoot],' "$TEST_RUNTIME_DIR/launch.cjs"
  ! grep -Fq 'paths: [workRepo],' "$TEST_RUNTIME_DIR/launch.cjs"
  grep -Fq 'loadEnvConfig(workRepo, false);' "$TEST_RUNTIME_DIR/launch.cjs"

  grep -Fq 'Wants=tailscaled.service' \
    "$TEST_RUNTIME_DIR/95-tailscale-ready.conf"
  grep -Fq 'After=tailscaled.service' \
    "$TEST_RUNTIME_DIR/95-tailscale-ready.conf"
  grep -Fq \
    'ExecStartPre=/usr/local/libexec/otg-wait-for-tailscale-ip.sh 100.75.162.64 tailscale0 120' \
    "$TEST_RUNTIME_DIR/95-tailscale-ready.conf"

  ! grep -Eq \
    'systemctl[[:space:]]+(restart|start|stop)' \
    "$TEST_RUNTIME_INSTALLER"
  # OTG_TEST_RUNTIME_DURABILITY_V1_END

# Live TEST must reject fixture-only bypasses before locking, validation, switching,
# or service actions. The release need not exist because the guard runs first.
set +e
OTG_TEST_DEPLOY_ROOT="$LIVE_DEPLOY_ROOT" OTG_TEST_SKIP_RUNTIME_VERIFY=1 \
  "$ACTIVATOR" "$LIVE_DEPLOY_ROOT/releases/fixture-must-not-exist" >"$FIXTURE_ROOT/live-bypass.out" 2>&1
live_bypass_status=$?
set -e
[ "$live_bypass_status" -ne 0 ] || { echo "FAIL: live TEST accepted runtime-verification bypass" >&2; exit 1; }
grep -Fq "bypass are prohibited against live TEST root" "$FIXTURE_ROOT/live-bypass.out"

command -v fakeroot >/dev/null || { echo "FAIL: fakeroot is required for root-guard assertions" >&2; exit 1; }
set +e
fakeroot "$TEST_BUILDER" root-guard-fixture >"$FIXTURE_ROOT/builder-root.out" 2>&1
builder_root_status=$?
fakeroot "$DEPLOY_DRIVER" root-guard-fixture >"$FIXTURE_ROOT/driver-root.out" 2>&1
driver_root_status=$?
set -e
[ "$builder_root_status" -ne 0 ] || { echo "FAIL: TEST builder accepted root execution" >&2; exit 1; }
[ "$driver_root_status" -ne 0 ] || { echo "FAIL: TEST deploy driver accepted root execution" >&2; exit 1; }
grep -Fq "must run unprivileged" "$FIXTURE_ROOT/builder-root.out"
grep -Fq "not root" "$FIXTURE_ROOT/driver-root.out"
! grep -Fq 'OTG_TEST_VERIFY_COMMAND' "$ACTIVATOR"
! grep -Eq 'bash[[:space:]]+-c' "$ACTIVATOR"

echo "OK: missing worker rejected before symlink activation"
echo "OK: complete payload accepted and activated"
echo "OK: contract path containing spaces accepted when present and rejected when missing"
echo "OK: failed post-switch verification restored the previous release"
echo "OK: live TEST root rejected runtime-verification bypass"
echo "OK: TEST builder and deploy driver rejected root execution"
echo "OK: deployed @next/env dependency is explicit and fail-closed"
echo "OK: canonical TEST launcher and Tailscale runtime sources are valid"
