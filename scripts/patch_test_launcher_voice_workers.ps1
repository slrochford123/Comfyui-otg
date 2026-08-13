param(
  [string]$RepoRoot = "C:\AI\OTG-Test2"
)

$ErrorActionPreference = "Stop"

function Write-Ok([string]$Message) { Write-Host "[OK] $Message" -ForegroundColor Green }
function Write-WarnLine([string]$Message) { Write-Host "[WARN] $Message" -ForegroundColor Yellow }
function Write-Fail([string]$Message) { Write-Host "[FAIL] $Message" -ForegroundColor Red }

function Normalize-Crlf([string]$Text) {
  return ($Text -replace "`r?`n", "`r`n")
}

function Insert-After([string]$Text, [string]$Needle, [string]$Insert, [string]$Marker) {
  $Insert = Normalize-Crlf $Insert
  if ($Text.Contains($Marker)) {
    return $Text
  }
  if (-not $Text.Contains($Needle)) {
    throw "Insertion anchor not found: $Needle"
  }
  return $Text.Replace($Needle, "$Needle`r`n$Insert")
}

function Insert-Before([string]$Text, [string]$Needle, [string]$Insert, [string]$Marker) {
  $Insert = Normalize-Crlf $Insert
  if ($Text.Contains($Marker)) {
    return $Text
  }
  if (-not $Text.Contains($Needle)) {
    throw "Insertion anchor not found: $Needle"
  }
  return $Text.Replace($Needle, "$Insert`r`n$Needle")
}

function Require-Marker([string]$Text, [string]$Marker, [string]$Label) {
  if (-not $Text.Contains($Marker)) {
    throw "Missing marker: $Label"
  }
}

