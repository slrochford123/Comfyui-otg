[CmdletBinding()]
param(
    [string]$RepoRoot = "C:\AI\OTG-Test2",

    [ValidateSet("Aab", "Apk", "Both")]
    [string]$Artifact = "Aab",

    [string]$VersionName = "",

    [int]$VersionCode = 0,

    [switch]$SkipWebBuild,

    [switch]$SkipCapSync,

    [switch]$RequireCleanGit
)

$ErrorActionPreference = "Stop"

function Fail {
    param([string]$Message)
    Write-Error $Message
    exit 1
}

function Test-CommandExists {
    param([string]$Name)
    return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function Invoke-Step {
    param(
        [string]$Command,
        [string[]]$Arguments,
        [string]$WorkingDirectory
    )

    Write-Host ""
    Write-Host "[RUN] $Command $($Arguments -join ' ')"
    Write-Host "      cwd: $WorkingDirectory"

    Push-Location $WorkingDirectory
    try {
        & $Command @Arguments
        if ($LASTEXITCODE -ne 0) {
            Fail "Command failed with exit code $LASTEXITCODE`: $Command $($Arguments -join ' ')"
        }
    }
    finally {
        Pop-Location
    }
}

function Get-NextPatchVersion {
    param([string]$Current)

    if ($Current -match '^(\d+)\.(\d+)\.(\d+)(.*)$') {
        $major = [int]$Matches[1]
        $minor = [int]$Matches[2]
        $patch = ([int]$Matches[3]) + 1
        $suffix = $Matches[4]
        return "$major.$minor.$patch$suffix"
    }

    if ($Current -match '^(\d+)\.(\d+)(.*)$') {
        $major = [int]$Matches[1]
        $minor = ([int]$Matches[2]) + 1
        $suffix = $Matches[3]
        return "$major.$minor.0$suffix"
    }

    return "$Current.$(Get-Date -Format 'yyyyMMddHHmm')"
}

Write-Host ""
Write-Host "============================================================"
Write-Host " OTG Android Update Release"
Write-Host "============================================================"
Write-Host "RepoRoot: $RepoRoot"
Write-Host "Artifact: $Artifact"
Write-Host ""

if (-not (Test-Path $RepoRoot)) {
    Fail "Repo root not found: $RepoRoot"
}

$AndroidRoot = Join-Path $RepoRoot "android"
if (-not (Test-Path $AndroidRoot)) {
    Fail "Android project folder not found: $AndroidRoot"
}

$GradleBat = Join-Path $AndroidRoot "gradlew.bat"
if (-not (Test-Path $GradleBat)) {
    Fail "Gradle wrapper not found: $GradleBat"
}

$GradleCandidates = @(
    (Join-Path $AndroidRoot "app\build.gradle"),
    (Join-Path $AndroidRoot "app\build.gradle.kts")
)

$BuildGradle = $GradleCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $BuildGradle) {
    Fail "No app Gradle file found. Tried: $($GradleCandidates -join ', ')"
}

Write-Host "[OK] Android root: $AndroidRoot"
Write-Host "[OK] Gradle file:  $BuildGradle"

if ($RequireCleanGit -and (Test-Path (Join-Path $RepoRoot ".git"))) {
    if (-not (Test-CommandExists "git")) {
        Fail "Git is required for -RequireCleanGit but was not found on PATH."
    }

    $GitStatus = & git -C $RepoRoot status --short
    if ($LASTEXITCODE -ne 0) {
        Fail "git status failed."
    }

    if ($GitStatus) {
        Write-Host $GitStatus
        Fail "Git working tree is not clean. Commit/stash changes or rerun without -RequireCleanGit."
    }

    Write-Host "[OK] Git working tree is clean."
}
elseif (Test-Path (Join-Path $RepoRoot ".git")) {
    if (Test-CommandExists "git") {
        $GitStatus = & git -C $RepoRoot status --short
        if ($GitStatus) {
            Write-Warning "Git working tree has changes. Release will include current local state."
        }
    }
}

$OriginalGradle = Get-Content -Path $BuildGradle -Raw

$VersionCodeRegex = '(?m)(^\s*versionCode\s*(?:=)?\s*)(\d+)(\s*(?://.*)?$)'
$VersionNameRegex = "(?m)(^\s*versionName\s*(?:=)?\s*[""'])([^""']+)([""'].*$)"

