$ErrorActionPreference = "Stop"

$Repo = "C:\AI\OTG-Test2"
$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$BackupRoot = Join-Path $Repo ".patch-backups\voice-effects-rework-p3a-$Stamp"

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

# ---------------------------------------------------------------------
# 1. Add rework state beside existing Voice Effects UI state.
# ---------------------------------------------------------------------

if ($text -notmatch "OTG_VOICE_EFFECTS_REWORK_P3A_STATE") {
  $anchor = 'const [voiceEffectOutputs, setVoiceEffectOutputs] = useState<Record<string, Array<{'
  $idx = $text.IndexOf($anchor)

  if ($idx -lt 0) {
    throw "Could not find voiceEffectOutputs state anchor."
  }

  $stateEnd = $text.IndexOf("}>>>({});", $idx)
  if ($stateEnd -lt 0) {
    throw "Could not find end of voiceEffectOutputs state block."
  }

  $insertAt = $stateEnd + "}>>>({});".Length

  $stateBlock = @'

  // OTG_VOICE_EFFECTS_REWORK_P3A_STATE
  const [voiceEffectsAdvancedOpen, setVoiceEffectsAdvancedOpen] = useState(false);
  const [simplePitchEffectId, setSimplePitchEffectId] = useState("simple_pitch_normal");
  const [simpleEchoEffectId, setSimpleEchoEffectId] = useState("simple_echo_none");
  const [voiceEffectWorkingByJob, setVoiceEffectWorkingByJob] = useState<Record<string, {
    audioPath: string;
    audioUrl: string;
    label: string;
  }>>({});
  const [voiceEffectChainByJob, setVoiceEffectChainByJob] = useState<Record<string, Array<{
    label: string;
    effectId: string;
    engine: string;
    audioPath: string;
    audioUrl: string;
  }>>>({});
  const [ffmpegAdvancedPresetId, setFfmpegAdvancedPresetId] = useState("clean_robot");
  const [pedalboardPresetId, setPedalboardPresetId] = useState("pedalboard_studio");
  const [soxPresetId, setSoxPresetId] = useState("sox_synthwave");
  const [ffmpegControlsUnlocked, setFfmpegControlsUnlocked] = useState(false);
  const [pedalboardControlsUnlocked, setPedalboardControlsUnlocked] = useState(false);
  const [soxControlsUnlocked, setSoxControlsUnlocked] = useState(false);
'@

  $text = $text.Insert($insertAt, $stateBlock)
}

# ---------------------------------------------------------------------
# 2. Add local option constants inside component before helper.
# ---------------------------------------------------------------------

