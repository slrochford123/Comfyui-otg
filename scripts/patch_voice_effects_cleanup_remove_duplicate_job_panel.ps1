$ErrorActionPreference = "Stop"

$Repo = "C:\AI\OTG-Test2"
$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$BackupRoot = Join-Path $Repo ".patch-backups\voice-effects-cleanup-duplicate-job-panel-$Stamp"

$Files = @(
  "app\app\components\CharactersPanel.tsx",
  "docs\OTG_REWORK_CHECKLIST.md"
)

Write-Host "Creating backup: $BackupRoot"
New-Item -ItemType Directory -Force -Path $BackupRoot | Out-Null

foreach ($rel in $Files) {
  $src = Join-Path $Repo $rel
  if (Test-Path -LiteralPath $src) {
    $dst = Join-Path $BackupRoot $rel
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $dst) | Out-Null
    Copy-Item -LiteralPath $src -Destination $dst -Force
    Write-Host "Backed up: $rel"
  }
}

$PanelPath = Join-Path $Repo "app\app\components\CharactersPanel.tsx"
$ChecklistPath = Join-Path $Repo "docs\OTG_REWORK_CHECKLIST.md"

$text = Get-Content -LiteralPath $PanelPath -Raw

$duplicatePhrase = "Start from the base voice, apply simple pitch/echo, then optionally stack advanced effects. The original audio is never overwritten."
$phraseIndex = $text.IndexOf($duplicatePhrase)

if ($phraseIndex -ge 0) {
  $startMarker = '                {isVoiceEffectEligible ? ('
  $endMarker = '                {resultEntries.length ? ('

  $start = $text.LastIndexOf($startMarker, $phraseIndex)
  if ($start -lt 0) {
    throw "Could not find duplicate completed-job Voice Effects block start."
  }

  $end = $text.IndexOf($endMarker, $phraseIndex)
  if ($end -lt 0) {
    throw "Could not find duplicate completed-job Voice Effects block end."
  }

  $text = $text.Remove($start, $end - $start)

  Write-Host "Removed duplicate completed-job Voice Effects panel."
} else {
  Write-Host "Duplicate completed-job Voice Effects panel was already removed."
}

# Write file.
[System.IO.File]::WriteAllText(
  $PanelPath,
  $text,
  (New-Object System.Text.UTF8Encoding($false))
)

# Checklist update.
if (Test-Path -LiteralPath $ChecklistPath) {
  $checklist = Get-Content -LiteralPath $ChecklistPath -Raw
  $marker = "Voice Effects Cleanup Duplicate Job Panel"
  if ($checklist -notmatch [regex]::Escape($marker)) {
    Add-Content -LiteralPath $ChecklistPath -Value "`r`n- [x] ${marker}: removed the temporary duplicate Voice Effects UI from completed job cards; the real Step 2 Voice Effects page remains the only active effects interface.`r`n" -Encoding UTF8
  }
}

# Verification.
$fileText = Get-Content -LiteralPath $PanelPath -Raw

if ($fileText -match [regex]::Escape($duplicatePhrase)) {
  throw "Verification failed. Duplicate completed-job Voice Effects panel text still exists."
}

$requiredRealPageMarkers = @(
  "Fast controls only: pitch and echo",
  "Add FFmpeg Effect",
  "Add Pedalboard Effect",
  "Add SoX Effect",
  "Applied Effect Chain",
  "Use This Version"
)

foreach ($marker in $requiredRealPageMarkers) {
  if ($fileText -notmatch [regex]::Escape($marker)) {
    throw "Verification failed. Real Voice FX page marker missing: $marker"
  }
}

Write-Host ""
Write-Host "SUCCESS"
Write-Host "Voice Effects cleanup patch installed."
Write-Host "Backup: $BackupRoot"
Write-Host ""
Write-Host "Next validation:"
Write-Host "  npm run lint -- --quiet"
Write-Host "  npx tsc --noEmit --pretty false"
Write-Host "  npm test"