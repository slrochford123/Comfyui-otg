from pathlib import Path
from datetime import datetime
import shutil

root = Path(r"C:\AI\OTG-Test2")
panel = root / "app" / "app" / "components" / "CharactersPanel.tsx"
backup_dir = root / ".manual-backups" / ("character-voice-fx-ui-v2-" + datetime.now().strftime("%Y%m%d-%H%M%S"))

if not panel.exists():
    raise FileNotFoundError(panel)

backup_dir.mkdir(parents=True, exist_ok=True)
shutil.copy2(panel, backup_dir / "CharactersPanel.tsx")

text = panel.read_text(encoding="utf-8")
original = text

voice_settings_anchor = """type VoiceSettings = {
  voiceAge: "child" | "teen" | "young adult" | "adult" | "older";
  genderExpression: "male" | "female" | "androgynous";
  pitch: "low" | "medium" | "high";
  resonance: "thin" | "balanced" | "full";
  energy: "low" | "medium" | "high";
  texture: "clean" | "slightly rough" | "raspy" | "breathy" | "nasal";
  personalityTone: string[];
  hasAccent: boolean;
  accentType: string;
  speciesFlavor: "none" | "subtle" | "medium" | "strong";
  speciesTrait: string;
};
"""

voice_fx_type = """type VoiceFxSettings = {
  preset: "clean_dialogue" | "deep_monster" | "dark_villain" | "angelic_light" | "ghost_whisper" | "custom";
  pitchSemitones: number;
  speed: number;
  gainDb: number;
  highpassHz: number;
  lowpassHz: number;
  echo: "off" | "subtle" | "room" | "cave";
  normalize: boolean;
};

"""

if "type VoiceFxSettings" not in text:
    if voice_settings_anchor not in text:
        raise RuntimeError("Missing VoiceSettings type anchor.")
    text = text.replace(voice_settings_anchor, voice_settings_anchor + "\n" + voice_fx_type, 1)

default_voice_anchor = """const DEFAULT_VOICE: VoiceSettings = {
  voiceAge: "teen",
  genderExpression: "male",
  pitch: "medium",
  resonance: "thin",
  energy: "medium",
  texture: "slightly rough",
  personalityTone: ["mischievous"],
  hasAccent: false,
  accentType: "",
  speciesFlavor: "subtle",
  speciesTrait: "rat-like",
};
"""

default_fx = """
const DEFAULT_VOICE_FX: VoiceFxSettings = {
  preset: "clean_dialogue",
  pitchSemitones: 0,
  speed: 1,
  gainDb: 0,
  highpassHz: 60,
  lowpassHz: 12000,
  echo: "off",
  normalize: true,
};

const VOICE_FX_PRESETS: Record<VoiceFxSettings["preset"], VoiceFxSettings> = {
  clean_dialogue: {
    preset: "clean_dialogue",
    pitchSemitones: 0,
    speed: 1,
    gainDb: 0,
    highpassHz: 60,
    lowpassHz: 12000,
    echo: "off",
    normalize: true,
  },
  deep_monster: {
    preset: "deep_monster",
    pitchSemitones: -5,
    speed: 0.92,
    gainDb: 0,
    highpassHz: 45,
    lowpassHz: 7000,
    echo: "room",
    normalize: true,
  },
  dark_villain: {
    preset: "dark_villain",
    pitchSemitones: -3,
    speed: 0.96,
    gainDb: 0,
    highpassHz: 55,
    lowpassHz: 8500,
    echo: "subtle",
    normalize: true,
  },
  angelic_light: {
    preset: "angelic_light",
    pitchSemitones: 3,
    speed: 1.02,
    gainDb: 0,
    highpassHz: 90,
    lowpassHz: 14000,
    echo: "room",
    normalize: true,
  },
  ghost_whisper: {
    preset: "ghost_whisper",
    pitchSemitones: -1,
    speed: 0.94,
    gainDb: -1,
    highpassHz: 120,
    lowpassHz: 6500,
    echo: "cave",
    normalize: true,
  },
  custom: {
    preset: "custom",
    pitchSemitones: 0,
    speed: 1,
    gainDb: 0,
    highpassHz: 60,
    lowpassHz: 12000,
    echo: "off",
    normalize: true,
  },
};

"""

if "const DEFAULT_VOICE_FX" not in text:
    if default_voice_anchor not in text:
        raise RuntimeError("Missing DEFAULT_VOICE anchor.")
    text = text.replace(default_voice_anchor, default_voice_anchor + default_fx, 1)

old_state = """  const [voicePackCreated, setVoicePackCreated] = useState(false);
  const [voicePackRecord, setVoicePackRecord] = useState<any | null>(null);
  const [voicePreview, setVoicePreview] = useState<any | null>(null);
"""

