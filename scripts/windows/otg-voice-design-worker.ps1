param(
  [string]$Repo = $(if ($env:OTG_REPO) { $env:OTG_REPO } else { "C:\AI\OTG-Test2" }),
  [string]$BaseUrl = $(if ($env:OTG_BASE_URL) { $env:OTG_BASE_URL } else { "http://127.0.0.1:3001" }),
  [string]$DeviceId = $(if ($env:OTG_DEVICE_ID) { $env:OTG_DEVICE_ID } else { "slrochford" }),
  [string]$WorkerId = $(if ($env:OTG_WORKER_ID) { $env:OTG_WORKER_ID } else { "windows-voice-design-worker" }),
  [string]$WorkerToken = $(if ($env:OTG_WORKER_TOKEN) { $env:OTG_WORKER_TOKEN } else { "" }),
  [string]$WorkerPython = $(if ($env:OTG_WORKER_PYTHON) { $env:OTG_WORKER_PYTHON } elseif ($env:QWEN_TTS_PYTHON) { $env:QWEN_TTS_PYTHON } elseif ($env:COSYVOICE_PYTHON) { $env:COSYVOICE_PYTHON } else { "python" }),
  [string]$WorkRoot = $(if ($env:OTG_VOICE_DESIGN_WORK_ROOT) { $env:OTG_VOICE_DESIGN_WORK_ROOT } else { "C:\AI\OTG-Worker\voice-design" }),
  [string]$QwenRoot = $(if ($env:QWEN_TTS_ROOT) { $env:QWEN_TTS_ROOT } else { "C:\AI\voices\qwen 3" }),
  [string]$QwenPython = $(if ($env:QWEN_TTS_PYTHON) { $env:QWEN_TTS_PYTHON } else { "C:\Users\SLRoc\miniconda3\envs\qwen3tts-repair\python.exe" }),
  [string]$QwenSitePackages = $(if ($env:QWEN_TTS_SITE_PACKAGES) { $env:QWEN_TTS_SITE_PACKAGES } else { "" }),
  [string]$QwenBridge = $(if ($env:QWEN_TTS_BRIDGE) { $env:QWEN_TTS_BRIDGE } else { "C:\AI\OTG-Test2\scripts\qwen3_voice_design_preview.py" }),
  [string]$QwenApiUrl = $(if ($env:QWEN3_TTS_API_URL) { $env:QWEN3_TTS_API_URL } elseif ($env:QWEN3_TTS_URL) { $env:QWEN3_TTS_URL } else { "http://127.0.0.1:7863/synthesize" }),
  [string]$CosyRoot = $(if ($env:COSYVOICE_ROOT) { $env:COSYVOICE_ROOT } else { "C:\AI\Voices\CosyVoice" }),
  [string]$CosyPython = $(if ($env:COSYVOICE_PYTHON) { $env:COSYVOICE_PYTHON } else { "C:\AI\Voices\CosyVoice\.venv\Scripts\python.exe" }),
  [string]$CosySitePackages = $(if ($env:COSYVOICE_SITE_PACKAGES) { $env:COSYVOICE_SITE_PACKAGES } else { "" }),
  [string]$CosyBridge = $(if ($env:COSYVOICE_BRIDGE) { $env:COSYVOICE_BRIDGE } else { "C:\AI\OTG-Test2\scripts\cosy_voice_sample_bridge.py" }),
  [int]$PollSeconds = $(if ($env:OTG_VOICE_DESIGN_POLL_SECONDS) { [int]$env:OTG_VOICE_DESIGN_POLL_SECONDS } else { 30 }),
  [switch]$Once
)

$ErrorActionPreference = "Stop"