if ($text -notmatch "OTG_VOICE_EFFECTS_REWORK_P3A_OPTIONS") {
  $anchor = "async function applyVoiceEffectToSample"
  $idx = $text.IndexOf($anchor)

  if ($idx -lt 0) {
    throw "Could not find applyVoiceEffectToSample anchor."
  }

  $optionsBlock = @'
  // OTG_VOICE_EFFECTS_REWORK_P3A_OPTIONS
  const simplePitchOptions = [
    { id: "simple_pitch_very_deep", label: "Very Deep", effectId: "monster_deep_voice", intensity: "strong" as VoiceEffectIntensity },
    { id: "simple_pitch_deep", label: "Deep", effectId: "monster_deep_voice", intensity: "medium" as VoiceEffectIntensity },
    { id: "simple_pitch_normal", label: "Normal", effectId: "", intensity: "medium" as VoiceEffectIntensity },
    { id: "simple_pitch_high", label: "High", effectId: "tiny_creature", intensity: "medium" as VoiceEffectIntensity },
    { id: "simple_pitch_very_high", label: "Very High", effectId: "tiny_creature", intensity: "strong" as VoiceEffectIntensity },
  ];

  const simpleEchoOptions = [
    { id: "simple_echo_none", label: "None", effectId: "", intensity: "medium" as VoiceEffectIntensity },
    { id: "simple_echo_small", label: "Small Echo", effectId: "far_away_voice", intensity: "subtle" as VoiceEffectIntensity },
    { id: "simple_echo_medium", label: "Medium Echo", effectId: "cave_echo", intensity: "medium" as VoiceEffectIntensity },
    { id: "simple_echo_large", label: "Large Echo", effectId: "cave_echo", intensity: "strong" as VoiceEffectIntensity },
  ];

  const ffmpegAdvancedVoiceOptions = [
    { id: "clean_robot", label: "Robotic", description: "Synthetic robot tone." },
    { id: "demonic_distortion", label: "Distortion", description: "Dark gritty distortion." },
    { id: "buzzing_circuit", label: "Buzz", description: "Electrical circuit buzz." },
    { id: "wah_wah_mutant", label: "Wah-Wah", description: "Moving filter mutant voice." },
    { id: "old_radio_distance", label: "Telephone / Radio", description: "Band-limited radio or phone voice." },
    { id: "alien_modulation", label: "Alien Modulation", description: "Alien vibrato, tremolo, and chorus." },
    { id: "monster_deep_voice", label: "Monster Low Voice", description: "Deep monster pitch and body." },
    { id: "tiny_creature", label: "Chipmunk High Voice", description: "High tiny creature pitch." },
    { id: "cave_echo", label: "Echo", description: "Large echo and room tail." },
    { id: "dream_reverb", label: "Chorus", description: "Soft chorus and dream movement." },
    { id: "haunted_room", label: "Tremolo", description: "Haunted tremolo instability." },
    { id: "glitching_cyborg", label: "Vibrato", description: "Cyborg vibrato and glitch movement." },
    { id: "broken_robot", label: "Bitcrush / Glitchy", description: "Broken robot bitcrush and choppy modulation." },
  ];

  const pedalboardAdvancedOptions = [
    { id: "pedalboard_studio", label: "Studio", description: "Studio polish chain. Backend Patch 3B." },
    { id: "pedalboard_distortion", label: "Distortion", description: "Pedalboard distortion. Backend Patch 3B." },
    { id: "pedalboard_phaser", label: "Phaser", description: "Pedalboard phaser. Backend Patch 3B." },
    { id: "pedalboard_chorus", label: "Chorus", description: "Pedalboard chorus. Backend Patch 3B." },
    { id: "pedalboard_delay", label: "Delay", description: "Pedalboard delay. Backend Patch 3B." },
    { id: "pedalboard_reverb", label: "Reverb", description: "Pedalboard reverb. Backend Patch 3B." },
    { id: "pedalboard_pitch_shift", label: "Pitch-Shifting", description: "Pedalboard pitch shift. Backend Patch 3B." },
    { id: "pedalboard_plugin_chain", label: "Plugin Chain", description: "Future plugin chain support." },
    { id: "pedalboard_vst3_presets", label: "VST3 Effects Presets", description: "Future VST3 preset support." },
  ];

  const soxAdvancedOptions = [
    { id: "sox_synthwave", label: "Synthwave", description: "SoX synthwave effect. Backend Patch 3B." },
    { id: "sox_chip", label: "Chip / Chiptune", description: "SoX chip voice effect. Backend Patch 3B." },
    { id: "sox_overdrive", label: "Overdrive Voice", description: "SoX overdrive. Backend Patch 3B." },
    { id: "sox_echo_filtering", label: "Echo Filtering", description: "SoX echo/filter chain. Backend Patch 3B." },
    { id: "sox_max_conversion", label: "Max Conversion", description: "SoX conversion/normalization chain. Backend Patch 3B." },
  ];

'@

  $text = $text.Insert($idx, $optionsBlock)
}

# ---------------------------------------------------------------------
# 3. Add stack-aware helper.
# ---------------------------------------------------------------------