new_state = """  const [voicePackCreated, setVoicePackCreated] = useState(false);
  const [voicePackRecord, setVoicePackRecord] = useState<any | null>(null);
  const [voicePreview, setVoicePreview] = useState<any | null>(null);
  const [voiceFx, setVoiceFx] = useState<VoiceFxSettings>(DEFAULT_VOICE_FX);
  const [voiceFxPreview, setVoiceFxPreview] = useState<any | null>(null);
"""

if "const [voiceFx, setVoiceFx]" not in text:
    if old_state not in text:
        raise RuntimeError("Missing voicePreview state anchor.")
    text = text.replace(old_state, new_state, 1)

old_reset = """    setVoicePackCreated(false);
    setVoicePackRecord(null);
    setVoicePreview(null);
"""

new_reset = """    setVoicePackCreated(false);
    setVoicePackRecord(null);
    setVoicePreview(null);
    setVoiceFx(DEFAULT_VOICE_FX);
    setVoiceFxPreview(null);
"""

if "setVoiceFx(DEFAULT_VOICE_FX)" not in text:
    if old_reset not in text:
        raise RuntimeError("Missing reset anchor.")
    text = text.replace(old_reset, new_reset, 1)

save_anchor = "  async function saveCharacter() {"

voice_fx_functions = """  function setVoiceFxField<K extends keyof VoiceFxSettings>(key: K, value: VoiceFxSettings[K]) {
    setVoiceFx((current) => ({ ...current, [key]: value, preset: key === "preset" ? value as VoiceFxSettings["preset"] : "custom" }));
    setVoiceFxPreview(null);
  }

  function applyVoiceFxPreset(preset: VoiceFxSettings["preset"]) {
    setVoiceFx(VOICE_FX_PRESETS[preset] || VOICE_FX_PRESETS.custom);
    setVoiceFxPreview(null);
  }

  async function applyVoiceFx() {
    if (!details.name.trim()) {
      setError("Character name is required before applying Voice FX.");
      setStep("details");
      return;
    }

    const inputPath = String(voicePreview?.audioPath || voicePreview?.outputPath || "").trim();

    if (!inputPath) {
      setError("Generate a Qwen audio preview before applying Voice FX.");
      return;
    }

    setLoading(true);
    setError("");
    setMessage("Applying Voice FX...");
    try {
      const characterId = safeId(details.name);
      const response = await fetch("/api/characters/voice-fx", {
        method: "POST",
        headers: CHARACTER_JSON_HEADERS,
        credentials: "omit",
        body: JSON.stringify({
          characterId,
          candidateId: selectedQwenVoiceCandidate?.candidateId || "candidate",
          inputPath,
          preset: voiceFx.preset,
          pitchSemitones: voiceFx.pitchSemitones,
          speed: voiceFx.speed,
          gainDb: voiceFx.gainDb,
          highpassHz: voiceFx.highpassHz,
          lowpassHz: voiceFx.lowpassHz,
          echo: voiceFx.echo,
          normalize: voiceFx.normalize,
        }),
      });

      const json = await response.json().catch(() => null);
      if (!response.ok || !json?.ok) {
        throw new Error(json?.error || "Voice FX failed.");
      }

      setVoiceFxPreview(json);
      setMessage("Voice FX applied. Compare the raw preview and tuned preview.");
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  }

"""

if "async function applyVoiceFx()" not in text:
    if save_anchor not in text:
        raise RuntimeError("Missing saveCharacter anchor.")
    text = text.replace(save_anchor, voice_fx_functions + save_anchor, 1)

panel_marker = '<Panel title="Qwen3-TTS Voice Design">'
panel_pos = text.find(panel_marker)
if panel_pos == -1:
    raise RuntimeError("Missing Qwen3-TTS Voice Design panel marker.")

action_marker = '              <div className="mt-5 flex flex-wrap gap-3">'
action_pos = text.find(action_marker, panel_pos)
if action_pos == -1:
    raise RuntimeError("Missing Voice Lab action button marker.")

