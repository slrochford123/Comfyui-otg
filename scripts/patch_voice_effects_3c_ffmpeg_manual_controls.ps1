$ErrorActionPreference = "Stop"

$Repo = "C:\AI\OTG-Test2"
$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$BackupRoot = Join-Path $Repo ".patch-backups\voice-effects-3c-ffmpeg-manual-$Stamp"

$Files = @(
  "app\api\characters\voice-sample\effect\route.ts",
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

$RoutePath = Join-Path $Repo "app\api\characters\voice-sample\effect\route.ts"
$PanelPath = Join-Path $Repo "app\app\components\CharactersPanel.tsx"
$ChecklistPath = Join-Path $Repo "docs\OTG_REWORK_CHECKLIST.md"

# ---------------------------------------------------------------------
# 1. Backend: custom FFmpeg control support.
# ---------------------------------------------------------------------

$route = Get-Content -LiteralPath $RoutePath -Raw

if ($route -notmatch "OTG_VOICE_EFFECTS_3C_FFMPEG_MANUAL_CONTROLS") {
  $anchor = "function ffmpegArgs(inputPath: string, outputPath: string, filter: string) {"
  $idx = $route.IndexOf($anchor)
  if ($idx -lt 0) {
    throw "Could not find ffmpegArgs anchor."
  }

  $backendBlock = @'
/* OTG_VOICE_EFFECTS_3C_FFMPEG_MANUAL_CONTROLS */
function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, numeric));
}

function atempoChain(factor: number) {
  const parts: string[] = [];
  let remaining = factor;

  while (remaining > 2) {
    parts.push("atempo=2");
    remaining /= 2;
  }

  while (remaining < 0.5) {
    parts.push("atempo=0.5");
    remaining /= 0.5;
  }

  parts.push(`atempo=${remaining.toFixed(6)}`);
  return parts;
}

function buildCustomFfmpegFilter(rawControls: unknown) {
  if (!rawControls || typeof rawControls !== "object" || Array.isArray(rawControls)) return "";

  const controls = rawControls as Record<string, unknown>;
  const parts: string[] = [];

  const pitchSemitones = clampNumber(controls.pitchSemitones, -12, 12, 0);
  const grit = clampNumber(controls.grit, 0, 100, 0);
  const echoDelayMs = clampNumber(controls.echoDelayMs, 0, 900, 0);
  const echoDecay = clampNumber(controls.echoDecay, 0, 0.9, 0);
  const tremoloRate = clampNumber(controls.tremoloRate, 0, 40, 0);
  const tremoloDepth = clampNumber(controls.tremoloDepth, 0, 1, 0);
  const vibratoRate = clampNumber(controls.vibratoRate, 0, 15, 0);
  const vibratoDepth = clampNumber(controls.vibratoDepth, 0, 1, 0);
  const chorusMix = clampNumber(controls.chorusMix, 0, 1, 0);
  const highpassHz = clampNumber(controls.highpassHz, 20, 1200, 80);
  const lowpassHz = clampNumber(controls.lowpassHz, 1200, 20000, 12000);
  const gainDb = clampNumber(controls.gainDb, -12, 12, 0);
  const compression = clampNumber(controls.compression, 0, 100, 30);

  if (Math.abs(pitchSemitones) >= 0.05) {
    const rateFactor = Math.pow(2, pitchSemitones / 12);
    const inverseTempo = 1 / rateFactor;
    parts.push(`asetrate=48000*${rateFactor.toFixed(6)}`);
    parts.push("aresample=48000");
    parts.push(...atempoChain(inverseTempo));
  }

  if (highpassHz > 20) parts.push(`highpass=f=${Math.round(highpassHz)}`);
  if (lowpassHz < 20000) parts.push(`lowpass=f=${Math.round(lowpassHz)}`);

  if (grit > 0) {
    const bits = Math.round(16 - (grit / 100) * 10);
    const mix = Math.min(0.65, grit / 130).toFixed(3);
    parts.push(`acrusher=bits=${bits}:mix=${mix}`);
  }

  if (echoDelayMs > 0 && echoDecay > 0) {
    const decay = echoDecay.toFixed(3);
    parts.push(`aecho=0.8:0.45:${Math.round(echoDelayMs)}:${decay}`);
  }

  if (tremoloRate > 0 && tremoloDepth > 0) {
    parts.push(`tremolo=f=${tremoloRate.toFixed(3)}:d=${tremoloDepth.toFixed(3)}`);
  }

  if (vibratoRate > 0 && vibratoDepth > 0) {
    parts.push(`vibrato=f=${vibratoRate.toFixed(3)}:d=${vibratoDepth.toFixed(3)}`);
  }

  if (chorusMix > 0) {
    const mix = chorusMix.toFixed(3);
    parts.push(`chorus=0.45:0.65:40|55:0.22|0.18:${mix}|${mix}:1.4|1.8`);
  }

  if (compression > 0) {
    const ratio = (1.5 + (compression / 100) * 3.5).toFixed(2);
    parts.push(`acompressor=threshold=0.14:ratio=${ratio}`);
  }

  if (Math.abs(gainDb) >= 0.1) {
    parts.push(`volume=${gainDb.toFixed(2)}dB`);
  }

  parts.push("loudnorm=I=-16:TP=-1.5:LRA=10");
  return parts.join(",");
}

