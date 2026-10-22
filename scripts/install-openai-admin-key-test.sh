#!/usr/bin/env bash
set -euo pipefail
set +x

RUNTIME_ENV="/home/shawn-rochford/AI/runtime/test/config/app-env/.env.local"
ACTIVE_RELEASE="$(readlink -f /home/shawn-rochford/AI/deploy/otg-test/current 2>/dev/null || true)"
ACTIVE_ENV="${ACTIVE_RELEASE}/.env.local"
BACKUP_DIR="/home/shawn-rochford/AI/runtime/test/config/app-env/backups"
UNIT="otg-test-manual-openai-billing.service"

if [[ ! -f "${RUNTIME_ENV}" ]]; then
  echo "TEST env file not found: ${RUNTIME_ENV}" >&2
  exit 1
fi

if [[ -z "${ACTIVE_RELEASE}" || ! -f "${ACTIVE_ENV}" ]]; then
  echo "Active TEST release env file not found: ${ACTIVE_ENV}" >&2
  exit 1
fi

mkdir -p "${BACKUP_DIR}"
chmod 700 "${BACKUP_DIR}" || true

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
install -m 0600 "${RUNTIME_ENV}" "${BACKUP_DIR}/env.local.before-openai-admin-key.${stamp}.runtime"
install -m 0600 "${ACTIVE_ENV}" "${BACKUP_DIR}/env.local.before-openai-admin-key.${stamp}.active-release"

printf "Paste OPENAI_ADMIN_API_KEY for TEST. Input is hidden: "
IFS= read -r -s admin_key
printf "\n"

if [[ -z "${admin_key}" ]]; then
  echo "No key entered; no changes made." >&2
  exit 1
fi

update_env_file() {
  local file="$1"
  local tmp
  tmp="$(mktemp)"
  chmod 600 "${tmp}"
  awk -v key="${admin_key}" '
    BEGIN { written = 0 }
    /^OPENAI_ADMIN_API_KEY=/ {
      print "OPENAI_ADMIN_API_KEY=" key
      written = 1
      next
    }
    { print }
    END {
      if (!written) print "OPENAI_ADMIN_API_KEY=" key
    }
  ' "${file}" > "${tmp}"
  install -m 0600 "${tmp}" "${file}"
  rm "${tmp}"
}

update_env_file "${RUNTIME_ENV}"
install -m 0600 "${RUNTIME_ENV}" "${ACTIVE_ENV}"
unset admin_key

echo "OPENAI_ADMIN_API_KEY installed into TEST runtime env and active TEST release env."
echo "Backups written under ${BACKUP_DIR}."
read -r -p "Restart TEST user service now so the key is loaded? [y/N] " restart_answer
case "${restart_answer}" in
  y|Y|yes|YES)
    systemctl --user restart "${UNIT}"
    sleep 2
    systemctl --user show "${UNIT}" -p ActiveState -p MainPID -p FragmentPath --no-pager
    curl -fsS http://127.0.0.1:3001/api/healthz
    ;;
  *)
    echo "TEST was not restarted. Restart ${UNIT} before official sync can use the new key."
    ;;
esac
