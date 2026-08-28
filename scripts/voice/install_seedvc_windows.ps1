param(
  [string]$SeedVcRoot = "C:\AI\Voices\Seed-Vc",
  [string]$PythonVersion = "3.10",
  [switch]$CpuOnly
)

$ErrorActionPreference = "Stop"

function Write-Info($m) { Write-Host "[seedvc-install] $m" -ForegroundColor Cyan }
function Write-Ok($m) { Write-Host "[OK] $m" -ForegroundColor Green }
function Write-Fail($m) { Write-Host "[FAIL] $m" -ForegroundColor Red }

Write-Info "Installing Seed-VC into $SeedVcRoot"
New-Item -ItemType Directory -Force -Path (Split-Path $SeedVcRoot -Parent) | Out-Null

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Write-Fail "git is not available in PATH. Install Git for Windows first."
  exit 1
}

if (-not (Test-Path $SeedVcRoot) -or -not (Get-ChildItem -LiteralPath $SeedVcRoot -Force -ErrorAction SilentlyContinue | Select-Object -First 1)) {
  if (Test-Path $SeedVcRoot) { Remove-Item -LiteralPath $SeedVcRoot -Recurse -Force }
  Write-Info "Cloning Seed-VC..."
  git clone https://github.com/Plachtaa/seed-vc.git $SeedVcRoot
} else {
  Write-Info "Seed-VC folder is not empty; leaving existing files in place."
}

Set-Location $SeedVcRoot

$venvPython = Join-Path $SeedVcRoot ".venv\Scripts\python.exe"
if (-not (Test-Path $venvPython)) {
  Write-Info "Creating Python venv..."
  $pyLauncher = Get-Command py -ErrorAction SilentlyContinue
  if ($pyLauncher) {
    py -$PythonVersion -m venv .venv
  } else {
    python -m venv .venv
  }
}

Write-Info "Upgrading pip tooling..."
& $venvPython -m pip install --upgrade pip setuptools wheel

if ($CpuOnly) {
  Write-Info "Installing PyTorch CPU build..."
  & $venvPython -m pip install torch torchvision torchaudio
} else {
  Write-Info "Installing PyTorch CUDA 12.1 build..."
  & $venvPython -m pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121
}

if (Test-Path (Join-Path $SeedVcRoot "requirements.txt")) {
  Write-Info "Installing Seed-VC requirements..."
  & $venvPython -m pip install -r requirements.txt
} else {
  Write-Fail "requirements.txt not found in $SeedVcRoot"
  exit 1
}

$inference = Join-Path $SeedVcRoot "inference.py"
if (-not (Test-Path $inference)) {
  Write-Fail "inference.py not found after install. Check clone result."
  exit 1
}

Write-Ok "Seed-VC install completed."
Write-Host ""
Write-Host "Update .env.local if needed:" -ForegroundColor Yellow
Write-Host "SEED_VC_ROOT=C:/AI/Voices/Seed-Vc"
Write-Host "SEED_VC_PYTHON=C:/AI/Voices/Seed-Vc/.venv/Scripts/python.exe"
Write-Host "SEED_VC_SCRIPT=C:/AI/Voices/Seed-Vc/inference.py"
Write-Host ""
Write-Host "Restart npm run dev after installing Seed-VC."