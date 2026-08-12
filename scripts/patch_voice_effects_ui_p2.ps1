$ErrorActionPreference = "Stop"

$Repo = "C:\AI\OTG-Test2"
$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$BackupRoot = Join-Path $Repo ".patch-backups\voice-effects-ui-p2-$Stamp"

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

if ($text -notmatch "OTG_VOICE_EFFECTS_UI_P2") {
  # 1. Add import after voiceDesignModels import.
  if ($text -notmatch 'from "../../../lib/characters/voiceEffectPresets"') {
    $anchorCandidates = @(
      'from "../../../lib/characters/unnaturalVoicePresets";',
      'from "../../../lib/characters/voiceFxPresets";',
      'from "../../../lib/characterVoiceAudioStudio";',
      'from "../../../lib/characters/voiceDesignModels";'
    )

    $idx = -1
    foreach ($candidate in $anchorCandidates) {
      $candidateIdx = $text.IndexOf($candidate)
      if ($candidateIdx -ge 0 -and ($idx -lt 0 -or $candidateIdx -gt $idx)) {
        $idx = $candidateIdx
      }
    }

    if ($idx -lt 0) {
      throw "Could not find any relative character import anchor."
    }

    $lineEnd = $text.IndexOf("`n", $idx)
    if ($lineEnd -lt 0) { $lineEnd = $idx }

    $import = @'
import {
  VOICE_EFFECT_CATEGORIES,
  VOICE_EFFECT_PRESETS,
  type VoiceEffectCategory,
  type VoiceEffectIntensity,
} from "../../../lib/characters/voiceEffectPresets";
'@

    $text = $text.Insert($lineEnd + 1, $import)
  }

  # 2. Add UI state near existing LTX processing state.
  if ($text -notmatch "voiceEffectCategory") {
    $needle = "const [ltxAudioProcessing"
    $idx = $text.IndexOf($needle)
    if ($idx -lt 0) {
      throw "Could not find ltxAudioProcessing state anchor."
    }
    $end = $text.IndexOf(");", $idx)
    if ($end -lt 0) {
      throw "Could not find end of ltxAudioProcessing state."
    }
    $insertAt = $end + 2

    $stateBlock = @'

  // OTG_VOICE_EFFECTS_UI_P2
  const [voiceEffectCategory, setVoiceEffectCategory] = useState<VoiceEffectCategory>("space_distance");
  const [voiceEffectId, setVoiceEffectId] = useState("far_away_voice");
  const [voiceEffectIntensity, setVoiceEffectIntensity] = useState<VoiceEffectIntensity>("medium");
  const [voiceEffectProcessing, setVoiceEffectProcessing] = useState<{ jobId: string; message: string } | null>(null);
  const [voiceEffectMessage, setVoiceEffectMessage] = useState("");
  const [voiceEffectOutputs, setVoiceEffectOutputs] = useState<Record<string, Array<{
    effectId: string;
    effectLabel: string;
    category: string;
    intensity: string;
    engine: string;
    audioPath: string;
    audioUrl: string;
  }>>>({});
'@

    $text = $text.Insert($insertAt, $stateBlock)
  }

  # 3. Add helper function before removeLtxBackgroundSoundEffects.
  if ($text -notmatch "async function applyVoiceEffectToSample") {
    $funcAnchorCandidates = @(
      "async function removeLtxBackgroundSoundEffects",
      "const removeLtxBackgroundSoundEffects",
      "function removeLtxBackgroundSoundEffects",
      "async function enhanceLtxVoice",
      "const enhanceLtxVoice",
      "function enhanceLtxVoice",
      "function renderVoicePipelineJobStatus"
    )

    $idx = -1
    foreach ($candidate in $funcAnchorCandidates) {
      $candidateIdx = $text.IndexOf($candidate)
      if ($candidateIdx -ge 0 -and ($idx -lt 0 -or $candidateIdx -lt $idx)) {
        $idx = $candidateIdx
      }
    }

    if ($idx -lt 0) {
      throw "Could not find a safe insertion point for applyVoiceEffectToSample."
    }

    $helper = @'
  async function applyVoiceEffectToSample(job: Record<string, unknown>, result: Record<string, unknown>) {
    // OTG_VOICE_EFFECTS_UI_P2: apply FFmpeg-backed effect preset to any completed local voice sample.
    const jobId = String(job.jobId || "").trim();
    if (!jobId) {
      setVoiceEffectMessage("Cannot apply effect because the voice job id is missing.");
      return;
    }

    const selectedPreset = VOICE_EFFECT_PRESETS.find((preset) => preset.id === voiceEffectId);
    if (!selectedPreset) {
      setVoiceEffectMessage("Select a valid voice effect preset.");
      return;
    }

    const inputPath = String(
      result.enhancedAudioPath ||
      result.isolatedAudioPath ||
      result.uploadedSamplePath ||
      result.outputAudioPath ||
      result.samplePath ||
      result.processedSamplePath ||
      result.fxSamplePath ||
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
      result.provider ||
      (job.input && typeof job.input === "object" && !Array.isArray(job.input) ? (job.input as Record<string, unknown>).provider : "") ||
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
      job.characterId ||
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
      message: `Applying ${selectedPreset.label} (${voiceEffectIntensity})...`,
    });
    setVoiceEffectMessage("");

    try {
      const response = await fetch("/api/characters/voice-sample/effect", {
        method: "POST",
        headers,
        body: JSON.stringify({
          provider,
          effectId: selectedPreset.id,
          intensity: voiceEffectIntensity,
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
        effectId: String(json.effectId || selectedPreset.id),
        effectLabel: String(json.effectLabel || selectedPreset.label),
        category: String(json.category || selectedPreset.category),
        intensity: String(json.intensity || voiceEffectIntensity),
        engine: String(json.engine || "ffmpeg"),
        audioPath: String(json.audioPath || ""),
        audioUrl: String(json.audioUrl || ""),
      };

      if (!output.audioUrl) {
        throw new Error("Voice effect completed but did not return an audio URL.");
      }

      setVoiceEffectOutputs((current) => ({
        ...current,
        [jobId]: [...(current[jobId] || []), output],
      }));
      setVoiceEffectMessage(String(json.message || `Voice effect created: ${selectedPreset.label}.`));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setVoiceEffectMessage(message || "Voice effect failed. Original audio is still available.");
    } finally {
      setVoiceEffectProcessing(null);
    }
  }

'@

    $text = $text.Insert($idx, $helper)
  }

  # 4. Add render-time derived variables after ltxProcessingThisJob.
  if ($text -notmatch "isVoiceEffectEligible") {
    $needle = 'const ltxProcessingThisJob = isCompletedLtxVoiceSample && ltxAudioProcessing.jobId === job?.jobId ? ltxAudioProcessing.action : "";'
    $idx = $text.IndexOf($needle)
    if ($idx -lt 0) {
      throw "Could not find ltxProcessingThisJob anchor."
    }
    $insertAt = $idx + $needle.Length

    $derived = @'

    const voiceEffectPresetsForCategory = VOICE_EFFECT_PRESETS.filter((preset) => preset.category === voiceEffectCategory);
    const selectedVoiceEffectPreset =
      voiceEffectPresetsForCategory.find((preset) => preset.id === voiceEffectId) ||
      voiceEffectPresetsForCategory[0] ||
      VOICE_EFFECT_PRESETS[0];
    const voiceEffectOutputsForJob = job?.jobId ? (voiceEffectOutputs[String(job.jobId)] || []) : [];
    const voiceEffectIsProcessing = Boolean(job?.jobId && voiceEffectProcessing?.jobId === String(job.jobId));
    const isVoiceEffectEligible =
      action === "create_voice_sample" &&
      completed &&
      result &&
      result.mock === false &&
      Boolean(String(
        result.enhancedAudioPath ||
        result.isolatedAudioPath ||
        result.uploadedSamplePath ||
        result.outputAudioPath ||
        result.samplePath ||
        result.processedSamplePath ||
        result.fxSamplePath ||
        builderCharacterVoiceProfile?.approvedSamplePath ||
        builderCharacterVoiceProfile?.tunedSamplePath ||
        builderCharacterVoiceProfile?.baseSamplePath ||
        ""
      ).trim());
'@

    $text = $text.Insert($insertAt, $derived)
  }

  # 5. Insert JSX before Technical Details block.
  if ($text -notmatch "Voice Effects</div>") {
    $anchor = '                {resultEntries.length ? ('
    $idx = $text.IndexOf($anchor)
    if ($idx -lt 0) {
      throw "Could not find resultEntries JSX anchor."
    }

    $jsx = @'
                {isVoiceEffectEligible ? (
                  <div className="mt-3 rounded-lg border border-violet-400/30 bg-violet-400/10 p-3 text-violet-100">
                    <div className="font-semibold">Voice Effects</div>
                    <div className="mt-1 text-xs text-violet-100/75">
                      Add space, machine, creature, alien, echo, distortion, robotic, or strange voice processing. The original audio is preserved.
                    </div>

                    <div className="mt-3 grid gap-2 sm:grid-cols-3">
                      <label className="text-xs text-violet-100/80">
                        Category
                        <select
                          value={voiceEffectCategory}
                          onChange={(event) => {
                            const nextCategory = event.target.value as VoiceEffectCategory;
                            const firstPreset = VOICE_EFFECT_PRESETS.find((preset) => preset.category === nextCategory);
                            setVoiceEffectCategory(nextCategory);
                            if (firstPreset) setVoiceEffectId(firstPreset.id);
                          }}
                          className="mt-1 w-full rounded-lg border border-violet-400/30 bg-zinc-950 px-2 py-2 text-xs text-violet-50"
                        >
                          {VOICE_EFFECT_CATEGORIES.map((category) => (
                            <option key={category.id} value={category.id}>{category.label}</option>
                          ))}
                        </select>
                      </label>

                      <label className="text-xs text-violet-100/80">
                        Preset
                        <select
                          value={selectedVoiceEffectPreset.id}
                          onChange={(event) => setVoiceEffectId(event.target.value)}
                          className="mt-1 w-full rounded-lg border border-violet-400/30 bg-zinc-950 px-2 py-2 text-xs text-violet-50"
                        >
                          {voiceEffectPresetsForCategory.map((preset) => (
                            <option key={preset.id} value={preset.id}>{preset.label}</option>
                          ))}
                        </select>
                      </label>

                      <label className="text-xs text-violet-100/80">
                        Intensity
                        <select
                          value={voiceEffectIntensity}
                          onChange={(event) => setVoiceEffectIntensity(event.target.value as VoiceEffectIntensity)}
                          className="mt-1 w-full rounded-lg border border-violet-400/30 bg-zinc-950 px-2 py-2 text-xs text-violet-50"
                        >
                          <option value="subtle">Subtle</option>
                          <option value="medium">Medium</option>
                          <option value="strong">Strong</option>
                        </select>
                      </label>
                    </div>

                    <div className="mt-2 text-xs text-violet-100/70">
                      {selectedVoiceEffectPreset.description}
                    </div>

                    <button
                      type="button"
                      onClick={() => job && result ? void applyVoiceEffectToSample(job as unknown as Record<string, unknown>, result) : undefined}
                      disabled={voiceEffectIsProcessing}
                      className="mt-3 rounded-lg border border-violet-300/60 bg-violet-300/10 px-3 py-2 text-xs font-bold text-violet-50 disabled:opacity-40 hover:bg-violet-300/20"
                    >
                      {voiceEffectIsProcessing ? "Applying Effect..." : "Apply Effect"}
                    </button>

                    {voiceEffectIsProcessing ? (
                      <div className="mt-2 text-xs text-amber-100">{voiceEffectProcessing?.message}</div>
                    ) : null}

                    {voiceEffectMessage ? (
                      <div className="mt-2 text-xs text-violet-100/80">{voiceEffectMessage}</div>
                    ) : null}

                    {voiceEffectOutputsForJob.length ? (
                      <div className="mt-3 space-y-3">
                        <div className="text-xs font-semibold text-violet-100">Processed Effects</div>
                        {voiceEffectOutputsForJob.map((output, index) => (
                          <div key={`${output.audioUrl}-${index}`} className="rounded-lg border border-violet-400/20 bg-black/20 p-2">
                            <div className="text-xs font-semibold text-violet-100">
                              {output.effectLabel} / {output.intensity} / {output.engine}
                            </div>
                            <audio
                              controls
                              preload="metadata"
                              src={output.audioUrl}
                              className="mt-2 w-full"
                            />
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}

'@

    $text = $text.Insert($idx, $jsx)
  }
}

[System.IO.File]::WriteAllText($PanelPath, $text, (New-Object System.Text.UTF8Encoding($false)))

if (Test-Path -LiteralPath $ChecklistPath) {
  $Checklist = Get-Content -LiteralPath $ChecklistPath -Raw
  $Marker = "Voice Effects UI Patch 2"
  if ($Checklist -notmatch [regex]::Escape($Marker)) {
    Add-Content -LiteralPath $ChecklistPath -Value "`r`n- [x] ${Marker}: added category/preset/intensity controls for FFmpeg-backed voice effects under completed voice samples. Original audio remains preserved.`r`n" -Encoding UTF8
  }
}

$checks = @(
  @{ Path = $PanelPath; Pattern = "OTG_VOICE_EFFECTS_UI_P2" },
  @{ Path = $PanelPath; Pattern = "applyVoiceEffectToSample" },
  @{ Path = $PanelPath; Pattern = "Voice Effects</div>" },
  @{ Path = $PanelPath; Pattern = "/api/characters/voice-sample/effect" },
  @{ Path = $PanelPath; Pattern = "VOICE_EFFECT_CATEGORIES" },
  @{ Path = $PanelPath; Pattern = "VOICE_EFFECT_PRESETS" }
)

foreach ($check in $checks) {
  if (!(Test-Path -LiteralPath $check.Path)) {
    throw "Verification failed. Missing file: $($check.Path)"
  }
  $fileText = Get-Content -LiteralPath $check.Path -Raw
  if ($fileText -notmatch [regex]::Escape($check.Pattern)) {
    throw "Verification failed. Missing marker '$($check.Pattern)' in $($check.Path)"
  }
}

Write-Host ""
Write-Host "SUCCESS"
Write-Host "Voice Effects UI Patch 2 installed."
Write-Host "Backup: $BackupRoot"
Write-Host ""
Write-Host "Next validation:"
Write-Host "  npm run lint -- --quiet"
Write-Host "  npx tsc --noEmit --pretty false"
Write-Host "  npm test"
