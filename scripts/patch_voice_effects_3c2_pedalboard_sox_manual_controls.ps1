$ErrorActionPreference = "Stop"

$Repo = "C:\AI\OTG-Test2"
$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$BackupRoot = Join-Path $Repo ".patch-backups\voice-effects-3c2-pedalboard-sox-manual-$Stamp"

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
  $Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Content, $Utf8NoBom)
}

$RoutePath = Join-Path $Repo "app\api\characters\voice-sample\effect\route.ts"
$PanelPath = Join-Path $Repo "app\app\components\CharactersPanel.tsx"
$PedalboardPath = Join-Path $Repo "scripts\process_pedalboard_voice_fx.py"
$ChecklistPath = Join-Path $Repo "docs\OTG_REWORK_CHECKLIST.md"

# ---------------------------------------------------------------------
# 1. Replace Pedalboard processor with controls-aware version.
# ---------------------------------------------------------------------

$PedalboardScript = @'
# OTG_VOICE_EFFECTS_BACKEND_P3B_PEDALBOARD
# OTG_VOICE_EFFECTS_3C2_PEDALBOARD_CONTROLS
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Dict

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


def clamp(value: Any, low: float, high: float, fallback: float) -> float:
    try:
        numeric = float(value)
    except Exception:
        return fallback
    if not np.isfinite(numeric):
        return fallback
    return max(low, min(high, numeric))


def parse_controls(raw: str | None) -> Dict[str, Any]:
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, dict):
            return parsed
    except Exception:
        pass
    return {}


def build_custom_board(controls: Dict[str, Any]) -> Pedalboard:
    drive_db = clamp(controls.get("driveDb"), 0, 40, 0)
    phaser_rate = clamp(controls.get("phaserRate"), 0, 5, 0)
    phaser_depth = clamp(controls.get("phaserDepth"), 0, 1, 0)
    chorus_rate = clamp(controls.get("chorusRate"), 0, 8, 0)
    chorus_depth = clamp(controls.get("chorusDepth"), 0, 1, 0)
    delay_seconds = clamp(controls.get("delayMs"), 0, 900, 0) / 1000.0
    delay_feedback = clamp(controls.get("delayFeedback"), 0, 0.95, 0)
    delay_mix = clamp(controls.get("delayMix"), 0, 1, 0)
    reverb_room = clamp(controls.get("reverbRoomSize"), 0, 1, 0)
    reverb_wet = clamp(controls.get("reverbWet"), 0, 1, 0)
    pitch_semitones = clamp(controls.get("pitchSemitones"), -12, 12, 0)
    highpass_hz = clamp(controls.get("highpassHz"), 20, 1200, 80)
    lowpass_hz = clamp(controls.get("lowpassHz"), 1200, 20000, 12000)
    compression = clamp(controls.get("compression"), 0, 100, 30)
    gain_db = clamp(controls.get("gainDb"), -12, 12, 0)

    plugins = []

    if highpass_hz > 20:
        plugins.append(HighpassFilter(cutoff_frequency_hz=highpass_hz))

    if abs(pitch_semitones) >= 0.05:
        plugins.append(PitchShift(semitones=pitch_semitones))

    if drive_db > 0:
        plugins.append(Distortion(drive_db=drive_db))

    if phaser_rate > 0 and phaser_depth > 0:
        plugins.append(Phaser(rate_hz=phaser_rate, depth=phaser_depth, centre_frequency_hz=950, feedback=0.20, mix=0.45))

    if chorus_rate > 0 and chorus_depth > 0:
        plugins.append(Chorus(rate_hz=chorus_rate, depth=chorus_depth, centre_delay_ms=8.0, feedback=0.10, mix=0.35))

    if delay_seconds > 0 and delay_mix > 0:
        plugins.append(Delay(delay_seconds=delay_seconds, feedback=delay_feedback, mix=delay_mix))

    if reverb_room > 0 and reverb_wet > 0:
        plugins.append(Reverb(room_size=reverb_room, damping=0.45, wet_level=reverb_wet, dry_level=max(0.25, 1.0 - reverb_wet)))

    if lowpass_hz < 20000:
        plugins.append(LowpassFilter(cutoff_frequency_hz=lowpass_hz))

    if compression > 0:
        ratio = 1.5 + (compression / 100.0) * 3.5
        plugins.append(Compressor(threshold_db=-18, ratio=ratio))

    if abs(gain_db) >= 0.05:
        plugins.append(Gain(gain_db=gain_db))

    if not plugins:
        plugins.append(Gain(gain_db=0.0))

    return Pedalboard(plugins)


