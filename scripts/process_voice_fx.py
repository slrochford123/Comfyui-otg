import argparse
import json
import math
import subprocess
import sys
from pathlib import Path


def run(cmd):
    result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if result.returncode != 0:
        raise RuntimeError(
            "Command failed:\n"
            + " ".join(cmd)
            + "\n\nSTDOUT:\n"
            + result.stdout
            + "\n\nSTDERR:\n"
            + result.stderr
        )
    return result


def clamp_float(value, default, min_value, max_value):
    try:
        parsed = float(value)
    except Exception:
        parsed = default
    return max(min_value, min(max_value, parsed))


def clean_choice(value, default, allowed):
    text = str(value or default).strip().lower()
    return text if text in allowed else default


def base_filters(params):
    filters = []

    highpass_hz = clamp_float(params.get("highpassHz"), 0, 0, 2000)
    lowpass_hz = clamp_float(params.get("lowpassHz"), 0, 0, 22050)
    gain_db = clamp_float(params.get("gainDb"), 0, -24, 24)
    speed = clamp_float(params.get("speed"), 1.0, 0.5, 2.0)
    pitch_semitones = clamp_float(params.get("pitchSemitones"), 0, -12, 12)
    grit_amount = clamp_float(params.get("gritAmount"), 0, 0, 100)
    normalize = bool(params.get("normalize", True))

    echo = clean_choice(params.get("echo"), "off", {"off", "subtle", "room", "cave"})
    tone_preset = clean_choice(params.get("tonePreset"), "neutral", {"neutral", "dark", "bright", "radio", "telephone"})
    body_mode = clean_choice(params.get("bodyMode"), "normal", {"lighter", "normal", "deeper", "huge"})
    compression = clean_choice(params.get("compression"), "off", {"off", "light", "medium", "strong"})

    if highpass_hz > 0:
        filters.append(f"highpass=f={highpass_hz}")

    if lowpass_hz > 0:
        filters.append(f"lowpass=f={lowpass_hz}")

    if tone_preset == "dark":
        filters.extend(["bass=g=4:f=120", "treble=g=-3:f=6500"])
    elif tone_preset == "bright":
        filters.extend(["bass=g=-2:f=180", "treble=g=4:f=6500"])
    elif tone_preset == "radio":
        filters.extend(["highpass=f=250", "lowpass=f=4200", "equalizer=f=1200:t=q:w=1:g=3"])
    elif tone_preset == "telephone":
        filters.extend(["highpass=f=320", "lowpass=f=3200", "equalizer=f=1000:t=q:w=1:g=2"])

    if body_mode == "lighter":
        filters.extend(["bass=g=-2:f=160", "treble=g=2:f=5500"])
    elif body_mode == "deeper":
        filters.extend(["bass=g=4:f=110", "equalizer=f=240:t=q:w=1.1:g=2", "treble=g=-1:f=6500"])
    elif body_mode == "huge":
        filters.extend(["bass=g=7:f=90", "equalizer=f=180:t=q:w=1.2:g=3", "treble=g=-3:f=6500"])

    if abs(gain_db) > 0.01:
        filters.append(f"volume={gain_db}dB")

    if abs(pitch_semitones) > 0.01:
        ratio = math.pow(2.0, pitch_semitones / 12.0)
        filters.append(f"asetrate=24000*{ratio}")
        filters.append("aresample=24000")

    if abs(speed - 1.0) > 0.01:
        filters.append(f"atempo={speed}")

    if grit_amount > 0.01:
        bits = int(round(16 - (grit_amount / 100.0) * 8))
        bits = max(6, min(16, bits))
        mix = max(0.02, min(0.55, grit_amount / 180.0))
        filters.append(f"acrusher=bits={bits}:mix={mix}")

    if compression == "light":
        filters.append("acompressor=threshold=0.18:ratio=1.8:attack=8:release=80")
    elif compression == "medium":
        filters.append("acompressor=threshold=0.14:ratio=2.6:attack=6:release=90")
    elif compression == "strong":
        filters.append("acompressor=threshold=0.10:ratio=4.0:attack=4:release=120")

    if echo == "subtle":
        filters.append("aecho=0.8:0.25:45:0.18")
    elif echo == "room":
        filters.append("aecho=0.8:0.35:80:0.25")
    elif echo == "cave":
        filters.append("aecho=0.8:0.45:180:0.35")

    if normalize:
        filters.append("loudnorm=I=-16:TP=-1.5:LRA=11")

    return filters


