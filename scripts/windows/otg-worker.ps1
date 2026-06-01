param(
  [string]$Repo = "C:\AI\OTG-Test2",
  [string]$BaseUrl = $env:OTG_WORKER_BASE_URL,
  [string]$OwnerKey = $env:OTG_WORKER_OWNER_KEY,
  [string]$WorkerId = $env:OTG_WORKER_ID,
  [switch]$Once
)

$ErrorActionPreference = "Stop"

if (-not $BaseUrl) { $BaseUrl = "https://otg.win" }
if (-not $OwnerKey) { throw "Missing owner key. Set OTG_WORKER_OWNER_KEY or pass -OwnerKey." }
if (-not $WorkerId) { $WorkerId = "windows-main-pc" }

$Python = Join-Path $Repo ".venv\Scripts\python.exe"
if (-not (Test-Path $Python)) { $Python = "python" }

$Worker = Join-Path $Repo "scripts\windows\otg-worker.py"
if (-not (Test-Path $Worker)) { throw "Missing worker script: $Worker" }

$args = @(
  $Worker,
  "--repo", $Repo,
  "--base-url", $BaseUrl,
  "--owner-key", $OwnerKey,
  "--worker-id", $WorkerId
)

if ($Once) { $args += "--once" }

Write-Host "Starting OTG Windows worker coordinator"
Write-Host "  Repo: $Repo"
Write-Host "  BaseUrl: $BaseUrl"
Write-Host "  OwnerKey: $OwnerKey"
Write-Host "  WorkerId: $WorkerId"

& $Python @args
exit $LASTEXITCODE

