param(
  [string]$Repo = "C:\AI\OTG-Test2",
  [string]$BaseUrl = $env:OTG_BASE_URL,
  [string]$DeviceId = $env:OTG_DEVICE_ID,
  [string]$WorkerId = $env:OTG_WORKER_ID,
  [switch]$Once
)

$ErrorActionPreference = "Stop"

if (-not $BaseUrl) { $BaseUrl = "http://100.75.162.64:3001" }
if (-not $DeviceId) { $DeviceId = "windows-character-completion" }
if (-not $WorkerId) { $WorkerId = "windows-character-completion-worker" }
if (-not $env:OTG_WORKER_TOKEN) { throw "Missing OTG_WORKER_TOKEN in the Worker Manager environment." }

$Python = Join-Path $Repo ".venv\Scripts\python.exe"
if (-not (Test-Path -LiteralPath $Python)) { $Python = "python" }

$Worker = Join-Path $Repo "scripts\windows\otg-character-completion-worker.py"
if (-not (Test-Path -LiteralPath $Worker)) { throw "Missing worker script: $Worker" }

$Args = @(
  $Worker,
  "--repo", $Repo,
  "--base-url", $BaseUrl,
  "--device-id", $DeviceId,
  "--worker-id", $WorkerId
)
if ($Once) { $Args += "--once" }

Write-Host "Starting OTG Character Completion Worker"
Write-Host "  Repo: $Repo"
Write-Host "  BaseUrl: $BaseUrl"
Write-Host "  DeviceId: $DeviceId"
Write-Host "  WorkerId: $WorkerId"

& $Python @Args
exit $LASTEXITCODE