def build_board(preset: str, controls: Dict[str, Any] | None = None) -> Pedalboard:
    controls = controls or {}
    if controls:
        return build_custom_board(controls)

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
        return Pedalboard([
            HighpassFilter(cutoff_frequency_hz=100),
            Distortion(drive_db=10),
            Phaser(rate_hz=0.45, depth=0.45, mix=0.25),
            Delay(delay_seconds=0.12, feedback=0.18, mix=0.16),
            Reverb(room_size=0.28, wet_level=0.16, dry_level=0.88),
            Compressor(threshold_db=-18, ratio=2.5),
        ])

    if preset == "pedalboard_vst3_presets":
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
    parser.add_argument("--controls", required=False, default="")
    args = parser.parse_args()

    input_path = Path(args.input)
    output_path = Path(args.output)

    if not input_path.is_file():
        raise FileNotFoundError(f"Input audio not found: {input_path}")

    controls = parse_controls(args.controls)
    board = build_board(args.preset, controls)
    audio, sample_rate = read_audio(input_path)
    processed = board(audio, sample_rate)
    write_audio(output_path, processed, sample_rate)

    mode = "custom" if controls else "preset"
    print(f"pedalboard mode={mode} preset={args.preset} input={input_path} output={output_path} sample_rate={sample_rate}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise
'@

Write-Utf8NoBom -Path $PedalboardPath -Content $PedalboardScript

# ---------------------------------------------------------------------
# 2. Backend route: pass controls to Pedalboard and SoX.
# ---------------------------------------------------------------------

$route = Get-Content -LiteralPath $RoutePath -Raw

if ($route -notmatch "OTG_VOICE_EFFECTS_3C2_ROUTE_CONTROLS") {
  $insertAnchor = 'async function processPedalboardEffect(args: {'
  $idx = $route.IndexOf($insertAnchor)
  if ($idx -lt 0) {
    throw "Could not find processPedalboardEffect anchor."
  }

  $routeControlsBlock = @'
/* OTG_VOICE_EFFECTS_3C2_ROUTE_CONTROLS */
function serializeEffectControls(rawControls: unknown) {
  if (!rawControls || typeof rawControls !== "object" || Array.isArray(rawControls)) return "";
  return JSON.stringify(rawControls);
}

function soxArgsForCustomControls(rawControls: unknown, inputPath: string, outputPath: string) {
  if (!rawControls || typeof rawControls !== "object" || Array.isArray(rawControls)) return null;

  const controls = rawControls as Record<string, unknown>;
  const base = [inputPath, "-r", "48000", "-c", "1", outputPath];
  const effects: string[] = [];

  const pitchCents = Math.round(clampNumber(controls.pitchCents, -1200, 1200, 0));
  const tempo = clampNumber(controls.tempo, 0.5, 2, 1);
  const overdriveGain = clampNumber(controls.overdriveGain, 0, 40, 0);
  const overdriveColour = clampNumber(controls.overdriveColour, 0, 100, 20);
  const echoDelayMs = Math.round(clampNumber(controls.echoDelayMs, 0, 900, 0));
  const echoDecay = clampNumber(controls.echoDecay, 0, 0.9, 0);
  const highpassHz = Math.round(clampNumber(controls.highpassHz, 20, 1200, 80));
  const lowpassHz = Math.round(clampNumber(controls.lowpassHz, 1200, 20000, 12000));
  const chorusDelayMs = clampNumber(controls.chorusDelayMs, 0, 120, 0);
  const chorusDecay = clampNumber(controls.chorusDecay, 0, 1, 0);
  const bassDb = clampNumber(controls.bassDb, -12, 12, 0);
  const trebleDb = clampNumber(controls.trebleDb, -12, 12, 0);
  const gainDb = clampNumber(controls.gainDb, -12, 12, 0);
  const normalize = Boolean(controls.normalize);

  if (highpassHz > 20) effects.push("highpass", String(highpassHz));
  if (lowpassHz < 20000) effects.push("lowpass", String(lowpassHz));
  if (pitchCents !== 0) effects.push("pitch", String(pitchCents));
  if (Math.abs(tempo - 1) >= 0.01) effects.push("tempo", tempo.toFixed(3));
  if (overdriveGain > 0) effects.push("overdrive", overdriveGain.toFixed(1), overdriveColour.toFixed(1));
  if (echoDelayMs > 0 && echoDecay > 0) effects.push("echo", "0.8", "0.45", String(echoDelayMs), echoDecay.toFixed(3));
  if (chorusDelayMs > 0 && chorusDecay > 0) {
    effects.push("chorus", "0.6", "0.8", chorusDelayMs.toFixed(1), chorusDecay.toFixed(3), "0.25", "2.0");
  }
  if (Math.abs(bassDb) >= 0.1) effects.push("bass", bassDb.toFixed(1));
  if (Math.abs(trebleDb) >= 0.1) effects.push("treble", trebleDb.toFixed(1));
  if (Math.abs(gainDb) >= 0.1) effects.push("gain", gainDb.toFixed(1));
  if (normalize) effects.push("norm", "-1");

  if (!effects.length) return null;
  return [...base, ...effects];
}

'@

  $route = $route.Insert($idx, $routeControlsBlock)

  # Add controls?: unknown to processPedalboardEffect args.
  $route = $route.Replace(
'  preset: string;
  workDir: string;
}) {',
'  preset: string;
  workDir: string;
  controls?: unknown;
}) {'
  )

  # Add --controls to Pedalboard command only inside the runCmd argument list.
  $oldPedalboardRun = @'
    "--preset",
    args.preset,
  ], { timeoutMs: 5 * 60 * 1000 });
