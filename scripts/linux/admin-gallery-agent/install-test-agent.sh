#!/usr/bin/env bash
set -Eeuo pipefail

ACTION="${1:-install}"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

case "${ACTION}" in
  install)
    sudo install -d -m 0755 /opt/otg-admin-gallery-agent /etc/otg
    sudo install -m 0755 "${SCRIPT_DIR}/otg_admin_gallery_agent.py" /opt/otg-admin-gallery-agent/otg_admin_gallery_agent.py
    sudo install -m 0644 "${SCRIPT_DIR}/otg-admin-gallery-agent.service" /etc/systemd/system/otg-admin-gallery-agent.service
    if [[ ! -e /etc/otg/admin-gallery-agent.env ]]; then
      sudo install -m 0600 "${SCRIPT_DIR}/admin-gallery-agent.env.example" /etc/otg/admin-gallery-agent.env
    fi
    sudo systemctl daemon-reload
    printf 'Installed but not started. Edit /etc/otg/admin-gallery-agent.env, then run: %s start\n' "$0"
    ;;
  start)
    sudo systemctl enable --now otg-admin-gallery-agent.service
    ;;
  status)
    systemctl status otg-admin-gallery-agent.service --no-pager
    ;;
  *)
    printf 'Usage: %s {install|start|status}\n' "$0" >&2
    exit 2
    ;;
esac