if ($text -notmatch "async function applyVoiceEffectById") {
  $anchor = "async function applyVoiceEffectToSample"
  $idx = $text.IndexOf($anchor)

  if ($idx -lt 0) {
    throw "Could not find applyVoiceEffectToSample anchor for helper insertion."
  }

  $helper = @'
  async function applyVoiceEffectById(args: {
    job: Record<string, unknown>;
    result: Record<string, unknown>;
    effectId: string;
    intensity: VoiceEffectIntensity;
    label: string;
  }) {
    // OTG_VOICE_EFFECTS_REWORK_P3A_CHAIN: apply effect to current working voice if present, otherwise base voice.
    const jobId = String(args.job.jobId || "").trim();
    if (!jobId) {
      setVoiceEffectMessage("Cannot apply effect because the voice job id is missing.");
      return;
    }

    const preset = VOICE_EFFECT_PRESETS.find((item) => item.id === args.effectId);
    if (!preset) {
      setVoiceEffectMessage("Select a valid voice effect preset.");
      return;
    }

    const working = voiceEffectWorkingByJob[jobId];
    const inputPath = String(
      working?.audioPath ||
      args.result.enhancedAudioPath ||
      args.result.isolatedAudioPath ||
      args.result.uploadedSamplePath ||
      args.result.outputAudioPath ||
      args.result.samplePath ||
      args.result.processedSamplePath ||
      args.result.fxSamplePath ||
      builderCharacterVoiceProfile?.approvedSamplePath ||
      builderCharacterVoiceProfile?.tunedSamplePath ||
      builderCharacterVoiceProfile?.baseSamplePath ||
      ""
    ).trim();

    if (!inputPath) {
      setVoiceEffectMessage("Cannot apply effect because the local sample path is missing.");
      return;
    }

    const rawProvider = String(
      args.result.provider ||
      (args.job.input && typeof args.job.input === "object" && !Array.isArray(args.job.input) ? (args.job.input as Record<string, unknown>).provider : "") ||
      builderCharacterVoiceProfile?.provider ||
      voiceProvider ||
      "uploaded"
    ).trim();

    const provider =
      rawProvider === "cosy" ||
      rawProvider === "ltx" ||
      rawProvider === "unnatural_ltx" ||
      rawProvider === "uploaded"
        ? rawProvider
        : "qwen3";

    const characterId = String(
      args.job.characterId ||
      builderCharacterVoiceProfile?.characterId ||
      details.name ||
      "character"
    ).trim();

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
          characterId,
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

      if (!output.audioUrl || !output.audioPath) {
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
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setVoiceEffectMessage(message || "Voice effect failed. Original audio is still available.");
    } finally {
      setVoiceEffectProcessing(null);
    }
  }

  async function applySimpleVoiceEffects(job: Record<string, unknown>, result: Record<string, unknown>) {
    const pitch = simplePitchOptions.find((item) => item.id === simplePitchEffectId);
    const echo = simpleEchoOptions.find((item) => item.id === simpleEchoEffectId);

    if (!pitch || !echo) {
      setVoiceEffectMessage("Select valid simple pitch and echo options.");
      return;
    }

    if (!pitch.effectId && !echo.effectId) {
      setVoiceEffectMessage("Simple Effects are set to normal/no echo. Nothing to apply.");
      return;
    }

    if (pitch.effectId) {
      await applyVoiceEffectById({
        job,
        result,
        effectId: pitch.effectId,
        intensity: pitch.intensity,
        label: `Simple Pitch: ${pitch.label}`,
      });
    }

    if (echo.effectId) {
      await applyVoiceEffectById({
        job,
        result,
        effectId: echo.effectId,
        intensity: echo.intensity,
        label: `Simple Echo: ${echo.label}`,
      });
    }
  }

  function resetVoiceEffectChain(jobId: string) {
    setVoiceEffectWorkingByJob((current) => {
      const next = { ...current };
      delete next[jobId];
      return next;
    });
    setVoiceEffectChainByJob((current) => ({
      ...current,
      [jobId]: [],
    }));
    setVoiceEffectMessage("Voice effect chain reset to the base voice.");
  }

'@

  $text = $text.Insert($idx, $helper)
}

# ---------------------------------------------------------------------
# 4. Add derived values for current working/chain.
# ---------------------------------------------------------------------

