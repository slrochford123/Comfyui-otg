param(
  [string]$QwenRoot = "C:\AI\Voices\qwen 3",
  [string]$EnvName = "qwen3tts-env",
  [string]$PythonVersion = "3.10",
  [switch]$CpuOnly,
  [switch]$NoBackup
)

$ErrorActionPreference = "Stop"

function Info($m) { Write-Host "[qwen3-repair] $m" -ForegroundColor Cyan }
function Ok($m) { Write-Host "[OK] $m" -ForegroundColor Green }
function Warn($m) { Write-Host "[WARN] $m" -ForegroundColor Yellow }
function Fail($m) { Write-Host "[FAIL] $m" -ForegroundColor Red }

$EnvPath = Join-Path $QwenRoot $EnvName
$VenvPython = Join-Path $EnvPath "Scripts\python.exe"

Info "Qwen root: $QwenRoot"
Info "Target venv: $EnvPath"
New-Item -ItemType Directory -Force -Path $QwenRoot | Out-Null

if (Test-Path -LiteralPath $EnvPath) {
  if ($NoBackup) {
    Warn "Removing existing environment without backup: $EnvPath"
    Remove-Item -LiteralPath $EnvPath -Recurse -Force
  } else {
    $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $BackupPath = "$EnvPath.broken-$stamp"
    Warn "Moving broken environment to: $BackupPath"
    Move-Item -LiteralPath $EnvPath -Destination $BackupPath
  }
}

$UsePyLauncher = $false
if (Get-Command py -ErrorAction SilentlyContinue) {
  Info "Checking py -$PythonVersion..."
  & py "-$PythonVersion" -c "import sys, encodings, zlib; print(sys.executable); print(sys.version); print(zlib.ZLIB_VERSION)"
  if ($LASTEXITCODE -eq 0) {
    $UsePyLauncher = $true
  }
}

if (-not $UsePyLauncher) {
  Info "py -$PythonVersion was not usable. Checking python in PATH..."
  if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
    Fail "No usable Python found. Install Python $PythonVersion from python.org, then rerun this script."
    exit 1
  }

  & python -c "import sys, encodings, zlib; major_minor=f'{sys.version_info.major}.{sys.version_info.minor}'; print(sys.executable); print(sys.version); raise SystemExit(0 if major_minor == '$PythonVersion' else 2)"
  if ($LASTEXITCODE -ne 0) {
    Fail "python in PATH is not Python $PythonVersion. Install Python $PythonVersion or use the py launcher."
    exit 1
  }
}

Info "Creating fresh venv..."
if ($UsePyLauncher) {
  & py "-$PythonVersion" -m venv $EnvPath
} else {
  & python -m venv $EnvPath
}

if (-not (Test-Path -LiteralPath $VenvPython)) {
  Fail "Venv was not created correctly: $VenvPython"
  exit 1
}

Info "Verifying clean Python startup..."
& $VenvPython -c "import sys, encodings, zlib; print('[OK] exe:', sys.executable); print('[OK] prefix:', sys.prefix); print('[OK] zlib:', zlib.ZLIB_VERSION)"
if ($LASTEXITCODE -ne 0) {
  Fail "Fresh venv Python still cannot import encodings/zlib. This indicates a broken base Python install."
  exit 1
}

Info "Upgrading pip tooling..."
& $VenvPython -m pip install --upgrade pip setuptools wheel
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

if ($CpuOnly) {
  Info "Installing CPU PyTorch..."
  & $VenvPython -m pip install --upgrade torch torchaudio
} else {
  Info "Installing CUDA 12.1 PyTorch..."
  & $VenvPython -m pip install --upgrade torch torchaudio --index-url https://download.pytorch.org/whl/cu121
}
if ($LASTEXITCODE -ne 0) {
  Fail "PyTorch install failed."
  exit $LASTEXITCODE
}

Info "Installing Qwen3-TTS and API server dependencies..."
& $VenvPython -m pip install --upgrade qwen-tts fastapi "uvicorn[standard]" python-multipart soundfile "huggingface_hub[cli]" accelerate safetensors
if ($LASTEXITCODE -ne 0) {
  Fail "Qwen/API dependency install failed."
  exit $LASTEXITCODE
}

Info "Final import verification..."
& $VenvPython -c "import sys, zlib, torch, soundfile, fastapi, uvicorn; from qwen_tts import Qwen3TTSModel; print('[OK] Python:', sys.executable); print('[OK] zlib:', zlib.ZLIB_VERSION); print('[OK] torch:', torch.__version__); print('[OK] cuda:', torch.cuda.is_available()); print('[OK] gpu:', torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'CPU only'); print('[OK] Qwen3TTSModel import:', Qwen3TTSModel)"
if ($LASTEXITCODE -ne 0) {
  Fail "Final import verification failed."
  exit $LASTEXITCODE
}

Ok "Qwen3-TTS environment repaired."
Write-Host ""
Write-Host "Next run:"
Write-Host "  C:\AI\OTG-Test2\scripts\voice\run_qwen3_tts_api_clean.bat"
