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
  $routePath = Join-Path $repo "app\api\characters\voice-sample\process\route.ts"
  $fileRoutePath = Join-Path $repo "app\api\characters\voice-sample\file\route.ts"
  $panelPath = Join-Path $repo "app\app\components\CharactersPanel.tsx"
  $checklistPath = Join-Path $repo "docs\OTG_REWORK_CHECKLIST.md"

  $paths = @($routePath, $fileRoutePath, $panelPath, $checklistPath)
  foreach ($path in $paths) {
    if (-not (Test-Path -LiteralPath $path)) { throw "Required file missing: $path" }
  }

  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $backupDir = Join-Path $repo ".patch-backups\ltx-voice-audio-post-processing-p3-$stamp"
  New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
  foreach ($path in $paths) {
    Copy-Item -LiteralPath $path -Destination (Join-Path $backupDir (Split-Path -Leaf $path)) -Force
  }
  Ok "Backed up files to $backupDir"

  $routeText = Get-Content -LiteralPath $routePath -Raw
  RequireContains $routeText "OTG_LTX_AUDIO_POST_PROCESSING" "process route marker"
  RequireContains $routeText "processLtxVoiceAudio" "processLtxVoiceAudio"
  RequireContains $routeText "remove_background" "remove background action"
  RequireContains $routeText "enhance_voice" "enhance voice action"
  RequireContains $routeText "samplePath must be under the project data folder." "data-root path guard"
  RequireContains $routeText "updateVoicePipelineJob" "job result persistence"
  WriteUtf8NoBom $routePath $routeText

  $fileRouteText = Get-Content -LiteralPath $fileRoutePath -Raw
  RequireContains $fileRouteText "ltx-voice-isolated.wav" "isolated sample file allowlist"
  RequireContains $fileRouteText "ltx-voice-enhanced.wav" "enhanced sample file allowlist"
  WriteUtf8NoBom $fileRoutePath $fileRouteText

  $panelText = Get-Content -LiteralPath $panelPath -Raw
  RequireContains $panelText "OTG_LTX_AUDIO_POST_PROCESSING" "panel marker"
  RequireContains $panelText "removeLtxBackgroundSoundEffects" "removeLtxBackgroundSoundEffects"
  RequireContains $panelText "enhanceLtxVoice" "enhanceLtxVoice"
  RequireContains $panelText "Remove Background Sound / Effects" "remove button"
  RequireContains $panelText "Enhanced Voice" "enhanced player"
  WriteUtf8NoBom $panelPath $panelText

  $checklist = Get-Content -LiteralPath $checklistPath -Raw
  $done = "- [x] LTX Voice Design Patch 3 TEST only: LTX audio samples now expose Remove Background Sound / Effects and Enhance Voice post-processing actions, save isolated/enhanced audio beside the original sample, keep the original playable, and preserve audio-only UI behavior."
  if (-not $checklist.Contains($done)) {
    $pending = "- [ ] LTX Voice Design Patch 3 TEST only: add background sound/effects cleanup and Enhance Voice flow after LTX audio generation."
    if ($checklist.Contains($pending)) {
      $checklist = $checklist.Replace($pending, $done)
    } else {
      $checklist = $checklist.TrimEnd() + "`r`n" + $done + "`r`n"
    }
  }
  [System.IO.File]::WriteAllText($checklistPath, $checklist, [System.Text.UTF8Encoding]::new($true))

  Ok "LTX Voice Patch 3 post-processing markers verified"
}
catch {
  Fail $_.Exception.Message
  exit 1
}
