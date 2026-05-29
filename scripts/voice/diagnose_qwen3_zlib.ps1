$Venv = "C:\AI\Voices\qwen 3\qwen3tts-env"
$Python = Join-Path $Venv "Scripts\python.exe"
$Cfg = Join-Path $Venv "pyvenv.cfg"

Write-Host "[qwen3-diag] Venv: $Venv"
Write-Host "[qwen3-diag] Python: $Python"

if (!(Test-Path $Cfg)) {
  Write-Host "[FAIL] Missing pyvenv.cfg: $Cfg" -ForegroundColor Red
  exit 1
}

Write-Host ""
Write-Host "[qwen3-diag] pyvenv.cfg:"
Get-Content $Cfg

$homeLine = Select-String -LiteralPath $Cfg -Pattern '^\s*home\s*=\s*(.+)$' | Select-Object -First 1
$home = $null
if ($homeLine) {
  $home = $homeLine.Matches[0].Groups[1].Value.Trim()
}

Write-Host ""
Write-Host "[qwen3-diag] Base home: $home"

if ($home) {
  Write-Host "[qwen3-diag] Base python exists: $(Test-Path (Join-Path $home 'python.exe'))"
  Write-Host "[qwen3-diag] zlib candidates under base home:"
  Get-ChildItem -LiteralPath $home -Filter "zlib*.dll" -Recurse -ErrorAction SilentlyContinue | Select-Object FullName
}

Write-Host ""
Write-Host "[qwen3-diag] zlib candidates under venv:"
Get-ChildItem -LiteralPath $Venv -Filter "zlib*.dll" -Recurse -ErrorAction SilentlyContinue | Select-Object FullName

Write-Host ""
Write-Host "[qwen3-diag] py launcher Pythons:"
if (Get-Command py -ErrorAction SilentlyContinue) {
  py -0p
} else {
  Write-Host "py launcher not found"
}

Write-Host ""
Write-Host "[qwen3-diag] Trying Python startup:"
& $Python -c "import sys, zlib; print(sys.executable); print(zlib.ZLIB_VERSION)"
