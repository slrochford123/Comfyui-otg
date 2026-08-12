param(
  [string]$Repo = $(if ($env:OTG_REPO) { $env:OTG_REPO } else { "C:\AI\OTG-Test2" }),
  [string]$BaseUrl = $(if ($env:OTG_BASE_URL) { $env:OTG_BASE_URL } else { "http://127.0.0.1:3001" }),
  [string]$OwnerKey = $(if ($env:OTG_OWNER_KEY) { $env:OTG_OWNER_KEY } else { "" }),
  [string]$DeviceId = $(if ($env:OTG_DEVICE_ID) { $env:OTG_DEVICE_ID } else { "slrochford" }),
  [string]$WorkerId = $(if ($env:OTG_WORKER_ID) { $env:OTG_WORKER_ID } else { "windows-voice-dataset-worker" }),
  [string]$WorkerToken = "",
  [string]$IndexRoot = $(if ($env:INDEXTTS2_ROOT) { $env:INDEXTTS2_ROOT } else { "C:\AI\Voices\IndexTTS2" }),
  [string]$IndexPython = $(if ($env:INDEXTTS2_PYTHON) { $env:INDEXTTS2_PYTHON } else { "C:\AI\Voices\IndexTTS2\.venv\Scripts\python.exe" }),
  [string]$WorkRoot = $(if ($env:OTG_INDEXTTS2_WORK_ROOT) { $env:OTG_INDEXTTS2_WORK_ROOT } else { "C:\AI\OTG-Worker\voice-datasets" }),
  [int]$UploadChunkSize = $(if ($env:OTG_INDEXTTS2_UPLOAD_CHUNK_SIZE) { [int]$env:OTG_INDEXTTS2_UPLOAD_CHUNK_SIZE } else { 10 }),
  [int]$MaxClips = $(if ($env:OTG_INDEXTTS2_MAX_CLIPS) { [int]$env:OTG_INDEXTTS2_MAX_CLIPS } else { 0 }),
  [int]$PollSeconds = $(if ($env:OTG_INDEXTTS2_POLL_SECONDS) { [int]$env:OTG_INDEXTTS2_POLL_SECONDS } else { 30 }),
  [switch]$Once,
  [switch]$Regenerate
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

if ([string]::IsNullOrWhiteSpace($WorkerToken) -and [string]::IsNullOrWhiteSpace($OwnerKey)) {
  throw "OTG_WORKER_TOKEN is required for universal all-user claim mode. Set it in the user environment or .env.local."
}
if (!(Test-Path $Repo)) {
  throw "Repo not found: $Repo"
}
if (!(Test-Path $IndexPython)) {
  throw "IndexTTS2 Python not found: $IndexPython"
}
if (!(Test-Path $IndexRoot)) {
  throw "IndexTTS2 root not found: $IndexRoot"
}

$WorkerPy = Join-Path $Repo "scripts\windows\otg-voice-dataset-worker.py"
if (!(Test-Path $WorkerPy)) {
  throw "Dedicated worker script not found: $WorkerPy"
}

New-Item -ItemType Directory -Force -Path $WorkRoot | Out-Null

$ArgsList = @(
  $WorkerPy,
  "--repo", $Repo,
  "--base-url", $BaseUrl,
  "--device-id", $DeviceId,
  "--worker-id", $WorkerId,
  "--index-root", $IndexRoot,
  "--index-python", $IndexPython,
  "--work-root", $WorkRoot,
  "--upload-chunk-size", [string]$UploadChunkSize,
  "--max-clips", [string]$MaxClips,
  "--poll-seconds", [string]$PollSeconds
)

if ($Once) {
  $ArgsList += "--once"
}
if ($Regenerate) {
  $ArgsList += "--regenerate"
}

Write-Host "Starting dedicated OTG voice dataset worker"
Write-Host "  Route: character_voice_pipeline / generate_training_dataset only"
Write-Host "  BaseUrl: $BaseUrl"
Write-Host "  Claim: $(if ([string]::IsNullOrWhiteSpace($WorkerToken)) { 'owner scoped' } else { 'all owners via worker token' })"
Write-Host "  DeviceId: $DeviceId"
Write-Host "  WorkerId: $WorkerId"
Write-Host "  IndexRoot: $IndexRoot"
Write-Host "  WorkRoot: $WorkRoot"

& $IndexPython @ArgsList
exit $LASTEXITCODE
