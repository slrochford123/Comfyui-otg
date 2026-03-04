#!/usr/bin/env bash
set -euo pipefail

# Official Cloudflare repo install (Ubuntu)

if command -v cloudflared >/dev/null 2>&1; then
  cloudflared --version
  echo "OK: cloudflared already installed"
  exit 0
fi

curl -fsSL https://pkg.cloudflare.com/cloudflared-ascii.gpg | sudo gpg --dearmor -o /usr/share/keyrings/cloudflared.gpg

echo "deb [signed-by=/usr/share/keyrings/cloudflared.gpg] https://pkg.cloudflare.com/cloudflared $(lsb_release -cs) main" \
  | sudo tee /etc/apt/sources.list.d/cloudflared.list >/dev/null

sudo apt-get update
sudo apt-get install -y cloudflared

cloudflared --version

echo "OK: cloudflared installed"
