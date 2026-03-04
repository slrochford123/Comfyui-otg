#!/usr/bin/env bash
set -euo pipefail

# Installs NVM + Node version from .nvmrc
export NVM_DIR="$HOME/.nvm"
if [ ! -d "$NVM_DIR" ]; then
  curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
fi

# shellcheck disable=SC1090
source "$NVM_DIR/nvm.sh"

NODE_VER=$(cat .nvmrc | tr -d '\r\n\t ')

nvm install "$NODE_VER"
nvm use "$NODE_VER"
node -v
npm -v

echo "OK: node installed via nvm ($NODE_VER)"
