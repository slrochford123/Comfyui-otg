param(
  [Parameter(Mandatory=$false)]
  [string]$RepoRoot = (Get-Location).Path
)

$ErrorActionPreference = 'Stop'

function Backup-File([string]$Path) {
  if (Test-Path $Path) {
    $ts = Get-Date -Format 'yyyyMMdd-HHmmss'
    $bak = "$Path.bak.$ts"
    Copy-Item -LiteralPath $Path -Destination $bak -Force
    Write-Host "BACKUP: $Path -> $bak"
  }
}

function Ensure-Dir([string]$Dir) {
  if (-not (Test-Path $Dir)) {
    New-Item -ItemType Directory -Path $Dir -Force | Out-Null
  }
}

function Write-File([string]$Path, [string]$Content) {
  $dir = Split-Path -Parent $Path
  Ensure-Dir $dir
  Backup-File $Path
  Set-Content -LiteralPath $Path -Value $Content -Encoding UTF8
  if (-not (Test-Path $Path)) { throw "Failed to write: $Path" }
  Write-Host "WROTE: $Path"
}

$RepoRoot = (Resolve-Path $RepoRoot).Path
Write-Host "RepoRoot: $RepoRoot"

# 1) package.json (env-driven ports)
Write-File (Join-Path $RepoRoot 'package.json') @'
{
  "name": "otg",
  "version": "1.0.11",
  "private": true,
  "engines": {
    "node": ">=20.11.0 <21"
  },
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint"
  },
  "dependencies": {
    "@capacitor/android": "^7.4.5",
    "@capacitor/app": "^7.1.1",
    "@capacitor/core": "^7.4.5",
    "@capacitor/local-notifications": "^7.0.4",
    "@capacitor/preferences": "^7.0.0",
    "@capacitor/push-notifications": "^7.0.4",
    "@google/model-viewer": "^4.1.0",
    "@supabase/supabase-js": "^2.89.0",
    "bcryptjs": "^3.0.3",
    "better-sqlite3": "^12.5.0",
    "chokidar": "4.0.3",
    "jose": "^6.1.3",
    "next": "^15.5.11",
    "react": "19.0.0",
    "react-dom": "19.0.0",
    "sharp": "^0.34.5",
    "zod": "^4.1.5"
  },
  "devDependencies": {
    "@capacitor/cli": "^7.4.5",
    "@tailwindcss/postcss": "^4.1.18",
    "@types/node": "^20.17.19",
    "@types/react": "^19.0.10",
    "@types/react-dom": "^19.0.4",
    "autoprefixer": "^10.4.21",
    "eslint": "^8.57.1",
    "eslint-config-next": "^15.5.12",
    "next-pwa": "^5.6.0",
    "postcss": "^8.5.3",
    "tailwindcss": "^4.0.15",
    "typescript": "^5.7.3"
  },
  "pnpm": {
    "onlyBuiltDependencies": [
      "better-sqlite3",
      "sharp",
      "unrs-resolver"
    ]
  }
}
'@

# 2) .nvmrc (pin Node)
Write-File (Join-Path $RepoRoot '.nvmrc') @'
20.11.1
'@

# 3) next.config.mjs (standalone artifact)
Write-File (Join-Path $RepoRoot 'next.config.mjs') @'
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Create a self-contained production artifact under .next/standalone.
  // This enables build-once / promote-the-same-artifact deployments.
  output: "standalone",

  // Force Next.js to treat THIS folder as the workspace root even if there are
  // multiple lockfiles elsewhere. This stabilizes builds/starts.
  outputFileTracingRoot: __dirname,

  // Keep production builds from failing because of ESLint warnings/errors
  eslint: {
    ignoreDuringBuilds: true,
  },

  webpack(config) {
    // Prevent Next from bundling Storybook story files
    config.module.rules.push({
      test: /\\.stories\\.(ts|tsx|js|jsx)$/,
      loader: "ignore-loader",
    });
    return config;
  },

  // IMPORTANT:
  // Do NOT set basePath/assetPrefix unless you *really* deploy under a subpath.
  // Your Cloudflare Tunnel should route the hostname to http://127.0.0.1:3000
  // and you should browse: https://comf-otg.comfyui-otg.win/login
};

