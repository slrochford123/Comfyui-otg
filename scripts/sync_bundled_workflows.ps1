# Copies bundled workflow JSONs from the repo into your configured OTG workflows folder.
# Run from any PowerShell prompt.

$ErrorActionPreference = 'Stop'

$repo = Split-Path -Parent $MyInvocation.MyCommand.Path
$repo = Split-Path -Parent $repo  # ...\OTG

$src = Join-Path $repo 'bundled_workflows'
if (!(Test-Path $src)) {
  throw "Bundled workflows folder not found: $src"
}

$dest = $env:OTG_WORKFLOWS_DIR
if ([string]::IsNullOrWhiteSpace($dest)) {
  $dest = 'C:\Users\SLRoc\comfy-controller\presets'
}

Write-Host "Copying bundled workflows from:" $src
Write-Host "Into OTG_WORKFLOWS_DIR:" $dest

New-Item -ItemType Directory -Force -Path $dest | Out-Null

Get-ChildItem -Path $src -Filter '*.json' -File | ForEach-Object {
  $out = Join-Path $dest $_.Name
  Copy-Item -Force $_.FullName $out
  Write-Host "  ->" $out
}

Write-Host "Done. Now click 'Reload workflows' in Settings (or hit /api/workflows/reload)."
