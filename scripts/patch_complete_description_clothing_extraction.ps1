$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$RoutePath = Join-Path $Root "app\api\vision-prompt\route.ts"
$PanelPath = Join-Path $Root "app\app\components\CharactersPanel.tsx"
$ChecklistPath = Join-Path $Root "docs\OTG_REWORK_CHECKLIST.md"
$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$BackupDir = Join-Path $Root ".patch-backups\complete-description-clothing-$Stamp"

function Fail($Message) {
  Write-Host "[FAIL] $Message" -ForegroundColor Red
  exit 1
}

function Pass($Message) {
  Write-Host "[OK] $Message" -ForegroundColor Green
}

foreach ($path in @($RoutePath, $PanelPath, $ChecklistPath)) {
  if (-not (Test-Path -LiteralPath $path)) {
    Fail "Missing required file: $path"
  }
}

New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
Copy-Item -LiteralPath $RoutePath -Destination (Join-Path $BackupDir "vision-prompt-route.ts.bak") -Force
Copy-Item -LiteralPath $PanelPath -Destination (Join-Path $BackupDir "CharactersPanel.tsx.bak") -Force
Copy-Item -LiteralPath $ChecklistPath -Destination (Join-Path $BackupDir "OTG_REWORK_CHECKLIST.md.bak") -Force
Pass "Backed up files to $BackupDir"

$route = Get-Content -LiteralPath $RoutePath -Raw
$panel = Get-Content -LiteralPath $PanelPath -Raw
$checklist = Get-Content -LiteralPath $ChecklistPath -Raw

Set-Content -LiteralPath $RoutePath -Value $route -Encoding utf8
Set-Content -LiteralPath $PanelPath -Value $panel -Encoding utf8
Set-Content -LiteralPath $ChecklistPath -Value $checklist -Encoding utf8
Pass "Rewrote patched files"

$route = Get-Content -LiteralPath $RoutePath -Raw
$panel = Get-Content -LiteralPath $PanelPath -Raw
$checklist = Get-Content -LiteralPath $ChecklistPath -Raw

$routeMarkers = @(
  "OTG_COMPLETE_DESCRIPTION_CLOTHING_EXTRACTION",
  "Treat character sheets or multi-view images as one character reference.",
  "Do not put name, species, gender, height, build, pose, expression, anatomy, or personality into clothingAccessories.",
  "If clothing is visible on a standard humanoid character, clothingAccessories must not be blank.",
  "j?.clothingAccessories",
  "j?.distinctiveFeatures ?? j?.distinctive_features"
)

foreach ($marker in $routeMarkers) {
  if (-not $route.Contains($marker)) {
    Fail "Missing vision route marker: $marker"
  }
}

$panelMarkers = @(
  "sanitizeClothingAccessoriesInput",
  "buildCompleteDescriptionIdentity",
  "buildPromptReadyCharacterDescription",
  "CLOTHING_ACCESSORY_NOUNS",
  "manualClothing.clothingAccessories || providerClothing",
  "wears ${args.clothingAccessories}",
  "doNotChange: cappedDoNotChange"
)

foreach ($marker in $panelMarkers) {
  if (-not $panel.Contains($marker)) {
    Fail "Missing CharactersPanel marker: $marker"
  }
}

if (-not $checklist.Contains("Complete Description clothing extraction now separates descriptor-like manual text")) {
  Fail "Missing checklist marker"
}

Pass "Complete Description clothing extraction markers verified"
Write-Host "Run validation next:" -ForegroundColor Cyan
Write-Host "  npm run lint -- --quiet"
Write-Host "  npx tsc --noEmit --pretty false"
Write-Host "  npm test"