export default nextConfig;
'@

# 4) /api/healthz (lowercase stable endpoint)
Write-File (Join-Path $RepoRoot 'app/api/healthz/route.ts') @'
import { NextResponse } from "next/server";

// Lowercase, stable health endpoint for deploy gates.
// Keep /api/Health for backward compatibility.
export async function GET() {
  return NextResponse.json({ ok: true, ts: Date.now() });
}
'@

# 5) Ops scripts (Ubuntu + env samples)
$opsFiles = @(
  @{ Path = 'ops/ubuntu/00-install-prereqs.sh'; Content = @'
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
'@ },
  @{ Path = 'ops/ubuntu/01-install-node-nvm.sh'; Content = @'
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
'@ },
  @{ Path = 'ops/ubuntu/02-install-cloudflared.sh'; Content = @'
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
'@ },
  @{ Path = 'ops/ubuntu/03-setup-directories.sh'; Content = @'
#!/usr/bin/env bash
set -euo pipefail

sudo mkdir -p /opt/otg/{repo,releases} /opt/otg/env /var/lib/otg
sudo chown -R "$USER":"$USER" /opt/otg
sudo chown -R "$USER":"$USER" /var/lib/otg

echo "OK: directories created"
'@ },
  @{ Path = 'ops/ubuntu/04-install-systemd-units.sh'; Content = @'
#!/usr/bin/env bash
set -euo pipefail

sudo tee /etc/systemd/system/otg-staging.service >/dev/null <<'UNIT'
[Unit]
Description=OTG Next.js (staging)
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/otg/current-staging
EnvironmentFile=/opt/otg/env/.env.staging
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
UNIT

sudo tee /etc/systemd/system/otg-prod.service >/dev/null <<'UNIT'
[Unit]
Description=OTG Next.js (prod)
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/otg/current-prod
EnvironmentFile=/opt/otg/env/.env.prod
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
UNIT

sudo systemctl daemon-reload
sudo systemctl enable otg-staging otg-prod

echo "OK: systemd units installed"
'@ },
  @{ Path = 'ops/ubuntu/05-smoke-test.sh'; Content = @'
#!/usr/bin/env bash
set -euo pipefail

BASE_URL=${1:-http://127.0.0.1:3000}

req() {
  local url="$1"
  local code
  code=$(curl -sS -o /dev/null -w "%{http_code}" "$url")
  echo "$code $url"
  if [ "$code" -lt 200 ] || [ "$code" -ge 400 ]; then
    echo "FAIL: $url returned $code" >&2
    exit 1
  fi
}

req "$BASE_URL/api/healthz"
req "$BASE_URL/api/whoami"
req "$BASE_URL/login"

code=$(curl -sS -o /dev/null -w "%{http_code}" -I "$BASE_URL/app")
echo "$code $BASE_URL/app"
if [ "$code" -lt 300 ] || [ "$code" -ge 400 ]; then
  echo "FAIL: /app expected redirect (3xx), got $code" >&2
  exit 1
fi

echo "OK: smoke test passed ($BASE_URL)"
'@ },
  @{ Path = 'ops/ubuntu/06-build-release.sh'; Content = @'
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
'@ },
  @{ Path = 'ops/ubuntu/07-activate-staging.sh'; Content = @'
#!/usr/bin/env bash
set -euo pipefail

REL_ID=${1:-}
if [ -z "$REL_ID" ]; then
  echo "Usage: 07-activate-staging.sh <release_id>" >&2
  exit 1
fi

REL_DIR="/opt/otg/releases/$REL_ID"
if [ ! -d "$REL_DIR" ]; then
  echo "Release not found: $REL_DIR" >&2
  exit 1
fi

ln -sfn "$REL_DIR" /opt/otg/current-staging
sudo systemctl restart otg-staging

BASE_URL=${BASE_URL:-http://127.0.0.1:3002}
/opt/otg/repo/ops/ubuntu/05-smoke-test.sh "$BASE_URL"

echo "OK: staging activated -> $REL_ID"
'@ },
  @{ Path = 'ops/ubuntu/08-promote-to-prod.sh'; Content = @'
#!/usr/bin/env bash
set -euo pipefail

REL_ID=${1:-}
if [ -z "$REL_ID" ]; then
  echo "Usage: 08-promote-to-prod.sh <release_id>" >&2
  exit 1
fi

REL_DIR="/opt/otg/releases/$REL_ID"
if [ ! -d "$REL_DIR" ]; then
  echo "Release not found: $REL_DIR" >&2
  exit 1
fi

ln -sfn "$REL_DIR" /opt/otg/current-prod
sudo systemctl restart otg-prod

BASE_URL=${BASE_URL:-http://127.0.0.1:3000}
/opt/otg/repo/ops/ubuntu/05-smoke-test.sh "$BASE_URL"

echo "OK: prod promoted -> $REL_ID"
'@ },
  @{ Path = 'ops/ubuntu/09-rollback-prod.sh'; Content = @'
#!/usr/bin/env bash
set -euo pipefail

REL_ID=${1:-}
if [ -z "$REL_ID" ]; then
  echo "Usage: 09-rollback-prod.sh <release_id>" >&2
  echo "Tip: ls -1 /opt/otg/releases | tail" >&2
  exit 1
fi

REL_DIR="/opt/otg/releases/$REL_ID"
if [ ! -d "$REL_DIR" ]; then
  echo "Release not found: $REL_DIR" >&2
  exit 1
fi

ln -sfn "$REL_DIR" /opt/otg/current-prod
sudo systemctl restart otg-prod

BASE_URL=${BASE_URL:-http://127.0.0.1:3000}
/opt/otg/repo/ops/ubuntu/05-smoke-test.sh "$BASE_URL"

echo "OK: prod rolled back -> $REL_ID"
'@ },
  @{ Path = 'ops/env/.env.staging.sample'; Content = @'
# STAGING (dummy) - production mode
NODE_ENV=production
PORT=3002
NEXT_PUBLIC_APP_URL=https://stage-comf-otg.comfyui-otg.win

# Auth
AUTH_COOKIE_NAME=otg_session
TRUST_PROXY=1

# Data
OTG_DATA_DIR=/var/lib/otg
OTG_DEVICE_OUTPUT_ROOT=/var/lib/otg/device_galleries

# ComfyUI (default target; UI may override via comfy-target cookie)
COMFY_BASE_URL=http://100.64.0.10:8188

# Optional (if used elsewhere in code)
COMFY_URL=http://100.64.0.10:8188
'@ },
  @{ Path = 'ops/env/.env.prod.sample'; Content = @'
# PROD - production mode
NODE_ENV=production
PORT=3000
NEXT_PUBLIC_APP_URL=https://comf-otg.comfyui-otg.win

# Auth
AUTH_COOKIE_NAME=otg_session
TRUST_PROXY=1

# Data
OTG_DATA_DIR=/var/lib/otg
OTG_DEVICE_OUTPUT_ROOT=/var/lib/otg/device_galleries

# ComfyUI (default target)
COMFY_BASE_URL=http://100.64.0.10:8188
COMFY_URL=http://100.64.0.10:8188
'@ }
)

foreach ($f in $opsFiles) {
  $p = Join-Path $RepoRoot $f.Path
  Write-File $p $f.Content
  if ($f.Path -like '*.sh') {
    # best-effort: mark executable on Windows Git Bash users; no-op otherwise
  }
}

Write-Host "\nSUCCESS: OTG stability patch applied."
Write-Host "Next: run 'npm ci' then 'npm run build' locally to verify."
