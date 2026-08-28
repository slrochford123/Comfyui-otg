$ErrorActionPreference = "Stop"

$Repo = "C:\AI\OTG-Test2"
$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$BackupRoot = Join-Path $Repo ".patch-backups\voice-effects-backend-p3b-$Stamp"

$Files = @(
  "app\api\characters\voice-sample\effect\route.ts",
  "app\app\components\CharactersPanel.tsx",
  "scripts\process_pedalboard_voice_fx.py",
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
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Path) | Out-Null
  $Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Content, $Utf8NoBom)
}

$RoutePath = Join-Path $Repo "app\api\characters\voice-sample\effect\route.ts"
$PanelPath = Join-Path $Repo "app\app\components\CharactersPanel.tsx"
$PedalboardScriptPath = Join-Path $Repo "scripts\process_pedalboard_voice_fx.py"
$ChecklistPath = Join-Path $Repo "docs\OTG_REWORK_CHECKLIST.md"

# ---------------------------------------------------------------------
# 1. Add Pedalboard processor script.
# ---------------------------------------------------------------------

$PedalboardScript = @'
# OTG_VOICE_EFFECTS_BACKEND_P3B_PEDALBOARD
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
from pedalboard import (
    Chorus,
    Compressor,
    Delay,
    Distortion,
    Gain,
    HighpassFilter,
    LowpassFilter,
    Pedalboard,
    Phaser,
    PitchShift,
    Reverb,
)
from pedalboard.io import AudioFile


def build_board(preset: str) -> Pedalboard:
    if preset == "pedalboard_studio":
        return Pedalboard([
            HighpassFilter(cutoff_frequency_hz=80),
            Compressor(threshold_db=-20, ratio=2.5),
            Chorus(rate_hz=0.8, depth=0.18, mix=0.15),
            Reverb(room_size=0.18, damping=0.65, wet_level=0.10, dry_level=0.90),
            Gain(gain_db=1.5),
        ])

    if preset == "pedalboard_distortion":
        return Pedalboard([
            HighpassFilter(cutoff_frequency_hz=110),
            Distortion(drive_db=22),
            Compressor(threshold_db=-18, ratio=3.5),
            LowpassFilter(cutoff_frequency_hz=7600),
            Gain(gain_db=-2.0),
        ])

    if preset == "pedalboard_phaser":
        return Pedalboard([
            HighpassFilter(cutoff_frequency_hz=90),
            Phaser(rate_hz=0.65, depth=0.70, centre_frequency_hz=950, feedback=0.25, mix=0.55),
            Compressor(threshold_db=-18, ratio=2.0),
            Gain(gain_db=1.0),
        ])

    if preset == "pedalboard_chorus":
        return Pedalboard([
            Chorus(rate_hz=1.15, depth=0.42, centre_delay_ms=8.0, feedback=0.10, mix=0.38),
            Compressor(threshold_db=-18, ratio=2.0),
            Gain(gain_db=1.0),
        ])

    if preset == "pedalboard_delay":
        return Pedalboard([
            Delay(delay_seconds=0.22, feedback=0.28, mix=0.28),
            Compressor(threshold_db=-18, ratio=2.0),
            Gain(gain_db=0.5),
        ])

    if preset == "pedalboard_reverb":
        return Pedalboard([
            Reverb(room_size=0.55, damping=0.45, wet_level=0.32, dry_level=0.82),
            Compressor(threshold_db=-19, ratio=2.0),
            Gain(gain_db=0.5),
        ])

    if preset == "pedalboard_pitch_shift":
        return Pedalboard([
            PitchShift(semitones=4.0),
            Chorus(rate_hz=0.9, depth=0.20, mix=0.18),
            Compressor(threshold_db=-18, ratio=2.2),
        ])

    if preset == "pedalboard_plugin_chain":
        # Placeholder chain until VST3/plugin paths are formally supported.
        return Pedalboard([
            HighpassFilter(cutoff_frequency_hz=100),
            Distortion(drive_db=10),
            Phaser(rate_hz=0.45, depth=0.45, mix=0.25),
            Delay(delay_seconds=0.12, feedback=0.18, mix=0.16),
            Reverb(room_size=0.28, wet_level=0.16, dry_level=0.88),
            Compressor(threshold_db=-18, ratio=2.5),
        ])

    if preset == "pedalboard_vst3_presets":
        # Future VST3 placeholder: usable studio chain now, VST loader later.
        return Pedalboard([
            HighpassFilter(cutoff_frequency_hz=90),
            Chorus(rate_hz=0.7, depth=0.22, mix=0.20),
            Phaser(rate_hz=0.35, depth=0.35, mix=0.18),
            Reverb(room_size=0.22, wet_level=0.14, dry_level=0.90),
            Compressor(threshold_db=-18, ratio=2.0),
        ])

    raise ValueError(f"Unsupported Pedalboard preset: {preset}")


