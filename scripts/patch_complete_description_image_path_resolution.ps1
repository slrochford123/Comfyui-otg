$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$RoutePath = Join-Path $Root "app\api\vision-prompt\route.ts"
$PanelPath = Join-Path $Root "app\app\components\CharactersPanel.tsx"
$ChecklistPath = Join-Path $Root "docs\OTG_REWORK_CHECKLIST.md"
$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$BackupDir = Join-Path $Root ".patch-backups\complete-description-image-path-$Stamp"

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
  "normalizeVisionImagePath",
  "api_file_url",
  "remote URLs are not allowed",
  "outside allowed project data roots",
  "Complete Description image is not readable from an allowed project data folder.",
  "[CompleteDescription] image_path_resolved",
  "[CompleteDescription] image_path_rejected"
)

foreach ($marker in $routeMarkers) {
  if (-not $route.Contains($marker)) {
    Fail "Missing vision route marker: $marker"
  }
}

$panelMarkers = @(
  "apiFileUrlFallback",
  ".startsWith(`"/api/file?path=`")",
  "selectedFullBody?.serverPath || characterCard?.serverPath || uploadedImage?.serverPath || apiFileUrlFallback"
)

foreach ($marker in $panelMarkers) {
  if (-not $panel.Contains($marker)) {
    Fail "Missing CharactersPanel marker: $marker"
  }
}

if (-not $checklist.Contains("Complete Description path resolution now accepts safe project data paths")) {
  Fail "Missing checklist marker"
}

Pass "Complete Description image path resolution markers verified"
Write-Host "Run validation next:" -ForegroundColor Cyan
Write-Host "  npm run lint -- --quiet"
Write-Host "  npx tsc --noEmit --pretty false"
Write-Host "  npm test"
