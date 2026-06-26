# promote-test2-shell-ui-to-stage2-v36bpw19c.ps1
# STAGE2 ONLY. Narrow shell UI parity retry after v36bpw19b.
# v36bpw19b failed only because copied shell UI references SplatViewer, and Stage2 lacks @sparkjsdev/spark.
# This script:
# - backs up Stage2 files
# - copies shell/navigation/theme files from OTG-Test2
# - adds the exact @sparkjsdev/spark dependency version from OTG-Test2/package.json into Stage2/package.json
# - runs npm install to update package-lock/node_modules
# - runs npx tsc --noEmit and npm run build
# - rolls back copied files and package manifests if verification fails

$ErrorActionPreference = "Stop"

$PatchName = "promote-test2-shell-ui-to-stage2-v36bpw19c"
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
  "package.json",
  "package-lock.json",
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

function Backup-Path([string]$rel) {
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
    Backup-Path $rel
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

  $sourcePkgPath = Join-Path $SourceRoot "package.json"
  $targetPkgPath = Join-Path $TargetRoot "package.json"
  $sourcePkg = Get-Content $sourcePkgPath -Raw | ConvertFrom-Json
  $sparkVersion = $null

  if ($sourcePkg.dependencies -and $sourcePkg.dependencies.PSObject.Properties.Name -contains "@sparkjsdev/spark") {
    $sparkVersion = [string]$sourcePkg.dependencies."@sparkjsdev/spark"
  } elseif ($sourcePkg.devDependencies -and $sourcePkg.devDependencies.PSObject.Properties.Name -contains "@sparkjsdev/spark") {
    $sparkVersion = [string]$sourcePkg.devDependencies."@sparkjsdev/spark"
  }

  if ([string]::IsNullOrWhiteSpace($sparkVersion)) {
    Fail-And-Rollback "Could not find @sparkjsdev/spark in $sourcePkgPath. Cannot safely infer dependency version."
  }

  Write-Step "Using @sparkjsdev/spark version from TEST2 package.json: $sparkVersion"

  $tmpJs = Join-Path $TargetRoot ".tmp-$PatchName-package-update.cjs"
  @'
const fs = require("fs");

const targetPkgPath = process.argv[2];
const sparkVersion = process.argv[3];

const pkg = JSON.parse(fs.readFileSync(targetPkgPath, "utf8"));
pkg.dependencies = pkg.dependencies || {};
pkg.dependencies["@sparkjsdev/spark"] = sparkVersion;

fs.writeFileSync(targetPkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf8");
'@ | Set-Content -Encoding UTF8 $tmpJs

  & node $tmpJs $targetPkgPath $sparkVersion
  if ($LASTEXITCODE -ne 0) {
    Remove-Item -Force $tmpJs -ErrorAction SilentlyContinue
    Fail-And-Rollback "Failed to update package.json with @sparkjsdev/spark."
  }
  Remove-Item -Force $tmpJs -ErrorAction SilentlyContinue

  $checklist = Join-Path $TargetRoot "rework-checklist-background-storyboard-v36p.txt"
  Add-Content -Encoding UTF8 -Path $checklist -Value ""
  Add-Content -Encoding UTF8 -Path $checklist -Value "[$PatchName] Narrow Stage2 shell UI parity retry: copied AppPageClient, HeaderBar, and global CSS only; added @sparkjsdev/spark dependency from TEST2 because SplatViewer is pulled in by the shell UI."

  $diag = @()
  $diag += "Patch: $PatchName"
  $diag += "AppliedAt: $(Get-Date -Format o)"
  $diag += "SourceRoot: $SourceRoot"
  $diag += "TargetRoot: $TargetRoot"
  $diag += "TargetHeadBefore: $head"
  $diag += "BackupRoot: $BackupRoot"
  $diag += "SparkVersion: $sparkVersion"
  $diag += ""
  $diag += "Copied files:"
  foreach ($rel in $CopyFiles) { $diag += "- $rel" }
  $diag += ""
  $diag += "Package changes:"
  $diag += "- package.json: added dependencies['@sparkjsdev/spark'] = $sparkVersion"
  $diag += "- package-lock.json: updated by npm install"
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

  Write-Step "Running npm install to update package-lock and install @sparkjsdev/spark..."
  $npmInstallOutput = & npm install 2>&1
  if ($LASTEXITCODE -ne 0) {
    $npmInstallOutput | Add-Content -Encoding UTF8 $DiagPath
    Fail-And-Rollback "npm install failed. See diagnostics: $DiagPath"
  }

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
  Write-Host "  git add app\app\AppPageClient.tsx app\components\HeaderBar.tsx app\app\globals.css app\globals.css package.json package-lock.json rework-checklist-background-storyboard-v36p.txt"
  Write-Host "  git commit -m `"Promote Stage2 shell UI parity`""
  Write-Host "  git push origin codex/stabilize-test-build"
} catch {
  if ($_.Exception.Message -notlike "*TypeScript failed*" -and $_.Exception.Message -notlike "*npm run build failed*" -and $_.Exception.Message -notlike "*npm install failed*") {
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