def read_audio(path: Path):
    with AudioFile(str(path), "r") as f:
        audio = f.read(f.frames)
        sample_rate = f.samplerate
    if audio.ndim == 1:
        audio = audio.reshape(1, -1)
    audio = np.asarray(audio, dtype=np.float32)
    return audio, sample_rate


def write_audio(path: Path, audio, sample_rate: int):
    path.parent.mkdir(parents=True, exist_ok=True)
    audio = np.nan_to_num(audio, nan=0.0, posinf=0.0, neginf=0.0)
    audio = np.clip(audio, -1.0, 1.0).astype(np.float32)
    with AudioFile(str(path), "w", sample_rate, audio.shape[0]) as f:
        f.write(audio)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--preset", required=True)
    args = parser.parse_args()

    input_path = Path(args.input)
    output_path = Path(args.output)

    if not input_path.is_file():
        raise FileNotFoundError(f"Input audio not found: {input_path}")

    board = build_board(args.preset)
    audio, sample_rate = read_audio(input_path)
    processed = board(audio, sample_rate)
    write_audio(output_path, processed, sample_rate)

    print(f"pedalboard preset={args.preset} input={input_path} output={output_path} sample_rate={sample_rate}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise
'@

Write-Utf8NoBom -Path $PedalboardScriptPath -Content $PedalboardScript

# ---------------------------------------------------------------------
# 2. Patch backend route.
# ---------------------------------------------------------------------

$route = Get-Content -LiteralPath $RoutePath -Raw

if ($route -notmatch "OTG_VOICE_EFFECTS_BACKEND_P3B") {
  if ($route -notmatch 'import fs from "node:fs/promises";') {
    throw "Unexpected route shape: missing fs import."
  }

  if ($route -notmatch 'import path from "node:path";') {
    throw "Unexpected route shape: missing path import."
  }

  # Add constants and resolvers after SupportedProvider.
  $supportedProviderPattern = 'type SupportedProvider = "qwen3" \| "cosy" \| "ltx" \| "unnatural_ltx" \| "uploaded";'
  $supportedProviderReplacement = @'
type SupportedProvider = "qwen3" | "cosy" | "ltx" | "unnatural_ltx" | "uploaded";

/* OTG_VOICE_EFFECTS_BACKEND_P3B */
type VoiceEffectEngine = "ffmpeg" | "pedalboard" | "sox";

const PEDALBOARD_PRESET_IDS = new Set([
  "pedalboard_studio",
  "pedalboard_distortion",
  "pedalboard_phaser",
  "pedalboard_chorus",
  "pedalboard_delay",
  "pedalboard_reverb",
  "pedalboard_pitch_shift",
  "pedalboard_plugin_chain",
  "pedalboard_vst3_presets",
]);

const SOX_PRESET_IDS = new Set([
  "sox_synthwave",
  "sox_chip",
  "sox_overdrive",
  "sox_echo_filtering",
  "sox_max_conversion",
]);

function resolveEffectEngine(effectId: string, requested: unknown): VoiceEffectEngine {
  const explicit = String(requested || "").trim().toLowerCase();
  if (explicit === "pedalboard" || PEDALBOARD_PRESET_IDS.has(effectId)) return "pedalboard";
  if (explicit === "sox" || SOX_PRESET_IDS.has(effectId)) return "sox";
  return "ffmpeg";
}

function resolvePythonPath() {
  return process.env.OTG_PYTHON_EXE || process.env.PYTHON_EXE || "python";
}

async function resolveSoxPath() {
  const candidates = [
    process.env.SOX_EXE,
    "C:\\Program Files (x86)\\sox-14-4-2\\sox.exe",
    "C:\\Program Files\\sox-14-4-2\\sox.exe",
    "sox",
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    if (candidate === "sox") return candidate;
    try {
      const stat = await fs.stat(candidate);
      if (stat.isFile()) return candidate;
    } catch {
      // try next
    }
  }

  return "sox";
}

function soxArgsForPreset(preset: string, inputPath: string, outputPath: string) {
  const base = [inputPath, "-r", "48000", "-c", "1", outputPath];

  if (preset === "sox_synthwave") {
    return [
      ...base,
      "gain", "-n", "-3",
      "pitch", "-250",
      "chorus", "0.6", "0.8", "55", "0.35", "0.25", "2.0",
      "echo", "0.8", "0.45", "90", "0.25",
      "compand", "0.02,0.20", "6:-70,-60,-20", "-5", "-90", "0.2",
    ];
  }

  if (preset === "sox_chip") {
    return [
      ...base,
      "gain", "-n", "-4",
      "rate", "11025",
      "rate", "48000",
      "pitch", "450",
      "overdrive", "8", "18",
      "compand", "0.01,0.12", "6:-70,-55,-18", "-6", "-90", "0.2",
    ];
  }

  if (preset === "sox_overdrive") {
    return [
      ...base,
      "gain", "-n", "-6",
      "overdrive", "22", "18",
      "bass", "+3",
      "treble", "+2",
      "compand", "0.02,0.18", "6:-70,-58,-16", "-5", "-90", "0.2",
    ];
  }

  if (preset === "sox_echo_filtering") {
    return [
      ...base,
      "highpass", "220",
      "lowpass", "4200",
      "echo", "0.8", "0.42", "120", "0.28",
      "echo", "0.8", "0.25", "240", "0.18",
      "gain", "-n", "-3",
    ];
  }

  if (preset === "sox_max_conversion") {
    return [
      ...base,
      "gain", "-n", "-2",
      "highpass", "80",
      "lowpass", "12000",
      "compand", "0.02,0.20", "6:-70,-60,-18", "-5", "-90", "0.2",
      "norm", "-1",
    ];
  }

  throw new Error(`Unsupported SoX preset: ${preset}`);
}

async function convertToWorkingWav(inputPath: string, outputPath: string) {
  const ffmpeg = resolveFfmpegPath();
  const result = await runCmd(ffmpeg, [
    "-y",
    "-hide_banner",
    "-i",
    inputPath,
    "-vn",
    "-ar",
    "48000",
    "-ac",
    "1",
    outputPath,
  ], { timeoutMs: 5 * 60 * 1000 });

  if (result.code !== 0) {
    throw new Error((result.stderr || result.stdout || "ffmpeg conversion failed").slice(0, 2000));
  }

  if (!(await fileExists(outputPath))) {
    throw new Error("ffmpeg conversion completed but did not create working WAV.");
  }
}
'@

  $route = [regex]::Replace($route, [regex]::Escape($supportedProviderPattern), $supportedProviderReplacement, 1)

  # Add processors after processVoiceEffect function.
  $processVoiceEffectEnd = @'
  return { engine: "ffmpeg", elapsedMs };
}
'@

  if ($route.IndexOf($processVoiceEffectEnd) -lt 0) {
    throw "Could not find processVoiceEffect end anchor."
  }

  $extraProcessors = @'

async function processPedalboardEffect(args: {
  inputPath: string;
  outputPath: string;
  preset: string;
  workDir: string;
}) {
  const started = Date.now();
  const workingInput = path.join(args.workDir, "pedalboard-input.wav");
  await convertToWorkingWav(args.inputPath, workingInput);

  const python = resolvePythonPath();
  const scriptPath = path.join(process.cwd(), "scripts", "process_pedalboard_voice_fx.py");
  const result = await runCmd(python, [
    scriptPath,
    "--input",
    workingInput,
    "--output",
    args.outputPath,
    "--preset",
    args.preset,
  ], { timeoutMs: 5 * 60 * 1000 });

  const elapsedMs = Date.now() - started;

  if (result.code !== 0) {
    throw new Error((result.stderr || result.stdout || "pedalboard failed").slice(0, 2000));
  }

  if (!(await fileExists(args.outputPath))) {
    throw new Error("Pedalboard completed but did not create output audio.");
  }

  return { engine: "pedalboard", elapsedMs };
}

async function processSoxEffect(args: {
  inputPath: string;
  outputPath: string;
  preset: string;
  workDir: string;
}) {
  const started = Date.now();
  const workingInput = path.join(args.workDir, "sox-input.wav");
  await convertToWorkingWav(args.inputPath, workingInput);

  const sox = await resolveSoxPath();
  const result = await runCmd(sox, soxArgsForPreset(args.preset, workingInput, args.outputPath), {
    timeoutMs: 5 * 60 * 1000,
  });

  const elapsedMs = Date.now() - started;

  if (result.code !== 0) {
    throw new Error((result.stderr || result.stdout || "sox failed").slice(0, 2000));
  }

  if (!(await fileExists(args.outputPath))) {
    throw new Error("SoX completed but did not create output audio.");
  }

  return { engine: "sox", elapsedMs };
}
'@

  $route = $route.Replace($processVoiceEffectEnd, $processVoiceEffectEnd + $extraProcessors)

  # Replace preset validation section with engine-aware validation.
  $oldValidation = @'
    const preset = findVoiceEffectPreset(effectId);
    if (!preset) return jsonError("Unknown voice effect preset.", 404);

    const intensityRaw = String(body.intensity || "medium").trim();
    const intensity: VoiceEffectIntensity = isVoiceEffectIntensity(intensityRaw) ? intensityRaw : "medium";
    const filter = preset.filterByIntensity[intensity];

    if (!filter) return jsonError("Voice effect preset has no filter for this intensity.", 500);
'@

  $newValidation = @'
    const engine = resolveEffectEngine(effectId, body.engine || body.effectEngine);
    const preset = engine === "ffmpeg" ? findVoiceEffectPreset(effectId) : null;

    if (engine === "ffmpeg" && !preset) return jsonError("Unknown FFmpeg voice effect preset.", 404);
    if (engine === "pedalboard" && !PEDALBOARD_PRESET_IDS.has(effectId)) return jsonError("Unknown Pedalboard voice effect preset.", 404);
    if (engine === "sox" && !SOX_PRESET_IDS.has(effectId)) return jsonError("Unknown SoX voice effect preset.", 404);

    const intensityRaw = String(body.intensity || "medium").trim();
    const intensity: VoiceEffectIntensity = isVoiceEffectIntensity(intensityRaw) ? intensityRaw : "medium";
    const filter = preset?.filterByIntensity[intensity] || "";

    if (engine === "ffmpeg" && !filter) return jsonError("Voice effect preset has no filter for this intensity.", 500);
'@

  if ($route.IndexOf($oldValidation) -lt 0) {
    throw "Could not find validation block to replace."
  }

  $route = $route.Replace($oldValidation, $newValidation)

  # Insert workDir and engine output filename.
  $oldOutputSetup = @'
    const outputFileName = `voice-effect-${safeSegment(effectId)}-${safeSegment(intensity)}-${effectRunId}.wav`;
    const outputPath = safeJoin(outputDir, outputFileName);

    const method = await processVoiceEffect({
      inputPath: resolvedInput.path,
      outputPath,
      filter,
    });
'@

  $newOutputSetup = @'
    const outputFileName = `voice-effect-${safeSegment(effectId)}-${safeSegment(intensity)}-${effectRunId}.wav`;
    const outputPath = safeJoin(outputDir, outputFileName);
    const workDir = safeJoin(outputDir, `.work-${safeSegment(effectRunId)}`);
    await fs.mkdir(workDir, { recursive: true });

    const method =
      engine === "pedalboard"
        ? await processPedalboardEffect({
            inputPath: resolvedInput.path,
            outputPath,
            preset: effectId,
            workDir,
          })
        : engine === "sox"
          ? await processSoxEffect({
              inputPath: resolvedInput.path,
              outputPath,
              preset: effectId,
              workDir,
            })
          : await processVoiceEffect({
              inputPath: resolvedInput.path,
              outputPath,
              filter,
            });
'@

  if ($route.IndexOf($oldOutputSetup) -lt 0) {
    throw "Could not find output setup block to replace."
  }

  $route = $route.Replace($oldOutputSetup, $newOutputSetup)

  # Patch category/label response references for non-ffmpeg presets.
  $route = $route.Replace('category: preset.category,', 'category: preset?.category || engine,')
  $route = $route.Replace('effectLabel: preset.label,', 'effectLabel: preset?.label || safeSegment(effectId),')
  $route = $route.Replace('message: `Voice effect created: ${preset.label} (${intensity}).`,', 'message: `Voice effect created: ${(preset?.label || safeSegment(effectId))} (${intensity}).`,')
  $route = $route.Replace('category: String(json.category || preset.category),', 'category: String(json.category || preset?.category || engine),')

  Write-Utf8NoBom -Path $RoutePath -Content $route
}

