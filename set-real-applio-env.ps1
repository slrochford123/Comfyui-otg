param(
  [string]$RepoRoot = "C:\AI\OTG-Test2"
)

$ErrorActionPreference = "Stop"

$envPath = Join-Path $RepoRoot ".env.local"

if (-not (Test-Path $envPath)) {
  Write-Host "[FAIL] Missing .env.local: $envPath" -ForegroundColor Red
  exit 1
}

$required = @(
  "C:\AI\Voices\Applio",
  "C:\AI\Voices\Applio\core.py",
  "C:\AI\Voices\Applio\.venv\Scripts\python.exe"
)

foreach ($path in $required) {
  if (-not (Test-Path $path)) {
    Write-Host "[FAIL] Missing required Applio path: $path" -ForegroundColor Red
    exit 1
  }
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backup = "$envPath.bak-$timestamp"
Copy-Item $envPath $backup -Force
Write-Host "[OK] Backed up .env.local to $backup" -ForegroundColor Green

$text = Get-Content $envPath -Raw

$settings = [ordered]@{
  "OTG_ENABLE_REAL_APPLIO_TRAINING" = "1"
  "APPLIO_ROOT" = "C:/AI/Voices/Applio"
  "APPLIO_PYTHON" = "C:/AI/Voices/Applio/.venv/Scripts/python.exe"
  "APPLIO_CORE_SCRIPT" = "C:/AI/Voices/Applio/core.py"
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

Write-Host "[OK] Updated .env.local for real Applio training" -ForegroundColor Green

Get-Content $envPath |
  Select-String -Pattern "OTG_ENABLE_REAL_APPLIO_TRAINING|APPLIO_ROOT|APPLIO_PYTHON|APPLIO_CORE_SCRIPT|APPLIO_SAMPLE_RATE|APPLIO_EPOCHS|APPLIO_BATCH_SIZE|APPLIO_GPU"