'@
  $newPedalboardRun = @'
    "--preset",
    args.preset,
    "--controls",
    serializeEffectControls(args.controls),
  ], { timeoutMs: 5 * 60 * 1000 });
'@

  if ($route.IndexOf($oldPedalboardRun) -lt 0) {
    throw "Could not find Pedalboard runCmd preset block."
  }
  $route = $route.Replace($oldPedalboardRun, $newPedalboardRun)

  # Add controls?: unknown to processSoxEffect args.
  $route = $route.Replace(
'  preset: string;
  workDir: string;
}) {',
'  preset: string;
  workDir: string;
  controls?: unknown;
}) {'
  )

  # Replace SoX runCmd args.
  $oldSoxRun = @'
  const sox = await resolveSoxPath();
  const result = await runCmd(sox, soxArgsForPreset(args.preset, workingInput, args.outputPath), {
    timeoutMs: 5 * 60 * 1000,
  });
'@
  $newSoxRun = @'
  const sox = await resolveSoxPath();
  const customSoxArgs = soxArgsForCustomControls(args.controls, workingInput, args.outputPath);
  const result = await runCmd(sox, customSoxArgs || soxArgsForPreset(args.preset, workingInput, args.outputPath), {
    timeoutMs: 5 * 60 * 1000,
  });
'@

  if ($route.IndexOf($oldSoxRun) -lt 0) {
    throw "Could not find SoX runCmd block."
  }
  $route = $route.Replace($oldSoxRun, $newSoxRun)

  # Pass controls into process calls.
  $route = $route.Replace(
'            preset: effectId,
            workDir,
          })',
'            preset: effectId,
            workDir,
            controls: body.controls || body.customControls,
          })'
  )

  Write-Utf8NoBom -Path $RoutePath -Content $route
}

# ---------------------------------------------------------------------
# 3. Frontend: add Pedalboard and SoX manual control state.
# ---------------------------------------------------------------------

$panel = Get-Content -LiteralPath $PanelPath -Raw

if ($panel -notmatch "OTG_VOICE_EFFECTS_3C2_PEDALBOARD_SOX_MANUAL_STATE") {
  $anchor = 'const [soxControlsUnlocked, setSoxControlsUnlocked] = useState(false);'
  $idx = $panel.IndexOf($anchor)
  if ($idx -lt 0) {
    throw "Could not find soxControlsUnlocked state anchor."
  }

  $stateBlock = @'

  // OTG_VOICE_EFFECTS_3C2_PEDALBOARD_SOX_MANUAL_STATE
  const [pedalboardManualControls, setPedalboardManualControls] = useState({
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
  });

  const [soxManualControls, setSoxManualControls] = useState({
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
  });

  function setPedalboardManualControl(key: keyof typeof pedalboardManualControls, value: number) {
    setPedalboardManualControls((current) => ({
      ...current,
      [key]: value,
    }));
  }

  function setSoxManualControl(key: keyof typeof soxManualControls, value: number | boolean) {
    setSoxManualControls((current) => ({
      ...current,
      [key]: value,
    }));
  }
'@

  $panel = $panel.Insert($idx + $anchor.Length, $stateBlock)
}

