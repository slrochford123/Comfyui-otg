# promote-test2-ui-parity-to-stage2-v36bpw19.ps1
# TEST/STAGE2 ONLY. Copies the detected uncommitted TEST2 UI/control-plane file set into OTG-Stage2.
# It backs up Stage2 files first, verifies the copy, runs TypeScript + production build, and rolls back on failure.

$ErrorActionPreference = "Stop"

$PatchName = "promote-test2-ui-parity-to-stage2-v36bpw19"
$SourceRoot = "C:\AI\OTG-Test2"
$TargetRoot = "C:\AI\OTG-Stage2"
$BackupRoot = Join-Path $TargetRoot ".patch-backups\$PatchName-$(Get-Date -Format yyyyMMdd-HHmmss)"
$DiagPath = Join-Path $TargetRoot "diagnostics-$PatchName.txt"

$Files = @(
  "app\api\gallery\sync\route.ts",
  "app\api\production\animate\route.ts",
  "app\api\production\background\route.ts",
  "app\api\production\edit\render\route.ts",
  "app\api\production\picture\route.ts",
  "app\api\production\video\route.ts",
  "app\app\AppPageClient.tsx",
  "app\app\components\CharactersPanel.tsx",
  "app\app\components\ProductionCharacterReferencePickerBridge.tsx",
  "app\app\globals.css",
  "app\components\HeaderBar.tsx",
  "app\globals.css",
  "lib\comfyGallerySync.ts",
  "rework-checklist-background-storyboard-v36p.txt"
)

function Write-Step([string]$Message) {
  Write-Host $Message
}

function Fail-And-Rollback([string]$Message) {
  Write-Host "ERROR: $Message" -ForegroundColor Red
  Write-Host "Rolling back Stage2 files from backup: $BackupRoot" -ForegroundColor Yellow

  foreach ($rel in $Files) {
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
      throw "Required baseline file missing in Stage2: $rel"
    }
  }

  foreach ($rel in $Files) {
    $source = Join-Path $SourceRoot $rel
    $target = Join-Path $TargetRoot $rel
    $backup = Join-Path $BackupRoot $rel
    $marker = Join-Path $BackupRoot "$rel.__MISSING__"

    if (!(Test-Path $source)) {
      throw "Source file missing: $source"
    }

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

  foreach ($rel in $Files) {
    $source = Join-Path $SourceRoot $rel
    $target = Join-Path $TargetRoot $rel
    New-Item -ItemType Directory -Force -Path (Split-Path $target -Parent) | Out-Null
    Copy-Item -Force $source $target
    if (!(Test-Path $target)) {
      Fail-And-Rollback "Copied file does not exist after write: $rel"
    }
    Write-Step "Copied $rel"
  }

  $checklist = Join-Path $TargetRoot "rework-checklist-background-storyboard-v36p.txt"
  Add-Content -Encoding UTF8 -Path $checklist -Value ""
  Add-Content -Encoding UTF8 -Path $checklist -Value "[$PatchName] Stage2 UI parity pass: copied detected TEST2 UI/control-plane file set into Stage2 so Linux staging can match the intended local UI while retaining Assembly music/gallery routes."

  $diag = @()
  $diag += "Patch: $PatchName"
  $diag += "AppliedAt: $(Get-Date -Format o)"
  $diag += "SourceRoot: $SourceRoot"
  $diag += "TargetRoot: $TargetRoot"
  $diag += "TargetHeadBefore: $head"
  $diag += "BackupRoot: $BackupRoot"
  $diag += ""
  $diag += "Copied files:"
  foreach ($rel in $Files) { $diag += "- $rel" }
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
  Write-Host "  git add <changed files>"
  Write-Host "  git commit -m `"Promote Stage2 UI parity and Assembly controls`""
  Write-Host "  git push origin codex/stabilize-test-build"
} catch {
  if ($_.Exception.Message -notlike "*TypeScript failed*" -and $_.Exception.Message -notlike "*npm run build failed*") {
    try {
      if (Test-Path $BackupRoot) {
        foreach ($rel in $Files) {
          $target = Join-Path $TargetRoot $rel
          $backup = Join-Path $BackupRoot $rel
          $marker = Join-Path $BackupRoot "$rel.__MISSING__"
          if (Test-Path $backup) {
            New-Item -ItemType Directory -Force -Path (Split-Path $target -Parent) | Out-Null
            Copy-Item -Force $backup $target
          } elseif (Test-Path $marker -and (Test-Path $target)) {
            Remove-Item -Force $target
          }
        }
      }
    } catch {
      Write-Host "Rollback encountered an additional error: $($_.Exception.Message)" -ForegroundColor Red
    }
  }
  throw
}
