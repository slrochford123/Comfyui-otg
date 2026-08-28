param(
  [string]$Repo = $(if ($env:OTG_REPO) { $env:OTG_REPO } else { "C:\AI\OTG-Test2" }),
  [string]$BaseUrl = $(if ($env:OTG_BASE_URL) { $env:OTG_BASE_URL } else { "http://127.0.0.1:3001" }),
  [string]$DeviceId = $(if ($env:OTG_DEVICE_ID) { $env:OTG_DEVICE_ID } else { "slrochford" }),
  [string]$WorkerId = $(if ($env:OTG_WORKER_ID) { $env:OTG_WORKER_ID } else { "windows-voice-applio-worker" }),
  [string]$WorkerToken = "",
  [string]$ApplioRoot = $(if ($env:APPLIO_ROOT) { $env:APPLIO_ROOT } else { "C:\AI\Voices\Applio" }),
  [string]$ApplioPython = $(if ($env:APPLIO_PYTHON) { $env:APPLIO_PYTHON } else { "C:\AI\Voices\Applio\env\python.exe" }),
  [string]$ApplioCore = $(if ($env:APPLIO_CORE_SCRIPT) { $env:APPLIO_CORE_SCRIPT } elseif ($env:APPLIO_TRAIN_SCRIPT) { $env:APPLIO_TRAIN_SCRIPT } else { "C:\AI\Voices\Applio\core.py" }),
  [int]$PollSeconds = $(if ($env:OTG_APPLIO_WORKER_POLL_SECONDS) { [int]$env:OTG_APPLIO_WORKER_POLL_SECONDS } else { 30 }),
  [int]$HeartbeatSeconds = $(if ($env:OTG_APPLIO_WORKER_HEARTBEAT_SECONDS) { [int]$env:OTG_APPLIO_WORKER_HEARTBEAT_SECONDS } else { 20 }),
  [switch]$Once
)

$ErrorActionPreference = "Stop"

$EnvFile = Join-Path $Repo ".env.local"
if (Test-Path $EnvFile) {
  Get-Content $EnvFile | ForEach-Object {
    $line = $_.Trim()
    if (!$line -or $line.StartsWith("#") -or !$line.Contains("=")) { return }
    $parts = $line.Split("=", 2)
    $key = $parts[0].Trim()
    $value = $parts[1].Trim().Trim('"').Trim("'")
    if ($key -and [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($key, "Process"))) {
      [Environment]::SetEnvironmentVariable($key, $value, "Process")
    }
  }
}

if ([string]::IsNullOrWhiteSpace($WorkerToken)) {
  $WorkerToken = $(if ($env:OTG_WORKER_TOKEN) { $env:OTG_WORKER_TOKEN } else { "" })
}
if (![string]::IsNullOrWhiteSpace($WorkerToken)) {
  [Environment]::SetEnvironmentVariable("OTG_WORKER_TOKEN", $WorkerToken, "Process")
}

if ([string]::IsNullOrWhiteSpace($WorkerToken)) {
  throw "OTG_WORKER_TOKEN is required for universal all-user Applio worker claim mode. Set it in the user environment or .env.local."
}
if (!(Test-Path $Repo)) {
  throw "Repo not found: $Repo"
}
if (!(Test-Path $ApplioRoot)) {
  throw "Applio root not found: $ApplioRoot"
}
if (!(Test-Path $ApplioPython)) {
  throw "Applio Python not found: $ApplioPython"
}
if (!(Test-Path $ApplioCore)) {
  throw "Applio core.py not found: $ApplioCore"
}

$WorkerPy = Join-Path $Repo "scripts\windows\otg-voice-applio-worker.py"
if (!(Test-Path $WorkerPy)) {
  throw "Dedicated Applio worker script not found: $WorkerPy"
}

$ArgsList = @(
  $WorkerPy,
  "--repo", $Repo,
  "--base-url", $BaseUrl,
  "--device-id", $DeviceId,
  "--worker-id", $WorkerId,
  "--applio-root", $ApplioRoot,
  "--applio-python", $ApplioPython,
  "--applio-core", $ApplioCore,
  "--poll-seconds", [string]$PollSeconds,
  "--heartbeat-seconds", [string]$HeartbeatSeconds
)

if ($Once) {
  $ArgsList += "--once"
}

Write-Host "Starting dedicated OTG voice Applio worker"
Write-Host "  Route: character_voice_pipeline / start_applio_training only"
Write-Host "  BaseUrl: $BaseUrl"
Write-Host "  Claim: all owners via worker token"
Write-Host "  DeviceId: $DeviceId"
Write-Host "  WorkerId: $WorkerId"
Write-Host "  ApplioRoot: $ApplioRoot"
Write-Host "  ApplioCore: $ApplioCore"
Write-Host "  HeartbeatSeconds: $HeartbeatSeconds"
Write-Host "  Distributed: MASTER_ADDR=127.0.0.1 MASTER_PORT=per-job"

& $ApplioPython @ArgsList
exit $LASTEXITCODE