if ($text -notmatch "voiceEffectWorkingForJob") {
  $anchor = 'const voiceEffectOutputsForJob = job?.jobId ? (voiceEffectOutputs[String(job.jobId)] || []) : [];'
  $idx = $text.IndexOf($anchor)

  if ($idx -lt 0) {
    throw "Could not find voiceEffectOutputsForJob anchor."
  }

  $insertAt = $idx + $anchor.Length

  $derived = @'
    const voiceEffectWorkingForJob = job?.jobId ? voiceEffectWorkingByJob[String(job.jobId)] : null;
    const voiceEffectChainForJob = job?.jobId ? (voiceEffectChainByJob[String(job.jobId)] || []) : [];
'@

  $text = $text.Insert($insertAt, $derived)
}

# ---------------------------------------------------------------------
# 5. Replace the old generic Voice Effects JSX with corrected rework layout.
# ---------------------------------------------------------------------

$oldStart = $text.IndexOf('                {isVoiceEffectEligible ? (')
if ($oldStart -lt 0) {
  throw "Could not find old Voice Effects JSX start."
}

$oldEndAnchor = '                {resultEntries.length ? ('
$oldEnd = $text.IndexOf($oldEndAnchor, $oldStart)
if ($oldEnd -lt 0) {
  throw "Could not find old Voice Effects JSX end anchor."
}

