param(
  [switch]$Apply,
  [string]$ArchiveRoot = ".repo-archive"
)

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $repoRoot

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$targetRoot = Join-Path $repoRoot (Join-Path $ArchiveRoot "restored-backup-clutter-$stamp")
$manifestPath = Join-Path $targetRoot "manifest.txt"

$patterns = @(
  "*.bak",
  "*.bak_*",
  "*.bak-*",
  "*.otg-bak",
  "*.final-hotfix-bak",
  "apply-*.ps1",
  "*history*.json",
  "*prompt*.json",
  "*.txt",
  "*.png",
  "*.lnk",
  "run_seedvc*.bat",
  "run_qwen3_tts_ui.bat",
  "start-hunyuan*.bat"
)

function Matches-ClutterPattern([string]$path) {
  $name = Split-Path $path -Leaf
  foreach ($pattern in $patterns) {
    if ($name -like $pattern) { return $true }
  }
  return $false
}

function Assert-InRepo([string]$path) {
  $resolved = (Resolve-Path -LiteralPath $path).Path
  $relative = [System.IO.Path]::GetRelativePath($repoRoot, $resolved)
  if ($relative.StartsWith("..") -or [System.IO.Path]::IsPathRooted($relative)) {
    throw "Refusing to archive path outside repo: $resolved"
  }
  return $resolved
}

$untracked = git ls-files --others --exclude-standard
$candidates = @()
foreach ($item in $untracked) {
  if (-not $item) { continue }
  if ($item -like ".repo-archive/*" -or $item -like ".codex-backups/*") { continue }
  if (Matches-ClutterPattern $item) { $candidates += $item }
}

Write-Host "Archive target: $targetRoot"
Write-Host "Candidates: $($candidates.Count)"

if (-not $Apply) {
  Write-Host ""
  Write-Host "Dry run only. Re-run with -Apply to move these untracked files into the archive."
  $candidates | ForEach-Object { Write-Host "  $_" }
  exit 0
}

New-Item -ItemType Directory -Force -Path $targetRoot | Out-Null
"Archived from $repoRoot at $(Get-Date -Format o)" | Set-Content -LiteralPath $manifestPath -Encoding UTF8

foreach ($item in $candidates) {
  $src = Assert-InRepo $item
  $dest = Join-Path $targetRoot $item
  New-Item -ItemType Directory -Force -Path (Split-Path $dest) | Out-Null
  Move-Item -LiteralPath $src -Destination $dest -Force
  Add-Content -LiteralPath $manifestPath -Value $item -Encoding UTF8
}

Write-Host "Archived $($candidates.Count) untracked clutter file(s)."
Write-Host "Manifest: $manifestPath"
Write-Host ""
Write-Host "Rollback example:"
Write-Host "  Move-Item -LiteralPath `"$targetRoot\*`" -Destination `"$repoRoot`" -Force"