'@

  $route = $route.Insert($idx, $backendBlock)

  $oldValidation = @'
    const filter = preset?.filterByIntensity[intensity] || "";

    if (engine === "ffmpeg" && !filter) return jsonError("Voice effect preset has no filter for this intensity.", 500);
'@

  $newValidation = @'
    const filter = preset?.filterByIntensity[intensity] || "";
    const customFfmpegFilter = engine === "ffmpeg" ? buildCustomFfmpegFilter(body.controls || body.customControls) : "";
    const effectiveFilter = customFfmpegFilter || filter;

    if (engine === "ffmpeg" && !effectiveFilter) return jsonError("Voice effect preset has no filter for this intensity.", 500);
'@

  if ($route.IndexOf($oldValidation) -lt 0) {
    throw "Could not find FFmpeg filter validation block."
  }

  $route = $route.Replace($oldValidation, $newValidation)

  $oldFilterUse = @'
              filter,
'@

  $newFilterUse = @'
              filter: effectiveFilter,
'@

  if ($route.IndexOf($oldFilterUse) -lt 0) {
    throw "Could not find processVoiceEffect filter argument."
  }

  $route = $route.Replace($oldFilterUse, $newFilterUse)

  # Improve log to show custom/manual control usage.
  $route = $route.Replace(
    'engine: method.engine,',
    'engine: method.engine, customControls: Boolean(customFfmpegFilter),'
  )

  Write-Utf8NoBom -Path $RoutePath -Content $route
}

# ---------------------------------------------------------------------
# 2. Frontend: FFmpeg manual controls state + payload.
# ---------------------------------------------------------------------

$panel = Get-Content -LiteralPath $PanelPath -Raw

if ($panel -notmatch "OTG_VOICE_EFFECTS_3C_FFMPEG_MANUAL_STATE") {
  $anchor = 'const [ffmpegControlsUnlocked, setFfmpegControlsUnlocked] = useState(false);'
  $idx = $panel.IndexOf($anchor)
  if ($idx -lt 0) {
    throw "Could not find ffmpegControlsUnlocked state anchor."
  }

  $insertAt = $idx + $anchor.Length

  $stateBlock = @'

  // OTG_VOICE_EFFECTS_3C_FFMPEG_MANUAL_STATE
  const [ffmpegManualControls, setFfmpegManualControls] = useState({
    pitchSemitones: 0,
    grit: 0,
    echoDelayMs: 0,
    echoDecay: 0,
    tremoloRate: 0,
    tremoloDepth: 0,
    vibratoRate: 0,
    vibratoDepth: 0,
    chorusMix: 0,
    highpassHz: 80,
    lowpassHz: 12000,
    compression: 30,
    gainDb: 0,
  });

  function setFfmpegManualControl(key: keyof typeof ffmpegManualControls, value: number) {
    setFfmpegManualControls((current) => ({
      ...current,
      [key]: value,
    }));
  }
'@

  $panel = $panel.Insert($insertAt, $stateBlock)
}

