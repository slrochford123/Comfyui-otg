param(
  [string]$BaseUrl = "http://100.98.212.116:3000",
  [string]$OwnerKey = "slrochford00",
  [string]$DeviceId = "slrochford",
  [string]$WorkerId = "windows-rtx3090-applio-inference",
  [string]$ApplioRoot = "C:\AI\Voices\Applio",
  [string]$ApplioPython = "C:\AI\Voices\Applio\env\python.exe",
  [string]$WorkRoot = "C:\AI\OTG-Worker\applio-inference",
  [int]$Pitch = 0,
  [double]$IndexRate = 0.75,
  [double]$Protect = 0.33,
  [string]$F0Method = "rmvpe",
  [string]$EmbedderModel = "contentvec",
  [int]$TimeoutSeconds = 600,
  [int]$PollSeconds = 20,
  [switch]$Once
)

$ErrorActionPreference = "Stop"

$Repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$Worker = Join-Path $Repo "scripts\windows\applio-inference-worker.py"

if (!(Test-Path $Worker)) {
  throw "Missing worker script: $Worker"
}
if (!(Test-Path $ApplioPython)) {
  throw "Missing Applio Python: $ApplioPython"
}

Write-Host "Starting OTG Applio inference worker"
Write-Host "  BaseUrl: $BaseUrl"
Write-Host "  OwnerKey: $OwnerKey"
Write-Host "  WorkerId: $WorkerId"
Write-Host "  ApplioRoot: $ApplioRoot"
Write-Host "  WorkRoot: $WorkRoot"

$ArgsList = @(
  $Worker,
  "--base-url", $BaseUrl,
  "--owner-key", $OwnerKey,
  "--device-id", $DeviceId,
  "--worker-id", $WorkerId,
  "--applio-root", $ApplioRoot,
  "--applio-python", $ApplioPython,
  "--work-root", $WorkRoot,
  "--pitch", "$Pitch",
  "--index-rate", "$IndexRate",
  "--protect", "$Protect",
  "--f0-method", $F0Method,
  "--embedder-model", $EmbedderModel,
  "--timeout-seconds", "$TimeoutSeconds",
  "--poll-seconds", "$PollSeconds"
)

if ($Once) {
  $ArgsList += "--once"
}

& $ApplioPython @ArgsList
exit $LASTEXITCODE