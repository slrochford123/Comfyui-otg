#!/usr/bin/env bash
set -euo pipefail
if [[ $EUID -ne 0 || $(hostname) != slr ]]; then
  echo 'Run with sudo on slr (otg-slr), the RTX 5060 Ti TEST worker.' >&2
  exit 1
fi
package_dir=$(cd -- "$(dirname -- "$0")" && pwd)
test -s "$package_dir/maintenance.env"
install -d -o root -g root -m 755 /opt/otg-test-maintenance-5060
install -o root -g root -m 644 "$package_dir/agent.py" /opt/otg-test-maintenance-5060/agent.py
install -o root -g root -m 600 "$package_dir/maintenance.env" /etc/otg-test-maintenance-5060.env
install -o root -g root -m 644 "$package_dir/otg-test-maintenance-5060.service" /etc/systemd/system/otg-test-maintenance-5060.service
/usr/bin/python3 -m py_compile /opt/otg-test-maintenance-5060/agent.py
systemctl daemon-reload
systemctl enable --now otg-test-maintenance-5060.service
systemctl is-active otg-test-maintenance-5060.service