# ---------------------------------------------------------------------
# 4. Frontend: insert Pedalboard manual UI before Pedalboard button.
# ---------------------------------------------------------------------

if ($panel -notmatch "OTG_VOICE_EFFECTS_3C2_PEDALBOARD_MANUAL_UI") {
  $boxStart = $panel.IndexOf('<p className="text-sm font-semibold text-fuchsia-100">Spotify Pedalboard</p>')
  if ($boxStart -lt 0) {
    throw "Could not find Pedalboard box."
  }

  $buttonIdx = $panel.IndexOf('<button', $boxStart)
  while ($buttonIdx -ge 0) {
    $near = $panel.Substring($buttonIdx, [Math]::Min(900, $panel.Length - $buttonIdx))
    if ($near -match 'applyVoiceFxPageEffect\(\{\s*effectId:\s*pedalboardPresetId') {
      break
    }
    $buttonIdx = $panel.IndexOf('<button', $buttonIdx + 7)
  }

  if ($buttonIdx -lt 0) {
    throw "Could not find Pedalboard apply button."
  }

  $pedalboardUi = @'
                          {pedalboardControlsUnlocked ? (
                            <div className="mt-3 rounded-xl border border-fuchsia-400/20 bg-black/20 p-3">
                              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-fuchsia-100">Pedalboard Manual Controls</p>{/* OTG_VOICE_EFFECTS_3C2_PEDALBOARD_MANUAL_UI */}
                              <p className="mt-1 text-xs text-zinc-400">These values override the locked Pedalboard preset for this effect only.</p>

                              <div className="mt-3 grid gap-3 md:grid-cols-2">
                                <label className="block text-xs text-zinc-300">Drive: {pedalboardManualControls.driveDb} dB<input type="range" min={0} max={40} step={1} value={pedalboardManualControls.driveDb} onChange={(event) => setPedalboardManualControl("driveDb", Number(event.target.value))} className="mt-1 w-full accent-fuchsia-300" /></label>
                                <label className="block text-xs text-zinc-300">Pitch: {pedalboardManualControls.pitchSemitones} semitones<input type="range" min={-12} max={12} step={1} value={pedalboardManualControls.pitchSemitones} onChange={(event) => setPedalboardManualControl("pitchSemitones", Number(event.target.value))} className="mt-1 w-full accent-fuchsia-300" /></label>
                                <label className="block text-xs text-zinc-300">Phaser Rate: {pedalboardManualControls.phaserRate}<input type="range" min={0} max={5} step={0.1} value={pedalboardManualControls.phaserRate} onChange={(event) => setPedalboardManualControl("phaserRate", Number(event.target.value))} className="mt-1 w-full accent-fuchsia-300" /></label>
                                <label className="block text-xs text-zinc-300">Phaser Depth: {pedalboardManualControls.phaserDepth.toFixed(2)}<input type="range" min={0} max={1} step={0.05} value={pedalboardManualControls.phaserDepth} onChange={(event) => setPedalboardManualControl("phaserDepth", Number(event.target.value))} className="mt-1 w-full accent-fuchsia-300" /></label>
                                <label className="block text-xs text-zinc-300">Chorus Rate: {pedalboardManualControls.chorusRate}<input type="range" min={0} max={8} step={0.1} value={pedalboardManualControls.chorusRate} onChange={(event) => setPedalboardManualControl("chorusRate", Number(event.target.value))} className="mt-1 w-full accent-fuchsia-300" /></label>
                                <label className="block text-xs text-zinc-300">Chorus Depth: {pedalboardManualControls.chorusDepth.toFixed(2)}<input type="range" min={0} max={1} step={0.05} value={pedalboardManualControls.chorusDepth} onChange={(event) => setPedalboardManualControl("chorusDepth", Number(event.target.value))} className="mt-1 w-full accent-fuchsia-300" /></label>
                                <label className="block text-xs text-zinc-300">Delay: {pedalboardManualControls.delayMs} ms<input type="range" min={0} max={900} step={10} value={pedalboardManualControls.delayMs} onChange={(event) => setPedalboardManualControl("delayMs", Number(event.target.value))} className="mt-1 w-full accent-fuchsia-300" /></label>
                                <label className="block text-xs text-zinc-300">Delay Feedback: {pedalboardManualControls.delayFeedback.toFixed(2)}<input type="range" min={0} max={0.95} step={0.05} value={pedalboardManualControls.delayFeedback} onChange={(event) => setPedalboardManualControl("delayFeedback", Number(event.target.value))} className="mt-1 w-full accent-fuchsia-300" /></label>
                                <label className="block text-xs text-zinc-300">Delay Mix: {pedalboardManualControls.delayMix.toFixed(2)}<input type="range" min={0} max={1} step={0.05} value={pedalboardManualControls.delayMix} onChange={(event) => setPedalboardManualControl("delayMix", Number(event.target.value))} className="mt-1 w-full accent-fuchsia-300" /></label>
                                <label className="block text-xs text-zinc-300">Reverb Room: {pedalboardManualControls.reverbRoomSize.toFixed(2)}<input type="range" min={0} max={1} step={0.05} value={pedalboardManualControls.reverbRoomSize} onChange={(event) => setPedalboardManualControl("reverbRoomSize", Number(event.target.value))} className="mt-1 w-full accent-fuchsia-300" /></label>
                                <label className="block text-xs text-zinc-300">Reverb Wet: {pedalboardManualControls.reverbWet.toFixed(2)}<input type="range" min={0} max={1} step={0.05} value={pedalboardManualControls.reverbWet} onChange={(event) => setPedalboardManualControl("reverbWet", Number(event.target.value))} className="mt-1 w-full accent-fuchsia-300" /></label>
                                <label className="block text-xs text-zinc-300">Compression: {pedalboardManualControls.compression}%<input type="range" min={0} max={100} step={1} value={pedalboardManualControls.compression} onChange={(event) => setPedalboardManualControl("compression", Number(event.target.value))} className="mt-1 w-full accent-fuchsia-300" /></label>
                              </div>
                            </div>
                          ) : null}

'@

  $panel = $panel.Insert($buttonIdx, $pedalboardUi)
}

