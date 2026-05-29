from pathlib import Path
from datetime import datetime
import shutil
import re

root = Path(r"C:\AI\OTG-Test2")
fx_script = root / "scripts" / "process_voice_fx.py"
route = root / "app" / "api" / "characters" / "voice-fx" / "route.ts"
panel = root / "app" / "app" / "components" / "CharactersPanel.tsx"
backup_dir = root / ".manual-backups" / ("force-voice-fx-v2-advanced-" + datetime.now().strftime("%Y%m%d-%H%M%S"))

for file in [fx_script, route, panel]:
    if not file.exists():
        raise FileNotFoundError(file)

backup_dir.mkdir(parents=True, exist_ok=True)
shutil.copy2(fx_script, backup_dir / "process_voice_fx.py")
shutil.copy2(route, backup_dir / "voice-fx-route.ts")
shutil.copy2(panel, backup_dir / "CharactersPanel.tsx")

fx_script.write_text(r'''import argparse
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
''', encoding="utf-8")

# Patch route params.
route_text = route.read_text(encoding="utf-8")

if "tonePreset:" not in route_text:
    anchor = '''      echo: String(body.echo || "off"),
      normalize: body.normalize !== false,
      preset: String(body.preset || "custom"),'''
    replacement = '''      echo: String(body.echo || "off"),
      normalize: body.normalize !== false,
      preset: String(body.preset || "custom"),
      tonePreset: String(body.tonePreset || "neutral"),
      bodyMode: String(body.bodyMode || "normal"),
      gritAmount: Number(body.gritAmount || 0),
      compression: String(body.compression || "off"),
      layerMode: String(body.layerMode || "off"),
      layerMix: Number(body.layerMix || 0),'''
    if anchor not in route_text:
        raise RuntimeError("Missing voice-fx route params anchor.")
    route_text = route_text.replace(anchor, replacement, 1)

route.write_text(route_text, encoding="utf-8")

# Patch panel.
panel_text = panel.read_text(encoding="utf-8")

if "tonePreset?:" not in panel_text:
    old = '''  echo: "off" | "subtle" | "room" | "cave";
  normalize: boolean;
};'''
    new = '''  echo: "off" | "subtle" | "room" | "cave";
  normalize: boolean;
  tonePreset?: "neutral" | "dark" | "bright" | "radio" | "telephone";
  bodyMode?: "lighter" | "normal" | "deeper" | "huge";
  gritAmount?: number;
  compression?: "off" | "light" | "medium" | "strong";
  layerMode?: "off" | "octave_down" | "octave_up" | "monster_double" | "ghost_double" | "robot_double";
  layerMix?: number;
};'''
    if old not in panel_text:
        raise RuntimeError("Missing VoiceFxSettings type anchor.")
    panel_text = panel_text.replace(old, new, 1)

if "voiceFxAdvancedOpen" not in panel_text:
    old = '''  const [voiceFx, setVoiceFx] = useState<VoiceFxSettings>(DEFAULT_VOICE_FX);
  const [voiceFxPreview, setVoiceFxPreview] = useState<any | null>(null);'''
    new = '''  const [voiceFx, setVoiceFx] = useState<VoiceFxSettings>(DEFAULT_VOICE_FX);
  const [voiceFxPreview, setVoiceFxPreview] = useState<any | null>(null);
  const [voiceFxAdvancedOpen, setVoiceFxAdvancedOpen] = useState(false);'''
    if old not in panel_text:
        raise RuntimeError("Missing voiceFx state anchor.")
    panel_text = panel_text.replace(old, new, 1)

if "tonePreset: voiceFx.tonePreset" not in panel_text:
    old = '''          echo: voiceFx.echo,
          normalize: voiceFx.normalize,'''
    new = '''          echo: voiceFx.echo,
          normalize: voiceFx.normalize,
          tonePreset: voiceFx.tonePreset || "neutral",
          bodyMode: voiceFx.bodyMode || "normal",
          gritAmount: voiceFx.gritAmount || 0,
          compression: voiceFx.compression || "off",
          layerMode: voiceFx.layerMode || "off",
          layerMix: voiceFx.layerMix || 0,'''
    if old not in panel_text:
        raise RuntimeError("Missing applyVoiceFx payload anchor.")
    panel_text = panel_text.replace(old, new, 1)

