#!/usr/bin/env bash
set -Eeuo pipefail

# TEST-only activation for the FastH3 B02 Approximate Preview app changes.
# This script packages the current checkout into a new TEST release, flips only
# /home/shawn-rochford/AI/deploy/otg-test/current, and restarts only otg-test.

REPO_DIR="${REPO_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
NODE_BIN="${NODE_BIN:-/home/shawn-rochford/.nvm/versions/node/v20.20.2/bin}"
DEPLOY_ROOT="${DEPLOY_ROOT:-/home/shawn-rochford/AI/deploy/otg-test}"
SERVICE_NAME="${SERVICE_NAME:-otg-test.service}"
RELEASE_LABEL="${RELEASE_LABEL:-h3-b02-preview-dependency-gate}"
RUN_FULL_TESTS="${RUN_FULL_TESTS:-0}"
SKIP_RESTART="${SKIP_RESTART:-0}"

PATH="$NODE_BIN:$PATH"
export PATH
export NEXT_TELEMETRY_DISABLED=1

log() {
  printf '[activate-h3-b02-preview-test] %s\n' "$*"
}

die() {
  printf '[activate-h3-b02-preview-test] ERROR: %s\n' "$*" >&2
  exit 1
}

run() {
  log "+ $*"
  "$@"
}

require_test_scope() {
  [[ "$DEPLOY_ROOT" == *"/otg-test"* ]] || die "DEPLOY_ROOT must point at otg-test, got: $DEPLOY_ROOT"
  [[ "$DEPLOY_ROOT" != *"/otg-prod"* ]] || die "Refusing to activate into PROD deploy root: $DEPLOY_ROOT"
  [[ "$SERVICE_NAME" == *"test"* ]] || die "SERVICE_NAME must be TEST-scoped, got: $SERVICE_NAME"
}

restart_service() {
  if [[ "$SKIP_RESTART" == "1" ]]; then
    log "SKIP_RESTART=1; leaving service untouched."
    return
  fi

  if systemctl list-unit-files "$SERVICE_NAME" --no-pager >/dev/null 2>&1; then
    log "Restarting $SERVICE_NAME"
    if systemctl restart "$SERVICE_NAME" 2>/dev/null; then
      :
    elif sudo -n systemctl restart "$SERVICE_NAME" 2>/dev/null; then
      :
    else
      local main_pid
      main_pid="$(systemctl show "$SERVICE_NAME" -p MainPID --value --no-pager 2>/dev/null || true)"
      if [[ "$main_pid" =~ ^[0-9]+$ && "$main_pid" -gt 1 ]]; then
        log "systemctl restart requires sudo; killing TEST service PID $main_pid so systemd Restart=on-failure reloads the new release."
        kill -9 "$main_pid"
        sleep 8
      else
        sudo systemctl restart "$SERVICE_NAME"
      fi
    fi

    if systemctl is-active --quiet "$SERVICE_NAME"; then
      log "$SERVICE_NAME is active."
    elif sudo -n systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
      log "$SERVICE_NAME is active."
    else
      systemctl status "$SERVICE_NAME" --no-pager || true
      die "$SERVICE_NAME did not become active"
    fi
  else
    die "Systemd service not found: $SERVICE_NAME"
  fi
}

main() {
  require_test_scope

  [[ -d "$REPO_DIR" ]] || die "Repo not found: $REPO_DIR"
  [[ -f "$REPO_DIR/package.json" ]] || die "package.json not found in $REPO_DIR"
  [[ -d "$DEPLOY_ROOT/releases" ]] || die "TEST releases directory not found: $DEPLOY_ROOT/releases"

  cd "$REPO_DIR"

  local node_version
  node_version="$(node -p 'process.versions.node')"
  [[ "$node_version" == 20.* ]] || die "Node 20 is required, got: $node_version"
  log "Using Node $node_version"

  local lock_file="$DEPLOY_ROOT/.deploy.lock"
  exec 9>"$lock_file"
  flock -n 9 || die "Another TEST deployment is already holding $lock_file"

  local previous=""
  if [[ -L "$DEPLOY_ROOT/current" || -e "$DEPLOY_ROOT/current" ]]; then
    previous="$(readlink -f "$DEPLOY_ROOT/current" || true)"
  fi
  log "Previous TEST current: ${previous:-none}"

  run node scripts/install-h3-b02-approx-preview-workflows.cjs

  run npx vitest --config vitest.config.ts run \
    tests/vitest/contracts/h3-queue-fallback-no-lock-contract.test.ts \
    tests/vitest/contracts/h3-production-recipes-contract.test.ts \
    tests/vitest/contracts/h3-workflow-qualified-recipe-integration-contract.test.ts \
    tests/vitest/contracts/h3-direct-tab-contract.test.ts \
    tests/vitest/contracts/production-v2-h3-quality-routing-contract.test.ts \
    tests/vitest/contracts/production-v2-h3-i2v-starting-image-contract.test.ts \
    tests/vitest/contracts/production-v2-h3-r2v-continuation-guide-contract.test.ts

  run npx tsc --noEmit

  if [[ "$RUN_FULL_TESTS" == "1" ]]; then
    run npm test
  else
    log "Skipping full npm test by default. Set RUN_FULL_TESTS=1 to run it."
  fi

  AUTH_SECRET="${AUTH_SECRET:-codex-test-build-secret}"
  export AUTH_SECRET
  run npm run build

  [[ -f "$REPO_DIR/.next/standalone/server.js" ]] || die ".next/standalone/server.js was not produced"
  [[ -d "$REPO_DIR/.next/static" ]] || die ".next/static was not produced"

  local stamp release tmp_link
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  release="$DEPLOY_ROOT/releases/test3001-${RELEASE_LABEL}-${stamp}"
  tmp_link="$DEPLOY_ROOT/.current.${stamp}.tmp"

  [[ ! -e "$release" ]] || die "Release already exists: $release"
  run mkdir -p "$release"

  log "Packaging standalone release: $release"
  run rsync -a --delete "$REPO_DIR/.next/standalone/" "$release/"
  run mkdir -p "$release/.next"
  run rsync -a --delete "$REPO_DIR/.next/static/" "$release/.next/static/"

  for item in public comfy_workflows scripts docs; do
    if [[ -e "$REPO_DIR/$item" ]]; then
      run rsync -a --delete "$REPO_DIR/$item/" "$release/$item/"
    fi
  done

  cat > "$release/ACTIVATION_TEST_H3_B02_PREVIEW.txt" <<EOF
activated_at_utc=$stamp
source_repo=$REPO_DIR
previous_current=$previous
service=$SERVICE_NAME
node=$node_version
scope=TEST_ONLY
change=FastH3 B02 Approximate Preview dependency-gate activation
EOF

  log "Switching TEST current symlink"
  ln -sfn "$release" "$tmp_link"
  mv -Tf "$tmp_link" "$DEPLOY_ROOT/current"

  restart_service

  log "Activated TEST release:"
  log "  current -> $(readlink -f "$DEPLOY_ROOT/current")"
  log "Rollback command:"
  if [[ -n "$previous" ]]; then
    log "  ln -sfn '$previous' '$DEPLOY_ROOT/.rollback.tmp' && mv -Tf '$DEPLOY_ROOT/.rollback.tmp' '$DEPLOY_ROOT/current' && sudo systemctl restart '$SERVICE_NAME'"
  else
    log "  No previous release was recorded."
  fi
}

main "$@"
