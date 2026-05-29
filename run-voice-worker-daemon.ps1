param(
  [string]$Owner = "slrochford12300",
  [int]$Limit = 20,
  [int]$SleepSeconds = 10
)

$ErrorActionPreference = "Continue"
# OTG_INDEXTTS2_WORKER_UTF8_ENV_V1
$env:PYTHONUTF8 = "1"
$env:PYTHONIOENCODING = "utf-8"

$repo = "C:\AI\OTG-Test2"
Set-Location $repo

$env:PYTHONUTF8 = "1"
$env:PYTHONIOENCODING = "utf-8"
$env:OTG_REQUIRE_REAL_VOICE = "1"

$logDir = Join-Path $repo "data\worker-logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$lockPath = Join-Path $repo "data\voice-worker-daemon.lock.json"
$logPath = Join-Path $logDir ("voice-worker-daemon-" + (Get-Date -Format "yyyyMMdd") + ".log")
$realCreateVoiceScript = Join-Path $repo "scripts\process-real-create-voice-jobs-once.ps1"

function Write-Log {
  param([string]$Message)
  $line = "[" + (Get-Date).ToString("s") + "] " + $Message
  Add-Content -Path $logPath -Value $line -Encoding UTF8
  Write-Host $line
}

function Is-ActualDaemonProcess {
  param([int]$PidValue)

  try {
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$PidValue" -ErrorAction Stop
    if (!$proc) { return $false }

    $cmd = [string]$proc.CommandLine
    if ($cmd -match "run-voice-worker-daemon\.ps1" -and $cmd -notmatch "\-NoExit") {
      return $true
    }

    return $false
  }
  catch {
    return $false
  }
}

if (Test-Path $lockPath) {
  try {
    $existing = Get-Content $lockPath -Raw | ConvertFrom-Json
    if ($existing.pid) {
      $existingPid = [int]$existing.pid

      if ($existingPid -ne $PID -and (Is-ActualDaemonProcess $existingPid)) {
        Write-Log "[SKIP] Voice worker daemon already running. PID=$existingPid."
        exit 0
      }

      Write-Log "[WARN] Removing stale voice worker lock. PID=$existingPid is not an active daemon."
      Remove-Item $lockPath -Force -ErrorAction SilentlyContinue
    }
  }
  catch {
    Write-Log "[WARN] Existing lock file unreadable. Replacing it."
    Remove-Item $lockPath -Force -ErrorAction SilentlyContinue
  }
}

$lock = [ordered]@{
  pid = $PID
  owner = $Owner
  limit = $Limit
  startedAt = (Get-Date).ToString("o")
  heartbeatAt = (Get-Date).ToString("o")
}
$lock | ConvertTo-Json -Depth 5 | Set-Content -Path $lockPath -Encoding utf8

Write-Log "[OK] Voice worker daemon started. PID=$PID Owner=$Owner Limit=$Limit SleepSeconds=$SleepSeconds"
Write-Log "[OK] Real create-voice pass runs before generic npm worker. Mock fallback is blocked."

try {
  while ($true) {
    $heartbeat = [ordered]@{
      pid = $PID
      owner = $Owner
      limit = $Limit
      startedAt = $lock.startedAt
      heartbeatAt = (Get-Date).ToString("o")
    }
    $heartbeat | ConvertTo-Json -Depth 5 | Set-Content -Path $lockPath -Encoding utf8

    if (Test-Path $realCreateVoiceScript) {
      Write-Log "[RUN] powershell -File process-real-create-voice-jobs-once.ps1 -Owner $Owner -Limit $Limit"
      $realOutput = & powershell -ExecutionPolicy Bypass -File $realCreateVoiceScript -Owner $Owner -Limit $Limit 2>&1
      $realExitCode = $LASTEXITCODE

      foreach ($line in $realOutput) {
        Add-Content -Path $logPath -Value $line -Encoding UTF8
      }

      if ($realExitCode -ne 0) {
        Write-Log "[WARN] Real create-voice pass exited with code $realExitCode. Generic worker will still run for non-create jobs."
      }
      else {
        Write-Log "[OK] Real create-voice pass completed."
      }
    }
    else {
      Write-Log "[WARN] Missing real create-voice script: $realCreateVoiceScript"
    }

    Write-Log "[RUN] npm run voice-worker:once -- --owner $Owner --limit $Limit"
    $cmdOutput = & npm run voice-worker:once -- --owner $Owner --limit $Limit 2>&1
    $exitCode = $LASTEXITCODE

    foreach ($line in $cmdOutput) {
      Add-Content -Path $logPath -Value $line -Encoding UTF8
    }

    if ($exitCode -ne 0) {
      Write-Log "[WARN] Generic worker pass exited with code $exitCode. Continuing after delay."
    }
    else {
      Write-Log "[OK] Generic worker pass completed."
    }

    Start-Sleep -Seconds $SleepSeconds
  }
}
finally {
  if (Test-Path $lockPath) {
    Remove-Item $lockPath -Force -ErrorAction SilentlyContinue
  }
  Write-Log "[STOP] Voice worker daemon stopped."
}