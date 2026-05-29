param(
  [string]$TestRoot = "C:\AI\OTG-Test2",
  [string]$StageRoot = "C:\AI\OTG-Stage2",
  [int]$StagePort = 3002
)

$ErrorActionPreference = "Stop"

$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$BackupRoot = "C:\AI\stage_backups\OTG-Stage2-$Stamp"

function Ok($Message) {
  Write-Host "[OK] $Message" -ForegroundColor Green
}

function Info($Message) {
  Write-Host "[INFO] $Message" -ForegroundColor Cyan
}

function Warn($Message) {
  Write-Host "[WARN] $Message" -ForegroundColor Yellow
}

function Fail($Message) {
  Write-Host "[FAIL] $Message" -ForegroundColor Red
  exit 1
}

if (!(Test-Path $TestRoot)) {
  Fail "TEST root missing: $TestRoot"
}

if ($TestRoot -eq $StageRoot) {
  Fail "TEST and STAGE paths must be different."
}

Info "TEST root:  $TestRoot"
Info "STAGE root: $StageRoot"
Info "STAGE port: $StagePort"

# Stop existing STAGE port/processes only.
$StageListeners = @(Get-NetTCPConnection -State Listen -LocalPort $StagePort -ErrorAction SilentlyContinue)

foreach ($Conn in $StageListeners) {
  $PidToStop = $Conn.OwningProcess
  if ($PidToStop -and $PidToStop -ne 0) {
    $Proc = Get-CimInstance Win32_Process -Filter "ProcessId=$PidToStop" -ErrorAction SilentlyContinue
    if ($Proc) {
      Warn "Stopping existing STAGE port $StagePort process PID=$PidToStop"
      Write-Host "     $($Proc.CommandLine)"
      Stop-Process -Id $PidToStop -Force -ErrorAction SilentlyContinue
    }
  }
}

# Backup existing STAGE.
if (Test-Path $StageRoot) {
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $BackupRoot) | Out-Null
  Info "Backing up existing STAGE to: $BackupRoot"

  robocopy $StageRoot $BackupRoot /MIR /XD node_modules .next .git diagnostics patch_backups logs tmp /XF *.log | Out-Host

  if ($LASTEXITCODE -gt 7) {
    Fail "Backup robocopy failed with exit code $LASTEXITCODE"
  }

  Ok "Existing STAGE backed up."
}
else {
  New-Item -ItemType Directory -Force -Path $StageRoot | Out-Null
  Ok "Created STAGE root."
}

# Mirror TEST to STAGE.
# Excludes generated/build/cache/backup folders.
# Keeps source, app files, scripts, workflows, configs, and data files.
Info "Promoting TEST to STAGE..."

robocopy $TestRoot $StageRoot /MIR `
  /XD node_modules .next .git diagnostics patch_backups logs tmp __pycache__ `
  /XF *.log *.tmp `
  /R:2 /W:2 | Out-Host

if ($LASTEXITCODE -gt 7) {
  Fail "Promotion robocopy failed with exit code $LASTEXITCODE"
}

Ok "Copied TEST to STAGE."

Set-Location $StageRoot

# Remove stale build artifacts if copied somehow.
foreach ($Dir in @(".next", "tmp")) {
  $Path = Join-Path $StageRoot $Dir
  if (Test-Path $Path) {
    Remove-Item $Path -Recurse -Force -ErrorAction SilentlyContinue
    Ok "Removed stale $Dir"
  }
}

# Write STAGE env file.
$EnvStagePath = Join-Path $StageRoot ".env.stage.local"

$EnvStage = @"
# OTG STAGE local environment
OTG_ENV=stage
OTG_STAGE=1
PORT=$StagePort
NEXT_PUBLIC_OTG_APP_ENV=stage
NEXT_PUBLIC_OTG_PORT=$StagePort
PYTHONUTF8=1
PYTHONIOENCODING=utf-8
OTG_REQUIRE_REAL_VOICE=1
OTG_VOICE_DESIGN_ONLY=1
"@

[System.IO.File]::WriteAllText($EnvStagePath, $EnvStage, [System.Text.UTF8Encoding]::new($false))
Ok "Wrote .env.stage.local"

# Write STAGE launcher PowerShell.
$StageLauncherPs1 = Join-Path $StageRoot "start-stage-3002.ps1"

$StageLauncher = @"
`$ErrorActionPreference = "Stop"

`$Root = Split-Path -Parent `$MyInvocation.MyCommand.Path
Set-Location `$Root

`$env:OTG_ENV = "stage"
`$env:OTG_STAGE = "1"
`$env:PORT = "$StagePort"
`$env:NEXT_PUBLIC_OTG_APP_ENV = "stage"
`$env:NEXT_PUBLIC_OTG_PORT = "$StagePort"
`$env:PYTHONUTF8 = "1"
`$env:PYTHONIOENCODING = "utf-8"
`$env:OTG_REQUIRE_REAL_VOICE = "1"
`$env:OTG_VOICE_DESIGN_ONLY = "1"

