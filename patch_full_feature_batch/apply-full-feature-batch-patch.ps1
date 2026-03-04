param(
  [Parameter(Mandatory=$true)]
  [string]$RepoRoot
)

$ErrorActionPreference = "Stop"

function Write-Ok($msg) { Write-Host "[OK]   $msg" -ForegroundColor Green }
function Write-Info($msg) { Write-Host "[INFO] $msg" -ForegroundColor Cyan }
function Write-Warn($msg) { Write-Host "[WARN] $msg" -ForegroundColor Yellow }
function Write-Fail($msg) { Write-Host "[FAIL] $msg" -ForegroundColor Red }

if (-not (Test-Path $RepoRoot)) { Write-Fail "RepoRoot not found: $RepoRoot"; exit 1 }

$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$backupDir = Join-Path $RepoRoot ("_patch_backups\full_feature_batch_" + $stamp)
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
Write-Info "Backup dir: $backupDir"

$patchRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

$targets = @(
  @{ Rel="app\app\page.tsx"; Src=Join-Path $patchRoot "app\app\page.tsx" },
  @{ Rel="app\api\enhance-prompt\route.ts"; Src=Join-Path $patchRoot "app\api\enhance-prompt\route.ts" },
  @{ Rel="app\app\workflows\Edit_Pictures.json"; Src=Join-Path $patchRoot "app\app\workflows\Edit_Pictures.json"; New=$true },
  @{ Rel="CHANGELOG.md"; Src=Join-Path $patchRoot "CHANGELOG.md" },
  @{ Rel="tsconfig.json"; Src=Join-Path $patchRoot "tsconfig.json" }
)

foreach ($t in $targets) {
  $dest = Join-Path $RepoRoot $t.Rel
  $destDir = Split-Path -Parent $dest
  if (-not (Test-Path $destDir)) { New-Item -ItemType Directory -Force -Path $destDir | Out-Null }

  if (Test-Path $dest) {
    $bk = Join-Path $backupDir $t.Rel
    $bkDir = Split-Path -Parent $bk
    if (-not (Test-Path $bkDir)) { New-Item -ItemType Directory -Force -Path $bkDir | Out-Null }
    Copy-Item -Force $dest $bk
    Write-Ok "Backed up $($t.Rel)"
  } else {
    if (-not $t.New) { Write-Warn "Target did not exist (will create): $($t.Rel)" }
  }

  Copy-Item -Force $t.Src $dest
  Write-Ok "Patched $($t.Rel)"

  if (-not (Test-Path $dest)) { Write-Fail "Write failed: $($t.Rel)"; exit 1 }
}

# Verification markers
$markers = @(
  @{ Rel="app\app\page.tsx"; Needle="Edit Image" },
  @{ Rel="app\api\enhance-prompt\route.ts"; Needle="STRICT RULES" },
  @{ Rel="app\app\workflows\Edit_Pictures.json"; Needle="Qwen Image Edit" },
  @{ Rel="tsconfig.json"; Needle="_patch_backups" }
)

foreach ($m in $markers) {
  $p = Join-Path $RepoRoot $m.Rel
  $content = Get-Content -Raw -Path $p
  if ($content -notmatch [regex]::Escape($m.Needle)) {
    Write-Fail "Verification failed: '$($m.Needle)' not found in $($m.Rel)"
    exit 1
  }
  Write-Ok "Verified '$($m.Needle)' in $($m.Rel)"
}

# Optional cleanup: patch folders copied into repo can break TS typecheck on some setups.
$cleanupDirs = @(
  Join-Path $RepoRoot "patch_gallery_ui_controls_refresh",
  Join-Path $RepoRoot "patch_gallery_hotfix_001",
  Join-Path $RepoRoot "patch_gallery_hotfix_002_tsconfig_exclude_backups",
  Join-Path $RepoRoot "patch_gallery_hotfix_003_tsconfig_exclude_patch_folders",
  Join-Path $RepoRoot "patch_generate_recent_undo_rename_ltx2_orientation"
)

foreach ($d in $cleanupDirs) {
  if (Test-Path $d) {
    try {
      Remove-Item -Recurse -Force $d
      Write-Ok "Removed patch folder $d"
    } catch {
      Write-Warn "Could not remove patch folder ${d}: $($_.Exception.Message)"
    }
  }
}

Write-Host ""
Write-Ok "Patch applied successfully."
Write-Info "Rollback: copy files back from $backupDir to $RepoRoot (same relative paths)."
