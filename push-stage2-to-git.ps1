param(
  [string]$StageRoot = "C:\AI\OTG-Stage2",
  [string]$TestRoot = "C:\AI\OTG-Test2",
  [string]$Branch = "stage2",
  [string]$RemoteName = "origin",
  [string]$RemoteUrl = "",
  [string]$CommitMessage = ""
)

$ErrorActionPreference = "Stop"

function Ok($Message) {
  Write-Host "[OK] $Message" -ForegroundColor Green
}

function Info($Message) {
  Write-Host "[INFO] $Message" -ForegroundColor Cyan
}

function Warn($Message) {
  Write-Host "[WARN] $Message" -ForegroundColor Yellow
}

function Fail($Message) {
  Write-Host "[FAIL] $Message" -ForegroundColor Red
  exit 1
}

if (!(Test-Path $StageRoot)) {
  Fail "Stage root missing: $StageRoot"
}

$Git = Get-Command git -ErrorAction SilentlyContinue
if (!$Git) {
  Fail "git is not installed or not on PATH."
}

Set-Location $StageRoot

Info "Stage root: $StageRoot"
Info "Target branch: $Branch"

if ([string]::IsNullOrWhiteSpace($CommitMessage)) {
  $CommitMessage = "Promote TEST 3001 snapshot to STAGE 3002 - $(Get-Date -Format yyyy-MM-dd-HHmm)"
}

# Detect remote URL from TEST if STAGE has no remote and RemoteUrl not provided.
if ([string]::IsNullOrWhiteSpace($RemoteUrl)) {
  if (Test-Path (Join-Path $StageRoot ".git")) {
    try {
      $ExistingStageRemote = git remote get-url $RemoteName 2>$null
      if (![string]::IsNullOrWhiteSpace($ExistingStageRemote)) {
        $RemoteUrl = $ExistingStageRemote.Trim()
        Ok "Using existing STAGE remote: $RemoteUrl"
      }
    }
    catch {}
  }

  if ([string]::IsNullOrWhiteSpace($RemoteUrl) -and (Test-Path (Join-Path $TestRoot ".git"))) {
    Push-Location $TestRoot
    try {
      $Detected = git remote get-url $RemoteName 2>$null
      if (![string]::IsNullOrWhiteSpace($Detected)) {
        $RemoteUrl = $Detected.Trim()
        Ok "Detected remote from TEST: $RemoteUrl"
      }
    }
    finally {
      Pop-Location
    }
  }
}

if ([string]::IsNullOrWhiteSpace($RemoteUrl)) {
  Fail "No Git remote found. Rerun with: -RemoteUrl https://github.com/YOUR_USER/YOUR_REPO.git"
}

Set-Location $StageRoot

# Initialize repo if needed.
if (!(Test-Path (Join-Path $StageRoot ".git"))) {
  Info "Initializing Git repo in STAGE..."
  git init
  if ($LASTEXITCODE -ne 0) { Fail "git init failed." }
  Ok "Initialized Git repo."
}

# Configure or update remote.
$HasRemote = $false
try {
  $CurrentRemote = git remote get-url $RemoteName 2>$null
  if (![string]::IsNullOrWhiteSpace($CurrentRemote)) {
    $HasRemote = $true
  }
}
catch {
  $HasRemote = $false
}

if ($HasRemote) {
  Info "Updating remote $RemoteName to $RemoteUrl"
  git remote set-url $RemoteName $RemoteUrl
}
else {
  Info "Adding remote $RemoteName = $RemoteUrl"
  git remote add $RemoteName $RemoteUrl
}

if ($LASTEXITCODE -ne 0) {
  Fail "Remote setup failed."
}

# Make sure branch exists locally.
Info "Switching to branch $Branch..."
git checkout -B $Branch
if ($LASTEXITCODE -ne 0) {
  Fail "Could not create/switch branch $Branch."
}

# Ensure safe ignore rules.
$GitIgnorePath = Join-Path $StageRoot ".gitignore"
$RequiredIgnores = @(
  "",
  "# OTG generated/runtime files",
  "node_modules/",
  ".next/",
  ".turbo/",
  "dist/",
  "build/",
  "logs/",
  "tmp/",
  "diagnostics/",
  "patch_backups/",
  "*.log",
  "*.tmp",
  ".env",
  ".env.local",
  ".env.*.local",
  "",
  "# OTG generated media / private runtime data",
  "data/worker-logs/",
  "data/characters/**/voice-samples/",
  "data/characters/**/training-datasets/",
  "data/characters/**/generated/",
  "data/**/*.wav",
  "data/**/*.mp3",
  "data/**/*.mp4",
  "data/**/*.webm",
  "data/**/*.png",
  "data/**/*.jpg",
  "data/**/*.jpeg",
  "data/**/*.webp",
  "",
  "# Python cache",
  "__pycache__/",
  "*.pyc",
  ".venv/",
  "venv/"
)

$ExistingIgnore = ""
if (Test-Path $GitIgnorePath) {
  $ExistingIgnore = Get-Content $GitIgnorePath -Raw
}

$ToAppend = New-Object System.Collections.Generic.List[string]

foreach ($Line in $RequiredIgnores) {
  if ([string]::IsNullOrWhiteSpace($Line)) {
    continue
  }

  if (!$ExistingIgnore.Contains($Line)) {
    $ToAppend.Add($Line)
  }
}

if ($ToAppend.Count -gt 0) {
  Add-Content -Path $GitIgnorePath -Value ""
  Add-Content -Path $GitIgnorePath -Value "# Added by Stage2 promotion"
  foreach ($Line in $ToAppend) {
    Add-Content -Path $GitIgnorePath -Value $Line
  }
  Ok "Updated .gitignore"
}
else {
  Ok ".gitignore already contains required exclusions."
}

# Show what will be added.
Info "Git status before add:"
git status --short

# Add tracked source files.
git add -A
if ($LASTEXITCODE -ne 0) {
  Fail "git add failed."
}

Info "Git status after add:"
git status --short

# Commit only if there are staged changes.
$Staged = git diff --cached --name-only

if ([string]::IsNullOrWhiteSpace(($Staged | Out-String))) {
  Warn "No staged changes to commit."
}
else {
  Info "Committing Stage2 snapshot..."
  git commit -m $CommitMessage
  if ($LASTEXITCODE -ne 0) {
    Fail "git commit failed."
  }
  Ok "Committed Stage2 snapshot."
}

Info "Pushing branch $Branch to $RemoteName..."
git push -u $RemoteName $Branch
if ($LASTEXITCODE -ne 0) {
  Fail "git push failed."
}

Ok "Stage2 pushed to Git."
Write-Host ""
Write-Host "Branch pushed:"
Write-Host "  $Branch"
Write-Host "Remote:"
Write-Host "  $RemoteUrl"