function Import-OtgEnvFile {
  param([string]$Path)
  if (!(Test-Path $Path)) { return }

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
elseif ($env:QWEN_TTS_PYTHON) { $WorkerPython = $env:QWEN_TTS_PYTHON }
elseif ($env:COSYVOICE_PYTHON) { $WorkerPython = $env:COSYVOICE_PYTHON }
if ($env:OTG_VOICE_DESIGN_WORK_ROOT) { $WorkRoot = $env:OTG_VOICE_DESIGN_WORK_ROOT }
if ($env:QWEN_TTS_ROOT) { $QwenRoot = $env:QWEN_TTS_ROOT }
if ($env:QWEN_TTS_PYTHON) { $QwenPython = $env:QWEN_TTS_PYTHON }
if ($env:QWEN_TTS_SITE_PACKAGES) { $QwenSitePackages = $env:QWEN_TTS_SITE_PACKAGES }
if ($env:QWEN_TTS_BRIDGE) { $QwenBridge = $env:QWEN_TTS_BRIDGE }
if ($env:QWEN3_TTS_API_URL) { $QwenApiUrl = $env:QWEN3_TTS_API_URL }
elseif ($env:QWEN3_TTS_URL) { $QwenApiUrl = $env:QWEN3_TTS_URL }
if ($env:COSYVOICE_ROOT) { $CosyRoot = $env:COSYVOICE_ROOT }
if ($env:COSYVOICE_PYTHON) { $CosyPython = $env:COSYVOICE_PYTHON }
if ($env:COSYVOICE_SITE_PACKAGES) { $CosySitePackages = $env:COSYVOICE_SITE_PACKAGES }
if ($env:COSYVOICE_BRIDGE) { $CosyBridge = $env:COSYVOICE_BRIDGE }
if ($env:OTG_VOICE_DESIGN_POLL_SECONDS) { $PollSeconds = [int]$env:OTG_VOICE_DESIGN_POLL_SECONDS }

if ([string]::IsNullOrWhiteSpace($WorkerToken)) {
  throw "WorkerToken is required for universal all-user claim mode. Pass -WorkerToken or set OTG_WORKER_TOKEN."
}
[Environment]::SetEnvironmentVariable("OTG_WORKER_TOKEN", $WorkerToken, "Process")

if (!(Test-Path $Repo)) {
  throw "Repo not found: $Repo"
}

$WorkerPy = Join-Path $Repo "scripts\windows\otg-voice-design-worker.py"
if (!(Test-Path $WorkerPy)) {
  throw "Dedicated voice design worker script not found: $WorkerPy"
}

New-Item -ItemType Directory -Force -Path $WorkRoot | Out-Null

$ArgsList = @(
  $WorkerPy,
  "--base-url", $BaseUrl,
  "--device-id", $DeviceId,
  "--worker-id", $WorkerId,
  "--work-root", $WorkRoot,
  "--qwen-root", $QwenRoot,
  "--qwen-python", $QwenPython,
  "--qwen-bridge", $QwenBridge,
  "--qwen-api-url", $QwenApiUrl,
  "--cosy-root", $CosyRoot,
  "--cosy-python", $CosyPython,
  "--cosy-bridge", $CosyBridge,
  "--poll-seconds", [string]$PollSeconds
)

if (![string]::IsNullOrWhiteSpace($QwenSitePackages)) {
  $ArgsList += @("--qwen-site-packages", $QwenSitePackages)
}

if (![string]::IsNullOrWhiteSpace($CosySitePackages)) {
  $ArgsList += @("--cosy-site-packages", $CosySitePackages)
}

if ($Once) {
  $ArgsList += "--once"
}

Write-Host "Starting dedicated OTG voice design worker"
Write-Host "  Route: character_voice_pipeline / create_voice_sample only"
Write-Host "  BaseUrl: $BaseUrl"
Write-Host "  Claim: all owners via worker token"
Write-Host "  DeviceId: $DeviceId"
Write-Host "  WorkerId: $WorkerId"
Write-Host "  WorkRoot: $WorkRoot"
Write-Host "  Qwen3ApiUrl: $QwenApiUrl"

& $WorkerPython @ArgsList
exit $LASTEXITCODE
