$ErrorActionPreference = "Stop"

$Repo = "C:\AI\OTG-Test2"
$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$BackupRoot = Join-Path $Repo ".patch-backups\voice-effects-rework-p3a-fxpage-$Stamp"

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

if ($text -notmatch "OTG_VOICE_EFFECTS_REWORK_P3A_STATE") {
  throw "Missing Patch 3A state. Run/repair patch_voice_effects_rework_p3a.ps1 first."
}

if ($text -notmatch "OTG_VOICE_EFFECTS_REWORK_P3A_OPTIONS") {
  throw "Missing Patch 3A option constants. Run/repair patch_voice_effects_rework_p3a.ps1 first."
}

# ---------------------------------------------------------------------
# 1. Add real Voice FX page helper functions.
# ---------------------------------------------------------------------

if ($text -notmatch "OTG_VOICE_EFFECTS_REWORK_P3A_FXPAGE_HELPERS") {
  $anchor = "  function mapSimpleFxToVoiceFx(settings: SimpleVoiceFxSettings): VoiceFxSettings {"
  $idx = $text.IndexOf($anchor)

  if ($idx -lt 0) {
    throw "Could not find mapSimpleFxToVoiceFx anchor."
  }

  $helpers = @'
  // OTG_VOICE_EFFECTS_REWORK_P3A_FXPAGE_HELPERS
  function getVoiceFxPageJobId() {
    return `voice-fx-page-${safeId(details.name || builderCharacterVoiceProfile?.characterId || "character")}`;
  }

  function getVoiceFxPageBaseAudio() {
    const audioPath = String(
      rawVoicePreviewPath ||
      builderCharacterVoiceProfile?.baseSamplePath ||
      builderCharacterVoiceProfile?.approvedSamplePath ||
      builderCharacterVoiceProfile?.tunedSamplePath ||
      ""
    ).trim();

    const audioUrl = String(
      rawVoicePreviewUrl ||
      builderCharacterVoiceProfile?.baseSampleUrl ||
      builderCharacterVoiceProfile?.approvedSampleUrl ||
      builderCharacterVoiceProfile?.tunedSampleUrl ||
      ""
    ).trim();

    return { audioPath, audioUrl };
  }

  async function applyVoiceFxPageEffect(args: {
    effectId: string;
    intensity: VoiceEffectIntensity;
    label: string;
    sourcePath?: string;
  }): Promise<{ audioPath: string; audioUrl: string; label: string } | null> {
    // OTG_VOICE_EFFECTS_REWORK_P3A_FXPAGE_CHAIN
    const jobId = getVoiceFxPageJobId();
    const preset = VOICE_EFFECT_PRESETS.find((item) => item.id === args.effectId);
    if (!preset) {
      setVoiceEffectMessage("Select a valid voice effect preset.");
      return null;
    }

    const baseAudio = getVoiceFxPageBaseAudio();
    const working = voiceEffectWorkingByJob[jobId];
    const inputPath = String(args.sourcePath || working?.audioPath || baseAudio.audioPath || "").trim();

    if (!inputPath) {
      setVoiceEffectMessage("Cannot apply effect because the local base voice path is missing.");
      return null;
    }

    const rawProvider = String(builderCharacterVoiceProfile?.provider || voiceProvider || "uploaded").trim();
    const provider =
      rawProvider === "cosy" ||
      rawProvider === "ltx" ||
      rawProvider === "unnatural_ltx" ||
      rawProvider === "uploaded"
        ? rawProvider
        : "qwen3";

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (typeof window !== "undefined") {
      const deviceId =
        window.localStorage.getItem("otg-device-id") ||
        window.localStorage.getItem("otgDeviceId") ||
        window.localStorage.getItem("deviceId") ||
        "";
      if (deviceId) headers["x-otg-device-id"] = deviceId;
    }

    setVoiceEffectProcessing({
      jobId,
      message: `Applying ${args.label}...`,
    });
    setVoiceEffectMessage("");

    try {
      const response = await fetch("/api/characters/voice-sample/effect", {
        method: "POST",
        headers,
        body: JSON.stringify({
          provider,
          effectId: args.effectId,
          intensity: args.intensity,
          samplePath: inputPath,
          characterId: safeId(details.name || builderCharacterVoiceProfile?.characterId || "character"),
          jobId,
        }),
      });

      const json = await response.json().catch(() => null) as Record<string, unknown> | null;
      if (!response.ok || !json?.ok) {
        throw new Error(String(json?.error || `Voice effect failed with HTTP ${response.status}`));
      }

      const output = {
        effectId: String(json.effectId || args.effectId),
        effectLabel: String(json.effectLabel || args.label),
        category: String(json.category || preset.category),
        intensity: String(json.intensity || args.intensity),
        engine: String(json.engine || "ffmpeg"),
        audioPath: String(json.audioPath || ""),
        audioUrl: String(json.audioUrl || ""),
      };

      if (!output.audioPath || !output.audioUrl) {
        throw new Error("Voice effect completed but did not return an audio path and URL.");
      }

      setVoiceEffectWorkingByJob((current) => ({
        ...current,
        [jobId]: {
          audioPath: output.audioPath,
          audioUrl: output.audioUrl,
          label: args.label,
        },
      }));

      setVoiceEffectChainByJob((current) => ({
        ...current,
        [jobId]: [
          ...(current[jobId] || []),
          {
            label: args.label,
            effectId: output.effectId,
            engine: output.engine,
            audioPath: output.audioPath,
            audioUrl: output.audioUrl,
          },
        ],
      }));

      setVoiceEffectOutputs((current) => ({
        ...current,
        [jobId]: [...(current[jobId] || []), output],
      }));

      setVoiceEffectMessage(String(json.message || `Voice effect created: ${args.label}.`));
      return {
        audioPath: output.audioPath,
        audioUrl: output.audioUrl,
        label: args.label,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setVoiceEffectMessage(message || "Voice effect failed. Original audio is still available.");
      return null;
    } finally {
      setVoiceEffectProcessing(null);
    }
  }

  async function applyVoiceFxPageSimpleEffects() {
    const pitch = simplePitchOptions.find((item) => item.id === simplePitchEffectId);
    const echo = simpleEchoOptions.find((item) => item.id === simpleEchoEffectId);

    if (!pitch || !echo) {
      setVoiceEffectMessage("Select valid simple pitch and echo options.");
      return;
    }

    if (!pitch.effectId && !echo.effectId) {
      setVoiceEffectMessage("Simple FX is set to Normal and No Echo. Nothing to apply.");
      return;
    }

    let currentPath: string | undefined;

    if (pitch.effectId) {
      const pitchOutput = await applyVoiceFxPageEffect({
        effectId: pitch.effectId,
        intensity: pitch.intensity,
        label: `Simple Pitch: ${pitch.label}`,
      });
      currentPath = pitchOutput?.audioPath || currentPath;
    }

    if (echo.effectId) {
      await applyVoiceFxPageEffect({
        effectId: echo.effectId,
        intensity: echo.intensity,
        label: `Simple Echo: ${echo.label}`,
        sourcePath: currentPath,
      });
    }
  }

  function resetVoiceFxPageChain() {
    const jobId = getVoiceFxPageJobId();

    setVoiceEffectWorkingByJob((current) => {
      const next = { ...current };
      delete next[jobId];
      return next;
    });

    setVoiceEffectChainByJob((current) => ({
      ...current,
      [jobId]: [],
    }));

    setVoiceEffectMessage("Voice FX chain reset to the base voice.");
  }

  function useVoiceFxPageCurrentVersionForTraining() {
    const jobId = getVoiceFxPageJobId();
    const working = voiceEffectWorkingByJob[jobId];

    if (!working?.audioUrl && !working?.audioPath) {
      setVoiceEffectMessage("No effected working voice is available yet.");
      return;
    }

    setSelectedIndexVoiceReference({
      source: "tuned_voice_fx",
      engine: "OTG Voice FX",
      characterId: safeId(details.name || builderCharacterVoiceProfile?.characterId || "character"),
      candidateId: "",
      selectedAt: new Date().toISOString(),
      audioPath: working.audioPath,
      audioUrl: working.audioUrl,
      qwenVoiceDesign,
      qwenVoiceDesignRecord,
      voiceFx,
      voiceFxPreview: null,
      rawVoicePreview: voicePreview || null,
    });

    setMessage("Current effected voice selected for training.");
    setVoiceEffectMessage("Current effected voice selected for training.");
  }

'@

  $text = $text.Insert($idx, $helpers)
}

# ---------------------------------------------------------------------
# 2. Replace the real Voice FX page Simple FX block.
# ---------------------------------------------------------------------

$simpleStartMarker = '                <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">'
$simpleTitleMarker = '<p className="text-sm font-semibold text-zinc-100">Simple FX</p>'
$advancedStartMarker = '                <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">'
$advancedTitleMarker = '<span className="block text-sm font-semibold text-zinc-100">Advanced FX</span>'

$simpleTitle = $text.IndexOf($simpleTitleMarker)
if ($simpleTitle -lt 0) {
  throw "Could not find real Voice FX page Simple FX title."
}

$simpleStart = $text.LastIndexOf($simpleStartMarker, $simpleTitle)
if ($simpleStart -lt 0) {
  throw "Could not find real Voice FX page Simple FX block start."
}

$advancedTitle = $text.IndexOf($advancedTitleMarker, $simpleTitle)
if ($advancedTitle -lt 0) {
  throw "Could not find real Voice FX page Advanced FX title."
}

$advancedStart = $text.LastIndexOf($advancedStartMarker, $advancedTitle)
if ($advancedStart -lt 0) {
  throw "Could not find real Voice FX page Advanced FX block start."
}

$simpleReplacement = @'
                <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-zinc-100">Simple FX</p>
                      <p className="mt-1 text-xs text-zinc-500">Fast controls only: pitch and echo. Use Advanced FX for robotic, alien, distortion, SoX, or Pedalboard chains.</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => void applyVoiceFxPageSimpleEffects()}
                        disabled={voiceEffectProcessing?.jobId === getVoiceFxPageJobId()}
                        className="rounded-xl border border-emerald-400 px-3 py-1.5 text-xs font-semibold text-emerald-100 disabled:opacity-40"
                      >
                        {voiceEffectProcessing?.jobId === getVoiceFxPageJobId() ? "Applying..." : "Apply Simple FX"}
                      </button>
                      <button type="button" onClick={resetVoiceFxPageChain} className="rounded-xl border border-zinc-700 px-3 py-1.5 text-xs font-semibold text-zinc-100 hover:border-zinc-500">
                        Reset to Base
                      </button>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <label className="block text-sm text-zinc-300">
                      <span className="mb-1 block text-xs uppercase tracking-[0.16em] text-zinc-500">Pitch</span>
                      <select
                        value={simplePitchEffectId}
                        onChange={(event) => setSimplePitchEffectId(event.target.value)}
                        className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
                      >
                        {simplePitchOptions.map((option) => (
                          <option key={option.id} value={option.id}>{option.label}</option>
                        ))}
                      </select>
                    </label>

                    <label className="block text-sm text-zinc-300">
                      <span className="mb-1 block text-xs uppercase tracking-[0.16em] text-zinc-500">Echo</span>
                      <select
                        value={simpleEchoEffectId}
                        onChange={(event) => setSimpleEchoEffectId(event.target.value)}
                        className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
                      >
                        {simpleEchoOptions.map((option) => (
                          <option key={option.id} value={option.id}>{option.label}</option>
                        ))}
                      </select>
                    </label>
                  </div>

                  {voiceEffectWorkingByJob[getVoiceFxPageJobId()]?.audioUrl ? (
                    <div className="mt-4 rounded-xl border border-emerald-400/30 bg-emerald-400/10 p-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-100">Current Working Voice</p>
                      <p className="mt-1 text-xs text-emerald-100/70">New effects will stack on this version until you reset to base.</p>
                      <audio controls preload="metadata" src={voiceEffectWorkingByJob[getVoiceFxPageJobId()].audioUrl} className="mt-2 w-full" />
                    </div>
                  ) : null}

                  {voiceEffectMessage ? (
                    <p className="mt-3 text-xs text-violet-200">{voiceEffectMessage}</p>
                  ) : null}
                </div>

