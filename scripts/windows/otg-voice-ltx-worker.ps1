param(
  [string]$Repo = $(if ($env:OTG_REPO) { $env:OTG_REPO } else { "C:\AI\OTG-Test2" }),
  [string]$BaseUrl = $(if ($env:OTG_BASE_URL) { $env:OTG_BASE_URL } else { "http://127.0.0.1:3001" }),
  [string]$DeviceId = $(if ($env:OTG_DEVICE_ID) { $env:OTG_DEVICE_ID } else { "slrochford" }),
  [string]$WorkerId = $(if ($env:OTG_WORKER_ID) { $env:OTG_WORKER_ID } else { "windows-voice-ltx-worker" }),
  [string]$WorkerToken = $(if ($env:OTG_WORKER_TOKEN) { $env:OTG_WORKER_TOKEN } else { "" }),
  [string]$WorkerPython = $(if ($env:OTG_WORKER_PYTHON) { $env:OTG_WORKER_PYTHON } else { "python" }),
  [string]$WorkRoot = $(if ($env:OTG_VOICE_LTX_WORK_ROOT) { $env:OTG_VOICE_LTX_WORK_ROOT } else { "C:\AI\OTG-Test2\data\characters\_worker_voice_ltx" }),
  [string]$WorkflowPath = $(if ($env:OTG_LTX_VOICE_WORKFLOW_PATH) { $env:OTG_LTX_VOICE_WORKFLOW_PATH } else { "C:\AI\OTG-Test2\comfy_workflows\presets\LTX Voice Sample.json" }),
  [string]$ComfyUrl = $(if ($env:OTG_LTX_COMFY_URL) { $env:OTG_LTX_COMFY_URL } elseif ($env:COMFYUI_VIDEO_URL) { $env:COMFYUI_VIDEO_URL } elseif ($env:COMFYUI_URL) { $env:COMFYUI_URL } else { "http://127.0.0.1:8188" }),
  [int]$PollSeconds = $(if ($env:OTG_LTX_POLL_SECONDS) { [int]$env:OTG_LTX_POLL_SECONDS } else { 5 }),
  [switch]$Once
)

$ErrorActionPreference = "Stop"

function Import-OtgEnvFile {
  param([string]$Path)
  if (!(Test-Path -LiteralPath $Path)) { return }

  Get-Content -LiteralPath $Path | ForEach-Object {
    $line = $_.Trim()
    if (!$line -or $line.StartsWith("#")) { return }
    if ($line -notmatch '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$') { return }

    $name = $matches[1]
    $value = $matches[2].Trim()
    if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
      $value = $value.Substring(1, $value.Length - 2)
    }
    if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($name, "Process"))) {
      [Environment]::SetEnvironmentVariable($name, $value, "Process")
    }
  }
}

Import-OtgEnvFile (Join-Path $Repo ".env.local")
Import-OtgEnvFile (Join-Path $Repo ".env")

if ([string]::IsNullOrWhiteSpace($WorkerToken) -and $env:OTG_WORKER_TOKEN) { $WorkerToken = $env:OTG_WORKER_TOKEN }
if ($env:OTG_BASE_URL) { $BaseUrl = $env:OTG_BASE_URL }
if ($env:OTG_DEVICE_ID) { $DeviceId = $env:OTG_DEVICE_ID }
if ($env:OTG_WORKER_ID) { $WorkerId = $env:OTG_WORKER_ID }
if ($env:OTG_WORKER_PYTHON) { $WorkerPython = $env:OTG_WORKER_PYTHON }
if ($env:OTG_VOICE_LTX_WORK_ROOT) { $WorkRoot = $env:OTG_VOICE_LTX_WORK_ROOT }
if ($env:OTG_LTX_VOICE_WORKFLOW_PATH) { $WorkflowPath = $env:OTG_LTX_VOICE_WORKFLOW_PATH }
if ($env:OTG_LTX_COMFY_URL) { $ComfyUrl = $env:OTG_LTX_COMFY_URL }
elseif ($env:COMFYUI_VIDEO_URL) { $ComfyUrl = $env:COMFYUI_VIDEO_URL }
elseif ($env:COMFYUI_URL) { $ComfyUrl = $env:COMFYUI_URL }
if ($env:OTG_LTX_POLL_SECONDS) { $PollSeconds = [int]$env:OTG_LTX_POLL_SECONDS }

if ([string]::IsNullOrWhiteSpace($WorkerToken)) {
  throw "WorkerToken is required for universal all-user claim mode. Pass -WorkerToken or set OTG_WORKER_TOKEN in .env.local."
}

if (!(Test-Path -LiteralPath $Repo)) {
  throw "Repo not found: $Repo"
}

$WorkerScript = Join-Path $Repo "scripts\windows\otg-voice-ltx-worker.py"
if (!(Test-Path -LiteralPath $WorkerScript)) {
  throw "LTX voice worker script not found: $WorkerScript"
}

if (!(Test-Path -LiteralPath $WorkflowPath)) {
  throw "LTX Voice Sample workflow not found: $WorkflowPath"
}

New-Item -ItemType Directory -Force -Path $WorkRoot | Out-Null

$ArgsList = @(
  $WorkerScript,
  "--repo", $Repo,
  "--base-url", $BaseUrl,
  "--device-id", $DeviceId,
  "--worker-id", $WorkerId,
  # Worker token is inherited from OTG_WORKER_TOKEN environment variable. Do not pass it on the command line.
  "--work-root", $WorkRoot,
  "--workflow-path", $WorkflowPath,
  "--comfy-url", $ComfyUrl,
  "--poll-seconds", [string]$PollSeconds
)

if ($Once) {
  $ArgsList += "--once"
}

Write-Host "Starting OTG LTX voice worker"
Write-Host "  Route: character_voice_pipeline / create_voice_sample"
Write-Host "  Provider: ltx"
Write-Host "  BaseUrl: $BaseUrl"
Write-Host "  WorkerId: $WorkerId"
Write-Host "  WorkRoot: $WorkRoot"
Write-Host "  WorkflowPath: $WorkflowPath"
Write-Host "  ComfyUrl: $ComfyUrl"

& $WorkerPython @ArgsList
exit $LASTEXITCODE