# Add controls arg to helper signature.
$panel = $panel.Replace(
'    label: string;
    sourcePath?: string;',
'    label: string;
    sourcePath?: string;
    controls?: Record<string, unknown>;'
)

# Add controls to request body.
$oldBody = @'
          samplePath: inputPath,
          characterId: safeId(details.name || builderCharacterVoiceProfile?.characterId || "character"),
          jobId,
'@

$newBody = @'
          samplePath: inputPath,
          characterId: safeId(details.name || builderCharacterVoiceProfile?.characterId || "character"),
          jobId,
          controls: args.controls,
'@

if ($panel.IndexOf($oldBody) -lt 0) {
  throw "Could not find effect request body block."
}

$panel = $panel.Replace($oldBody, $newBody)

# Insert FFmpeg manual controls UI.
if ($panel -notmatch "OTG_VOICE_EFFECTS_3C_FFMPEG_MANUAL_UI") {
  $anchor = @'
                          <button
                            type="button"
                            onClick={() => void applyVoiceFxPageEffect({
                              effectId: ffmpegAdvancedPresetId,
                              intensity: voiceEffectIntensity,
                              label: `FFmpeg: ${ffmpegAdvancedVoiceOptions.find((option) => option.id === ffmpegAdvancedPresetId)?.label || ffmpegAdvancedPresetId}`,
                            })}
'@

  $idx = $panel.IndexOf($anchor)
  if ($idx -lt 0) {
    throw "Could not find FFmpeg Apply button anchor."
  }

  $manualUi = @'
                          {ffmpegControlsUnlocked ? (
                            <div className="mt-3 rounded-xl border border-cyan-400/20 bg-black/20 p-3">
                              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-100">Manual FFmpeg Controls</p>
                              <p className="mt-1 text-xs text-zinc-400">These values override the locked preset for this FFmpeg effect only.</p>

                              <div className="mt-3 grid gap-3 md:grid-cols-2">
                                <label className="block text-xs text-zinc-300">
                                  Pitch: {ffmpegManualControls.pitchSemitones} semitones
                                  <input type="range" min={-12} max={12} step={1} value={ffmpegManualControls.pitchSemitones} onChange={(event) => setFfmpegManualControl("pitchSemitones", Number(event.target.value))} className="mt-1 w-full accent-cyan-300" />
                                </label>
                                <label className="block text-xs text-zinc-300">
                                  Grit / Distortion: {ffmpegManualControls.grit}%
                                  <input type="range" min={0} max={100} step={1} value={ffmpegManualControls.grit} onChange={(event) => setFfmpegManualControl("grit", Number(event.target.value))} className="mt-1 w-full accent-cyan-300" />
                                </label>
                                <label className="block text-xs text-zinc-300">
                                  Echo Delay: {ffmpegManualControls.echoDelayMs} ms
                                  <input type="range" min={0} max={900} step={10} value={ffmpegManualControls.echoDelayMs} onChange={(event) => setFfmpegManualControl("echoDelayMs", Number(event.target.value))} className="mt-1 w-full accent-cyan-300" />
                                </label>
                                <label className="block text-xs text-zinc-300">
                                  Echo Decay: {ffmpegManualControls.echoDecay.toFixed(2)}
                                  <input type="range" min={0} max={0.9} step={0.05} value={ffmpegManualControls.echoDecay} onChange={(event) => setFfmpegManualControl("echoDecay", Number(event.target.value))} className="mt-1 w-full accent-cyan-300" />
                                </label>
                                <label className="block text-xs text-zinc-300">
                                  Tremolo Rate: {ffmpegManualControls.tremoloRate}
                                  <input type="range" min={0} max={40} step={1} value={ffmpegManualControls.tremoloRate} onChange={(event) => setFfmpegManualControl("tremoloRate", Number(event.target.value))} className="mt-1 w-full accent-cyan-300" />
                                </label>
                                <label className="block text-xs text-zinc-300">
                                  Tremolo Depth: {ffmpegManualControls.tremoloDepth.toFixed(2)}
                                  <input type="range" min={0} max={1} step={0.05} value={ffmpegManualControls.tremoloDepth} onChange={(event) => setFfmpegManualControl("tremoloDepth", Number(event.target.value))} className="mt-1 w-full accent-cyan-300" />
                                </label>
                                <label className="block text-xs text-zinc-300">
                                  Vibrato Rate: {ffmpegManualControls.vibratoRate}
                                  <input type="range" min={0} max={15} step={0.5} value={ffmpegManualControls.vibratoRate} onChange={(event) => setFfmpegManualControl("vibratoRate", Number(event.target.value))} className="mt-1 w-full accent-cyan-300" />
                                </label>
                                <label className="block text-xs text-zinc-300">
                                  Vibrato Depth: {ffmpegManualControls.vibratoDepth.toFixed(2)}
                                  <input type="range" min={0} max={1} step={0.05} value={ffmpegManualControls.vibratoDepth} onChange={(event) => setFfmpegManualControl("vibratoDepth", Number(event.target.value))} className="mt-1 w-full accent-cyan-300" />
                                </label>
                                <label className="block text-xs text-zinc-300">
                                  Chorus Mix: {ffmpegManualControls.chorusMix.toFixed(2)}
                                  <input type="range" min={0} max={1} step={0.05} value={ffmpegManualControls.chorusMix} onChange={(event) => setFfmpegManualControl("chorusMix", Number(event.target.value))} className="mt-1 w-full accent-cyan-300" />
                                </label>
                                <label className="block text-xs text-zinc-300">
                                  Highpass: {ffmpegManualControls.highpassHz} Hz
                                  <input type="range" min={20} max={1200} step={10} value={ffmpegManualControls.highpassHz} onChange={(event) => setFfmpegManualControl("highpassHz", Number(event.target.value))} className="mt-1 w-full accent-cyan-300" />
                                </label>
                                <label className="block text-xs text-zinc-300">
                                  Lowpass: {ffmpegManualControls.lowpassHz} Hz
                                  <input type="range" min={1200} max={20000} step={100} value={ffmpegManualControls.lowpassHz} onChange={(event) => setFfmpegManualControl("lowpassHz", Number(event.target.value))} className="mt-1 w-full accent-cyan-300" />
                                </label>
                                <label className="block text-xs text-zinc-300">
                                  Compression: {ffmpegManualControls.compression}%
                                  <input type="range" min={0} max={100} step={1} value={ffmpegManualControls.compression} onChange={(event) => setFfmpegManualControl("compression", Number(event.target.value))} className="mt-1 w-full accent-cyan-300" />
                                </label>
                                <label className="block text-xs text-zinc-300">
                                  Gain: {ffmpegManualControls.gainDb} dB
                                  <input type="range" min={-12} max={12} step={1} value={ffmpegManualControls.gainDb} onChange={(event) => setFfmpegManualControl("gainDb", Number(event.target.value))} className="mt-1 w-full accent-cyan-300" />
                                </label>
                              </div>

                              <button
                                type="button"
                                onClick={() => setFfmpegManualControls({
                                  pitchSemitones: 0,
                                  grit: 0,
                                  echoDelayMs: 0,
                                  echoDecay: 0,
                                  tremoloRate: 0,
                                  tremoloDepth: 0,
                                  vibratoRate: 0,
                                  vibratoDepth: 0,
                                  chorusMix: 0,
                                  highpassHz: 80,
                                  lowpassHz: 12000,
                                  compression: 30,
                                  gainDb: 0,
                                })}
                                className="mt-3 rounded-xl border border-zinc-700 px-3 py-1.5 text-xs font-semibold text-zinc-100 hover:border-zinc-500"
                              >
                                Reset Manual Controls
                              </button>
                            </div>
                          ) : null}

'@

  $panel = $panel.Insert($idx, $manualUi)
}

