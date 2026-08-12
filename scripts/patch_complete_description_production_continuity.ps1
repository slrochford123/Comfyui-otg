$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$PanelPath = Join-Path $Root "app\app\AppPageClient.tsx"
$ComfyRoutePath = Join-Path $Root "app\api\comfy\route.ts"
$ChecklistPath = Join-Path $Root "docs\OTG_REWORK_CHECKLIST.md"
$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$BackupDir = Join-Path $Root ".patch-backups\complete-description-patch3-$Stamp"

function Fail($Message) {
  Write-Host "[FAIL] $Message" -ForegroundColor Red
  exit 1
}

function Pass($Message) {
  Write-Host "[OK] $Message" -ForegroundColor Green
}

foreach ($path in @($PanelPath, $ComfyRoutePath, $ChecklistPath)) {
  if (-not (Test-Path -LiteralPath $path)) {
    Fail "Missing required file: $path"
  }
}

New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
Copy-Item -LiteralPath $PanelPath -Destination (Join-Path $BackupDir "AppPageClient.tsx.bak") -Force
Copy-Item -LiteralPath $ComfyRoutePath -Destination (Join-Path $BackupDir "comfy-route.ts.bak") -Force
Copy-Item -LiteralPath $ChecklistPath -Destination (Join-Path $BackupDir "OTG_REWORK_CHECKLIST.md.bak") -Force
Pass "Backed up files to $BackupDir"

$panel = Get-Content -LiteralPath $PanelPath -Raw
$comfy = Get-Content -LiteralPath $ComfyRoutePath -Raw
$checklist = Get-Content -LiteralPath $ChecklistPath -Raw

Set-Content -LiteralPath $PanelPath -Value $panel -Encoding utf8
Set-Content -LiteralPath $ComfyRoutePath -Value $comfy -Encoding utf8
Set-Content -LiteralPath $ChecklistPath -Value $checklist -Encoding utf8
Pass "Rewrote patched files"

$panel = Get-Content -LiteralPath $PanelPath -Raw
$comfy = Get-Content -LiteralPath $ComfyRoutePath -Raw
$checklist = Get-Content -LiteralPath $ChecklistPath -Raw

$panelMarkers = @(
  "CHARACTER CONTINUITY:",
  "injectCharacterContinuityPrompt",
  "selectedSceneCharacterIdentities",
  "Missing locked character description. Open Character Builder and click Complete Description, then Lock Description.",
  "Complete and lock the character description for each selected character before generating a multi-character scene.",
  "body.set(`"characterContinuityPrompt`"",
  "`"selectedCharacterIdentities`""
)

foreach ($marker in $panelMarkers) {
  if (-not $panel.Contains($marker)) {
    Fail "Missing AppPageClient marker: $marker"
  }
}

$comfyMarkers = @(
  "characterContinuityPrompt",
  "selectedCharacterIdentities",
  "promptReadyDescription"
)

foreach ($marker in $comfyMarkers) {
  if (-not $comfy.Contains($marker)) {
    Fail "Missing /api/comfy marker: $marker"
  }
}

if (-not $checklist.Contains("Complete Description Patch 3 injects locked prompt-ready character continuity blocks")) {
  Fail "Missing checklist Patch 3 marker"
}

Pass "Complete Description Patch 3 production continuity markers verified"
Write-Host "Run validation next:" -ForegroundColor Cyan
Write-Host "  npm run lint -- --quiet"
Write-Host "  npx tsc --noEmit --pretty false"
Write-Host "  npm test"