# ---------------------------------------------------------------------
# 5. Frontend: insert SoX manual UI before SoX button.
# ---------------------------------------------------------------------

if ($panel -notmatch "OTG_VOICE_EFFECTS_3C2_SOX_MANUAL_UI") {
  $boxStart = $panel.IndexOf('<p className="text-sm font-semibold text-orange-100">SoX</p>')
  if ($boxStart -lt 0) {
    throw "Could not find SoX box."
  }

  $buttonIdx = $panel.IndexOf('<button', $boxStart)
  while ($buttonIdx -ge 0) {
    $near = $panel.Substring($buttonIdx, [Math]::Min(900, $panel.Length - $buttonIdx))
    if ($near -match 'applyVoiceFxPageEffect\(\{\s*effectId:\s*soxPresetId') {
      break
    }
    $buttonIdx = $panel.IndexOf('<button', $buttonIdx + 7)
  }

  if ($buttonIdx -lt 0) {
    throw "Could not find SoX apply button."
  }

  $soxUi = @'
                          {soxControlsUnlocked ? (
                            <div className="mt-3 rounded-xl border border-orange-400/20 bg-black/20 p-3">
                              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-orange-100">SoX Manual Controls</p>{/* OTG_VOICE_EFFECTS_3C2_SOX_MANUAL_UI */}
                              <p className="mt-1 text-xs text-zinc-400">These values override the locked SoX preset for this effect only.</p>

                              <div className="mt-3 grid gap-3 md:grid-cols-2">
                                <label className="block text-xs text-zinc-300">Pitch: {soxManualControls.pitchCents} cents<input type="range" min={-1200} max={1200} step={25} value={soxManualControls.pitchCents} onChange={(event) => setSoxManualControl("pitchCents", Number(event.target.value))} className="mt-1 w-full accent-orange-300" /></label>
                                <label className="block text-xs text-zinc-300">Tempo: {soxManualControls.tempo.toFixed(2)}x<input type="range" min={0.5} max={2} step={0.05} value={soxManualControls.tempo} onChange={(event) => setSoxManualControl("tempo", Number(event.target.value))} className="mt-1 w-full accent-orange-300" /></label>
                                <label className="block text-xs text-zinc-300">Overdrive Gain: {soxManualControls.overdriveGain}<input type="range" min={0} max={40} step={1} value={soxManualControls.overdriveGain} onChange={(event) => setSoxManualControl("overdriveGain", Number(event.target.value))} className="mt-1 w-full accent-orange-300" /></label>
                                <label className="block text-xs text-zinc-300">Overdrive Colour: {soxManualControls.overdriveColour}<input type="range" min={0} max={100} step={1} value={soxManualControls.overdriveColour} onChange={(event) => setSoxManualControl("overdriveColour", Number(event.target.value))} className="mt-1 w-full accent-orange-300" /></label>
                                <label className="block text-xs text-zinc-300">Echo Delay: {soxManualControls.echoDelayMs} ms<input type="range" min={0} max={900} step={10} value={soxManualControls.echoDelayMs} onChange={(event) => setSoxManualControl("echoDelayMs", Number(event.target.value))} className="mt-1 w-full accent-orange-300" /></label>
                                <label className="block text-xs text-zinc-300">Echo Decay: {soxManualControls.echoDecay.toFixed(2)}<input type="range" min={0} max={0.9} step={0.05} value={soxManualControls.echoDecay} onChange={(event) => setSoxManualControl("echoDecay", Number(event.target.value))} className="mt-1 w-full accent-orange-300" /></label>
                                <label className="block text-xs text-zinc-300">Highpass: {soxManualControls.highpassHz} Hz<input type="range" min={20} max={1200} step={10} value={soxManualControls.highpassHz} onChange={(event) => setSoxManualControl("highpassHz", Number(event.target.value))} className="mt-1 w-full accent-orange-300" /></label>
                                <label className="block text-xs text-zinc-300">Lowpass: {soxManualControls.lowpassHz} Hz<input type="range" min={1200} max={20000} step={100} value={soxManualControls.lowpassHz} onChange={(event) => setSoxManualControl("lowpassHz", Number(event.target.value))} className="mt-1 w-full accent-orange-300" /></label>
                                <label className="block text-xs text-zinc-300">Chorus Delay: {soxManualControls.chorusDelayMs} ms<input type="range" min={0} max={120} step={5} value={soxManualControls.chorusDelayMs} onChange={(event) => setSoxManualControl("chorusDelayMs", Number(event.target.value))} className="mt-1 w-full accent-orange-300" /></label>
                                <label className="block text-xs text-zinc-300">Chorus Decay: {soxManualControls.chorusDecay.toFixed(2)}<input type="range" min={0} max={1} step={0.05} value={soxManualControls.chorusDecay} onChange={(event) => setSoxManualControl("chorusDecay", Number(event.target.value))} className="mt-1 w-full accent-orange-300" /></label>
                                <label className="block text-xs text-zinc-300">Bass: {soxManualControls.bassDb} dB<input type="range" min={-12} max={12} step={1} value={soxManualControls.bassDb} onChange={(event) => setSoxManualControl("bassDb", Number(event.target.value))} className="mt-1 w-full accent-orange-300" /></label>
                                <label className="block text-xs text-zinc-300">Treble: {soxManualControls.trebleDb} dB<input type="range" min={-12} max={12} step={1} value={soxManualControls.trebleDb} onChange={(event) => setSoxManualControl("trebleDb", Number(event.target.value))} className="mt-1 w-full accent-orange-300" /></label>
                              </div>

                              <label className="mt-3 flex items-center gap-2 text-xs text-orange-100/80">
                                <input type="checkbox" checked={soxManualControls.normalize} onChange={(event) => setSoxManualControl("normalize", event.target.checked)} />
                                Normalize output
                              </label>
                            </div>
                          ) : null}

'@

  $panel = $panel.Insert($buttonIdx, $soxUi)
}

