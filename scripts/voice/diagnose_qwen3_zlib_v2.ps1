$Venv = "C:\AI\Voices\qwen 3\qwen3tts-env"
$VenvPython = Join-Path $Venv "Scripts\python.exe"
$Cfg = Join-Path $Venv "pyvenv.cfg"

Write-Host "[qwen3-diag-v2] Venv: $Venv"
Write-Host "[qwen3-diag-v2] Python: $VenvPython"

if (!(Test-Path -LiteralPath $Cfg)) {
  Write-Host "[FAIL] Missing pyvenv.cfg: $Cfg" -ForegroundColor Red
  exit 1
}

Write-Host ""
Write-Host "[qwen3-diag-v2] pyvenv.cfg:"
Get-Content -LiteralPath $Cfg

$BaseHome = $null
$HomeLine = Select-String -LiteralPath $Cfg -Pattern '^\s*home\s*=\s*(.+)$' | Select-Object -First 1
if ($HomeLine) {
  $BaseHome = $HomeLine.Matches[0].Groups[1].Value.Trim()
}

Write-Host ""
Write-Host "[qwen3-diag-v2] Base home from pyvenv.cfg: $BaseHome"

if ($BaseHome) {
  $BasePython = Join-Path $BaseHome "python.exe"
  Write-Host "[qwen3-diag-v2] Base python exists: $(Test-Path -LiteralPath $BasePython)"
  Write-Host "[qwen3-diag-v2] zlib candidates under base home:"
  Get-ChildItem -LiteralPath $BaseHome -Filter "zlib*.dll" -Recurse -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName
}

Write-Host ""
Write-Host "[qwen3-diag-v2] zlib candidates under venv:"
Get-ChildItem -LiteralPath $Venv -Filter "zlib*.dll" -Recurse -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName

Write-Host ""
Write-Host "[qwen3-diag-v2] py launcher Pythons:"
if (Get-Command py -ErrorAction SilentlyContinue) {
  py -0p
} else {
  Write-Host "py launcher not found"
}

Write-Host ""
Write-Host "[qwen3-diag-v2] Process PATH zlib candidates:"
$env:Path -split ';' | ForEach-Object {
  if ($_ -and (Test-Path -LiteralPath $_)) {
    Get-ChildItem -LiteralPath $_ -Filter "zlib*.dll" -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName
  }
}

Write-Host ""
Write-Host "[qwen3-diag-v2] Trying Python startup and critical imports:"
& $VenvPython -X faulthandler -c "import sys, zlib; print('[OK] exe:', sys.executable); print('[OK] zlib:', zlib.ZLIB_VERSION); import torch; print('[OK] torch:', torch.__version__); print('[OK] cuda:', torch.cuda.is_available()); import soundfile, fastapi, uvicorn; print('[OK] soundfile/fastapi/uvicorn'); import qwen_tts; print('[OK] qwen_tts')"
$Code = $LASTEXITCODE

Write-Host ""
Write-Host "[qwen3-diag-v2] Exit code: $Code"
exit $Code
