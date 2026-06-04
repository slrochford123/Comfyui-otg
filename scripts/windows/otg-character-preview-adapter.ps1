param(
  [string]$Repo = $(if ($env:OTG_REPO) { $env:OTG_REPO } else { "C:\AI\OTG-Test2" }),
  [string]$Python = $(if ($env:OTG_WORKER_PYTHON) { $env:OTG_WORKER_PYTHON } elseif ($env:APPLIO_PYTHON) { $env:APPLIO_PYTHON } else { "python" })
)

$ErrorActionPreference = "Stop"

if (!(Test-Path $Repo)) {
  throw "Repo not found: $Repo"
}

$AdapterPy = Join-Path $Repo "scripts\windows\otg-character-preview-adapter.py"
if (!(Test-Path $AdapterPy)) {
  throw "Character Preview Dub adapter script not found: $AdapterPy"
}

if ([string]::IsNullOrWhiteSpace($env:OTG_CHARACTER_PREVIEW_JOB_JSON)) {
  throw "OTG_CHARACTER_PREVIEW_JOB_JSON is required."
}
if ([string]::IsNullOrWhiteSpace($env:OTG_CHARACTER_PREVIEW_RESULT_JSON)) {
  throw "OTG_CHARACTER_PREVIEW_RESULT_JSON is required."
}

& $Python $AdapterPy
exit $LASTEXITCODE