# ---------------------------------------------------------------------
# 6. Frontend: pass manual controls in Pedalboard/SoX calls.
# ---------------------------------------------------------------------

if ($panel -notmatch "controls: pedalboardControlsUnlocked ? pedalboardManualControls : undefined") {
  $callStart = $panel.IndexOf('applyVoiceFxPageEffect({', $panel.IndexOf('<p className="text-sm font-semibold text-fuchsia-100">Spotify Pedalboard</p>'))
  if ($callStart -lt 0) { throw "Could not find Pedalboard apply call." }

  $labelLine = '                              label: `Pedalboard: ${pedalboardAdvancedOptions.find((option) => option.id === pedalboardPresetId)?.label || pedalboardPresetId}`,'
  $labelIdx = $panel.IndexOf($labelLine, $callStart)
  if ($labelIdx -lt 0) { throw "Could not find Pedalboard label line." }

  $panel = $panel.Insert($labelIdx + $labelLine.Length, "`r`n                              controls: pedalboardControlsUnlocked ? pedalboardManualControls : undefined,")
}

if ($panel -notmatch "controls: soxControlsUnlocked ? soxManualControls : undefined") {
  $callStart = $panel.IndexOf('applyVoiceFxPageEffect({', $panel.IndexOf('<p className="text-sm font-semibold text-orange-100">SoX</p>'))
  if ($callStart -lt 0) { throw "Could not find SoX apply call." }

  $labelLine = '                              label: `SoX: ${soxAdvancedOptions.find((option) => option.id === soxPresetId)?.label || soxPresetId}`,'
  $labelIdx = $panel.IndexOf($labelLine, $callStart)
  if ($labelIdx -lt 0) { throw "Could not find SoX label line." }

  $panel = $panel.Insert($labelIdx + $labelLine.Length, "`r`n                              controls: soxControlsUnlocked ? soxManualControls : undefined,")
}