$VersionCodeMatch = [regex]::Match($OriginalGradle, $VersionCodeRegex)
if (-not $VersionCodeMatch.Success) {
    Fail "Could not find direct numeric versionCode in $BuildGradle. Expected something like: versionCode 12 or versionCode = 12"
}

$VersionNameMatch = [regex]::Match($OriginalGradle, $VersionNameRegex)
if (-not $VersionNameMatch.Success) {
    Fail "Could not find direct string versionName in $BuildGradle. Expected something like: versionName `"1.0.0`" or versionName = `"1.0.0`""
}

$CurrentVersionCode = [int]$VersionCodeMatch.Groups[2].Value
$CurrentVersionName = $VersionNameMatch.Groups[2].Value

if ($VersionCode -gt 0) {
    $NextVersionCode = $VersionCode
}
else {
    $NextVersionCode = $CurrentVersionCode + 1
}

if ($NextVersionCode -le $CurrentVersionCode) {
    Fail "New VersionCode must be greater than current VersionCode. Current=$CurrentVersionCode New=$NextVersionCode"
}

if ([string]::IsNullOrWhiteSpace($VersionName)) {
    $NextVersionName = Get-NextPatchVersion $CurrentVersionName
}
else {
    $NextVersionName = $VersionName
}

Write-Host ""
Write-Host "Version update:"
Write-Host "  versionCode: $CurrentVersionCode -> $NextVersionCode"
Write-Host "  versionName: $CurrentVersionName -> $NextVersionName"

$Timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$GradleBackup = "$BuildGradle.android-release.bak.$Timestamp"
Copy-Item -Path $BuildGradle -Destination $GradleBackup -Force
Write-Host "[OK] Gradle backup: $GradleBackup"

$VersionCodeReplacement = "$($VersionCodeMatch.Groups[1].Value)$NextVersionCode$($VersionCodeMatch.Groups[3].Value)"
$UpdatedGradle = $OriginalGradle.Remove($VersionCodeMatch.Index, $VersionCodeMatch.Length).Insert($VersionCodeMatch.Index, $VersionCodeReplacement)

$VersionNameMatchAfterCode = [regex]::Match($UpdatedGradle, $VersionNameRegex)
$VersionNameReplacement = "$($VersionNameMatchAfterCode.Groups[1].Value)$NextVersionName$($VersionNameMatchAfterCode.Groups[3].Value)"
$UpdatedGradle = $UpdatedGradle.Remove($VersionNameMatchAfterCode.Index, $VersionNameMatchAfterCode.Length).Insert($VersionNameMatchAfterCode.Index, $VersionNameReplacement)

[System.IO.File]::WriteAllText($BuildGradle, $UpdatedGradle, (New-Object System.Text.UTF8Encoding($false)))

$VerifyGradle = Get-Content -Path $BuildGradle -Raw
if ($VerifyGradle -notmatch "versionCode\s*(?:=)?\s*$NextVersionCode") {
    Fail "Verification failed: versionCode was not written."
}
if ($VerifyGradle -notmatch "versionName\s*(?:=)?\s*[""']$([regex]::Escape($NextVersionName))[""']") {
    Fail "Verification failed: versionName was not written."
}

Write-Host "[OK] Gradle version values updated."

$SigningConfigured = ($VerifyGradle -match "signingConfigs" -and $VerifyGradle -match "signingConfig")
if (-not $SigningConfigured) {
    Write-Warning "No obvious release signing config found in app Gradle file. The output may be unsigned and not uploadable to Google Play until signing is configured."
}

$PackageJson = Join-Path $RepoRoot "package.json"
if (-not $SkipWebBuild -and (Test-Path $PackageJson)) {
    $HasBuildScript = $false
    try {
        $Package = Get-Content -Path $PackageJson -Raw | ConvertFrom-Json
        if ($null -ne $Package.scripts) {
            $HasBuildScript = $Package.scripts.PSObject.Properties.Name -contains "build"
        }
    }
    catch {
        Write-Warning "Could not parse package.json. Skipping npm build detection."
    }

    if ($HasBuildScript) {
        if (-not (Test-CommandExists "npm")) {
            Fail "npm was not found on PATH."
        }
        Invoke-Step "npm" @("run", "build") $RepoRoot
    }
    else {
        Write-Host "[SKIP] package.json has no build script."
    }
}
else {
    Write-Host "[SKIP] Web build skipped."
}

