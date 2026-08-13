param(
  [string]$RepoRoot = "C:\AI\OTG-Test2"
)

$ErrorActionPreference = "Stop"

function Ok([string]$Message) { Write-Host "[OK] $Message" -ForegroundColor Green }
function Fail([string]$Message) { Write-Host "[FAIL] $Message" -ForegroundColor Red }
function RequireContains([string]$Text, [string]$Needle, [string]$Label) {
  if (-not $Text.Contains($Needle)) { throw "Missing marker: $Label" }
}
function WriteUtf8NoBom([string]$Path, [string]$Text) {
  [System.IO.File]::WriteAllText($Path, $Text, [System.Text.UTF8Encoding]::new($false))
}

try {
  $repo = (Resolve-Path -LiteralPath $RepoRoot).Path
  $panelPath = Join-Path $repo "app\app\components\CharactersPanel.tsx"
  $routePath = Join-Path $repo "app\api\characters\voice-sample\process\route.ts"
  $checklistPath = Join-Path $repo "docs\OTG_REWORK_CHECKLIST.md"
  $paths = @($panelPath, $routePath, $checklistPath)

  foreach ($path in $paths) {
    if (-not (Test-Path -LiteralPath $path)) { throw "Required file missing: $path" }
  }

  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $backupDir = Join-Path $repo ".patch-backups\ltx-voice-process-json-body-fix-$stamp"
  New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
  foreach ($path in $paths) {
    Copy-Item -LiteralPath $path -Destination (Join-Path $backupDir (Split-Path -Leaf $path)) -Force
  }
  Ok "Backed up files to $backupDir"

  $panel = Get-Content -LiteralPath $panelPath -Raw
  RequireContains $panel "OTG_LTX_AUDIO_POST_PROCESSING" "LTX post-processing marker"
  RequireContains $panel "OTG_LTX_PROCESS_JSON_BODY" "client JSON body marker"
  RequireContains $panel '"Content-Type": "application/json"' "Content-Type header"
  RequireContains $panel '"x-otg-device-id": getCharacterDeviceId()' "device id header"
  RequireContains $panel "originalSamplePath: originalPath" "originalSamplePath payload"
  RequireContains $panel "Cannot process LTX audio because the local sample path is missing." "missing path UI error"
  WriteUtf8NoBom $panelPath $panel

  $route = Get-Content -LiteralPath $routePath -Raw
  RequireContains $route "OTG_LTX_PROCESS_JSON_BODY" "route JSON body marker"
  RequireContains $route "const body = await req.clone().json()" "clone body parse before owner"
  RequireContains $route "const owner = await getOwnerContext(req);" "owner resolution after clone body parse"
  RequireContains $route "Missing required field: samplePath" "samplePath guard"
  RequireContains $route "Missing required field: action" "action guard"
  RequireContains $route "samplePath must be under the project data folder." "path security guard"
  WriteUtf8NoBom $routePath $route

  $checklist = Get-Content -LiteralPath $checklistPath -Raw
  $line = "- [x] LTX Voice Patch 3 JSON-body fix: post-processing buttons now send explicit JSON request payloads with local sample paths, and the process route clones/parses safely before owner resolution."
  if (-not $checklist.Contains($line)) {
    $checklist = $checklist.TrimEnd() + "`r`n" + $line + "`r`n"
  }
  [System.IO.File]::WriteAllText($checklistPath, $checklist, [System.Text.UTF8Encoding]::new($true))

  Ok "LTX voice process JSON-body fix markers verified"
}
catch {
  Fail $_.Exception.Message
  exit 1
}
