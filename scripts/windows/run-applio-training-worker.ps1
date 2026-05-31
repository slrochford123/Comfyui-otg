param(
  [Parameter(Mandatory = $true)]
  [string]$BaseUrl,

  [Parameter(Mandatory = $true)]
  [string]$OwnerKey,

  [Parameter(Mandatory = $true)]
  [string]$DeviceId,

  [string]$WorkerId = "windows-rtx3090-applio",

  [string]$Repo = "C:\AI\OTG-Test2",
  [string]$ApplioRoot = "C:\AI\Voices\Applio",
  [string]$ApplioPython = "C:\AI\Voices\Applio\env\python.exe",
  [string]$WorkRoot = "C:\AI\OTG-Worker\applio-training",

  [int]$Epochs = 50,
  [int]$BatchSize = 4,
  [int]$CpuCores = 8,
  [string]$Gpu = "0",
  [string]$TrainingQualityPreset = "normal",

  [int]$PollSeconds = 20,
  [switch]$Once
)

$ErrorActionPreference = "Stop"

$Worker = Join-Path $Repo "scripts\windows\applio-training-worker.py"

if (!(Test-Path $Worker)) {
  throw "Missing worker script: $Worker"
}
if (!(Test-Path $ApplioPython)) {
  throw "Missing Applio Python: $ApplioPython"
}
if (!(Test-Path (Join-Path $ApplioRoot "core.py"))) {
  throw "Missing Applio core.py under: $ApplioRoot"
}

New-Item -ItemType Directory -Path $WorkRoot -Force | Out-Null

Write-Host "Starting OTG Applio training worker"
Write-Host "  BaseUrl: $BaseUrl"
Write-Host "  OwnerKey: $OwnerKey"
Write-Host "  WorkerId: $WorkerId"
Write-Host "  ApplioRoot: $ApplioRoot"
Write-Host "  ApplioPython: $ApplioPython"
Write-Host "  WorkRoot: $WorkRoot"
Write-Host "  Epochs: $Epochs"
Write-Host "  BatchSize: $BatchSize"
Write-Host "  CpuCores: $CpuCores"
Write-Host "  Gpu: $Gpu"

$Args = @(
  $Worker,
  "--base-url", $BaseUrl,
  "--owner-key", $OwnerKey,
  "--device-id", $DeviceId,
  "--worker-id", $WorkerId,
  "--applio-root", $ApplioRoot,
  "--applio-python", $ApplioPython,
  "--work-root", $WorkRoot,
  "--epochs", [string]$Epochs,
  "--batch-size", [string]$BatchSize,
  "--cpu-cores", [string]$CpuCores,
  "--gpu", $Gpu,
  "--training-quality-preset", $TrainingQualityPreset,
  "--poll-seconds", [string]$PollSeconds
)

if ($Once) {
  $Args += "--once"
}

& $ApplioPython @Args
exit $LASTEXITCODE