# ---------------------------------------------------------------------
# 3. Patch real Voice FX page UI buttons.
# ---------------------------------------------------------------------

$panel = Get-Content -LiteralPath $PanelPath -Raw

if ($panel -notmatch "OTG_VOICE_EFFECTS_BACKEND_P3B_UI") {
  $panel = $panel.Replace(
    '                          <button
                            type="button"
                            disabled
                            className="mt-3 rounded-xl border border-fuchsia-400 px-3 py-1.5 text-xs font-semibold text-fuchsia-100 opacity-40"
                          >
                            Pedalboard Backend Pending
                          </button>',
    '                          {/* OTG_VOICE_EFFECTS_BACKEND_P3B_UI */}
                          <button
                            type="button"
                            onClick={() => void applyVoiceFxPageEffect({
                              effectId: pedalboardPresetId,
                              intensity: voiceEffectIntensity,
                              label: `Pedalboard: ${pedalboardAdvancedOptions.find((option) => option.id === pedalboardPresetId)?.label || pedalboardPresetId}`,
                            })}
                            disabled={voiceEffectProcessing?.jobId === getVoiceFxPageJobId()}
                            className="mt-3 rounded-xl border border-fuchsia-400 px-3 py-1.5 text-xs font-semibold text-fuchsia-100 disabled:opacity-40"
                          >
                            {voiceEffectProcessing?.jobId === getVoiceFxPageJobId() ? "Applying..." : "Add Pedalboard Effect"}
                          </button>'
  )

  $panel = $panel.Replace(
    '                          <button
                            type="button"
                            disabled
                            className="mt-3 rounded-xl border border-orange-400 px-3 py-1.5 text-xs font-semibold text-orange-100 opacity-40"
                          >
                            SoX Backend Pending
                          </button>',
    '                          <button
                            type="button"
                            onClick={() => void applyVoiceFxPageEffect({
                              effectId: soxPresetId,
                              intensity: voiceEffectIntensity,
                              label: `SoX: ${soxAdvancedOptions.find((option) => option.id === soxPresetId)?.label || soxPresetId}`,
                            })}
                            disabled={voiceEffectProcessing?.jobId === getVoiceFxPageJobId()}
                            className="mt-3 rounded-xl border border-orange-400 px-3 py-1.5 text-xs font-semibold text-orange-100 disabled:opacity-40"
                          >
                            {voiceEffectProcessing?.jobId === getVoiceFxPageJobId() ? "Applying..." : "Add SoX Effect"}
                          </button>'
  )

  if ($panel -notmatch "Add Pedalboard Effect") {
    throw "UI replacement failed: Add Pedalboard Effect not found."
  }
  if ($panel -notmatch "Add SoX Effect") {
    throw "UI replacement failed: Add SoX Effect not found."
  }

  Write-Utf8NoBom -Path $PanelPath -Content $panel
}

