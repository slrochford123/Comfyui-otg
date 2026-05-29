param(
  [string]$RepoRoot = "C:\AI\OTG-Test2",
  [string]$ApplioRoot = "C:\AI\Voices\Applio"
)

$ErrorActionPreference = "Stop"

function Write-Ok {
  param([string]$Text)
  Write-Host "[OK] $Text" -ForegroundColor Green
}

function Write-Fail {
  param([string]$Text)
  Write-Host "[FAIL] $Text" -ForegroundColor Red
}

$envPath = Join-Path $RepoRoot ".env.local"
$corePath = Join-Path $ApplioRoot "core.py"

$pythonCandidates = @(
  (Join-Path $ApplioRoot "env\python.exe"),
  (Join-Path $ApplioRoot ".venv\Scripts\python.exe"),
  (Join-Path $ApplioRoot "venv\Scripts\python.exe")
)

if (-not (Test-Path -LiteralPath $envPath)) {
  Write-Fail "Missing .env.local: $envPath"
  exit 1
}

if (-not (Test-Path -LiteralPath $ApplioRoot)) {
  Write-Fail "Missing Applio root: $ApplioRoot"
  exit 1
}

if (-not (Test-Path -LiteralPath $corePath)) {
  Write-Fail "Missing Applio core.py: $corePath"
  exit 1
}

$pythonPath = $null
foreach ($candidate in $pythonCandidates) {
  if (Test-Path -LiteralPath $candidate) {
    $pythonPath = $candidate
    break
  }
}

if (-not $pythonPath) {
  Write-Fail "Could not find Applio python.exe. Checked:"
  $pythonCandidates | ForEach-Object { Write-Host "  $_" }
  exit 1
}

Write-Ok "Using Applio root: $ApplioRoot"
Write-Ok "Using Applio core: $corePath"
Write-Ok "Using Applio Python: $pythonPath"

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backup = "$envPath.bak-$timestamp"
Copy-Item -LiteralPath $envPath -Destination $backup -Force
Write-Ok "Backed up .env.local to $backup"

$text = Get-Content -LiteralPath $envPath -Raw

$settings = [ordered]@{
  "OTG_ENABLE_REAL_APPLIO_TRAINING" = "1"
  "APPLIO_ROOT" = ($ApplioRoot -replace "\\", "/")
  "APPLIO_PYTHON" = ($pythonPath -replace "\\", "/")
  "APPLIO_CORE_SCRIPT" = ($corePath -replace "\\", "/")
  "APPLIO_SAMPLE_RATE" = "40000"
  "APPLIO_EPOCHS" = "100"
  "APPLIO_BATCH_SIZE" = "4"
  "APPLIO_SAVE_EVERY_EPOCH" = "10"
  "APPLIO_GPU" = "0"
  "APPLIO_INDEX_ALGORITHM" = "Auto"
  "APPLIO_PITCH_GUIDANCE" = "1"
  "APPLIO_F0_METHOD" = "rmvpe"
}

foreach ($key in $settings.Keys) {
  $value = $settings[$key]
  $line = "$key=$value"

  if ($text -match "(?m)^$([regex]::Escape($key))=") {
    $text = [regex]::Replace($text, "(?m)^$([regex]::Escape($key))=.*$", $line)
  } else {
    $text = $text.TrimEnd() + "`r`n" + $line + "`r`n"
  }
}

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($envPath, $text, $utf8NoBom)

Write-Ok "Updated .env.local for real Applio training."

Get-Content -LiteralPath $envPath |
  Select-String -Pattern "OTG_ENABLE_REAL_APPLIO_TRAINING|APPLIO_ROOT|APPLIO_PYTHON|APPLIO_CORE_SCRIPT|APPLIO_SAMPLE_RATE|APPLIO_EPOCHS|APPLIO_BATCH_SIZE|APPLIO_GPU"