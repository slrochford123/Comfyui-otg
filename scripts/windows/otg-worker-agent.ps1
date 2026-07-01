param(
  [string]$BaseUrl = $(if ($env:OTG_BASE_URL) { $env:OTG_BASE_URL } else { "http://127.0.0.1:3001" }),
  [string]$AgentId = $(if ($env:OTG_WORKER_CONTROL_AGENT_ID) { $env:OTG_WORKER_CONTROL_AGENT_ID } else { "windows-main-agent" }),
  [int]$PollSeconds = $(if ($env:OTG_WORKER_CONTROL_POLL_SECONDS) { [int]$env:OTG_WORKER_CONTROL_POLL_SECONDS } else { 5 }),
  [switch]$DryRun = $true,
  [switch]$Once
)

$ErrorActionPreference = "Stop"

$WorkerToken = $env:OTG_WORKER_TOKEN
if ([string]::IsNullOrWhiteSpace($WorkerToken)) {
  $WorkerToken = $env:OTG_WORKER_CONTROL_TOKEN
}
if ([string]::IsNullOrWhiteSpace($WorkerToken)) {
  throw "Missing OTG_WORKER_TOKEN or OTG_WORKER_CONTROL_TOKEN in environment."
}

$Repo = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path))
$Python = Join-Path $Repo ".venv\Scripts\python.exe"
if (!(Test-Path -LiteralPath $Python)) {
  $Python = "python"
}

$Agent = Join-Path $Repo "scripts\windows\otg-worker-agent.py"
if (!(Test-Path -LiteralPath $Agent)) {
  throw "Missing worker-control agent: $Agent"
}

$env:OTG_WORKER_TOKEN = $WorkerToken

$ArgsList = @(
  $Agent,
  "--base-url", $BaseUrl,
  "--agent-id", $AgentId,
  "--poll-seconds", [string]$PollSeconds
)

if ($DryRun) {
  $ArgsList += "--dry-run"
}
if ($Once) {
  $ArgsList += "--once"
}

Write-Host "Starting OTG worker-control dry-run agent"
Write-Host "  BaseUrl: $BaseUrl"
Write-Host "  AgentId: $AgentId"
Write-Host "  PollSeconds: $PollSeconds"
Write-Host "  DryRun: $DryRun"

& $Python @ArgsList
exit $LASTEXITCODE
