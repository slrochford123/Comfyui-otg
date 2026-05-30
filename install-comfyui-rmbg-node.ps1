param(
  [string]$ComfyRoot = "C:\AI\ComfyUI"
)

$ErrorActionPreference = "Stop"

function Ok($m) { Write-Host "[OK] $m" -ForegroundColor Green }
function Info($m) { Write-Host "[INFO] $m" -ForegroundColor Cyan }
function Fail($m) { Write-Host "[FAIL] $m" -ForegroundColor Red; exit 1 }

if (!(Test-Path $ComfyRoot)) {
  Fail "ComfyUI root not found: $ComfyRoot. Re-run with -ComfyRoot pointing to your actual ComfyUI folder."
}

$CustomNodes = Join-Path $ComfyRoot "custom_nodes"
if (!(Test-Path $CustomNodes)) {
  Fail "Missing custom_nodes folder: $CustomNodes"
}

$Target = Join-Path $CustomNodes "ComfyUI-RMBG"
$Repo = "https://github.com/1038lab/ComfyUI-RMBG.git"

Info "ComfyUI root: $ComfyRoot"
Info "Target node folder: $Target"

if (Test-Path $Target) {
  Info "ComfyUI-RMBG already exists. Updating."
  Push-Location $Target
  git pull
  Pop-Location
} else {
  Info "Cloning ComfyUI-RMBG."
  Push-Location $CustomNodes
  git clone $Repo
  Pop-Location
}

$PortablePython = Join-Path (Split-Path $ComfyRoot -Parent) "python_embeded\python.exe"
$VenvPython = Join-Path $ComfyRoot "venv\Scripts\python.exe"

if (Test-Path $PortablePython) {
  $Python = $PortablePython
} elseif (Test-Path $VenvPython) {
  $Python = $VenvPython
} else {
  $Python = "python"
}

Info "Using Python: $Python"

$Req = Join-Path $Target "requirements.txt"
if (Test-Path $Req) {
  Info "Installing requirements."
  & $Python -m pip install -r $Req
  if ($LASTEXITCODE -ne 0) {
    Fail "pip install failed."
  }
} else {
  Info "No requirements.txt found."
}

Ok "ComfyUI-RMBG installed/updated."
Write-Host ""
Write-Host "Next: restart ComfyUI, then verify AILab_ImageStitch exists."