# Add controls to FFmpeg apply call.
$oldApply = @'
                              label: `FFmpeg: ${ffmpegAdvancedVoiceOptions.find((option) => option.id === ffmpegAdvancedPresetId)?.label || ffmpegAdvancedPresetId}`,
                            })}
'@

$newApply = @'
                              label: `FFmpeg: ${ffmpegAdvancedVoiceOptions.find((option) => option.id === ffmpegAdvancedPresetId)?.label || ffmpegAdvancedPresetId}`,
                              controls: ffmpegControlsUnlocked ? ffmpegManualControls : undefined,
                            })}
'@

if ($panel.IndexOf($oldApply) -lt 0) {
  throw "Could not find FFmpeg apply call payload."
}

$panel = $panel.Replace($oldApply, $newApply)

# Add stack warning inside Applied Effect Chain block if not present.
if ($panel -notmatch "OTG_VOICE_EFFECTS_3C_STACK_WARNING") {
  $chainAnchor = @'
                          <ol className="mt-3 list-decimal space-y-2 pl-5 text-xs text-emerald-100/80">
'@
  $idx = $panel.IndexOf($chainAnchor)
  if ($idx -lt 0) {
    throw "Could not find Applied Effect Chain list anchor."
  }

  $warning = @'
                          {voiceEffectChainByJob[getVoiceFxPageJobId()].length >= 3 ? (
                            <p className="mt-2 rounded-lg border border-amber-400/30 bg-amber-400/10 p-2 text-xs text-amber-100">
                              OTG_VOICE_EFFECTS_3C_STACK_WARNING: This chain has 3 or more effects. Stacking too many effects can make the voice noisy, clipped, or unusable. Reset to base if quality drops.
                            </p>
                          ) : null}

'@

  $panel = $panel.Insert($idx, $warning)
}

