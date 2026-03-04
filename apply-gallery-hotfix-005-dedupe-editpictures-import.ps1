param(
  [Parameter(Mandatory=$false)]
  [string]$RepoRoot = (Get-Location).Path
)

$ErrorActionPreference = 'Stop'

function Info($m){Write-Host "[INFO] $m" -ForegroundColor Cyan}
function Ok($m){Write-Host "[OK]   $m" -ForegroundColor Green}
function Warn($m){Write-Host "[WARN] $m" -ForegroundColor Yellow}
function Fail($m){Write-Host "[FAIL] $m" -ForegroundColor Red}

$rel = "app\app\page.tsx"
$path = Join-Path $RepoRoot $rel
if (-not (Test-Path -LiteralPath $path)) { Fail "Missing: $path"; exit 1 }

# Backup OUTSIDE repo
$parent = Split-Path -Parent $RepoRoot
$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$backupDir = Join-Path $parent ("_otg_patch_backups\gallery_hotfix_005_dedupe_import_" + $ts)
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
$backupPath = Join-Path $backupDir "page.tsx"
Copy-Item -LiteralPath $path -Destination $backupPath -Force
Info "Backup: $backupPath"

$raw = Get-Content -LiteralPath $path -Raw

# Match import regardless of quotes/spacing
$pattern = 'import\s+EditPicturesGraph\s+from\s+["' + "'" + ']\./workflows/Edit_Pictures\.json["' + "'" + '];\s*'

$matches = [regex]::Matches($raw, $pattern)
if ($matches.Count -le 1) {
  Warn "Found $($matches.Count) EditPicturesGraph import(s); nothing to dedupe."
  Ok "Done."
  exit 0
}

# Keep the first occurrence, remove the rest
# Approach: remove from end to start (excluding first) to preserve indices
for ($i = $matches.Count - 1; $i -ge 1; $i--) {
  $m = $matches[$i]
  $raw = $raw.Remove($m.Index, $m.Length)
}

# Write UTF-8 no BOM
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($path, $raw, $utf8NoBom)

# Verify
$verify = Get-Content -LiteralPath $path -Raw
$after = [regex]::Matches($verify, $pattern).Count
if ($after -ne 1) {
  Fail "Expected 1 import after fix; found $after"
  Info "Rollback: copy $backupPath back to $path"
  exit 1
}

Ok "Deduped EditPicturesGraph import(s): $($matches.Count) -> 1"
Info "Rollback: copy $backupPath back to $path"