Write-Utf8NoBom -Path $PanelPath -Content $panel

# ---------------------------------------------------------------------
# 7. Checklist.
# ---------------------------------------------------------------------

if (Test-Path -LiteralPath $ChecklistPath) {
  $Checklist = Get-Content -LiteralPath $ChecklistPath -Raw
  $Marker = "Voice Effects Patch 3C-2"
  if ($Checklist -notmatch [regex]::Escape($Marker)) {
    Add-Content -LiteralPath $ChecklistPath -Value "`r`n- [x] ${Marker}: added unlocked editable Pedalboard and SoX manual controls with backend custom-control payload support.`r`n" -Encoding UTF8
  }
}

# ---------------------------------------------------------------------
# 8. Verification.
# ---------------------------------------------------------------------

$routeText = Get-Content -LiteralPath $RoutePath -Raw
$panelText = Get-Content -LiteralPath $PanelPath -Raw
$pedalText = Get-Content -LiteralPath $PedalboardPath -Raw

$checks = @(
  @{ Text = $routeText; Pattern = "OTG_VOICE_EFFECTS_3C2_ROUTE_CONTROLS" },
  @{ Text = $routeText; Pattern = "soxArgsForCustomControls" },
  @{ Text = $routeText; Pattern = "serializeEffectControls" },
  @{ Text = $routeText; Pattern = "controls: body.controls || body.customControls" },
  @{ Text = $pedalText; Pattern = "OTG_VOICE_EFFECTS_3C2_PEDALBOARD_CONTROLS" },
  @{ Text = $pedalText; Pattern = "build_custom_board" },
  @{ Text = $panelText; Pattern = "OTG_VOICE_EFFECTS_3C2_PEDALBOARD_SOX_MANUAL_STATE" },
  @{ Text = $panelText; Pattern = "OTG_VOICE_EFFECTS_3C2_PEDALBOARD_MANUAL_UI" },
  @{ Text = $panelText; Pattern = "OTG_VOICE_EFFECTS_3C2_SOX_MANUAL_UI" },
  @{ Text = $panelText; Pattern = "controls: pedalboardControlsUnlocked ? pedalboardManualControls : undefined" },
  @{ Text = $panelText; Pattern = "controls: soxControlsUnlocked ? soxManualControls : undefined" }
)

foreach ($check in $checks) {
  if ($check.Text -notmatch [regex]::Escape($check.Pattern)) {
    throw "Verification failed. Missing marker: $($check.Pattern)"
  }
}

Write-Host ""
Write-Host "SUCCESS"
Write-Host "Voice Effects Patch 3C-2 Pedalboard/SoX manual controls installed."
Write-Host "Backup: $BackupRoot"
Write-Host ""
Write-Host "Next validation:"
Write-Host "  python -m py_compile scripts\process_pedalboard_voice_fx.py"
Write-Host "  npx tsc --noEmit --pretty false"
Write-Host "  npm run lint -- --quiet"
Write-Host "  npm test -- --reporter=verbose"