Write-Host "[INFO] Starting OTG STAGE on port $StagePort from `$Root" -ForegroundColor Cyan

`$Existing = @(Get-NetTCPConnection -State Listen -LocalPort $StagePort -ErrorAction SilentlyContinue)
if (`$Existing.Count -gt 0) {
  Write-Host "[FAIL] Port $StagePort is already in use." -ForegroundColor Red
  `$Existing | Format-Table -AutoSize
  exit 1
}

`$NpmCmd = "C:\AI\nodejs\npm.cmd"
if (!(Test-Path `$NpmCmd)) {
  `$Resolved = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if (`$Resolved) {
    `$NpmCmd = `$Resolved.Source
  }
  else {
    `$Resolved = Get-Command npm -ErrorAction SilentlyContinue
    if (`$Resolved) {
      `$NpmCmd = `$Resolved.Source
    }
    else {
      Write-Host "[FAIL] npm not found." -ForegroundColor Red
      exit 1
    }
  }
}

& `$NpmCmd run dev -- -p $StagePort
"@

[System.IO.File]::WriteAllText($StageLauncherPs1, $StageLauncher, [System.Text.UTF8Encoding]::new($false))
Ok "Wrote start-stage-3002.ps1"

# Write STAGE launcher BAT.
$StageLauncherBat = Join-Path $StageRoot "start-stage-3002.bat"

$Bat = @"
@echo off
cd /d "%~dp0"
powershell -ExecutionPolicy Bypass -File "%~dp0start-stage-3002.ps1"
pause
"@

[System.IO.File]::WriteAllText($StageLauncherBat, $Bat, [System.Text.UTF8Encoding]::new($false))
Ok "Wrote start-stage-3002.bat"

# Optional: patch common hardcoded 3001 launcher references in STAGE copies only.
$StageFilesToPatch = Get-ChildItem $StageRoot -Recurse -File -Include *.ps1,*.bat,*.cmd,*.ts,*.tsx,*.js,*.jsx,*.json -ErrorAction SilentlyContinue |
  Where-Object {
    $_.FullName -notmatch "\\node_modules\\" -and
    $_.FullName -notmatch "\\.next\\" -and
    $_.FullName -notmatch "\\.git\\" -and
    $_.FullName -notmatch "\\patch_backups\\" -and
    $_.Length -lt 5MB
  }

$PatchCount = 0

foreach ($File in $StageFilesToPatch) {
  $Text = Get-Content $File.FullName -Raw -ErrorAction SilentlyContinue
  if ($null -eq $Text) {
    continue
  }

  $NewText = $Text

  # Only patch obvious local app port URLs / Next launch port references.
  $NewText = $NewText.Replace("localhost:3001", "localhost:$StagePort")
  $NewText = $NewText.Replace("127.0.0.1:3001", "127.0.0.1:$StagePort")
  $NewText = $NewText.Replace("http://0.0.0.0:3001", "http://0.0.0.0:$StagePort")
  $NewText = $NewText.Replace("-p 3001", "-p $StagePort")
  $NewText = $NewText.Replace("port 3001", "port $StagePort")
  $NewText = $NewText.Replace("PORT=3001", "PORT=$StagePort")

  if ($NewText -ne $Text) {
    [System.IO.File]::WriteAllText($File.FullName, $NewText, [System.Text.UTF8Encoding]::new($false))
    $PatchCount++
  }
}

Ok "Patched obvious 3001 references in STAGE files: $PatchCount"

# Install dependencies if needed.
$NodeModules = Join-Path $StageRoot "node_modules"
if (!(Test-Path $NodeModules)) {
  Info "node_modules missing in STAGE. Running npm install..."
  $NpmCmd = "C:\AI\nodejs\npm.cmd"
  if (!(Test-Path $NpmCmd)) {
    $ResolvedNpm = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if ($ResolvedNpm) {
      $NpmCmd = $ResolvedNpm.Source
    }
    else {
      $ResolvedNpm = Get-Command npm -ErrorAction SilentlyContinue
      if ($ResolvedNpm) {
        $NpmCmd = $ResolvedNpm.Source
      }
      else {
        Fail "npm not found."
      }
    }
  }

  & $NpmCmd install
  if ($LASTEXITCODE -ne 0) {
    Fail "npm install failed."
  }

  Ok "npm install completed."
}
else {
  Ok "node_modules already present in STAGE."
}

# Syntax check launchers.
try {
  [scriptblock]::Create((Get-Content $StageLauncherPs1 -Raw)) | Out-Null
  Ok "Stage launcher PowerShell syntax check passed."
}
catch {
  Fail "Stage launcher syntax check failed: $($_.Exception.Message)"
}

Write-Host ""
Ok "Promotion complete."
Write-Host "STAGE root:"
Write-Host "  $StageRoot"
Write-Host ""
Write-Host "Backup:"
Write-Host "  $BackupRoot"
Write-Host ""
Write-Host "Start STAGE with:"
Write-Host "  cd $StageRoot"
Write-Host "  .\start-stage-3002.bat"