'@

$text = $text.Remove($simpleStart, $advancedStart - $simpleStart).Insert($simpleStart, $simpleReplacement)

# ---------------------------------------------------------------------
# 3. Replace the real Voice FX page Advanced FX block.
# ---------------------------------------------------------------------

$advancedTitle = $text.IndexOf($advancedTitleMarker, $text.IndexOf($simpleReplacement))
if ($advancedTitle -lt 0) {
  throw "Could not find Advanced FX title after Simple FX replacement."
}

$advancedStart = $text.LastIndexOf($advancedStartMarker, $advancedTitle)
if ($advancedStart -lt 0) {
  throw "Could not find Advanced FX block start after Simple FX replacement."
}

$selectedTrainingMarker = '                <div className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4">'
$advancedEnd = $text.IndexOf($selectedTrainingMarker, $advancedStart)
if ($advancedEnd -lt 0) {
  throw "Could not find Selected Voice for Training block after Advanced FX."
}

$advancedReplacement = @'
                <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
                  <button type="button" onClick={() => setVoiceFxAdvancedOpen((current) => !current)} className="flex w-full items-center justify-between gap-3 text-left">
                    <span>
                      <span className="block text-sm font-semibold text-zinc-100">Advanced FX</span>
                      <span className="mt-1 block text-xs text-zinc-500">FFmpeg is active now. Pedalboard and SoX are installed targets for Patch 3B backend wiring.</span>
                    </span>
                    <span className="rounded-full border border-zinc-700 px-3 py-1 text-xs text-zinc-300">{voiceFxAdvancedOpen ? "Hide" : "Show"}</span>
                  </button>

                  {voiceFxAdvancedOpen ? (
                    <div className="mt-4 space-y-4">
                      <div className="grid gap-4 xl:grid-cols-3">
                        <div className="rounded-xl border border-cyan-400/30 bg-cyan-400/5 p-4">
                          <p className="text-sm font-semibold text-cyan-100">FFmpeg</p>
                          <p className="mt-1 text-xs text-zinc-400">Active engine for robotic, distortion, buzz, wah-wah, radio, alien, monster, chipmunk, echo, chorus, tremolo, vibrato, and bitcrush/glitchy voices.</p>

                          <label className="mt-3 block text-sm text-zinc-300">
                            <span className="mb-1 block text-xs uppercase tracking-[0.16em] text-zinc-500">Preset / Voice</span>
                            <select
                              value={ffmpegAdvancedPresetId}
                              onChange={(event) => setFfmpegAdvancedPresetId(event.target.value)}
                              className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
                            >
                              {ffmpegAdvancedVoiceOptions.map((option) => (
                                <option key={option.id} value={option.id}>{option.label}</option>
                              ))}
                            </select>
                          </label>

                          <label className="mt-3 flex items-center gap-2 text-xs text-zinc-300">
                            <input
                              type="checkbox"
                              checked={ffmpegControlsUnlocked}
                              onChange={(event) => setFfmpegControlsUnlocked(event.target.checked)}
                            />
                            Unlock manual controls
                          </label>

                          <div className="mt-3 rounded-xl border border-cyan-400/20 bg-black/20 p-3 text-xs leading-5 text-zinc-400">
                            {ffmpegAdvancedVoiceOptions.find((option) => option.id === ffmpegAdvancedPresetId)?.description || "FFmpeg preset"}
                            <div className="mt-1">
                              Controls shown: pitch, grit, echo, tremolo, vibrato, chorus, highpass, lowpass, compression.
                              {ffmpegControlsUnlocked ? " Manual editing comes in Patch 3C." : " Preset controls are locked."}
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={() => void applyVoiceFxPageEffect({
                              effectId: ffmpegAdvancedPresetId,
                              intensity: voiceEffectIntensity,
                              label: `FFmpeg: ${ffmpegAdvancedVoiceOptions.find((option) => option.id === ffmpegAdvancedPresetId)?.label || ffmpegAdvancedPresetId}`,
                            })}
                            disabled={voiceEffectProcessing?.jobId === getVoiceFxPageJobId()}
                            className="mt-3 rounded-xl border border-cyan-400 px-3 py-1.5 text-xs font-semibold text-cyan-100 disabled:opacity-40"
                          >
                            {voiceEffectProcessing?.jobId === getVoiceFxPageJobId() ? "Applying..." : "Add FFmpeg Effect"}
                          </button>
                        </div>

                        <div className="rounded-xl border border-fuchsia-400/30 bg-fuchsia-400/5 p-4">
                          <p className="text-sm font-semibold text-fuchsia-100">Spotify Pedalboard</p>
                          <p className="mt-1 text-xs text-zinc-400">Studio-style effects: distortion, phaser, chorus, delay, reverb, pitch-shifting, plugin chain, and future VST3 presets.</p>

                          <label className="mt-3 block text-sm text-zinc-300">
                            <span className="mb-1 block text-xs uppercase tracking-[0.16em] text-zinc-500">Preset / Voice</span>
                            <select
                              value={pedalboardPresetId}
                              onChange={(event) => setPedalboardPresetId(event.target.value)}
                              className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
                            >
                              {pedalboardAdvancedOptions.map((option) => (
                                <option key={option.id} value={option.id}>{option.label}</option>
                              ))}
                            </select>
                          </label>

                          <label className="mt-3 flex items-center gap-2 text-xs text-zinc-300">
                            <input
                              type="checkbox"
                              checked={pedalboardControlsUnlocked}
                              onChange={(event) => setPedalboardControlsUnlocked(event.target.checked)}
                            />
                            Unlock manual controls
                          </label>

                          <div className="mt-3 rounded-xl border border-fuchsia-400/20 bg-black/20 p-3 text-xs leading-5 text-zinc-400">
                            {pedalboardAdvancedOptions.find((option) => option.id === pedalboardPresetId)?.description || "Pedalboard preset"}
                            <div className="mt-1">
                              Controls shown: drive, mix, delay, feedback, reverb room size, phaser rate, chorus depth, pitch shift.
                              {pedalboardControlsUnlocked ? " Manual editing comes in Patch 3C." : " Preset controls are locked."}
                            </div>
                          </div>

                          <button
                            type="button"
                            disabled
                            className="mt-3 rounded-xl border border-fuchsia-400 px-3 py-1.5 text-xs font-semibold text-fuchsia-100 opacity-40"
                          >
                            Pedalboard Backend Pending
                          </button>
                        </div>

                        <div className="rounded-xl border border-orange-400/30 bg-orange-400/5 p-4">
                          <p className="text-sm font-semibold text-orange-100">SoX</p>
                          <p className="mt-1 text-xs text-zinc-400">Installed engine for synthwave, chip/chiptune, overdrive voice, echo filtering, and max conversion chains.</p>

                          <label className="mt-3 block text-sm text-zinc-300">
                            <span className="mb-1 block text-xs uppercase tracking-[0.16em] text-zinc-500">Preset / Voice</span>
                            <select
                              value={soxPresetId}
                              onChange={(event) => setSoxPresetId(event.target.value)}
                              className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
                            >
                              {soxAdvancedOptions.map((option) => (
                                <option key={option.id} value={option.id}>{option.label}</option>
                              ))}
                            </select>
                          </label>

                          <label className="mt-3 flex items-center gap-2 text-xs text-zinc-300">
                            <input
                              type="checkbox"
                              checked={soxControlsUnlocked}
                              onChange={(event) => setSoxControlsUnlocked(event.target.checked)}
                            />
                            Unlock manual controls
                          </label>

                          <div className="mt-3 rounded-xl border border-orange-400/20 bg-black/20 p-3 text-xs leading-5 text-zinc-400">
                            {soxAdvancedOptions.find((option) => option.id === soxPresetId)?.description || "SoX preset"}
                            <div className="mt-1">
                              Controls shown: synthwave, chip, overdrive, echo filtering, conversion chain.
                              {soxControlsUnlocked ? " Manual editing comes in Patch 3C." : " Preset controls are locked."}
                            </div>
                          </div>

                          <button
                            type="button"
                            disabled
                            className="mt-3 rounded-xl border border-orange-400 px-3 py-1.5 text-xs font-semibold text-orange-100 opacity-40"
                          >
                            SoX Backend Pending
                          </button>
                        </div>
                      </div>

                      {voiceEffectChainByJob[getVoiceFxPageJobId()]?.length ? (
                        <div className="rounded-xl border border-emerald-400/30 bg-emerald-400/5 p-4">
                          <p className="text-sm font-semibold text-emerald-100">Applied Effect Chain</p>
                          <ol className="mt-3 list-decimal space-y-2 pl-5 text-xs text-emerald-100/80">
                            {voiceEffectChainByJob[getVoiceFxPageJobId()].map((item, index) => (
                              <li key={`${item.audioUrl}-${index}`}>
                                {item.label} / {item.engine}
                              </li>
                            ))}
                          </ol>

                          <div className="mt-3 flex flex-wrap gap-2">
                            <button type="button" onClick={resetVoiceFxPageChain} className="rounded-xl border border-zinc-700 px-3 py-1.5 text-xs font-semibold text-zinc-100 hover:border-zinc-500">
                              Reset to Base Voice
                            </button>
                            <button type="button" onClick={useVoiceFxPageCurrentVersionForTraining} className="rounded-xl border border-emerald-400 px-3 py-1.5 text-xs font-semibold text-emerald-100 hover:bg-emerald-400/10">
                              Use This Version
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <p className="mt-3 text-xs text-zinc-500">Advanced FX is collapsed by default so the page stays focused on simple pitch and echo.</p>
                  )}
                </div>

'@

$text = $text.Remove($advancedStart, $advancedEnd - $advancedStart).Insert($advancedStart, $advancedReplacement)

# ---------------------------------------------------------------------
# 4. Checklist update.
# ---------------------------------------------------------------------

[System.IO.File]::WriteAllText($PanelPath, $text, (New-Object System.Text.UTF8Encoding($false)))

if (Test-Path -LiteralPath $ChecklistPath) {
  $Checklist = Get-Content -LiteralPath $ChecklistPath -Raw
  $Marker = "Voice Effects Rework Patch 3A-FXPage"
  if ($Checklist -notmatch [regex]::Escape($Marker)) {
    Add-Content -LiteralPath $ChecklistPath -Value "`r`n- [x] ${Marker}: reworked the actual Voice Lab Step 2 FX page with Simple Pitch/Echo controls, FFmpeg/Pedalboard/SoX advanced boxes, current working voice, effect chain, reset, and Use This Version. Pedalboard/SoX backend remains Patch 3B.`r`n" -Encoding UTF8
  }
}

# ---------------------------------------------------------------------
# 5. Verification.
# ---------------------------------------------------------------------

$fileText = Get-Content -LiteralPath $PanelPath -Raw

$checks = @(
  "OTG_VOICE_EFFECTS_REWORK_P3A_FXPAGE_HELPERS",
  "OTG_VOICE_EFFECTS_REWORK_P3A_FXPAGE_CHAIN",
  "Simple Pitch: ",
  "Simple Echo: ",
  "Fast controls only: pitch and echo",
  "Add FFmpeg Effect",
  "Pedalboard Backend Pending",
  "SoX Backend Pending",
  "Applied Effect Chain",
  "Use This Version"
)

foreach ($check in $checks) {
  if ($fileText -notmatch [regex]::Escape($check)) {
    throw "Verification failed. Missing marker: $check"
  }
}

$forbiddenAfter = $fileText.Substring($fileText.IndexOf('{voiceLabPage === "fx" ? ('))
foreach ($bad in @("Voice Type</span>", "Voice Size</span>", "Roughness</span>", "Transmission</span>")) {
  if ($forbiddenAfter -match [regex]::Escape($bad)) {
    throw "Verification failed. Old Simple FX control still present in Voice FX page: $bad"
  }
}

Write-Host ""
Write-Host "SUCCESS"
Write-Host "Voice Effects Rework Patch 3A-FXPage installed."
Write-Host "Backup: $BackupRoot"
Write-Host ""
Write-Host "Next validation:"
Write-Host "  npm run lint -- --quiet"
Write-Host "  npx tsc --noEmit --pretty false"
Write-Host "  npm test"