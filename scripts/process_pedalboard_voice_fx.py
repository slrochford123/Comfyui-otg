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