try {
  $repo = (Resolve-Path -LiteralPath $RepoRoot).Path
  $launcherPath = Join-Path $repo "start-otg-test-services-v2.bat"
  $checklistPath = Join-Path $repo "docs\OTG_REWORK_CHECKLIST.md"

  if (-not (Test-Path -LiteralPath $launcherPath)) { throw "Launcher not found: $launcherPath" }
  if (-not (Test-Path -LiteralPath $checklistPath)) { throw "Checklist not found: $checklistPath" }

  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $backupDir = Join-Path $repo ".patch-backups\test-launcher-voice-workers-$stamp"
  New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
  Copy-Item -LiteralPath $launcherPath -Destination (Join-Path $backupDir "start-otg-test-services-v2.bat") -Force
  Copy-Item -LiteralPath $checklistPath -Destination (Join-Path $backupDir "OTG_REWORK_CHECKLIST.md") -Force
  Write-Ok "Backed up files to $backupDir"

  $launcher = Get-Content -LiteralPath $launcherPath -Raw
  $launcher = Normalize-Crlf $launcher

  $launcher = Insert-After $launcher 'set "START_VOICE_APPLIO_WORKER=1"' @'
set "START_VOICE_DESIGN_WORKER=1"
set "START_VOICE_LTX_WORKER=1"
'@ 'set "START_VOICE_DESIGN_WORKER=1"'

  $launcher = Insert-After $launcher 'set "VOICE_APPLIO_WORKER_PS1=%REPO_ROOT%\scripts\windows\otg-voice-applio-worker.ps1"' @'
set "VOICE_DESIGN_WORKER_PS1=%REPO_ROOT%\scripts\windows\otg-voice-design-worker.ps1"
set "VOICE_LTX_WORKER_PS1=%REPO_ROOT%\scripts\windows\otg-voice-ltx-worker.ps1"
'@ 'set "VOICE_DESIGN_WORKER_PS1=%REPO_ROOT%\scripts\windows\otg-voice-design-worker.ps1"'

  $launcher = Insert-After $launcher 'if "%START_VOICE_APPLIO_WORKER%"=="1" call :StartVoiceApplioWorker' @'
if "%START_VOICE_DESIGN_WORKER%"=="1" call :StartVoiceDesignWorker
if "%START_VOICE_LTX_WORKER%"=="1" call :StartVoiceLtxWorker
'@ 'if "%START_VOICE_DESIGN_WORKER%"=="1" call :StartVoiceDesignWorker'

  $voiceDesignFunctions = @'
:StartVoiceDesignWorker
if not exist "%VOICE_DESIGN_WORKER_PS1%" (
  echo [WARN] OTG Voice Design Worker PS1 not found:
  echo        %VOICE_DESIGN_WORKER_PS1%
  exit /b 0
)
tasklist /v /fi "imagename eq cmd.exe" | findstr /i /c:"OTG Voice Design Worker" >nul 2>nul
if not errorlevel 1 (
  echo [SKIP] OTG Voice Design Worker already appears to be running.
  exit /b 0
)
echo [START] OTG Voice Design Worker
echo         %VOICE_DESIGN_WORKER_PS1%
start "OTG Voice Design Worker" cmd /k "cd /d ""%REPO_ROOT%"" && powershell -NoProfile -ExecutionPolicy Bypass -File ""%VOICE_DESIGN_WORKER_PS1%"" -BaseUrl http://127.0.0.1:3001 -WorkerId windows-voice-design-worker"
timeout /t 2 /nobreak >nul
exit /b 0

:StartVoiceLtxWorker
if not exist "%VOICE_LTX_WORKER_PS1%" (
  echo [WARN] OTG Voice LTX Worker PS1 not found:
  echo        %VOICE_LTX_WORKER_PS1%
  exit /b 0
)
tasklist /v /fi "imagename eq cmd.exe" | findstr /i /c:"OTG Voice LTX Worker" >nul 2>nul
if not errorlevel 1 (
  echo [SKIP] OTG Voice LTX Worker already appears to be running.
  exit /b 0
)
echo [START] OTG Voice LTX Worker
echo         %VOICE_LTX_WORKER_PS1%
start "OTG Voice LTX Worker" cmd /k "cd /d ""%REPO_ROOT%"" && powershell -NoProfile -ExecutionPolicy Bypass -File ""%VOICE_LTX_WORKER_PS1%"" -BaseUrl http://127.0.0.1:3001 -WorkerId windows-voice-ltx-worker"
timeout /t 2 /nobreak >nul
exit /b 0

'@
  $launcher = Insert-Before $launcher "`r`n:StartCharacterPreviewWorker" $voiceDesignFunctions "`r`n:StartVoiceDesignWorker`r`n"

  $launcher = Insert-After $launcher 'echo   Voice Applio Worker:  background PowerShell worker, no HTTP endpoint' @'
echo   Voice Design Worker:  background PowerShell worker, no HTTP endpoint
echo   Voice LTX Worker:     background PowerShell worker, no HTTP endpoint
'@ 'echo   Voice Design Worker:  background PowerShell worker, no HTTP endpoint'

  $launcher = $launcher.Replace(
    'echo   CosyVoice may be worker-backed.',
    'echo   CosyVoice service may be worker-backed, but create_voice_sample jobs for Qwen3/Cosy are handled by Voice Design Worker.'
  )
  $launcher = Insert-After $launcher 'echo   CosyVoice service may be worker-backed, but create_voice_sample jobs for Qwen3/Cosy are handled by Voice Design Worker.' @'
echo   LTX Voice uses ComfyUI through the Voice LTX Worker and returns audio only.
'@ 'echo   LTX Voice uses ComfyUI through the Voice LTX Worker and returns audio only.'

  [System.IO.File]::WriteAllText($launcherPath, $launcher, [System.Text.Encoding]::ASCII)

  $checklist = Get-Content -LiteralPath $checklistPath -Raw
  $checklist = Normalize-Crlf $checklist
  $checklistLine = '- [x] TEST launcher now starts the Voice Design Worker for Qwen3/Cosy `create_voice_sample` jobs and the Voice LTX Worker for `provider: ltx` jobs after Next TEST starts.'
  if (-not $checklist.Contains($checklistLine)) {
    $anchor = '- [x] LTX Voice Design Patch 2 TEST only: `provider: ltx` create-voice jobs now queue with dialect/prompt metadata, the dedicated Windows LTX worker patches `LTX Voice Sample.json`, submits to ComfyUI, copies node 384 MP3 audio only, and completes with `mock:false` / `ltx_audio_voice_sample`.'
    if (-not $checklist.Contains($anchor)) { throw "Checklist anchor not found for LTX Patch 2" }
    $checklist = $checklist.Replace($anchor, "$anchor`r`n$checklistLine")
  }
  [System.IO.File]::WriteAllText($checklistPath, $checklist, [System.Text.UTF8Encoding]::new($true))

  $launcherVerify = Get-Content -LiteralPath $launcherPath -Raw
  Require-Marker $launcherVerify 'set "START_VOICE_DESIGN_WORKER=1"' "START_VOICE_DESIGN_WORKER flag"
  Require-Marker $launcherVerify 'set "START_VOICE_LTX_WORKER=1"' "START_VOICE_LTX_WORKER flag"
  Require-Marker $launcherVerify 'set "VOICE_DESIGN_WORKER_PS1=%REPO_ROOT%\scripts\windows\otg-voice-design-worker.ps1"' "Voice Design PS1 path"
  Require-Marker $launcherVerify 'set "VOICE_LTX_WORKER_PS1=%REPO_ROOT%\scripts\windows\otg-voice-ltx-worker.ps1"' "Voice LTX PS1 path"
  Require-Marker $launcherVerify 'if "%START_VOICE_DESIGN_WORKER%"=="1" call :StartVoiceDesignWorker' "Voice Design startup call"
  Require-Marker $launcherVerify 'if "%START_VOICE_LTX_WORKER%"=="1" call :StartVoiceLtxWorker' "Voice LTX startup call"
  Require-Marker $launcherVerify ':StartVoiceDesignWorker' "Voice Design function"
  Require-Marker $launcherVerify ':StartVoiceLtxWorker' "Voice LTX function"
  Require-Marker $launcherVerify 'start "OTG Voice Design Worker" cmd /k "cd /d ""%REPO_ROOT%"" && powershell -NoProfile -ExecutionPolicy Bypass -File ""%VOICE_DESIGN_WORKER_PS1%"" -BaseUrl http://127.0.0.1:3001 -WorkerId windows-voice-design-worker"' "Voice Design start command"
  Require-Marker $launcherVerify 'start "OTG Voice LTX Worker" cmd /k "cd /d ""%REPO_ROOT%"" && powershell -NoProfile -ExecutionPolicy Bypass -File ""%VOICE_LTX_WORKER_PS1%"" -BaseUrl http://127.0.0.1:3001 -WorkerId windows-voice-ltx-worker"' "Voice LTX start command"
  Require-Marker $launcherVerify 'Voice Design Worker:  background PowerShell worker, no HTTP endpoint' "Voice Design endpoint note"
  Require-Marker $launcherVerify 'Voice LTX Worker:     background PowerShell worker, no HTTP endpoint' "Voice LTX endpoint note"
  Require-Marker $launcherVerify 'CosyVoice service may be worker-backed, but create_voice_sample jobs for Qwen3/Cosy are handled by Voice Design Worker.' "CosyVoice note"
  Require-Marker $launcherVerify 'LTX Voice uses ComfyUI through the Voice LTX Worker and returns audio only.' "LTX note"

  $checklistVerify = Get-Content -LiteralPath $checklistPath -Raw
  Require-Marker $checklistVerify $checklistLine "checklist launcher item"

  Write-Ok "TEST launcher voice worker markers verified"
  Write-Host "Run manual verification next:"
  Write-Host "  .\start-otg-test-services-v2.bat"
}
catch {
  Write-Fail $_.Exception.Message
  exit 1
}