voice_fx_ui = '''              <div className="mt-5 rounded-xl border border-cyan-400/30 bg-cyan-400/5 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-cyan-100">Voice Tuning / FX</p>
                    <p className="mt-1 max-w-2xl text-xs text-zinc-400">
                      Use this after generating a raw Qwen preview. It creates a tuned reference voice for Index.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={applyVoiceFx}
                    disabled={loading || !voicePreview?.audioPath}
                    className="rounded-xl border border-cyan-400 px-4 py-2 text-sm font-semibold text-cyan-100 disabled:opacity-40"
                  >
                    {loading ? "Applying..." : "Apply Voice FX"}
                  </button>
                </div>

                <div className="mt-4 grid gap-4 md:grid-cols-3">
                  <label className="block text-sm text-zinc-300">
                    <span className="mb-1 block text-xs uppercase tracking-[0.16em] text-zinc-500">FX Preset</span>
                    <select
                      value={voiceFx.preset}
                      onChange={(event) => applyVoiceFxPreset(event.target.value as VoiceFxSettings["preset"])}
                      className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
                    >
                      <option value="clean_dialogue">Clean Dialogue</option>
                      <option value="deep_monster">Deep Monster</option>
                      <option value="dark_villain">Dark Villain</option>
                      <option value="angelic_light">Angelic Light</option>
                      <option value="ghost_whisper">Ghost Whisper</option>
                      <option value="custom">Custom</option>
                    </select>
                  </label>

                  <label className="block text-sm text-zinc-300">
                    <span className="mb-1 block text-xs uppercase tracking-[0.16em] text-zinc-500">Pitch Semitones</span>
                    <input
                      type="number"
                      min={-12}
                      max={12}
                      step={1}
                      value={voiceFx.pitchSemitones}
                      onChange={(event) => setVoiceFxField("pitchSemitones", Number(event.target.value))}
                      className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
                    />
                  </label>

                  <label className="block text-sm text-zinc-300">
                    <span className="mb-1 block text-xs uppercase tracking-[0.16em] text-zinc-500">Speed</span>
                    <input
                      type="number"
                      min={0.8}
                      max={1.2}
                      step={0.01}
                      value={voiceFx.speed}
                      onChange={(event) => setVoiceFxField("speed", Number(event.target.value))}
                      className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
                    />
                  </label>

                  <label className="block text-sm text-zinc-300">
                    <span className="mb-1 block text-xs uppercase tracking-[0.16em] text-zinc-500">High-pass Hz</span>
                    <input
                      type="number"
                      min={0}
                      max={2000}
                      step={5}
                      value={voiceFx.highpassHz}
                      onChange={(event) => setVoiceFxField("highpassHz", Number(event.target.value))}
                      className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
                    />
                  </label>

                  <label className="block text-sm text-zinc-300">
                    <span className="mb-1 block text-xs uppercase tracking-[0.16em] text-zinc-500">Low-pass Hz</span>
                    <input
                      type="number"
                      min={0}
                      max={22050}
                      step={100}
                      value={voiceFx.lowpassHz}
                      onChange={(event) => setVoiceFxField("lowpassHz", Number(event.target.value))}
                      className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
                    />
                  </label>

                  <label className="block text-sm text-zinc-300">
                    <span className="mb-1 block text-xs uppercase tracking-[0.16em] text-zinc-500">Echo / Space</span>
                    <select
                      value={voiceFx.echo}
                      onChange={(event) => setVoiceFxField("echo", event.target.value as VoiceFxSettings["echo"])}
                      className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
                    >
                      <option value="off">Off</option>
                      <option value="subtle">Subtle</option>
                      <option value="room">Room</option>
                      <option value="cave">Cave</option>
                    </select>
                  </label>

                  <label className="flex items-center gap-2 text-sm text-zinc-300 md:mt-6">
                    <input
                      type="checkbox"
                      checked={voiceFx.normalize}
                      onChange={(event) => setVoiceFxField("normalize", event.target.checked)}
                    />
                    Normalize loudness
                  </label>
                </div>

                {voiceFxPreview?.audioUrl ? (
                  <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-950 p-4">
                    <p className="mb-2 text-sm font-medium text-zinc-200">Tuned Voice Preview</p>
                    <audio controls src={voiceFxPreview.audioUrl} className="w-full" />
                    <p className="mt-2 break-all text-xs text-zinc-500">{String(voiceFxPreview.audioPath || voiceFxPreview.outputPath || "")}</p>
                  </div>
                ) : null}
              </div>

'''

if "Voice Tuning / FX" not in text:
    text = text[:action_pos] + voice_fx_ui + text[action_pos:]

required = [
    "type VoiceFxSettings",
    "const DEFAULT_VOICE_FX",
    "VOICE_FX_PRESETS",
    "const [voiceFx, setVoiceFx]",
    "const [voiceFxPreview, setVoiceFxPreview]",
    "async function applyVoiceFx()",
    'fetch("/api/characters/voice-fx"',
    "Voice Tuning / FX",
    "Apply Voice FX",
    "Tuned Voice Preview",
]

for item in required:
    if item not in text:
        raise RuntimeError("Verification failed. Missing: " + item)

if text == original:
    raise RuntimeError("No changes made.")

panel.write_text(text, encoding="utf-8")

print("OK: Character Voice FX UI patched.")
print("Changed:", panel)
print("Backup:", backup_dir)