Write-Utf8NoBom -Path $PanelPath -Content $panel

# ---------------------------------------------------------------------
# 3. Checklist.
# ---------------------------------------------------------------------

if (Test-Path -LiteralPath $ChecklistPath) {
  $Checklist = Get-Content -LiteralPath $ChecklistPath -Raw
  $Marker = "Voice Effects Patch 3C-1"
  if ($Checklist -notmatch [regex]::Escape($Marker)) {
    Add-Content -LiteralPath $ChecklistPath -Value "`r`n- [x] ${Marker}: added unlocked editable FFmpeg manual controls, custom FFmpeg filter payload support, and chain stacking warning. Pedalboard/SoX manual controls remain pending.`r`n" -Encoding UTF8
  }
}

# ---------------------------------------------------------------------
# 4. Verification.
# ---------------------------------------------------------------------

$routeText = Get-Content -LiteralPath $RoutePath -Raw
$panelText = Get-Content -LiteralPath $PanelPath -Raw

$checks = @(
  @{ Text = $routeText; Pattern = "OTG_VOICE_EFFECTS_3C_FFMPEG_MANUAL_CONTROLS" },
  @{ Text = $routeText; Pattern = "buildCustomFfmpegFilter" },
  @{ Text = $routeText; Pattern = "effectiveFilter" },
  @{ Text = $panelText; Pattern = "OTG_VOICE_EFFECTS_3C_FFMPEG_MANUAL_STATE" },
  @{ Text = $panelText; Pattern = "OTG_VOICE_EFFECTS_3C_FFMPEG_MANUAL_UI" },
  @{ Text = $panelText; Pattern = "Manual FFmpeg Controls" },
  @{ Text = $panelText; Pattern = "controls: ffmpegControlsUnlocked ? ffmpegManualControls : undefined" },
  @{ Text = $panelText; Pattern = "OTG_VOICE_EFFECTS_3C_STACK_WARNING" }
)

foreach ($check in $checks) {
  if ($check.Text -notmatch [regex]::Escape($check.Pattern)) {
    throw "Verification failed. Missing marker: $($check.Pattern)"
  }
}

Write-Host ""
Write-Host "SUCCESS"
Write-Host "Voice Effects Patch 3C-1 FFmpeg manual controls installed."
Write-Host "Backup: $BackupRoot"
Write-Host ""
Write-Host "Next validation:"
Write-Host "  npm run lint -- --quiet"
Write-Host "  npx tsc --noEmit --pretty false"
Write-Host "  npm test"