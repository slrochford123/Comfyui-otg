param(
  [switch]$KeepDevServer,
  [switch]$SkipWebBuild
)

$ErrorActionPreference = "Stop"

function Write-Step {
  param([string]$Message)
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Resolve-FirstDirectory {
  param([string[]]$Patterns)
  foreach ($pattern in $Patterns) {
    $match = Get-ChildItem -Path $pattern -Directory -ErrorAction SilentlyContinue |
      Sort-Object FullName -Descending |
      Select-Object -First 1
    if ($match) {
      return $match.FullName
    }
  }
  return $null
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$androidRoot = Join-Path $repoRoot "android"
$releaseDir = Join-Path $androidRoot "release"
$keystorePropertiesPath = Join-Path $androidRoot "keystore.properties"
$localPropertiesPath = Join-Path $androidRoot "local.properties"
$nodeDir = "C:\AI\nodejs"
$androidSdk = "C:\AI\AndroidSdk"
$javaHome = $env:JAVA_HOME

if (-not $javaHome -or -not (Test-Path (Join-Path $javaHome "bin\java.exe"))) {
  $javaHome = Resolve-FirstDirectory @(
    "C:\Program Files\Eclipse Adoptium\jdk-21*",
    "C:\AI\AndroidBuildTools\jdk-21*"
  )
}

if (-not $javaHome -or -not (Test-Path (Join-Path $javaHome "bin\java.exe"))) {
  throw "JDK 21 was not found. Install Eclipse Temurin JDK 21, then rerun this script."
}

if (-not (Test-Path (Join-Path $nodeDir "node.exe"))) {
  throw "Node 20 was not found at $nodeDir."
}

if (-not (Test-Path (Join-Path $androidSdk "platforms"))) {
  throw "Android SDK was not found at $androidSdk."
}

$env:JAVA_HOME = $javaHome
$env:ANDROID_HOME = $androidSdk
$env:ANDROID_SDK_ROOT = $androidSdk
$env:Path = "$nodeDir;$javaHome\bin;$androidSdk\platform-tools;$androidSdk\cmdline-tools\latest\bin;$env:Path"

Write-Step "Using release toolchain"
Write-Host "Repo:        $repoRoot"
Write-Host "Node:        $(& node -v)"
Write-Host "Java home:   $javaHome"
& java -version
Write-Host "Android SDK: $androidSdk"

if (-not $KeepDevServer) {
  Write-Step "Stopping dev server on port 3001 if it is running"
  $conn = Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($conn) {
    Stop-Process -Id $conn.OwningProcess -Force
    Write-Host "Stopped port 3001 listener PID $($conn.OwningProcess)."
  } else {
    Write-Host "No port 3001 listener found."
  }
}

Write-Step "Ensuring Android SDK local.properties"
New-Item -ItemType Directory -Force -Path $androidRoot | Out-Null
"sdk.dir=C\:\\AI\\AndroidSdk" | Set-Content -Path $localPropertiesPath -Encoding UTF8
Write-Host "Wrote $localPropertiesPath"

if (-not (Test-Path $keystorePropertiesPath)) {
  throw "Missing $keystorePropertiesPath. Release signing cannot continue."
}

$keystoreProperties = @{}
Get-Content $keystorePropertiesPath | ForEach-Object {
  if ($_ -match "^\s*([^#][^=]+?)\s*=\s*(.*)\s*$") {
    $keystoreProperties[$matches[1].Trim()] = $matches[2].Trim()
  }
}

foreach ($requiredKey in @("storeFile", "storePassword", "keyAlias", "keyPassword")) {
  if (-not $keystoreProperties.ContainsKey($requiredKey) -or [string]::IsNullOrWhiteSpace($keystoreProperties[$requiredKey])) {
    throw "Missing '$requiredKey' in $keystorePropertiesPath."
  }
}

$keystorePath = Join-Path $androidRoot $keystoreProperties["storeFile"]
if (-not (Test-Path $keystorePath)) {
  throw "Missing upload keystore: $keystorePath. Restore the Play Console upload key or reset the upload key in Play Console."
}

if (-not $SkipWebBuild) {
  Write-Step "Building Next.js web app"
  Set-Location $repoRoot
  npm run build
}

Write-Step "Syncing Capacitor Android project"
Set-Location $repoRoot
npx cap sync android

Write-Step "Building signed Play release AAB"
Set-Location $androidRoot
.\gradlew bundleRelease

$aab = Get-ChildItem (Join-Path $androidRoot "app\build\outputs\bundle\release\*.aab") |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

if (-not $aab) {
  throw "Release AAB was not created."
}

Write-Step "Exporting upload certificate for Play Console key reset records"
New-Item -ItemType Directory -Force -Path $releaseDir | Out-Null
$certificatePath = Join-Path $releaseDir "otg-upload-certificate.pem"
& keytool -export -rfc `
  -keystore $keystorePath `
  -alias $keystoreProperties["keyAlias"] `
  -storepass $keystoreProperties["storePassword"] `
  -file $certificatePath | Out-Null

$fingerprintText = & keytool -list -v `
  -keystore $keystorePath `
  -alias $keystoreProperties["keyAlias"] `
  -storepass $keystoreProperties["storePassword"]

$sha1 = ($fingerprintText | Select-String -Pattern "SHA1:\s*(.+)$").Matches.Groups[1].Value.Trim()
$sha256 = ($fingerprintText | Select-String -Pattern "SHA256:\s*(.+)$").Matches.Groups[1].Value.Trim()
$hash = Get-FileHash -Algorithm SHA256 -Path $aab.FullName

$manifestPath = Join-Path $releaseDir "latest-play-release.json"
$manifest = [ordered]@{
  builtAt = (Get-Date).ToString("o")
  aabPath = $aab.FullName
  aabBytes = $aab.Length
  aabSha256 = $hash.Hash
  uploadKeystorePath = $keystorePath
  uploadCertificatePath = $certificatePath
  uploadKeySha1 = $sha1
  uploadKeySha256 = $sha256
  note = "Upload the AAB to Play Console. If Play rejects the key, upload the PEM certificate through App integrity upload-key reset."
}

$manifest | ConvertTo-Json -Depth 4 | Set-Content -Path $manifestPath -Encoding UTF8

Write-Step "Release ready"
Write-Host "AAB:         $($aab.FullName)"
Write-Host "AAB SHA256:  $($hash.Hash)"
Write-Host "Certificate: $certificatePath"
Write-Host "Manifest:    $manifestPath"
Write-Host "Key SHA1:    $sha1"
