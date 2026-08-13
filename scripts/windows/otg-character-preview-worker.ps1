param(
  [string]$Repo = $(if ($env:OTG_REPO) { $env:OTG_REPO } else { "C:\AI\OTG-Test2" }),
  [string]$BaseUrl = $(if ($env:OTG_BASE_URL) { $env:OTG_BASE_URL } else { "http://127.0.0.1:3001" }),
  [string]$DeviceId = $(if ($env:OTG_DEVICE_ID) { $env:OTG_DEVICE_ID } else { "slrochford" }),
  [string]$WorkerId = $(if ($env:OTG_WORKER_ID) { $env:OTG_WORKER_ID } else { "windows-character-preview-worker" }),
  [string]$WorkerToken = "",
  [string]$Python = $(if ($env:OTG_WORKER_PYTHON) { $env:OTG_WORKER_PYTHON } elseif ($env:APPLIO_PYTHON) { $env:APPLIO_PYTHON } else { "python" }),
  [string]$AdapterCommand = $(if ($env:OTG_CHARACTER_PREVIEW_ADAPTER) { $env:OTG_CHARACTER_PREVIEW_ADAPTER } else { "" }),
  [int]$PollSeconds = $(if ($env:OTG_CHARACTER_PREVIEW_WORKER_POLL_SECONDS) { [int]$env:OTG_CHARACTER_PREVIEW_WORKER_POLL_SECONDS } else { 30 }),
  [int]$HeartbeatSeconds = $(if ($env:OTG_CHARACTER_PREVIEW_WORKER_HEARTBEAT_SECONDS) { [int]$env:OTG_CHARACTER_PREVIEW_WORKER_HEARTBEAT_SECONDS } else { 20 }),
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
if (![string]::IsNullOrWhiteSpace($AdapterCommand)) {
  [Environment]::SetEnvironmentVariable("OTG_CHARACTER_PREVIEW_ADAPTER", $AdapterCommand, "Process")
}

if ([string]::IsNullOrWhiteSpace($WorkerToken)) {
  throw "OTG_WORKER_TOKEN is required for universal all-user Character Preview Dub worker claim mode. Set it in the user environment or .env.local."
}
if (!(Test-Path $Repo)) {
  throw "Repo not found: $Repo"
}

$WorkerPy = Join-Path $Repo "scripts\windows\otg-character-preview-worker.py"
if (!(Test-Path $WorkerPy)) {
  throw "Character Preview Dub worker script not found: $WorkerPy"
}

if ([string]::IsNullOrWhiteSpace($AdapterCommand)) {
  $AdapterPs1 = Join-Path $Repo "scripts\windows\otg-character-preview-adapter.ps1"
  $AdapterCommand = "powershell -NoProfile -ExecutionPolicy Bypass -File `"$AdapterPs1`""
  [Environment]::SetEnvironmentVariable("OTG_CHARACTER_PREVIEW_ADAPTER", $AdapterCommand, "Process")
}

$ArgsList = @(
  $WorkerPy,
  "--repo", $Repo,
  "--base-url", $BaseUrl,
  "--device-id", $DeviceId,
  "--worker-id", $WorkerId,
  "--poll-seconds", [string]$PollSeconds,
  "--heartbeat-seconds", [string]$HeartbeatSeconds
)

if (![string]::IsNullOrWhiteSpace($AdapterCommand)) {
  $ArgsList += @("--adapter-command", $AdapterCommand)
}
if ($Once) {
  $ArgsList += "--once"
}

Write-Host "Starting OTG Character Preview Dub worker"
Write-Host "  Route: character_voice_pipeline / generate_character_preview only"
Write-Host "  BaseUrl: $BaseUrl"
Write-Host "  Claim: all owners via worker token"
Write-Host "  DeviceId: $DeviceId"
Write-Host "  WorkerId: $WorkerId"
Write-Host "  Adapter: $(if ($AdapterCommand) { $AdapterCommand } else { 'not configured' })"

& $Python @ArgsList
exit $LASTEXITCODE