$newJsx = @'
                {isVoiceEffectEligible ? (
                  <div className="mt-3 rounded-lg border border-violet-400/30 bg-violet-400/10 p-3 text-violet-100">
                    <div className="font-semibold">Voice Effects</div>
                    <div className="mt-1 text-xs text-violet-100/75">
                      Start from the base voice, apply simple pitch/echo, then optionally stack advanced effects. The original audio is never overwritten.
                    </div>

                    <div className="mt-3 rounded-lg border border-violet-400/20 bg-black/20 p-3">
                      <div className="text-xs font-bold uppercase tracking-[0.16em] text-violet-200">Base Voice Sample</div>
                      <div className="mt-1 text-xs text-violet-100/70">Original voice remains available even after effects are added.</div>
                      {audioUrl || ltxOriginalAudioUrl ? (
                        <audio
                          controls
                          preload="metadata"
                          src={ltxOriginalAudioUrl || audioUrl}
                          className="mt-2 w-full"
                        />
                      ) : (
                        <div className="mt-2 text-xs text-violet-100/60">Base audio URL is not available.</div>
                      )}
                    </div>

                    {voiceEffectWorkingForJob?.audioUrl ? (
                      <div className="mt-3 rounded-lg border border-emerald-400/20 bg-emerald-400/10 p-3">
                        <div className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-100">Current Working Voice</div>
                        <div className="mt-1 text-xs text-emerald-100/70">Latest effected version. New effects will stack on this audio.</div>
                        <audio
                          controls
                          preload="metadata"
                          src={voiceEffectWorkingForJob.audioUrl}
                          className="mt-2 w-full"
                        />
                      </div>
                    ) : null}

                    <div className="mt-3 rounded-lg border border-violet-400/20 bg-zinc-950/60 p-3">
                      <div className="text-xs font-bold uppercase tracking-[0.16em] text-violet-200">Simple Effects</div>
                      <div className="mt-1 text-xs text-violet-100/70">Fast controls for deeper/higher pitch and small/medium/large echo.</div>

                      <div className="mt-3 grid gap-2 sm:grid-cols-2">
                        <label className="text-xs text-violet-100/80">
                          Pitch
                          <select
                            value={simplePitchEffectId}
                            onChange={(event) => setSimplePitchEffectId(event.target.value)}
                            className="mt-1 w-full rounded-lg border border-violet-400/30 bg-zinc-950 px-2 py-2 text-xs text-violet-50"
                          >
                            {simplePitchOptions.map((option) => (
                              <option key={option.id} value={option.id}>{option.label}</option>
                            ))}
                          </select>
                        </label>

                        <label className="text-xs text-violet-100/80">
                          Echo
                          <select
                            value={simpleEchoEffectId}
                            onChange={(event) => setSimpleEchoEffectId(event.target.value)}
                            className="mt-1 w-full rounded-lg border border-violet-400/30 bg-zinc-950 px-2 py-2 text-xs text-violet-50"
                          >
                            {simpleEchoOptions.map((option) => (
                              <option key={option.id} value={option.id}>{option.label}</option>
                            ))}
                          </select>
                        </label>
                      </div>

                      <button
                        type="button"
                        onClick={() => job && result ? void applySimpleVoiceEffects(job as unknown as Record<string, unknown>, result) : undefined}
                        disabled={voiceEffectIsProcessing}
                        className="mt-3 rounded-lg border border-violet-300/60 bg-violet-300/10 px-3 py-2 text-xs font-bold text-violet-50 disabled:opacity-40 hover:bg-violet-300/20"
                      >
                        {voiceEffectIsProcessing ? "Applying..." : "Apply Simple Effect"}
                      </button>
                    </div>

                    <div className="mt-3">
                      <button
                        type="button"
                        onClick={() => setVoiceEffectsAdvancedOpen((open) => !open)}
                        className="rounded-lg border border-zinc-500/60 bg-zinc-900 px-3 py-2 text-xs font-bold text-zinc-100 hover:bg-zinc-800"
                      >
                        {voiceEffectsAdvancedOpen ? "Hide Advanced Effects" : "Show Advanced Effects"}
                      </button>
                    </div>

                    {voiceEffectsAdvancedOpen ? (
                      <div className="mt-3 grid gap-3 xl:grid-cols-3">
                        <div className="rounded-lg border border-cyan-400/30 bg-cyan-400/10 p-3">
                          <div className="text-xs font-bold uppercase tracking-[0.16em] text-cyan-100">FFmpeg Effects</div>
                          <div className="mt-1 text-xs text-cyan-100/70">Active engine: robot, distortion, buzz, wah-wah, radio, alien, monster, chipmunk, chorus, tremolo, vibrato, bitcrush.</div>

                          <label className="mt-3 block text-xs text-cyan-100/80">
                            Preset / Voice
                            <select
                              value={ffmpegAdvancedPresetId}
                              onChange={(event) => setFfmpegAdvancedPresetId(event.target.value)}
                              className="mt-1 w-full rounded-lg border border-cyan-400/30 bg-zinc-950 px-2 py-2 text-xs text-cyan-50"
                            >
                              {ffmpegAdvancedVoiceOptions.map((option) => (
                                <option key={option.id} value={option.id}>{option.label}</option>
                              ))}
                            </select>
                          </label>

                          <label className="mt-2 flex items-center gap-2 text-xs text-cyan-100/80">
                            <input
                              type="checkbox"
                              checked={ffmpegControlsUnlocked}
                              onChange={(event) => setFfmpegControlsUnlocked(event.target.checked)}
                            />
                            Unlock manual controls
                          </label>

                          <div className="mt-2 rounded-lg border border-cyan-400/20 bg-black/20 p-2 text-xs text-cyan-100/70">
                            {ffmpegAdvancedVoiceOptions.find((option) => option.id === ffmpegAdvancedPresetId)?.description || "FFmpeg preset"}
                            <div className="mt-1">
                              Controls: pitch, grit, echo, tremolo, vibrato, chorus, highpass, lowpass, compression.
                              {ffmpegControlsUnlocked ? " Manual control editing comes in Patch 3C." : " Preset controls are locked."}
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={() => job && result ? void applyVoiceEffectById({
                              job: job as unknown as Record<string, unknown>,
                              result,
                              effectId: ffmpegAdvancedPresetId,
                              intensity: voiceEffectIntensity,
                              label: `FFmpeg: ${ffmpegAdvancedVoiceOptions.find((option) => option.id === ffmpegAdvancedPresetId)?.label || ffmpegAdvancedPresetId}`,
                            }) : undefined}
                            disabled={voiceEffectIsProcessing}
                            className="mt-3 rounded-lg border border-cyan-300/60 bg-cyan-300/10 px-3 py-2 text-xs font-bold text-cyan-50 disabled:opacity-40 hover:bg-cyan-300/20"
                          >
                            {voiceEffectIsProcessing ? "Applying..." : "Apply FFmpeg Effect"}
                          </button>
                        </div>

                        <div className="rounded-lg border border-fuchsia-400/30 bg-fuchsia-400/10 p-3">
                          <div className="text-xs font-bold uppercase tracking-[0.16em] text-fuchsia-100">Spotify Pedalboard</div>
                          <div className="mt-1 text-xs text-fuchsia-100/70">Studio-style effects. Backend wiring comes in Patch 3B.</div>

                          <label className="mt-3 block text-xs text-fuchsia-100/80">
                            Preset / Voice
                            <select
                              value={pedalboardPresetId}
                              onChange={(event) => setPedalboardPresetId(event.target.value)}
                              className="mt-1 w-full rounded-lg border border-fuchsia-400/30 bg-zinc-950 px-2 py-2 text-xs text-fuchsia-50"
                            >
                              {pedalboardAdvancedOptions.map((option) => (
                                <option key={option.id} value={option.id}>{option.label}</option>
                              ))}
                            </select>
                          </label>

                          <label className="mt-2 flex items-center gap-2 text-xs text-fuchsia-100/80">
                            <input
                              type="checkbox"
                              checked={pedalboardControlsUnlocked}
                              onChange={(event) => setPedalboardControlsUnlocked(event.target.checked)}
                            />
                            Unlock manual controls
                          </label>

                          <div className="mt-2 rounded-lg border border-fuchsia-400/20 bg-black/20 p-2 text-xs text-fuchsia-100/70">
                            {pedalboardAdvancedOptions.find((option) => option.id === pedalboardPresetId)?.description || "Pedalboard preset"}
                            <div className="mt-1">
                              Controls: drive, mix, delay, feedback, reverb room size, phaser rate, chorus depth, pitch shift.
                              {pedalboardControlsUnlocked ? " Manual control editing comes in Patch 3C." : " Preset controls are locked."}
                            </div>
                          </div>

                          <button
                            type="button"
                            disabled
                            className="mt-3 rounded-lg border border-fuchsia-300/40 bg-fuchsia-300/10 px-3 py-2 text-xs font-bold text-fuchsia-50 opacity-45"
                          >
                            Pedalboard Backend Pending
                          </button>
                        </div>

                        <div className="rounded-lg border border-orange-400/30 bg-orange-400/10 p-3">
                          <div className="text-xs font-bold uppercase tracking-[0.16em] text-orange-100">SoX Effects</div>
                          <div className="mt-1 text-xs text-orange-100/70">SoX is installed. Backend wiring comes in Patch 3B.</div>

                          <label className="mt-3 block text-xs text-orange-100/80">
                            Preset / Voice
                            <select
                              value={soxPresetId}
                              onChange={(event) => setSoxPresetId(event.target.value)}
                              className="mt-1 w-full rounded-lg border border-orange-400/30 bg-zinc-950 px-2 py-2 text-xs text-orange-50"
                            >
                              {soxAdvancedOptions.map((option) => (
                                <option key={option.id} value={option.id}>{option.label}</option>
                              ))}
                            </select>
                          </label>

                          <label className="mt-2 flex items-center gap-2 text-xs text-orange-100/80">
                            <input
                              type="checkbox"
                              checked={soxControlsUnlocked}
                              onChange={(event) => setSoxControlsUnlocked(event.target.checked)}
                            />
                            Unlock manual controls
                          </label>

                          <div className="mt-2 rounded-lg border border-orange-400/20 bg-black/20 p-2 text-xs text-orange-100/70">
                            {soxAdvancedOptions.find((option) => option.id === soxPresetId)?.description || "SoX preset"}
                            <div className="mt-1">
                              Controls: synthwave, chip, overdrive, echo filtering, conversion chain.
                              {soxControlsUnlocked ? " Manual control editing comes in Patch 3C." : " Preset controls are locked."}
                            </div>
                          </div>

                          <button
                            type="button"
                            disabled
                            className="mt-3 rounded-lg border border-orange-300/40 bg-orange-300/10 px-3 py-2 text-xs font-bold text-orange-50 opacity-45"
                          >
                            SoX Backend Pending
                          </button>
                        </div>
                      </div>
                    ) : null}

                    {voiceEffectChainForJob.length ? (
                      <div className="mt-3 rounded-lg border border-emerald-400/20 bg-black/20 p-3">
                        <div className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-100">Applied Effect Chain</div>
                        <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs text-emerald-100/80">
                          {voiceEffectChainForJob.map((item, index) => (
                            <li key={`${item.audioUrl}-${index}`}>
                              {item.label} / {item.engine}
                            </li>
                          ))}
                        </ol>

                        <div className="mt-3 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => job?.jobId ? resetVoiceEffectChain(String(job.jobId)) : undefined}
                            className="rounded-lg border border-zinc-500/60 bg-zinc-900 px-3 py-2 text-xs font-bold text-zinc-100 hover:bg-zinc-800"
                          >
                            Reset to Base Voice
                          </button>
                          <button
                            type="button"
                            className="rounded-lg border border-emerald-300/60 bg-emerald-300/10 px-3 py-2 text-xs font-bold text-emerald-50 hover:bg-emerald-300/20"
                          >
                            Use This Version
                          </button>
                        </div>
                      </div>
                    ) : null}

                    {voiceEffectIsProcessing ? (
                      <div className="mt-2 text-xs text-amber-100">{voiceEffectProcessing?.message}</div>
                    ) : null}

                    {voiceEffectMessage ? (
                      <div className="mt-2 text-xs text-violet-100/80">{voiceEffectMessage}</div>
                    ) : null}
                  </div>
                ) : null}

