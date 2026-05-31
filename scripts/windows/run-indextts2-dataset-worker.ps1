param(
  [string]$BaseUrl = "https://comf-otg.comfyui-otg.win",
  [string]$OwnerKey = "slrochford",
  [string]$DeviceId = "slrochford",
  [string]$WorkerId = "windows-rtx3090-indextts2",
  [string]$IndexRoot = "C:\AI\Voices\IndexTTS2",
  [string]$IndexPython = "C:\AI\Voices\IndexTTS2\.venv\Scripts\python.exe",
  [string]$WorkRoot = "C:\AI\OTG-Worker\indextts2-datasets",
  [int]$UploadChunkSize = 10,
  [int]$MaxClips = 0,
  [switch]$Once,
  [switch]$Regenerate
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$WorkerPy = Join-Path $ScriptDir "indextts2-dataset-worker.py"

if (!(Test-Path $WorkerPy)) {
  throw "Worker script not found: $WorkerPy"
}
if (!(Test-Path $IndexPython)) {
  throw "IndexTTS2 Python not found: $IndexPython"
}
if (!(Test-Path $IndexRoot)) {
  throw "IndexTTS2 root not found: $IndexRoot"
}

New-Item -ItemType Directory -Force -Path $WorkRoot | Out-Null

$ArgsList = @(
  $WorkerPy,
  "--base-url", $BaseUrl,
  "--owner-key", $OwnerKey,
  "--device-id", $DeviceId,
  "--worker-id", $WorkerId,
  "--index-root", $IndexRoot,
  "--index-python", $IndexPython,
  "--work-root", $WorkRoot,
  "--upload-chunk-size", [string]$UploadChunkSize,
  "--max-clips", [string]$MaxClips
)

if ($Once) {
  $ArgsList += "--once"
}
if ($Regenerate) {
  $ArgsList += "--regenerate"
}

Write-Host "Starting OTG IndexTTS2 dataset worker"
Write-Host "  BaseUrl: $BaseUrl"
Write-Host "  OwnerKey: $OwnerKey"
Write-Host "  WorkerId: $WorkerId"
Write-Host "  IndexRoot: $IndexRoot"
Write-Host "  WorkRoot: $WorkRoot"
Write-Host "  MaxClips: $MaxClips"
Write-Host "  UploadChunkSize: $UploadChunkSize"

& $IndexPython @ArgsList
exit $LASTEXITCODE