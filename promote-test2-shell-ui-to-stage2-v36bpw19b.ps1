# promote-test2-shell-ui-to-stage2-v36bpw19b.ps1
# STAGE2 ONLY. Narrow retry after v36bpw19 failed.
# Copies only shell/navigation/theme UI files from OTG-Test2 into OTG-Stage2.
# It intentionally does NOT copy CharactersPanel or production route files because v36bpw19 showed those drag missing voice/control-plane dependencies.

$ErrorActionPreference = "Stop"

$PatchName = "promote-test2-shell-ui-to-stage2-v36bpw19b"
$SourceRoot = "C:\AI\OTG-Test2"
$TargetRoot = "C:\AI\OTG-Stage2"
$BackupRoot = Join-Path $TargetRoot ".patch-backups\$PatchName-$(Get-Date -Format yyyyMMdd-HHmmss)"
$DiagPath = Join-Path $TargetRoot "diagnostics-$PatchName.txt"

$CopyFiles = @(
  "app\app\AppPageClient.tsx",
  "app\components\HeaderBar.tsx",
  "app\app\globals.css",
  "app\globals.css"
)

$BackupOnlyFiles = @(
  "rework-checklist-background-storyboard-v36p.txt"
)

$AllTrackedPatchFiles = @($CopyFiles + $BackupOnlyFiles)

function Write-Step([string]$Message) {
  Write-Host $Message
}

function Restore-FromBackup {
  Write-Host "Rolling back Stage2 files from backup: $BackupRoot" -ForegroundColor Yellow

  foreach ($rel in $AllTrackedPatchFiles) {
    $target = Join-Path $TargetRoot $rel
    $backup = Join-Path $BackupRoot $rel
    $marker = Join-Path $BackupRoot "$rel.__MISSING__"

    if (Test-Path $backup) {
      New-Item -ItemType Directory -Force -Path (Split-Path $target -Parent) | Out-Null
      Copy-Item -Force $backup $target
      Write-Host "Restored $rel"
    } elseif (Test-Path $marker) {
      if (Test-Path $target) {
        Remove-Item -Force $target
        Write-Host "Removed new file $rel"
      }
    }
  }
}

function Fail-And-Rollback([string]$Message) {
  Write-Host "ERROR: $Message" -ForegroundColor Red
  Restore-FromBackup
  throw $Message
}

Write-Step "Applying $PatchName"
Write-Step "Source: $SourceRoot"
Write-Step "Target: $TargetRoot"

if (!(Test-Path $SourceRoot)) { throw "Source repo not found: $SourceRoot" }
if (!(Test-Path $TargetRoot)) { throw "Target repo not found: $TargetRoot" }
if (!(Test-Path (Join-Path $SourceRoot ".git"))) { throw "Source is not a git repo: $SourceRoot" }
if (!(Test-Path (Join-Path $TargetRoot ".git"))) { throw "Target is not a git repo: $TargetRoot" }

New-Item -ItemType Directory -Force -Path $BackupRoot | Out-Null

