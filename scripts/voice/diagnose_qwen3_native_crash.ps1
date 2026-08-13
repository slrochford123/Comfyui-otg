param(
  [string]$Venv = "C:\AI\Voices\qwen 3\qwen3tts-env",
  [string]$RepoRoot = "C:\AI\OTG-Test2",
  [string]$CondaRoot = "C:\Users\SLRoc\miniconda3"
)

$VenvPython = Join-Path $Venv "Scripts\python.exe"
$ApiScript = Join-Path $RepoRoot "scripts\voice\qwen3_tts_api.py"
$Site = Join-Path $Venv "Lib\site-packages"
$Cfg = Join-Path $Venv "pyvenv.cfg"

Write-Host "[qwen3-native-diag] Python: $VenvPython"
Write-Host "[qwen3-native-diag] API:    $ApiScript"

$BaseHome = $null
if (Test-Path -LiteralPath $Cfg) {
  $HomeLine = Select-String -LiteralPath $Cfg -Pattern '^\s*home\s*=\s*(.+)$' | Select-Object -First 1
  if ($HomeLine) { $BaseHome = $HomeLine.Matches[0].Groups[1].Value.Trim() }
}

$PathParts = @(
  (Join-Path $Venv "Scripts"),
  $Venv,
  (Join-Path $Venv "DLLs"),
  (Join-Path $Venv "Library\bin"),
  (Join-Path $Site "torch\lib")
)

if ($BaseHome) {
  $PathParts += @(
    $BaseHome,
    (Join-Path $BaseHome "DLLs"),
    (Join-Path $BaseHome "Library\bin")
  )
}

if (Test-Path -LiteralPath $CondaRoot) {
  $PathParts += @(
    $CondaRoot,
    (Join-Path $CondaRoot "DLLs"),
    (Join-Path $CondaRoot "Library\bin"),
    (Join-Path $CondaRoot "Scripts"),
    (Join-Path $CondaRoot "condabin")
  )
}

$ExistingPathParts = $PathParts | Where-Object { $_ -and (Test-Path -LiteralPath $_) }
$env:Path = ($ExistingPathParts -join ';') + ';' + $env:Path
$env:PYTHONPATH = ""
$env:PYTHONFAULTHANDLER = "1"
$env:PYTHONUNBUFFERED = "1"

Write-Host ""
Write-Host "[qwen3-native-diag] Base home from pyvenv.cfg: $BaseHome"
Write-Host "[qwen3-native-diag] Prepended PATH entries:"
$ExistingPathParts | ForEach-Object { Write-Host "  $_" }

function Run-Test {
  param(
    [string]$Name,
    [string]$Code,
    [string]$WorkDir = $RepoRoot
  )

  Write-Host ""
  Write-Host "========== $Name =========="
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $VenvPython
  $psi.WorkingDirectory = $WorkDir
  $psi.UseShellExecute = $false
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.Arguments = "-X faulthandler -c `"$Code`""

  $p = New-Object System.Diagnostics.Process
  $p.StartInfo = $psi
  [void]$p.Start()
  $stdout = $p.StandardOutput.ReadToEnd()
  $stderr = $p.StandardError.ReadToEnd()
  $p.WaitForExit()

  if ($stdout.Trim()) { Write-Host $stdout.TrimEnd() }
  if ($stderr.Trim()) { Write-Host $stderr.TrimEnd() -ForegroundColor Yellow }

  Write-Host "[exit-code] $($p.ExitCode)"
  if ($p.ExitCode -eq -1073741515) {
    Write-Host "[meaning] 0xC0000135 / STATUS_DLL_NOT_FOUND: a native DLL dependency is missing." -ForegroundColor Red
  }
}

Run-Test "zlib" "import sys, zlib; print(sys.executable); print(zlib.ZLIB_VERSION)"
Run-Test "torch" "import torch; print(torch.__version__); print(torch.cuda.is_available()); print(torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'CPU only')"
Run-Test "soundfile" "import soundfile as sf; print(sf.__libsndfile_version__)"
Run-Test "fastapi_uvicorn" "import fastapi, uvicorn; print('fastapi/uvicorn ok')"
Run-Test "qwen_tts_package_only" "import qwen_tts; print(qwen_tts.__file__)"
Run-Test "qwen_tts_model_import_primary" "from qwen_tts import Qwen3TTSModel; print(Qwen3TTSModel)"
Run-Test "qwen_tts_model_import_fallback" "from qwen_tts.inference.qwen3_tts_model import Qwen3TTSModel; print(Qwen3TTSModel)"
Run-Test "api_module_import_no_server" "import runpy; d=runpy.run_path(r'$ApiScript', run_name='not_main'); print('loaded keys:', sorted([k for k in d.keys() if k in ['app','Qwen3TTSModel','CLONE_MODEL','CUSTOM_MODEL']]))"

Write-Host ""
Write-Host "========== recent Windows Application errors mentioning python/DLL =========="
$since = (Get-Date).AddMinutes(-15)
try {
  Get-WinEvent -FilterHashtable @{LogName='Application'; StartTime=$since} -ErrorAction SilentlyContinue |
    Where-Object { $_.Message -match 'python\.exe|python|DLL|dll|0xc0000135|C0000135' } |
    Select-Object -First 12 TimeCreated, ProviderName, Id, Message |
    Format-List
} catch {
  Write-Host "Could not read Application event log: $_"
}

Write-Host ""
Write-Host "[qwen3-native-diag] Done."