def layer_filter(params):
    layer_mode = clean_choice(
        params.get("layerMode"),
        "off",
        {"off", "octave_down", "octave_up", "monster_double", "ghost_double", "robot_double"},
    )
    layer_mix = clamp_float(params.get("layerMix"), 0, 0, 100) / 100.0

    if layer_mode == "off" or layer_mix <= 0.001:
        return None

    volume = max(0.01, min(0.85, layer_mix))

    if layer_mode == "octave_down":
        return f"asetrate=24000*0.5,aresample=24000,adelay=18|18,volume={volume}"
    if layer_mode == "octave_up":
        return f"asetrate=24000*2.0,aresample=24000,adelay=12|12,volume={volume}"
    if layer_mode == "monster_double":
        return f"asetrate=24000*0.5,aresample=24000,lowpass=f=4200,aecho=0.8:0.3:35:0.18,volume={volume}"
    if layer_mode == "ghost_double":
        return f"asetrate=24000*1.08,aresample=24000,highpass=f=220,aecho=0.8:0.45:130:0.32,volume={volume}"
    if layer_mode == "robot_double":
        return f"acrusher=bits=8:mix=0.35,aecho=0.8:0.25:28:0.25,volume={volume}"

    return None


def main():
    parser = argparse.ArgumentParser(description="OTG local voice FX processor")
    parser.add_argument("--params-json", required=True)
    parser.add_argument("--stdout-log", required=True)
    parser.add_argument("--stderr-log", required=True)
    args = parser.parse_args()

    stdout_log = Path(args.stdout_log)
    stderr_log = Path(args.stderr_log)
    stdout_log.parent.mkdir(parents=True, exist_ok=True)
    stderr_log.parent.mkdir(parents=True, exist_ok=True)

    try:
        params = json.loads(Path(args.params_json).read_text(encoding="utf-8-sig"))

        input_wav = Path(params["input_wav"])
        output_wav = Path(params["output_wav"])
        ffmpeg = str(params.get("ffmpeg") or "ffmpeg")

        if not input_wav.exists():
            raise FileNotFoundError(f"Missing input WAV: {input_wav}")

        output_wav.parent.mkdir(parents=True, exist_ok=True)

        filters = base_filters(params)
        layer = layer_filter(params)

        if layer:
            main_chain = ",".join(filters) if filters else "anull"
            filter_complex = (
                f"[0:a]{main_chain}[main];"
                f"[0:a]{layer}[layer];"
                f"[main][layer]amix=inputs=2:duration=longest:normalize=0,alimiter=limit=0.95[out]"
            )
            cmd = [
                ffmpeg,
                "-y",
                "-hide_banner",
                "-i",
                str(input_wav),
                "-filter_complex",
                filter_complex,
                "-map",
                "[out]",
                "-ar",
                "24000",
                "-ac",
                "1",
                str(output_wav),
            ]
            filter_summary = filter_complex
        else:
            filter_chain = ",".join(filters) if filters else "anull"
            cmd = [
                ffmpeg,
                "-y",
                "-hide_banner",
                "-i",
                str(input_wav),
                "-af",
                filter_chain,
                "-ar",
                "24000",
                "-ac",
                "1",
                str(output_wav),
            ]
            filter_summary = filter_chain

        result = run(cmd)

        meta = {
            "ok": True,
            "engine": "OTG Voice FX",
            "version": "v2_advanced",
            "input_wav": str(input_wav),
            "output_wav": str(output_wav),
            "filters": filter_summary,
            "params": params,
        }

        stdout_log.write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
        stderr_log.write_text(result.stderr or "", encoding="utf-8")
        print(json.dumps(meta))
        return 0

    except Exception as exc:
        stderr_log.write_text(str(exc) + "\n", encoding="utf-8")
        stdout_log.write_text("", encoding="utf-8")
        print(str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