advanced_ui = '''                <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-950/70 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setVoiceFxAdvancedOpen(false)}
                      className={classNames(
                        "rounded-xl border px-3 py-2 text-sm font-semibold",
                        !voiceFxAdvancedOpen ? "border-cyan-300 bg-cyan-300/10 text-cyan-100" : "border-zinc-800 text-zinc-400",
                      )}
                    >
                      Basic Controls
                    </button>
                    <button
                      type="button"
                      onClick={() => setVoiceFxAdvancedOpen(true)}
                      className={classNames(
                        "rounded-xl border px-3 py-2 text-sm font-semibold",
                        voiceFxAdvancedOpen ? "border-cyan-300 bg-cyan-300/10 text-cyan-100" : "border-zinc-800 text-zinc-400",
                      )}
                    >
                      Advanced Controls
                    </button>
                  </div>

                  {voiceFxAdvancedOpen ? (
                    <div className="mt-4 grid gap-4 md:grid-cols-3">
                      <label className="block text-sm text-zinc-300">
                        <span className="mb-1 block text-xs uppercase tracking-[0.16em] text-zinc-500">Body / Resonance</span>
                        <select
                          value={voiceFx.bodyMode || "normal"}
                          onChange={(event) => setVoiceFxField("bodyMode", event.target.value as VoiceFxSettings["bodyMode"])}
                          className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
                        >
                          <option value="lighter">Lighter</option>
                          <option value="normal">Normal</option>
                          <option value="deeper">Deeper</option>
                          <option value="huge">Huge</option>
                        </select>
                      </label>

                      <label className="block text-sm text-zinc-300">
                        <span className="mb-1 block text-xs uppercase tracking-[0.16em] text-zinc-500">Tone Preset</span>
                        <select
                          value={voiceFx.tonePreset || "neutral"}
                          onChange={(event) => setVoiceFxField("tonePreset", event.target.value as VoiceFxSettings["tonePreset"])}
                          className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
                        >
                          <option value="neutral">Neutral</option>
                          <option value="dark">Dark</option>
                          <option value="bright">Bright</option>
                          <option value="radio">Radio</option>
                          <option value="telephone">Telephone</option>
                        </select>
                      </label>

                      <label className="block text-sm text-zinc-300">
                        <span className="mb-1 block text-xs uppercase tracking-[0.16em] text-zinc-500">Grit / Saturation</span>
                        <input
                          type="number"
                          min={0}
                          max={100}
                          step={5}
                          value={voiceFx.gritAmount || 0}
                          onChange={(event) => setVoiceFxField("gritAmount", Number(event.target.value))}
                          className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
                        />
                      </label>

                      <label className="block text-sm text-zinc-300">
                        <span className="mb-1 block text-xs uppercase tracking-[0.16em] text-zinc-500">Compression</span>
                        <select
                          value={voiceFx.compression || "off"}
                          onChange={(event) => setVoiceFxField("compression", event.target.value as VoiceFxSettings["compression"])}
                          className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
                        >
                          <option value="off">Off</option>
                          <option value="light">Light</option>
                          <option value="medium">Medium</option>
                          <option value="strong">Strong</option>
                        </select>
                      </label>

                      <label className="block text-sm text-zinc-300">
                        <span className="mb-1 block text-xs uppercase tracking-[0.16em] text-zinc-500">Layer Mode</span>
                        <select
                          value={voiceFx.layerMode || "off"}
                          onChange={(event) => setVoiceFxField("layerMode", event.target.value as VoiceFxSettings["layerMode"])}
                          className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
                        >
                          <option value="off">Off</option>
                          <option value="octave_down">Octave Down</option>
                          <option value="octave_up">Octave Up</option>
                          <option value="monster_double">Monster Double</option>
                          <option value="ghost_double">Ghost Double</option>
                          <option value="robot_double">Robot Double</option>
                        </select>
                      </label>

                      <label className="block text-sm text-zinc-300">
                        <span className="mb-1 block text-xs uppercase tracking-[0.16em] text-zinc-500">Layer Mix %</span>
                        <input
                          type="number"
                          min={0}
                          max={100}
                          step={5}
                          value={voiceFx.layerMix || 0}
                          onChange={(event) => setVoiceFxField("layerMix", Number(event.target.value))}
                          className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
                        />
                      </label>

                      <p className="md:col-span-3 text-xs text-zinc-500">
                        Use advanced effects moderately for Index references. Heavy grit, cave echo, and high layer mix can make the voice dramatic, but may reduce clean dubbing consistency.
                      </p>
                    </div>
                  ) : (
                    <p className="mt-3 text-xs text-zinc-500">
                      Advanced effects are hidden. Open this tab for body resonance, grit, compression, tone shaping, and layered doubles.
                    </p>
                  )}
                </div>

'''

if "Advanced Controls" not in panel_text:
    marker = '''                {tunedVoicePreviewUrl ? ('''
    if marker not in panel_text:
        raise RuntimeError("Missing tuned preview marker for Advanced Controls insertion.")
    panel_text = panel_text.replace(marker, advanced_ui + marker, 1)

panel.write_text(panel_text, encoding="utf-8")

# Verify.
fx_text = fx_script.read_text(encoding="utf-8")
route_text = route.read_text(encoding="utf-8")
panel_text = panel.read_text(encoding="utf-8")

for item in ["v2_advanced", "tonePreset", "bodyMode", "gritAmount", "layerMode", "amix=inputs=2"]:
    if item not in fx_text:
        raise RuntimeError("FX script verification failed. Missing: " + item)

for item in ["tonePreset", "bodyMode", "gritAmount", "compression", "layerMode", "layerMix"]:
    if item not in route_text:
        raise RuntimeError("Route verification failed. Missing: " + item)

for item in ["Advanced Controls", "voiceFxAdvancedOpen", "Body / Resonance", "Grit / Saturation", "Layer Mode", "Layer Mix"]:
    if item not in panel_text:
        raise RuntimeError("Panel verification failed. Missing: " + item)

print("OK: forced Voice FX v2 Advanced patch applied.")
print("Changed:", fx_script)
print("Changed:", route)
print("Changed:", panel)
print("Backup:", backup_dir)