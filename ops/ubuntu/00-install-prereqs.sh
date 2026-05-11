#!/usr/bin/env bash
set -euo pipefail

# Ubuntu prerequisites for Next.js + native deps (better-sqlite3, sharp)
sudo apt-get update
sudo apt-get install -y --no-install-recommends \
  ca-certificates curl git unzip \
  build-essential python3 \
  pkg-config \
  libsqlite3-dev \
  libvips

echo "OK: prerequisites installed"
