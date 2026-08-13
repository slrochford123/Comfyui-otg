#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
LIVE_DEPLOY_ROOT=/home/shawn-rochford/AI/deploy/otg-test
DEPLOY_ROOT=$(readlink -m -- "${OTG_TEST_DEPLOY_ROOT:-$LIVE_DEPLOY_ROOT}")
CURRENT_LINK=$DEPLOY_ROOT/current
HEALTH_URL=${OTG_TEST_HEALTH_URL:-http://100.75.162.64:3001/api/healthz}
HEALTH_ATTEMPTS=${OTG_TEST_HEALTH_ATTEMPTS:-30}
HEALTH_DELAY_SECONDS=${OTG_TEST_HEALTH_DELAY_SECONDS:-2}
STABILITY_SECONDS=${OTG_TEST_STABILITY_SECONDS:-10}
UNIT_DIR=${OTG_TEST_UNIT_DIR:-}
SKIP_RUNTIME_VERIFY=${OTG_TEST_SKIP_RUNTIME_VERIFY:-0}
FORCE_POST_SWITCH_FAILURE=${OTG_TEST_FORCE_POST_SWITCH_FAILURE:-0}
RELEASE_DIR=${1:-}

case "$SKIP_RUNTIME_VERIFY:$FORCE_POST_SWITCH_FAILURE" in
  0:0|0:1|1:0|1:1) ;;
  *) echo "FAIL: TEST fixture controls accept only 0 or 1" >&2; exit 2 ;;
esac
if [ "$DEPLOY_ROOT" = "$LIVE_DEPLOY_ROOT" ] &&
   { [ "$SKIP_RUNTIME_VERIFY" != "0" ] || [ -n "$UNIT_DIR" ] || [ "$FORCE_POST_SWITCH_FAILURE" != "0" ] ||
     [ -n "${OTG_TEST_CONTRACT_FILE:-}" ]; }; then
  echo "FAIL: fixture overrides and runtime-verification bypass are prohibited against live TEST root $LIVE_DEPLOY_ROOT" >&2
  exit 1
fi
if [ "$DEPLOY_ROOT" != "$LIVE_DEPLOY_ROOT" ] && [ "$SKIP_RUNTIME_VERIFY" != "1" ]; then
  echo "FAIL: non-live fixture roots must disable real service actions" >&2
  exit 1
fi

if [ -z "$RELEASE_DIR" ]; then
  echo "Usage: 11-activate-test-release.sh <release-directory>" >&2
  exit 2
fi
RELEASE_DIR=$(readlink -f -- "$RELEASE_DIR")
case "$RELEASE_DIR" in
  "$DEPLOY_ROOT"/releases/*) ;;
  *) echo "FAIL: release must be under $DEPLOY_ROOT/releases: $RELEASE_DIR" >&2; exit 1 ;;
esac

mkdir -p "$DEPLOY_ROOT"
exec 9>"$DEPLOY_ROOT/.deploy.lock"
flock -n 9 || { echo "FAIL: another TEST deployment holds $DEPLOY_ROOT/.deploy.lock" >&2; exit 1; }

if [ "$SKIP_RUNTIME_VERIFY" != "1" ] && [ "$EUID" -ne 0 ]; then
  echo "FAIL: TEST activation requires root for systemd restart and rollback; rerun this activation through sudo" >&2
  exit 1
fi

OTG_TEST_CURRENT_LINK="$CURRENT_LINK" OTG_TEST_UNIT_DIR="$UNIT_DIR" \
  "$SCRIPT_DIR/10-validate-test-release.sh" "$RELEASE_DIR"

previous_release=$(readlink -f -- "$CURRENT_LINK")
if [ ! -d "$previous_release" ]; then
  echo "FAIL: current TEST rollback target is invalid: $previous_release" >&2
  exit 1
fi
case "$previous_release" in
  "$DEPLOY_ROOT"/releases/*) ;;
  *) echo "FAIL: current TEST rollback target escapes $DEPLOY_ROOT/releases: $previous_release" >&2; exit 1 ;;
esac
printf '%s\n' "$previous_release" > "$RELEASE_DIR/PREVIOUS_RELEASE.txt"

worker_units=()
if [ "$SKIP_RUNTIME_VERIFY" != "1" ]; then
  while read -r unit_name _; do
    [ -n "$unit_name" ] || continue
    fragment=$(systemctl show "$unit_name" -p FragmentPath --value)
    if [ -r "$fragment" ] && grep -Fq "$CURRENT_LINK/scripts/linux/" "$fragment"; then
      worker_units+=("$unit_name")
    fi
  done < <(systemctl list-unit-files 'otg-character-*.service' --state=enabled --no-legend)
fi

switched=0
rollback_needed=1
atomic_switch() {
  local target=$1
  local next_link="$CURRENT_LINK.next.$$"
  ln -s -- "$target" "$next_link"
  mv -Tf -- "$next_link" "$CURRENT_LINK"
}
rollback() {
  local status=$?
  if [ "$switched" -eq 1 ] && [ "$rollback_needed" -eq 1 ]; then
    set +e
    echo "Activation verification failed; rolling TEST back to $previous_release" >&2
    atomic_switch "$previous_release"
    if [ "$SKIP_RUNTIME_VERIFY" != "1" ]; then
      systemctl restart otg-test.service
      for unit_name in "${worker_units[@]}"; do systemctl restart "$unit_name"; done
    fi
  fi
  exit "$status"
}
trap rollback EXIT

atomic_switch "$RELEASE_DIR"
switched=1

if [ "$FORCE_POST_SWITCH_FAILURE" = "1" ]; then
  echo "FAIL: controlled fixture post-switch failure" >&2
  exit 1
fi

if [ "$SKIP_RUNTIME_VERIFY" != "1" ]; then
  systemctl restart otg-test.service
  for unit_name in "${worker_units[@]}"; do systemctl restart "$unit_name"; done

  healthy=0
  for _ in $(seq 1 "$HEALTH_ATTEMPTS"); do
    if curl -fsS --max-time 5 "$HEALTH_URL" >/dev/null; then healthy=1; break; fi
    sleep "$HEALTH_DELAY_SECONDS"
  done
  [ "$healthy" -eq 1 ] || { echo "FAIL: TEST health verification failed: $HEALTH_URL" >&2; exit 1; }

  declare -A restart_counts=()
  for unit_name in "${worker_units[@]}"; do
    [ "$(systemctl show "$unit_name" -p ActiveState --value)" = active ] || { echo "FAIL: $unit_name is not active" >&2; exit 1; }
    [ "$(systemctl show "$unit_name" -p SubState --value)" = running ] || { echo "FAIL: $unit_name is not running" >&2; exit 1; }
    restart_counts["$unit_name"]=$(systemctl show "$unit_name" -p NRestarts --value)
  done
  sleep "$STABILITY_SECONDS"
  for unit_name in "${worker_units[@]}"; do
    [ "$(systemctl show "$unit_name" -p ActiveState --value)" = active ] || { echo "FAIL: $unit_name became inactive" >&2; exit 1; }
    [ "$(systemctl show "$unit_name" -p SubState --value)" = running ] || { echo "FAIL: $unit_name stopped running" >&2; exit 1; }
    [ "$(systemctl show "$unit_name" -p NRestarts --value)" = "${restart_counts[$unit_name]}" ] || { echo "FAIL: $unit_name restarted during stability verification" >&2; exit 1; }
  done
fi

rollback_needed=0
trap - EXIT
echo "OK: TEST activated transactionally: $RELEASE_DIR"
echo "OK: previous TEST release recorded: $previous_release"
