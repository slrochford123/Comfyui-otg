$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$WorkerPy = Join-Path $Root "scripts\windows\otg-voice-design-worker.py"
$DesignPs1 = Join-Path $Root "scripts\windows\otg-voice-design-worker.ps1"
$QwenPs1 = Join-Path $Root "scripts\windows\otg-voice-qwen3-worker.ps1"
$Checklist = Join-Path $Root "docs\OTG_REWORK_CHECKLIST.md"
$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$BackupDir = Join-Path $Root ".patch-backups\qwen3-voice-worker-$Stamp"

function Fail($Message) {
  Write-Host "[FAIL] $Message" -ForegroundColor Red
  exit 1
}

function Pass($Message) {
  Write-Host "[OK] $Message" -ForegroundColor Green
}

foreach ($path in @($WorkerPy, $DesignPs1, $QwenPs1, $Checklist)) {
  if (-not (Test-Path -LiteralPath $path)) {
    Fail "Missing required file: $path"
  }
}

New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
Copy-Item -LiteralPath $WorkerPy -Destination (Join-Path $BackupDir "otg-voice-design-worker.py.bak") -Force
Copy-Item -LiteralPath $DesignPs1 -Destination (Join-Path $BackupDir "otg-voice-design-worker.ps1.bak") -Force
Copy-Item -LiteralPath $QwenPs1 -Destination (Join-Path $BackupDir "otg-voice-qwen3-worker.ps1.bak") -Force
Copy-Item -LiteralPath $Checklist -Destination (Join-Path $BackupDir "OTG_REWORK_CHECKLIST.md.bak") -Force
Pass "Backed up files to $BackupDir"

$workerText = Get-Content -LiteralPath $WorkerPy -Raw
$designText = Get-Content -LiteralPath $DesignPs1 -Raw
$qwenText = Get-Content -LiteralPath $QwenPs1 -Raw
$checklistText = Get-Content -LiteralPath $Checklist -Raw

$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$Utf8Bom = New-Object System.Text.UTF8Encoding($true)
[System.IO.File]::WriteAllText($WorkerPy, $workerText, $Utf8NoBom)
[System.IO.File]::WriteAllText($DesignPs1, $designText, $Utf8NoBom)
[System.IO.File]::WriteAllText($QwenPs1, $qwenText, $Utf8NoBom)
[System.IO.File]::WriteAllText($Checklist, $checklistText, $Utf8Bom)
Pass "Rewrote patched files"

$workerText = Get-Content -LiteralPath $WorkerPy -Raw
$designText = Get-Content -LiteralPath $DesignPs1 -Raw
$qwenText = Get-Content -LiteralPath $QwenPs1 -Raw
$checklistText = Get-Content -LiteralPath $Checklist -Raw

$workerMarkers = @(
  "normalize_qwen_synthesize_url",
  "QWEN3_TTS_API_URL",
  "QWEN3_TTS_URL",
  "[synthesize] Qwen3 API",
  "qwen3_real_voice_sample",
  "synthesizerAdapter",
  "Qwen3 TTS API did not write a non-empty WAV",
  "[output] job="
)

foreach ($marker in $workerMarkers) {
  if (-not $workerText.Contains($marker)) {
    Fail "Missing Python worker marker: $marker"
  }
}

if (-not $designText.Contains("--qwen-api-url")) {
  Fail "Design launcher does not pass --qwen-api-url"
}

$qwenMarkers = @(
  "Starting OTG Qwen3 voice worker",
  "windows-voice-qwen3-worker",
  "Qwen3ApiUrl",
  "OTG_VOICE_QWEN3_WORK_ROOT",
  "Provider: qwen3 API-first, no mock output"
)

foreach ($marker in $qwenMarkers) {
  if (-not $qwenText.Contains($marker)) {
    Fail "Missing Qwen3 launcher marker: $marker"
  }
}

if (-not $checklistText.Contains("Qwen3 create_voice_sample worker repair")) {
  Fail "Missing checklist marker"
}

Pass "Qwen3 voice worker markers verified"
Write-Host "Run validation next:" -ForegroundColor Cyan
Write-Host "  npm run lint -- --quiet"
Write-Host "  npx tsc --noEmit --pretty false"
Write-Host "  npm test"