$CapacitorConfigs = @(
    (Join-Path $RepoRoot "capacitor.config.ts"),
    (Join-Path $RepoRoot "capacitor.config.js"),
    (Join-Path $RepoRoot "capacitor.config.json")
) | Where-Object { Test-Path $_ }

if (-not $SkipCapSync -and $CapacitorConfigs.Count -gt 0) {
    if (-not (Test-CommandExists "npx")) {
        Fail "npx was not found on PATH."
    }
    Invoke-Step "npx" @("cap", "sync", "android") $RepoRoot
}
else {
    Write-Host "[SKIP] Capacitor sync skipped or no Capacitor config found."
}

$BuildStart = Get-Date

Invoke-Step $GradleBat @("clean") $AndroidRoot

if ($Artifact -eq "Aab" -or $Artifact -eq "Both") {
    Invoke-Step $GradleBat @(":app:bundleRelease") $AndroidRoot
}

if ($Artifact -eq "Apk" -or $Artifact -eq "Both") {
    Invoke-Step $GradleBat @(":app:assembleRelease") $AndroidRoot
}

$OutputsRoot = Join-Path $AndroidRoot "app\build\outputs"
if (-not (Test-Path $OutputsRoot)) {
    Fail "Android output folder was not created: $OutputsRoot"
}

$BuiltFiles = Get-ChildItem -Path $OutputsRoot -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object {
        (($_.Extension -ieq ".aab") -or ($_.Extension -ieq ".apk")) -and
        (($_.FullName -match "\\release\\") -or ($_.Name -match "release")) -and
        ($_.LastWriteTime -ge $BuildStart.AddMinutes(-10))
    } |
    Sort-Object LastWriteTime -Descending

if (-not $BuiltFiles -or $BuiltFiles.Count -eq 0) {
    $BuiltFiles = Get-ChildItem -Path $OutputsRoot -Recurse -File -ErrorAction SilentlyContinue |
        Where-Object {
            (($_.Extension -ieq ".aab") -or ($_.Extension -ieq ".apk")) -and
            (($_.FullName -match "\\release\\") -or ($_.Name -match "release"))
        } |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 10
}

if (-not $BuiltFiles -or $BuiltFiles.Count -eq 0) {
    Fail "No release AAB/APK output found under: $OutputsRoot"
}

$ReleaseDirName = "{0}-{1}" -f $NextVersionName, $NextVersionCode
$ReleaseDir = Join-Path $RepoRoot (Join-Path "release\android" $ReleaseDirName)
New-Item -ItemType Directory -Path $ReleaseDir -Force | Out-Null

$CopiedFiles = @()
foreach ($File in $BuiltFiles) {
    $Destination = Join-Path $ReleaseDir $File.Name
    Copy-Item -Path $File.FullName -Destination $Destination -Force
    $CopiedFiles += $Destination
}

$MetadataPath = Join-Path $ReleaseDir "release-metadata.json"
$Metadata = [ordered]@{
    repoRoot = $RepoRoot
    androidRoot = $AndroidRoot
    buildGradle = $BuildGradle
    gradleBackup = $GradleBackup
    versionCodePrevious = $CurrentVersionCode
    versionCode = $NextVersionCode
    versionNamePrevious = $CurrentVersionName
    versionName = $NextVersionName
    artifact = $Artifact
    signingConfigDetected = $SigningConfigured
    createdAt = (Get-Date).ToString("o")
    copiedFiles = $CopiedFiles
}

$Metadata | ConvertTo-Json -Depth 5 | Set-Content -Path $MetadataPath -Encoding UTF8

Write-Host ""
Write-Host "============================================================"
Write-Host " Android update release created"
Write-Host "============================================================"
Write-Host "Release folder:"
Write-Host "  $ReleaseDir"
Write-Host ""
Write-Host "Files:"
$CopiedFiles | ForEach-Object { Write-Host "  $_" }
Write-Host ""
Write-Host "Metadata:"
Write-Host "  $MetadataPath"
Write-Host ""
Write-Host "Rollback version bump:"
Write-Host "  Copy-Item `"$GradleBackup`" `"$BuildGradle`" -Force"
Write-Host ""

if (-not $SigningConfigured) {
    Write-Host "WARNING: Signing config was not detected. Do not upload this to Play Console until release signing is configured."
}

