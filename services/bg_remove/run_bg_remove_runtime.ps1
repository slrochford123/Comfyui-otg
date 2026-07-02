$ErrorActionPreference = "Stop"

Set-Location $PSScriptRoot

$Python = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"
$App = Join-Path $PSScriptRoot "app.py"

if (!(Test-Path $Python)) {
  throw "BG Remove .venv Python not found. Run services\bg_remove\run_bg_remove.ps1 once to install dependencies, then retry."
}

if (!(Test-Path $App)) {
  throw "BG Remove app.py not found."
}

Write-Host "Starting OTG Background Removal runtime server"
Write-Host "  Host: 127.0.0.1"
Write-Host "  Port: 3333"
Write-Host "  App: app:app"
Write-Host "  Install: skipped"

& $Python -m uvicorn app:app --host 127.0.0.1 --port 3333
exit $LASTEXITCODE
