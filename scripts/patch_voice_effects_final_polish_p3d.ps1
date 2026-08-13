$ErrorActionPreference = "Stop"

$Repo = "C:\AI\OTG-Test2"
$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$BackupRoot = Join-Path $Repo ".patch-backups\voice-effects-final-polish-p3d-$Stamp"

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

function Write-Utf8NoBom {
  param(
    [Parameter(Mandatory=$true)][string]$Path,
    [Parameter(Mandatory=$true)][string]$Content
  )
  $Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Content, $Utf8NoBom)
}

$PanelPath = Join-Path $Repo "app\app\components\CharactersPanel.tsx"
$ChecklistPath = Join-Path $Repo "docs\OTG_REWORK_CHECKLIST.md"

$text = Get-Content -LiteralPath $PanelPath -Raw

# ---------------------------------------------------------------------
# 1. Replace stale Patch 3B wording now that Pedalboard/SoX are active.
# ---------------------------------------------------------------------

$replacements = @{
  "Backend Patch 3B." = "Manual controls can override this preset when unlocked."
  "Pedalboard and SoX are installed targets for Patch 3B backend wiring." = "FFmpeg, Pedalboard, and SoX are active. Presets are locked unless manual controls are unlocked."
  "FFmpeg is active now. Pedalboard and SoX are installed targets for Patch 3B backend wiring." = "FFmpeg, Pedalboard, and SoX are active. Presets are locked unless manual controls are unlocked."
}

foreach ($old in $replacements.Keys) {
  $text = $text.Replace($old, $replacements[$old])
}

# ---------------------------------------------------------------------
# 2. Add Pedalboard manual reset button.
# ---------------------------------------------------------------------

if ($text -notmatch "OTG_VOICE_EFFECTS_P3D_PEDALBOARD_RESET") {
  $anchor = @'
                              <div className="mt-3 grid gap-3 md:grid-cols-2">
                                <label className="block text-xs text-zinc-300">Drive: {pedalboardManualControls.driveDb} dB<input type="range" min={0} max={40} step={1} value={pedalboardManualControls.driveDb} onChange={(event) => setPedalboardManualControl("driveDb", Number(event.target.value))} className="mt-1 w-full accent-fuchsia-300" /></label>
'@

  $idx = $text.IndexOf($anchor)
  if ($idx -lt 0) {
    throw "Could not find Pedalboard manual controls grid anchor."
  }

  $gridEnd = $text.IndexOf("                              </div>", $idx)
  if ($gridEnd -lt 0) {
    throw "Could not find Pedalboard manual controls grid end."
  }

  $insertAt = $gridEnd + "                              </div>".Length

  $reset = @'

                              <button
                                type="button"
                                onClick={() => setPedalboardManualControls({
                                  driveDb: 0,
                                  phaserRate: 0,
                                  phaserDepth: 0,
                                  chorusRate: 0,
                                  chorusDepth: 0,
                                  delayMs: 0,
                                  delayFeedback: 0,
                                  delayMix: 0,
                                  reverbRoomSize: 0,
                                  reverbWet: 0,
                                  pitchSemitones: 0,
                                  highpassHz: 80,
                                  lowpassHz: 12000,
                                  compression: 30,
                                  gainDb: 0,
                                })}
                                className="mt-3 rounded-xl border border-zinc-700 px-3 py-1.5 text-xs font-semibold text-zinc-100 hover:border-zinc-500"
                              >
                                Reset Pedalboard Manual Controls
                              </button>
                              {/* OTG_VOICE_EFFECTS_P3D_PEDALBOARD_RESET */}
'@

  $text = $text.Insert($insertAt, $reset)
}

# ---------------------------------------------------------------------
# 3. Add SoX manual reset button.
# ---------------------------------------------------------------------

