$ErrorActionPreference = "Stop"

$ServiceRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$VenvDir = Join-Path $ServiceRoot ".venv"
$Requirements = Join-Path $ServiceRoot "requirements.txt"

function Resolve-Python {
  if ($env:PYANNOTE_PYTHON -and (Test-Path $env:PYANNOTE_PYTHON)) {
    return @{ Exe = $env:PYANNOTE_PYTHON; Args = @() }
  }

  $candidates = @(
    @{ Exe = "py"; Args = @("-3.11") },
    @{ Exe = "py"; Args = @("-3.10") },
    @{ Exe = "python"; Args = @() }
  )

  foreach ($candidate in $candidates) {
    try {
      $version = & $candidate.Exe @($candidate.Args + @("-c", "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")) 2>$null
      if ($LASTEXITCODE -eq 0 -and $version -match "^(3\.10|3\.11|3\.12)$") {
        return $candidate
      }
    } catch {
    }
  }

  throw "Could not find Python 3.10, 3.11, or 3.12. Set PYANNOTE_PYTHON to a compatible python.exe."
}

$PythonCommand = Resolve-Python
Write-Host "[speaker-diarization] Service root: $ServiceRoot"
Write-Host "[speaker-diarization] Creating venv: $VenvDir"
& $PythonCommand.Exe @($PythonCommand.Args + @("-m", "venv", $VenvDir))

$VenvPython = Join-Path $VenvDir "Scripts\python.exe"
if (!(Test-Path $VenvPython)) {
  throw "Venv python was not created: $VenvPython"
}

& $VenvPython -m pip install --upgrade pip wheel setuptools
& $VenvPython -m pip install -r $Requirements

# The worker is pinned to pyannote.audio 3.x because pyannote 4.x routes through
# TorchCodec on Windows even when we pass a preloaded waveform.
& $VenvPython -m pip uninstall -y torchcodec

Write-Host ""
Write-Host "[speaker-diarization] Install complete."
Write-Host "[speaker-diarization] Set PYANNOTE_AUTH_TOKEN or HF_TOKEN before starting the worker."
Write-Host "[speaker-diarization] Start with: .\run_speaker_diarization.bat"
