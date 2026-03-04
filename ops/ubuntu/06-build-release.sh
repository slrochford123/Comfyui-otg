#!/usr/bin/env bash
set -euo pipefail

REPO_DIR=${REPO_DIR:-/opt/otg/repo}
REL_ID=${REL_ID:-$(date +%Y%m%d-%H%M%S)}
OUT_DIR="/opt/otg/releases/$REL_ID"

cd "$REPO_DIR"

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh"
NODE_VER=$(cat .nvmrc | tr -d '\r\n\t ')
command -v nvm >/dev/null 2>&1 && nvm use "$NODE_VER" >/dev/null

npm ci
npm run build

mkdir -p "$OUT_DIR"
cp -R .next/standalone/* "$OUT_DIR/"
mkdir -p "$OUT_DIR/.next"
cp -R .next/static "$OUT_DIR/.next/static"

if [ -d "public" ]; then
  cp -R public "$OUT_DIR/public"
fi

node -v > "$OUT_DIR/.build.node"
npm -v > "$OUT_DIR/.build.npm"

echo "$REL_ID" > "$OUT_DIR/.release_id"

echo "OK: built release $REL_ID at $OUT_DIR"
