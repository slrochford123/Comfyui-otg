#!/usr/bin/env bash
set -Eeuo pipefail

confirm_prod=false
expected_host=""
prod_service=""
prod_current_link=""
prod_releases_dir=""
prod_base_url=""
previous_release=""

usage() {
  cat <<'USAGE'
Usage:
  sudo ./ops/rollback-dual-gpu-routing-prod.sh --confirm-prod \
    --previous-release ABSOLUTE_PATH --expected-host HOST \
    --prod-service SERVICE --prod-current-link ABSOLUTE_PATH \
    --prod-releases-dir ABSOLUTE_PATH --prod-base-url URL
USAGE
}

die() {
  printf 'PROD ROLLBACK FAILED: %s\n' "$*" >&2
  exit 1
}

while (($#)); do
  case "$1" in
    --confirm-prod) confirm_prod=true; shift ;;
    --previous-release) previous_release=${2:-}; shift 2 ;;
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
[[ -n "$previous_release" && -n "$expected_host" && -n "$prod_service" && -n "$prod_current_link" && -n "$prod_releases_dir" && -n "$prod_base_url" ]] || {
  usage >&2
  die "all arguments are required"
}
[[ $previous_release == /* && $prod_current_link == /* && $prod_releases_dir == /* ]] || die "release and PROD paths must be absolute"
[[ $(hostname -f 2>/dev/null || hostname) == "$expected_host" || $(hostname) == "$expected_host" ]] || die "host mismatch; expected $expected_host"
[[ $EUID -eq 0 ]] || die "run as root"
systemctl cat "$prod_service" >/dev/null 2>&1 || die "PROD service does not exist: $prod_service"
[[ -L "$prod_current_link" ]] || die "PROD current path is not a symlink"
[[ -d "$previous_release" && -f "$previous_release/server.js" && -d "$previous_release/.next/static" && -d "$previous_release/node_modules" ]] || die "previous release is not a valid standalone release"
case "$previous_release/" in
  "$prod_releases_dir"/*/) ;;
  *) die "previous release is outside $prod_releases_dir" ;;
esac

health_check() {
  local root_code status_code workflows_code
  root_code=$(curl --max-time 15 -sS -o /dev/null -w '%{http_code}' "$prod_base_url/" || true)
  status_code=$(curl --max-time 15 -sS -o /dev/null -w '%{http_code}' "$prod_base_url/api/comfy-status" || true)
  workflows_code=$(curl --max-time 15 -sS -o /dev/null -w '%{http_code}' "$prod_base_url/api/workflows" || true)
  [[ $root_code =~ ^(200|301|302|307|308)$ && $status_code == 200 && $workflows_code == 200 ]]
}

timestamp=$(date +%Y%m%d-%H%M%S)
rollback_link="${prod_current_link}.rollback-$timestamp"
ln -s "$previous_release" "$rollback_link"
mv -Tf "$rollback_link" "$prod_current_link"
systemctl restart "$prod_service"
for _ in $(seq 1 30); do
  systemctl is-active --quiet "$prod_service" && break
  sleep 1
done
systemctl is-active --quiet "$prod_service" || die "service did not become active"
health_check || die "health checks failed after restoring $previous_release"

printf 'PROD ROLLBACK SUCCEEDED: %s -> %s\n' "$prod_current_link" "$previous_release"
printf 'PROD HEALTH CHECKS PASSED: %s\n' "$prod_base_url"