'@

$text = $text.Remove($oldStart, $oldEnd - $oldStart).Insert($oldStart, $newJsx)

# ---------------------------------------------------------------------
# 6. Checklist update.
# ---------------------------------------------------------------------

[System.IO.File]::WriteAllText($PanelPath, $text, (New-Object System.Text.UTF8Encoding($false)))

if (Test-Path -LiteralPath $ChecklistPath) {
  $Checklist = Get-Content -LiteralPath $ChecklistPath -Raw
  $Marker = "Voice Effects Rework Patch 3A"
  if ($Checklist -notmatch [regex]::Escape($Marker)) {
    Add-Content -LiteralPath $ChecklistPath -Value "`r`n- [x] ${Marker}: reworked Voice Effects into Base Voice, Simple Effects, Advanced FFmpeg/Pedalboard/SoX boxes, current working voice, reset, and effect chain UI. Pedalboard/SoX backend wiring remains Patch 3B.`r`n" -Encoding UTF8
  }
}

# ---------------------------------------------------------------------
# 7. Verification.
# ---------------------------------------------------------------------

$checks = @(
  "OTG_VOICE_EFFECTS_REWORK_P3A_STATE",
  "OTG_VOICE_EFFECTS_REWORK_P3A_OPTIONS",
  "OTG_VOICE_EFFECTS_REWORK_P3A_CHAIN",
  "Base Voice Sample",
  "Simple Effects",
  "FFmpeg Effects",
  "Spotify Pedalboard",
  "SoX Effects",
  "Applied Effect Chain",
  "Reset to Base Voice",
  "Use This Version"
)

$fileText = Get-Content -LiteralPath $PanelPath -Raw

foreach ($check in $checks) {
  if ($fileText -notmatch [regex]::Escape($check)) {
    throw "Verification failed. Missing marker: $check"
  }
}

Write-Host ""
Write-Host "SUCCESS"
Write-Host "Voice Effects Rework Patch 3A installed."
Write-Host "Backup: $BackupRoot"
Write-Host ""
Write-Host "Next validation:"
Write-Host "  npm run lint -- --quiet"
Write-Host "  npx tsc --noEmit --pretty false"
Write-Host "  npm test"