# ---------------------------------------------------------------------
# 4. Checklist update.
# ---------------------------------------------------------------------

if (Test-Path -LiteralPath $ChecklistPath) {
  $Checklist = Get-Content -LiteralPath $ChecklistPath -Raw
  $Marker = "Voice Effects Backend Patch 3B"
  if ($Checklist -notmatch [regex]::Escape($Marker)) {
    Add-Content -LiteralPath $ChecklistPath -Value "`r`n- [x] ${Marker}: wired Pedalboard and SoX backend preset execution into the voice-sample effect route and enabled the real Voice FX page buttons. Manual unlocked controls remain Patch 3C.`r`n" -Encoding UTF8
  }
}

# ---------------------------------------------------------------------
# 5. Verification.
# ---------------------------------------------------------------------

$RouteText = Get-Content -LiteralPath $RoutePath -Raw
$PanelText = Get-Content -LiteralPath $PanelPath -Raw
$ScriptText = Get-Content -LiteralPath $PedalboardScriptPath -Raw

$checks = @(
  @{ Name = "route marker"; Text = $RouteText; Pattern = "OTG_VOICE_EFFECTS_BACKEND_P3B" },
  @{ Name = "pedalboard processor"; Text = $RouteText; Pattern = "processPedalboardEffect" },
  @{ Name = "sox processor"; Text = $RouteText; Pattern = "processSoxEffect" },
  @{ Name = "pedalboard preset ids"; Text = $RouteText; Pattern = "PEDALBOARD_PRESET_IDS" },
  @{ Name = "sox preset ids"; Text = $RouteText; Pattern = "SOX_PRESET_IDS" },
  @{ Name = "pedalboard script marker"; Text = $ScriptText; Pattern = "OTG_VOICE_EFFECTS_BACKEND_P3B_PEDALBOARD" },
  @{ Name = "ui marker"; Text = $PanelText; Pattern = "OTG_VOICE_EFFECTS_BACKEND_P3B_UI" },
  @{ Name = "ui pedalboard enabled"; Text = $PanelText; Pattern = "Add Pedalboard Effect" },
  @{ Name = "ui sox enabled"; Text = $PanelText; Pattern = "Add SoX Effect" }
)

foreach ($check in $checks) {
  if ($check.Text -notmatch [regex]::Escape($check.Pattern)) {
    throw "Verification failed: $($check.Name) missing pattern '$($check.Pattern)'"
  }
}

Write-Host ""
Write-Host "SUCCESS"
Write-Host "Voice Effects Backend Patch 3B installed."
Write-Host "Backup: $BackupRoot"
Write-Host ""
Write-Host "Next validation:"
Write-Host "  python -m py_compile scripts\process_pedalboard_voice_fx.py"
Write-Host "  npm run lint -- --quiet"
Write-Host "  npx tsc --noEmit --pretty false"
Write-Host "  npm test"