if ($text -notmatch "OTG_VOICE_EFFECTS_P3D_SOX_RESET") {
  $anchor = @'
                              <label className="mt-3 flex items-center gap-2 text-xs text-orange-100/80">
                                <input type="checkbox" checked={soxManualControls.normalize} onChange={(event) => setSoxManualControl("normalize", event.target.checked)} />
                                Normalize output
                              </label>
'@

  $idx = $text.IndexOf($anchor)
  if ($idx -lt 0) {
    throw "Could not find SoX normalize checkbox anchor."
  }

  $insertAt = $idx + $anchor.Length

  $reset = @'

                              <button
                                type="button"
                                onClick={() => setSoxManualControls({
                                  pitchCents: 0,
                                  tempo: 1,
                                  overdriveGain: 0,
                                  overdriveColour: 20,
                                  echoDelayMs: 0,
                                  echoDecay: 0,
                                  highpassHz: 80,
                                  lowpassHz: 12000,
                                  chorusDelayMs: 0,
                                  chorusDecay: 0,
                                  bassDb: 0,
                                  trebleDb: 0,
                                  gainDb: 0,
                                  normalize: true,
                                })}
                                className="mt-3 rounded-xl border border-zinc-700 px-3 py-1.5 text-xs font-semibold text-zinc-100 hover:border-zinc-500"
                              >
                                Reset SoX Manual Controls
                              </button>
                              {/* OTG_VOICE_EFFECTS_P3D_SOX_RESET */}
'@

  $text = $text.Insert($insertAt, $reset)
}

# ---------------------------------------------------------------------
# 4. Add small finalization marker to Advanced FX explanatory text.
# ---------------------------------------------------------------------

if ($text -notmatch "OTG_VOICE_EFFECTS_P3D_FINAL_POLISH") {
  $text = $text.Replace(
    "Presets are locked unless manual controls are unlocked.",
    "Presets are locked unless manual controls are unlocked. OTG_VOICE_EFFECTS_P3D_FINAL_POLISH"
  )
}

Write-Utf8NoBom -Path $PanelPath -Content $text

# ---------------------------------------------------------------------
# 5. Checklist update.
# ---------------------------------------------------------------------

if (Test-Path -LiteralPath $ChecklistPath) {
  $Checklist = Get-Content -LiteralPath $ChecklistPath -Raw
  $Marker = "Voice Effects Final Polish Patch 3D"
  if ($Checklist -notmatch [regex]::Escape($Marker)) {
    Add-Content -LiteralPath $ChecklistPath -Value "`r`n- [x] ${Marker}: removed stale backend-pending wording, added Pedalboard/SoX manual reset buttons, and marked Voice Effects functional implementation complete pending runtime spot-checks.`r`n" -Encoding UTF8
  }
}

# ---------------------------------------------------------------------
# 6. Verification.
# ---------------------------------------------------------------------

$fileText = Get-Content -LiteralPath $PanelPath -Raw

$checks = @(
  "OTG_VOICE_EFFECTS_P3D_FINAL_POLISH",
  "OTG_VOICE_EFFECTS_P3D_PEDALBOARD_RESET",
  "OTG_VOICE_EFFECTS_P3D_SOX_RESET",
  "Reset Pedalboard Manual Controls",
  "Reset SoX Manual Controls",
  "FFmpeg, Pedalboard, and SoX are active"
)

foreach ($check in $checks) {
  if ($fileText -notmatch [regex]::Escape($check)) {
    throw "Verification failed. Missing marker: $check"
  }
}

if ($fileText -match [regex]::Escape("Backend Patch 3B.")) {
  throw "Verification failed. Stale Backend Patch 3B wording still exists."
}

Write-Host ""
Write-Host "SUCCESS"
Write-Host "Voice Effects final polish Patch 3D installed."
Write-Host "Backup: $BackupRoot"
Write-Host ""
Write-Host "Next validation:"
Write-Host "  npx tsc --noEmit --pretty false"
Write-Host "  npm run lint -- --quiet"
Write-Host "  npm test -- --reporter=verbose"