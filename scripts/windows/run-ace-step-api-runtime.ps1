$ErrorActionPreference = "Stop"

$AceRoot = "C:\AI\ACE-Step-1.5"
$HostName = "127.0.0.1"
$Port = "8001"

if (!(Test-Path -LiteralPath $AceRoot)) {
  throw "ACE-Step root not found: $AceRoot"
}

Set-Location -LiteralPath $AceRoot

$ApiServer = Join-Path $AceRoot "acestep\api_server.py"
if (!(Test-Path -LiteralPath $ApiServer)) {
  throw "ACE-Step api_server.py not found: $ApiServer"
}

$VenvPython = Join-Path $AceRoot ".venv\Scripts\python.exe"
if (!(Test-Path -LiteralPath $VenvPython)) {
  throw "ACE-Step .venv Python not found. Run ACE-Step setup manually first; WorkerManager runtime launcher does not install dependencies."
}

$UvCandidates = @(
  (Join-Path $env:USERPROFILE ".local\bin\uv.exe"),
  (Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Links\uv.exe")
)

$UvExe = $null
foreach ($Candidate in $UvCandidates) {
  if ($Candidate -and (Test-Path -LiteralPath $Candidate)) {
    $UvExe = $Candidate
    break
  }
}

if (-not $UvExe) {
  $ResolvedUv = Get-Command uv.exe -ErrorAction SilentlyContinue
  if ($ResolvedUv) { $UvExe = $ResolvedUv.Source }
}

if (-not $UvExe) {
  throw "uv.exe not found. Install/setup ACE-Step manually first; WorkerManager runtime launcher does not install uv."
}

$env:ACESTEP_API_HOST = $HostName
$env:ACESTEP_API_PORT = $Port
$env:CHECK_UPDATE = "false"
$env:PYTHONUNBUFFERED = "1"

Write-Host "Starting OTG ACE-Step runtime API server"
Write-Host "  Host: $HostName"
Write-Host "  Port: $Port"
Write-Host "  Mode: API runtime only"
Write-Host "  Install/update/sync: skipped"

& $UvExe run --no-sync --offline acestep-api --host $HostName --port $Port
exit $LASTEXITCODE
