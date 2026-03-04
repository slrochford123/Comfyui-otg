#!/usr/bin/env bash
set -euo pipefail

sudo mkdir -p /opt/otg/{repo,releases} /opt/otg/env /var/lib/otg
sudo chown -R "$USER":"$USER" /opt/otg
sudo chown -R "$USER":"$USER" /var/lib/otg

echo "OK: directories created"
