$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

$env:OTG_ENV = "stage"
$env:OTG_STAGE = "1"
$env:PORT = "3002"
$env:NEXT_PUBLIC_OTG_APP_ENV = "stage"
$env:NEXT_PUBLIC_OTG_PORT = "3002"
$env:PYTHONUTF8 = "1"
$env:PYTHONIOENCODING = "utf-8"
$env:OTG_REQUIRE_REAL_VOICE = "1"
$env:OTG_VOICE_DESIGN_ONLY = "1"

Write-Host "[INFO] Starting OTG STAGE on port 3002 from $Root" -ForegroundColor Cyan

$Existing = @(Get-NetTCPConnection -State Listen -LocalPort 3002 -ErrorAction SilentlyContinue)
if ($Existing.Count -gt 0) {
  Write-Host "[FAIL] Port 3002 is already in use." -ForegroundColor Red
  $Existing | Format-Table -AutoSize
  exit 1
}

$NpmCmd = "C:\AI\nodejs\npm.cmd"
if (!(Test-Path $NpmCmd)) {
  $Resolved = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if ($Resolved) {
    $NpmCmd = $Resolved.Source
  }
  else {
    $Resolved = Get-Command npm -ErrorAction SilentlyContinue
    if ($Resolved) {
      $NpmCmd = $Resolved.Source
    }
    else {
      Write-Host "[FAIL] npm not found." -ForegroundColor Red
      exit 1
    }
  }
}

& $NpmCmd run dev -- -p 3002