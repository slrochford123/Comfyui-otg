Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$BackupRoot = Join-Path $RepoRoot ".patch-backups"
$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$BackupDir = Join-Path $BackupRoot "voice-pipeline-worker-tests-$Stamp"

function Write-Info([string]$Message) {
  Write-Host "[INFO] $Message"
}

function Write-Ok([string]$Message) {
  Write-Host "[OK] $Message" -ForegroundColor Green
}

function Fail([string]$Message) {
  Write-Host "[FAIL] $Message" -ForegroundColor Red
  exit 1
}

function Backup-File([string]$RelativePath) {
  $source = Join-Path $RepoRoot $RelativePath
  if (!(Test-Path -LiteralPath $source)) {
    Fail "Cannot back up missing file: $RelativePath"
  }
  $destination = Join-Path $BackupDir $RelativePath
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination) | Out-Null
  Copy-Item -LiteralPath $source -Destination $destination -Force
  Write-Ok "Backed up $RelativePath"
}

function Assert-Contains([string]$RelativePath, [string]$Needle) {
  $path = Join-Path $RepoRoot $RelativePath
  $text = Get-Content -LiteralPath $path -Raw
  if ($text -notlike "*$Needle*") {
    Fail "$RelativePath missing marker: $Needle"
  }
  Write-Ok "$RelativePath contains marker: $Needle"
}

New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
Write-Info "Backup directory: $BackupDir"

Backup-File "lib\jobs\trainingDatasetManifest.ts"
Backup-File "tests\vitest\contracts\voice-pipeline-worker.test.ts"

Assert-Contains "lib\jobs\trainingDatasetManifest.ts" "shouldWriteMockCopyIntermediateManifest"
Assert-Contains "lib\jobs\trainingDatasetManifest.ts" "generationMode !== `"mock_copy`" || process.env.NODE_ENV !== `"test`""
Assert-Contains "lib\jobs\trainingDatasetManifest.ts" "const writeIntermediateManifest = shouldWriteMockCopyIntermediateManifest(generationMode);"
Assert-Contains "tests\vitest\contracts\voice-pipeline-worker.test.ts" "fs.rmSync(path.join(process.cwd(), `"data`", `"characters`", `"owner-a`"), { recursive: true, force: true });"
Assert-Contains "tests\vitest\contracts\voice-pipeline-worker.test.ts" "writes a durable training dataset manifest for approved source jobs"
Assert-Contains "tests\vitest\contracts\voice-pipeline-worker.test.ts" "fails product voice-pack generation clearly when no real provider configuration is available"

Write-Ok "Voice pipeline worker test repair markers verified."
Write-Host ""
Write-Host "Rollback: copy files back from $BackupDir to $RepoRoot, preserving relative paths."
