param(
  [string]$Python = $(if ($env:OTG_WORKER_PYTHON) { $env:OTG_WORKER_PYTHON } elseif ($env:APPLIO_PYTHON) { $env:APPLIO_PYTHON } else { "python" }),
  [string]$Repo = $(if ($env:OTG_REPO) { $env:OTG_REPO } else { "C:\AI\OTG-Test2" })
)

$ErrorActionPreference = "Stop"

$ScriptPath = Join-Path $Repo "scripts\windows\otg-ltx-character-preview.py"

if (!(Test-Path $ScriptPath)) {
  throw "Missing LTX character preview Python script: $ScriptPath"
}

Write-Host "Starting OTG LTX Character Preview command"
Write-Host "  Python: $Python"
Write-Host "  Script: $ScriptPath"
Write-Host "  Comfy:  $(if ($env:OTG_CHARACTER_PREVIEW_COMFY_URL) { $env:OTG_CHARACTER_PREVIEW_COMFY_URL } else { 'http://127.0.0.1:8188' })"
Write-Host "  Workflow: $(if ($env:OTG_CHARACTER_PREVIEW_LTX_WORKFLOW) { $env:OTG_CHARACTER_PREVIEW_LTX_WORKFLOW } else { 'repo preset fallback' })"

& $Python $ScriptPath
exit $LASTEXITCODE
