# promote-test2-shell-ui-to-stage2-v36bpw19d.ps1
# STAGE2 ONLY. Repair of v36bpw19c.
# v36bpw19c rolled back because npm wrote allow-scripts warnings to stderr and PowerShell treated them as terminating errors.
# This version runs npm through cmd.exe, captures output to diagnostics, and checks exit codes explicitly.

$ErrorActionPreference = "Stop"

$PatchName = "promote-test2-shell-ui-to-stage2-v36bpw19d"
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

function Run-CmdChecked([string]$Label, [string]$CommandLine, [string]$OutputFileName) {
  $outFile = Join-Path $TargetRoot $OutputFileName
  Add-Content -Encoding UTF8 -Path $DiagPath -Value ""
  Add-Content -Encoding UTF8 -Path $DiagPath -Value "----- $Label -----"
  Add-Content -Encoding UTF8 -Path $DiagPath -Value $CommandLine

  Write-Step $Label
  $previous = Get-Location
  try {
    Set-Location $TargetRoot
    & cmd.exe /d /c "$CommandLine > `"$outFile`" 2>&1"
    $exitCode = $LASTEXITCODE
  } finally {
    Set-Location $previous
  }

  if (Test-Path $outFile) {
    Get-Content $outFile | Add-Content -Encoding UTF8 -Path $DiagPath
  }

  if ($exitCode -ne 0) {
    Fail-And-Rollback "$Label failed with exit code $exitCode. See diagnostics: $DiagPath"
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

  Run-CmdChecked "Updating package.json through node helper" "node `"$tmpJs`" `"$targetPkgPath`" `"$sparkVersion`"" ".tmp-$PatchName-node-helper.log"
  Remove-Item -Force $tmpJs -ErrorAction SilentlyContinue

  $checklist = Join-Path $TargetRoot "rework-checklist-background-storyboard-v36p.txt"
  Add-Content -Encoding UTF8 -Path $checklist -Value ""
  Add-Content -Encoding UTF8 -Path $checklist -Value "[$PatchName] Narrow Stage2 shell UI parity retry: copied AppPageClient, HeaderBar, and global CSS only; added @sparkjsdev/spark dependency from TEST2 because SplatViewer is pulled in by the shell UI. Uses cmd-based npm execution to avoid PowerShell treating npm warnings as fatal."

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
  $diag += "- package-lock.json: updated by npm install --ignore-scripts --no-audit --fund=false"
  $diag | Set-Content -Encoding UTF8 $DiagPath

  Run-CmdChecked "Running npm install to update package-lock and install @sparkjsdev/spark" "npm install --ignore-scripts --no-audit --fund=false" ".tmp-$PatchName-npm-install.log"

  Run-CmdChecked "Running TypeScript verification" "npx tsc --noEmit" ".tmp-$PatchName-tsc.log"

  Run-CmdChecked "Running production build" "npm run build" ".tmp-$PatchName-build.log"

  $status = git status --short
  Add-Content -Encoding UTF8 -Path $DiagPath -Value ""
  Add-Content -Encoding UTF8 -Path $DiagPath -Value "----- git status --short -----"
  $status | Add-Content -Encoding UTF8 -Path $DiagPath

  Remove-Item -Force (Join-Path $TargetRoot ".tmp-$PatchName-node-helper.log") -ErrorAction SilentlyContinue
  Remove-Item -Force (Join-Path $TargetRoot ".tmp-$PatchName-npm-install.log") -ErrorAction SilentlyContinue
  Remove-Item -Force (Join-Path $TargetRoot ".tmp-$PatchName-tsc.log") -ErrorAction SilentlyContinue
  Remove-Item -Force (Join-Path $TargetRoot ".tmp-$PatchName-build.log") -ErrorAction SilentlyContinue

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
  if ($_.Exception.Message -notlike "*failed with exit code*") {
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