try {
  Set-Location $TargetRoot

  $head = (git rev-parse --short HEAD).Trim()
  if ($head -ne "163ef27") {
    throw "Stage2 target HEAD is $head, expected 163ef27. Stop and inspect before applying."
  }

  $required = @(
    "app\api\production\assembly-music\route.ts",
    "app\api\production\assembly-music-mix\route.ts",
    "app\api\production\assembly-music-detect\route.ts",
    "app\api\production\assembly-add-to-gallery\route.ts",
    "app\app\components\QwenSceneBuilderPanel.tsx"
  )
  foreach ($rel in $required) {
    if (!(Test-Path (Join-Path $TargetRoot $rel))) {
      throw "Required Assembly/Qwen baseline file missing in Stage2: $rel"
    }
  }

  foreach ($rel in $AllTrackedPatchFiles) {
    $target = Join-Path $TargetRoot $rel
    $backup = Join-Path $BackupRoot $rel
    $marker = Join-Path $BackupRoot "$rel.__MISSING__"

    New-Item -ItemType Directory -Force -Path (Split-Path $backup -Parent) | Out-Null

    if (Test-Path $target) {
      Copy-Item -Force $target $backup
      Write-Step "Backed up $rel"
    } else {
      New-Item -ItemType Directory -Force -Path (Split-Path $marker -Parent) | Out-Null
      "missing before patch" | Set-Content -Encoding UTF8 $marker
      Write-Step "Marked missing target $rel"
    }
  }

  foreach ($rel in $CopyFiles) {
    $source = Join-Path $SourceRoot $rel
    $target = Join-Path $TargetRoot $rel

    if (!(Test-Path $source)) {
      Fail-And-Rollback "Source file missing: $source"
    }

    New-Item -ItemType Directory -Force -Path (Split-Path $target -Parent) | Out-Null
    Copy-Item -Force $source $target

    if (!(Test-Path $target)) {
      Fail-And-Rollback "Copied file does not exist after write: $rel"
    }

    Write-Step "Copied $rel"
  }

  $checklist = Join-Path $TargetRoot "rework-checklist-background-storyboard-v36p.txt"
  Add-Content -Encoding UTF8 -Path $checklist -Value ""
  Add-Content -Encoding UTF8 -Path $checklist -Value "[$PatchName] Narrow Stage2 shell UI parity retry: copied AppPageClient, HeaderBar, and global CSS only. Avoided CharactersPanel and production route copies because v36bpw19 diagnostics showed missing voice/control-plane dependencies."

  $diag = @()
  $diag += "Patch: $PatchName"
  $diag += "AppliedAt: $(Get-Date -Format o)"
  $diag += "SourceRoot: $SourceRoot"
  $diag += "TargetRoot: $TargetRoot"
  $diag += "TargetHeadBefore: $head"
  $diag += "BackupRoot: $BackupRoot"
  $diag += ""
  $diag += "Copied files:"
  foreach ($rel in $CopyFiles) { $diag += "- $rel" }
  $diag += ""
  $diag += "Intentionally not copied from failed v36bpw19:"
  $diag += "- app\app\components\CharactersPanel.tsx"
  $diag += "- app\api\production\animate\route.ts"
  $diag += "- app\api\production\background\route.ts"
  $diag += "- app\api\production\picture\route.ts"
  $diag += "- app\api\production\video\route.ts"
  $diag += "- app\api\production\edit\render\route.ts"
  $diag += "- app\api\gallery\sync\route.ts"
  $diag | Set-Content -Encoding UTF8 $DiagPath

  Write-Step "Running TypeScript verification..."
  $tscOutput = & npx tsc --noEmit 2>&1
  if ($LASTEXITCODE -ne 0) {
    $tscOutput | Add-Content -Encoding UTF8 $DiagPath
    Fail-And-Rollback "TypeScript failed. See diagnostics: $DiagPath"
  }

  Write-Step "Running production build..."
  $buildOutput = & npm run build 2>&1
  if ($LASTEXITCODE -ne 0) {
    $buildOutput | Add-Content -Encoding UTF8 $DiagPath
    Fail-And-Rollback "npm run build failed. See diagnostics: $DiagPath"
  }

  $status = git status --short
  $status | Add-Content -Encoding UTF8 $DiagPath

  Write-Host "SUCCESS: $PatchName applied to Stage2 and build passed." -ForegroundColor Green
  Write-Host "Backups: $BackupRoot"
  Write-Host "Diagnostics: $DiagPath"
  Write-Host ""
  Write-Host "Next:"
  Write-Host "  git status --short"
  Write-Host "  git add app\app\AppPageClient.tsx app\components\HeaderBar.tsx app\app\globals.css app\globals.css rework-checklist-background-storyboard-v36p.txt"
  Write-Host "  git commit -m `"Promote Stage2 shell UI parity`""
  Write-Host "  git push origin codex/stabilize-test-build"
} catch {
  if ($_.Exception.Message -notlike "*TypeScript failed*" -and $_.Exception.Message -notlike "*npm run build failed*") {
    try {
      if (Test-Path $BackupRoot) {
        Restore-FromBackup
      }
    } catch {
      Write-Host "Rollback encountered an additional error: $($_.Exception.Message)" -ForegroundColor Red
    }
  }
  throw
}
