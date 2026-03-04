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

# Backup OUTSIDE repo to avoid TS typecheck scanning backups
$parent = Split-Path -Parent $RepoRoot
$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$backupDir = Join-Path $parent ("_otg_patch_backups\gallery_hotfix_004_dupe_import_" + $ts)
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
$backupPath = Join-Path $backupDir "page.tsx"
Copy-Item -LiteralPath $path -Destination $backupPath -Force
Info "Backup: $backupPath"

$raw = Get-Content -LiteralPath $path -Raw

$importLine = 'import EditPicturesGraph from "./workflows/Edit_Pictures.json";'

# Count occurrences
$matches = [regex]::Matches($raw, [regex]::Escape($importLine))
if ($matches.Count -lt 2) {
  Warn "Expected duplicate import not found (found $($matches.Count)). No changes applied."
  Ok "Done."
  exit 0
}

# Remove ONLY the second occurrence (keep first)
$idx2 = $matches[1].Index
$len = $matches[1].Length

# Also remove an optional trailing newline after the second import
$end = $idx2 + $len
if ($end -lt $raw.Length -and ($raw.Substring($end,1) -eq "`n")) {
  $len = $len + 1
  if ($idx2 + $len -le $raw.Length -and $raw.Substring($idx2 + $len - 2,2) -eq "`r`n") {
    # already handled via `n, no-op
    $null = $true
  }
}

$new = $raw.Remove($idx2, $len)

# Write UTF-8 no BOM
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($path, $new, $utf8NoBom)

# Verify
$verify = Get-Content -LiteralPath $path -Raw
$after = [regex]::Matches($verify, [regex]::Escape($importLine)).Count
if ($after -ne 1) { Fail "Expected 1 import after fix; found $after"; Info "Restore from $backupPath"; exit 1 }

Ok "Removed duplicate EditPicturesGraph import."
Info "Rollback: copy $backupPath back to $path"
