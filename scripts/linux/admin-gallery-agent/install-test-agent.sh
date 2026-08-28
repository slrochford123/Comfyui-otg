#!/usr/bin/env bash
set -Eeuo pipefail

ACTION="${1:-install}"

SCRIPT_DIR="$(
  cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &&
  pwd
)"

INSTALL_DIR="/opt/otg-admin-gallery-agent"
ENV_DIR="/etc/otg"
ENV_FILE="$ENV_DIR/admin-gallery-agent.env"
UNIT_FILE="/etc/systemd/system/otg-admin-gallery-agent.service"

PYTHON_SOURCE="$SCRIPT_DIR/otg_admin_gallery_agent.py"
SERVICE_TEMPLATE_SOURCE="$SCRIPT_DIR/otg-admin-gallery-agent.service"
ENV_EXAMPLE_SOURCE="$SCRIPT_DIR/admin-gallery-agent.env.example"

die() {
  printf 'OTG Admin Gallery Agent: %s\n' "$*" >&2
  exit 1
}

caller_user() {
  if [[ -n "${SUDO_USER:-}" && "${SUDO_USER}" != "root" ]]; then
    printf '%s\n' "$SUDO_USER"
    return
  fi

  id -un
}

env_value() {
  local key="$1"

  sudo python3 - "$ENV_FILE" "$key" <<'PYENV'
from pathlib import Path
import sys

env_file = Path(sys.argv[1])
wanted = sys.argv[2]

value = None

for raw in env_file.read_text().splitlines():
    line = raw.strip()

    if not line or line.startswith("#"):
        continue

    if "=" not in line:
        continue

    key, current = line.split("=", 1)

    if key.strip() != wanted:
        continue

    current = current.strip()

    if (
        len(current) >= 2
        and current[0] == current[-1]
        and current[0] in {"'", '"'}
    ):
        current = current[1:-1]

    value = current
    break

if value is not None:
    print(value)
PYENV
}

render_service_unit() {
  local service_user
  local service_group
  local gallery_root
  local template
  local rendered

  [[ -f "$ENV_FILE" ]] \
    || die "missing $ENV_FILE"

  [[ -f "$INSTALL_DIR/otg-admin-gallery-agent.service.template" ]] \
    || die "service template is not installed"

  service_user="$(caller_user)"
  service_group="$(id -gn "$service_user")"

  [[ -n "$service_user" ]] \
    || die "could not determine service user"

  [[ -n "$service_group" ]] \
    || die "could not determine service group"

  gallery_root="$(env_value OTG_ADMIN_GALLERY_AGENT_ROOT)"

  [[ -n "$gallery_root" ]] \
    || die "OTG_ADMIN_GALLERY_AGENT_ROOT is not configured"

  [[ "$gallery_root" == /* ]] \
    || die "OTG_ADMIN_GALLERY_AGENT_ROOT must be absolute"

  sudo test -d "$gallery_root" \
    || die "configured gallery root does not exist: $gallery_root"

  template="$INSTALL_DIR/otg-admin-gallery-agent.service.template"
  rendered="$(mktemp)"

  python3 - \
    "$template" \
    "$rendered" \
    "$service_user" \
    "$service_group" \
    "$gallery_root" <<'PY'
from pathlib import Path
import re
import sys

template = Path(sys.argv[1])
output = Path(sys.argv[2])

user = sys.argv[3]
group = sys.argv[4]
root = sys.argv[5]

identity = re.compile(r"^[A-Za-z0-9_.-]+$")

if not identity.fullmatch(user):
    raise SystemExit("unsafe service user")

if not identity.fullmatch(group):
    raise SystemExit("unsafe service group")

if "\n" in root or "\r" in root:
    raise SystemExit("unsafe gallery root")

def systemd_quote(value: str) -> str:
    return '"' + (
        value
        .replace("\\", "\\\\")
        .replace('"', '\\"')
    ) + '"'

text = template.read_text()

replacements = {
    "__OTG_ADMIN_GALLERY_USER__": user,
    "__OTG_ADMIN_GALLERY_GROUP__": group,
    "__OTG_ADMIN_GALLERY_ROOT__": systemd_quote(root),
}

for old, new in replacements.items():
    if text.count(old) != 1:
        raise SystemExit(
            f"expected exactly one template marker: {old}"
        )
    text = text.replace(old, new)

if "__OTG_ADMIN_GALLERY_" in text:
    raise SystemExit("unresolved service template marker")

output.write_text(text)
PY

  sudo install \
    -m 0644 \
    "$rendered" \
    "$UNIT_FILE"

  rm -f "$rendered"

  sudo systemctl daemon-reload

  printf 'Rendered service unit:\n'
  printf '  user:  %s\n' "$service_user"
  printf '  group: %s\n' "$service_group"
  printf '  root:  %s\n' "$gallery_root"
}

case "$ACTION" in
  install)
    sudo install \
      -d \
      -m 0755 \
      "$INSTALL_DIR" \
      "$ENV_DIR"

    sudo install \
      -m 0755 \
      "$PYTHON_SOURCE" \
      "$INSTALL_DIR/otg_admin_gallery_agent.py"

    sudo install \
      -m 0644 \
      "$SERVICE_TEMPLATE_SOURCE" \
      "$INSTALL_DIR/otg-admin-gallery-agent.service.template"

    if [[ ! -e "$ENV_FILE" ]]; then
      sudo install \
        -m 0600 \
        "$ENV_EXAMPLE_SOURCE" \
        "$ENV_FILE"

      printf '\nCreated %s.\n' "$ENV_FILE"
      printf 'Edit ROOT, BIND, PORT, and TOKEN before starting.\n'
    else
      printf '\nPreserved existing %s.\n' "$ENV_FILE"
    fi

    printf '\nInstalled but not started.\n'
    printf 'After reviewing the env file, run:\n'
    printf '  %s start\n' "$0"
    ;;

  start)
    render_service_unit

    sudo systemctl enable \
      --now \
      otg-admin-gallery-agent.service

    systemctl is-active \
      --quiet \
      otg-admin-gallery-agent.service \
      || die "service failed to become active"

    printf 'OTG Admin Gallery Agent is active.\n'
    ;;

  status)
    systemctl status \
      otg-admin-gallery-agent.service \
      --no-pager
    ;;

  *)
    printf 'Usage: %s {install|start|status}\n' "$0" >&2
    exit 2
    ;;
esac
