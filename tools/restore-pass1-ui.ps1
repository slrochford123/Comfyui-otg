# Restores PASS-1 locked UI files (Generate/Gallery/Favorites/Settings) from this package.
# Run from the OTG project root:  .\tools\restore-pass1-ui.ps1

$ErrorActionPreference = 'Stop'

$root = (Get-Location).Path
$pkgRoot = Join-Path $PSScriptRoot '..'

$srcBase = Join-Path $pkgRoot 'pass1_ui'
$dstBase = Join-Path $root 'app\app'

Write-Host "Restoring PASS-1 UI into: $dstBase" -ForegroundColor Cyan

$files = @(
  @{ src = 'page.tsx'; dst = 'page.tsx' },
  @{ src = 'layout.tsx'; dst = 'layout.tsx' },
  @{ src = 'gallery\page.tsx'; dst = 'gallery\page.tsx' }
)

foreach ($f in $files) {
  $s = Join-Path $srcBase $f.src
  $d = Join-Path $dstBase $f.dst
  New-Item -ItemType Directory -Force -Path (Split-Path $d) | Out-Null
  Copy-Item -Force $s $d
  # make read-only to help prevent accidental overwrites
  attrib +R $d
  Write-Host "  OK: $d" -ForegroundColor Green
}

Write-Host "
PASS-1 UI restored and marked read-only." -ForegroundColor Cyan
