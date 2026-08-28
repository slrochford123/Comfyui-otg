"use client";

import * as React from "react";

export type FinalVoiceSelection = {
  finalAudioPath: string;
  finalAudioUrl: string;
  effectsApplied: boolean;
  voiceFxLabel?: string;
  voiceFx: Record<string, unknown> | null;
};

type FxPreset = {
  id: string;
  label: string;
  detail: string;
  pitchSemitones?: number;
  gainDb?: number;
  highpassHz?: number;
  lowpassHz?: number;
  tonePreset?: string;
  bodyMode?: string;
  gritAmount?: number;
  saturationAmount?: number;
  overdriveAmount?: number;
  fuzzAmount?: number;
  compression?: string;
  echo?: string;
  layerMode?: string;
  layerMix?: number;
};

const FX_PRESETS: FxPreset[] = [
  {
    id: "clean",
    label: "Clean / Original",
    detail: "Keep the accepted voice unchanged.",
  },
  {
    id: "deep",
    label: "Deep Voice",
    detail: "Lower pitch with a fuller body.",
    pitchSemitones: -4,
    bodyMode: "deeper",
    compression: "light",
  },
  {
    id: "giant",
    label: "Giant / Very Deep",
    detail: "Huge low character voice.",
    pitchSemitones: -7,
    bodyMode: "huge",
    saturationAmount: 18,
    compression: "medium",
  },
  {
    id: "high",
    label: "High Pitch",
    detail: "Higher and lighter character voice.",
    pitchSemitones: 5,
    bodyMode: "lighter",
  },
  {
    id: "robot",
    label: "Robot",
    detail: "Digital, metallic doubled voice.",
    gritAmount: 28,
    compression: "medium",
    layerMode: "robot_double",
    layerMix: 38,
  },
  {
    id: "radio",
    label: "Old Radio",
    detail: "Compressed communications-radio sound.",
    tonePreset: "radio",
    compression: "medium",
    gritAmount: 8,
  },
  {
    id: "telephone",
    label: "Telephone",
    detail: "Narrow-band telephone sound.",
    tonePreset: "telephone",
    compression: "light",
  },
  {
    id: "saturated",
    label: "Saturated",
    detail: "Warm harmonic thickness.",
    saturationAmount: 42,
    compression: "light",
  },
  {
    id: "overdrive",
    label: "Overdrive",
    detail: "Driven aggressive vocal distortion.",
    overdriveAmount: 58,
    compression: "medium",
  },
  {
    id: "fuzz",
    label: "Fuzz / Distorted",
    detail: "Heavy broken-up clipping.",
    fuzzAmount: 60,
    gritAmount: 12,
    compression: "strong",
  },
  {
    id: "static",
    label: "Static / Lo-Fi",
    detail: "Digital grit and damaged-speaker texture.",
    gritAmount: 70,
    tonePreset: "radio",
  },
  {
    id: "close",
    label: "Close-Up",
    detail: "Present close-microphone sound.",
    bodyMode: "deeper",
    compression: "medium",
    gainDb: 2,
  },
  {
    id: "far",
    label: "Far Away",
    detail: "Distant filtered voice with reflections.",
    highpassHz: 180,
    lowpassHz: 5600,
    tonePreset: "dark",
    echo: "room",
  },
  {
    id: "room",
    label: "Small Room",
    detail: "Short environmental reflections.",
    echo: "room",
  },
  {
    id: "cave",
    label: "Cave / Reverb",
    detail: "Large echoing environment.",
    echo: "cave",
    tonePreset: "dark",
  },
  {
    id: "ghost",
    label: "Ghost",
    detail: "Airy supernatural doubled voice.",
    pitchSemitones: 1,
    layerMode: "ghost_double",
    layerMix: 38,
    echo: "room",
  },
  {
    id: "monster",
    label: "Monster",
    detail: "Large layered creature voice.",
    pitchSemitones: -6,
    bodyMode: "huge",
    layerMode: "monster_double",
    layerMix: 42,
    saturationAmount: 25,
    compression: "medium",
  },
  {
    id: "android",
    label: "Android",
    detail: "Controlled synthetic machine voice.",
    gritAmount: 15,
    tonePreset: "bright",
    compression: "medium",
    layerMode: "robot_double",
    layerMix: 24,
  },
  {
    id: "alien",
    label: "Alien",
    detail: "Unnatural higher spectral doubled voice.",
    pitchSemitones: 3,
    bodyMode: "lighter",
    tonePreset: "bright",
    echo: "subtle",
    layerMode: "ghost_double",
    layerMix: 20,
  },
  {
    id: "underwater",
    label: "Underwater",
    detail: "Dark muffled submerged voice.",
    highpassHz: 80,
    lowpassHz: 3200,
    bodyMode: "deeper",
    tonePreset: "dark",
    echo: "subtle",
  },

];

export default function CharacterVoiceFxStage({
  characterId,
  candidateId,
  inputPath,
  inputUrl,
  disabled,
  saving,
  onFinish,
}: {
  characterId: string;
  candidateId: string;
  inputPath: string;
  inputUrl: string;
  disabled?: boolean;
  saving?: boolean;
  onFinish: (
    selection: FinalVoiceSelection,
  ) => Promise<void>;
}) {
  const [fxBusy, setFxBusy] = React.useState(false);
  const [fxPreset, setFxPreset] = React.useState("clean");
  const [showAdvanced, setShowAdvanced] =
    React.useState(false);

  const [pitchSemitones, setPitchSemitones] =
    React.useState(0);
  const [gainDb, setGainDb] =
    React.useState(0);
  const [highpassHz, setHighpassHz] =
    React.useState(0);
  const [lowpassHz, setLowpassHz] =
    React.useState(0);
  const [tonePreset, setTonePreset] =
    React.useState("neutral");
  const [bodyMode, setBodyMode] =
    React.useState("normal");
  const [gritAmount, setGritAmount] =
    React.useState(0);
  const [saturationAmount, setSaturationAmount] =
    React.useState(0);
  const [overdriveAmount, setOverdriveAmount] =
    React.useState(0);
  const [fuzzAmount, setFuzzAmount] =
    React.useState(0);
  const [compression, setCompression] =
    React.useState("off");
  const [echo, setEcho] =
    React.useState("off");
  const [layerMode, setLayerMode] =
    React.useState("off");
  const [layerMix, setLayerMix] =
    React.useState(0);

  const [fxResult, setFxResult] = React.useState<{
    audioPath: string;
    audioUrl: string;
  } | null>(null);

  const [message, setMessage] = React.useState("");
  const [error, setError] = React.useState("");

  const activePreset =
    FX_PRESETS.find((item) => item.id === fxPreset) ||
    null;

  function markCustom() {
    setFxPreset("custom");
    setFxResult(null);
    setMessage("");
    setError("");
  }

  function applyPreset(preset: FxPreset) {
    setFxPreset(preset.id);
    setPitchSemitones(preset.pitchSemitones ?? 0);
    setGainDb(preset.gainDb ?? 0);
    setHighpassHz(preset.highpassHz ?? 0);
    setLowpassHz(preset.lowpassHz ?? 0);
    setTonePreset(preset.tonePreset ?? "neutral");
    setBodyMode(preset.bodyMode ?? "normal");
    setGritAmount(preset.gritAmount ?? 0);
    setSaturationAmount(
      preset.saturationAmount ?? 0,
    );
    setOverdriveAmount(
      preset.overdriveAmount ?? 0,
    );
    setFuzzAmount(preset.fuzzAmount ?? 0);
    setCompression(preset.compression ?? "off");
    setEcho(preset.echo ?? "off");
    setLayerMode(preset.layerMode ?? "off");
    setLayerMix(preset.layerMix ?? 0);
    setFxResult(null);
    setError("");

    setMessage(
      preset.id === "clean"
        ? "Voice FX reset to the original voice."
        : `${preset.label} settings loaded. Preview the effect when ready.`,
    );
  }

  async function previewFx() {
    setFxBusy(true);
    setError("");
    setMessage("Processing Voice FX preview...");
    setFxResult(null);

    try {
      const response = await fetch(
        "/api/characters/voice-fx",
        {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            "x-otg-device-id":
              window.localStorage.getItem(
                "otg_character_device_id",
              ) || "character-web",
          },
          body: JSON.stringify({
            characterId,
            candidateId,
            inputPath,
            preset: fxPreset,
            pitchSemitones,
            gainDb,
            highpassHz,
            lowpassHz,
            tonePreset,
            bodyMode,
            gritAmount,
            saturationAmount,
            overdriveAmount,
            fuzzAmount,
            compression,
            echo,
            layerMode,
            layerMix,
            normalize: true,
          }),
        },
      );

      const json = await response.json().catch(() => null);

      if (
        !response.ok ||
        !json?.ok ||
        !json?.audioPath ||
        !json?.audioUrl
      ) {
        throw new Error(
          json?.error || "Voice FX processing failed.",
        );
      }

      setFxResult({
        audioPath: String(json.audioPath),
        audioUrl: String(json.audioUrl),
      });

      setMessage(
        "FX preview ready. Compare it with the original voice.",
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Voice FX processing failed.",
      );
      setMessage("");
    } finally {
      setFxBusy(false);
    }
  }

  const voiceFx = {
    preset: fxPreset,
    presetLabel:
      activePreset?.label ||
      (fxPreset === "custom"
        ? "Custom Voice FX"
        : fxPreset),
    pitchSemitones,
    gainDb,
    highpassHz,
    lowpassHz,
    tonePreset,
    bodyMode,
    gritAmount,
    saturationAmount,
    overdriveAmount,
    fuzzAmount,
    compression,
    echo,
    layerMode,
    layerMix,
  };

  const locked =
    Boolean(disabled) || Boolean(saving) || fxBusy;

  return (
    <section
      className="rounded-[26px] border border-fuchsia-300/20 bg-fuchsia-400/[0.05] p-5"
      data-otg="character-voice-fx"
    >
      <div className="text-xs font-black uppercase tracking-[0.2em] text-fuchsia-200/75">
        Final Step · Voice FX
      </div>

      <h2 className="mt-2 text-2xl font-black text-white">
        Shape the Final Voice
      </h2>

      <p className="mt-2 text-sm leading-6 text-white/55">
        Modify the accepted voice without regenerating it.
        Make it deeper, higher, robotic, distorted,
        saturated, distant, close, echoing, ghostly,
        monstrous, or custom.
      </p>

      {message ? (
        <div className="mt-4 rounded-xl border border-emerald-300/20 bg-emerald-400/10 p-3 text-sm text-emerald-100">
          {message}
        </div>
      ) : null}

      {error ? (
        <div className="mt-4 rounded-xl border border-red-300/20 bg-red-400/10 p-3 text-sm text-red-100">
          {error}
        </div>
      ) : null}

      <div className="mt-4 rounded-2xl border border-white/10 bg-black/25 p-4">
        <div className="text-xs font-black uppercase tracking-[0.16em] text-white/45">
          Original Accepted Voice
        </div>

        <audio
          key={inputUrl}
          src={inputUrl}
          controls
          preload="metadata"
          className="mt-3 w-full"
        />
      </div>

      <section
        data-otg="voice-fx-presets"
        className="mt-5 rounded-2xl border border-fuchsia-300/20 bg-black/20 p-4"
      >
        <div className="text-xs font-black uppercase tracking-[0.16em] text-fuchsia-100/70">
          Voice FX Preset
        </div>
        <select
          value={fxPreset}
          disabled={locked}
          onChange={(event) => {
            const preset = FX_PRESETS.find((item) => item.id === event.target.value);
            if (preset) applyPreset(preset);
          }}
          className="mt-3 min-h-12 w-full rounded-xl border border-fuchsia-300/20 bg-black/60 px-3 text-sm font-black text-white disabled:opacity-40"
        >
          {fxPreset === "custom" ? <option value="custom">Custom / Edited</option> : null}
          {FX_PRESETS.map((preset) => (
            <option key={preset.id} value={preset.id}>{preset.label}</option>
          ))}
        </select>
        <div className="mt-2 text-xs leading-5 text-white/45">
          {activePreset?.detail || "Custom settings. Preview the result before finishing."}
        </div>
      </section>

      <section
        data-otg="voice-fx-basic"
        className="mt-5 rounded-2xl border border-white/10 bg-black/25 p-4"
      >
        <div className="text-xs font-black uppercase tracking-[0.16em] text-white/55">
          Basic Voice FX
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label>
            <span className="text-xs font-black text-white/45">Pitch · {pitchSemitones}</span>
            <input type="range" min="-12" max="12" value={pitchSemitones}
              onChange={(event) => { setPitchSemitones(Number(event.target.value)); markCustom(); }}
              className="mt-3 w-full" />
          </label>
          <label>
            <span className="text-xs font-black text-white/45">Volume · {gainDb} dB</span>
            <input type="range" min="-24" max="24" value={gainDb}
              onChange={(event) => { setGainDb(Number(event.target.value)); markCustom(); }}
              className="mt-3 w-full" />
          </label>
          <label>
            <span className="text-xs font-black text-white/45">Echo</span>
            <select value={echo}
              onChange={(event) => { setEcho(event.target.value); markCustom(); }}
              className="mt-2 min-h-11 w-full rounded-xl border border-white/10 bg-black/50 px-3 text-sm text-white">
              <option value="off">Off</option>
              <option value="subtle">Subtle</option>
              <option value="room">Room</option>
              <option value="cave">Cave / Large</option>
            </select>
          </label>
          <label>
            <span className="text-xs font-black text-white/45">Distortion · {fuzzAmount}%</span>
            <input type="range" min="0" max="100" value={fuzzAmount}
              onChange={(event) => { setFuzzAmount(Number(event.target.value)); markCustom(); }}
              className="mt-3 w-full" />
          </label>
        </div>
      </section>

      <button
        type="button"
        disabled={locked}
        onClick={() =>
          setShowAdvanced((value) => !value)
        }
        data-otg="voice-fx-advanced"
        className="mt-5 min-h-11 w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 text-sm font-black text-white/70 disabled:opacity-40"
      >
        {showAdvanced
          ? "Hide Advanced Voice FX"
          : "Advanced Voice FX"}
      </button>

      {showAdvanced ? (
        <div className="mt-4 grid gap-4 rounded-2xl border border-white/10 bg-black/25 p-4 sm:grid-cols-2">

          <label>
            <span className="text-xs font-black uppercase tracking-[0.14em] text-white/45">
              Voice Body
            </span>
            <select
              value={bodyMode}
              onChange={(event) => {
                setBodyMode(event.target.value);
                markCustom();
              }}
              className="mt-2 min-h-11 w-full rounded-xl border border-white/10 bg-black/50 px-3 text-sm text-white"
            >
              <option value="lighter">Lighter</option>
              <option value="normal">Normal</option>
              <option value="deeper">Deeper</option>
              <option value="huge">Huge</option>
            </select>
          </label>

          <label>
            <span className="text-xs font-black uppercase tracking-[0.14em] text-white/45">
              Saturation · {saturationAmount}%
            </span>
            <input
              type="range"
              min="0"
              max="100"
              value={saturationAmount}
              onChange={(event) => {
                setSaturationAmount(
                  Number(event.target.value),
                );
                markCustom();
              }}
              className="mt-3 w-full"
            />
          </label>

          <label>
            <span className="text-xs font-black uppercase tracking-[0.14em] text-white/45">
              Overdrive · {overdriveAmount}%
            </span>
            <input
              type="range"
              min="0"
              max="100"
              value={overdriveAmount}
              onChange={(event) => {
                setOverdriveAmount(
                  Number(event.target.value),
                );
                markCustom();
              }}
              className="mt-3 w-full"
            />
          </label>


          <label>
            <span className="text-xs font-black uppercase tracking-[0.14em] text-white/45">
              Digital Grit · {gritAmount}%
            </span>
            <input
              type="range"
              min="0"
              max="100"
              value={gritAmount}
              onChange={(event) => {
                setGritAmount(
                  Number(event.target.value),
                );
                markCustom();
              }}
              className="mt-3 w-full"
            />
          </label>

          <label>
            <span className="text-xs font-black uppercase tracking-[0.14em] text-white/45">
              Tone
            </span>
            <select
              value={tonePreset}
              onChange={(event) => {
                setTonePreset(event.target.value);
                markCustom();
              }}
              className="mt-2 min-h-11 w-full rounded-xl border border-white/10 bg-black/50 px-3 text-sm text-white"
            >
              <option value="neutral">Neutral</option>
              <option value="dark">Dark</option>
              <option value="bright">Bright</option>
              <option value="radio">Radio</option>
              <option value="telephone">Telephone</option>
            </select>
          </label>


          <label>
            <span className="text-xs font-black uppercase tracking-[0.14em] text-white/45">
              Compression
            </span>
            <select
              value={compression}
              onChange={(event) => {
                setCompression(event.target.value);
                markCustom();
              }}
              className="mt-2 min-h-11 w-full rounded-xl border border-white/10 bg-black/50 px-3 text-sm text-white"
            >
              <option value="off">Off</option>
              <option value="light">Light</option>
              <option value="medium">Medium</option>
              <option value="strong">Strong</option>
            </select>
          </label>

          <label>
            <span className="text-xs font-black uppercase tracking-[0.14em] text-white/45">
              Voice Layer
            </span>
            <select
              value={layerMode}
              onChange={(event) => {
                setLayerMode(event.target.value);
                markCustom();
              }}
              className="mt-2 min-h-11 w-full rounded-xl border border-white/10 bg-black/50 px-3 text-sm text-white"
            >
              <option value="off">Off</option>
              <option value="octave_down">
                Octave Down
              </option>
              <option value="octave_up">
                Octave Up
              </option>
              <option value="monster_double">
                Monster Double
              </option>
              <option value="ghost_double">
                Ghost Double
              </option>
              <option value="robot_double">
                Robot Double
              </option>
            </select>
          </label>

          <label className="sm:col-span-2">
            <span className="text-xs font-black uppercase tracking-[0.14em] text-white/45">
              Layer Mix · {layerMix}%
            </span>
            <input
              type="range"
              min="0"
              max="100"
              value={layerMix}
              onChange={(event) => {
                setLayerMix(
                  Number(event.target.value),
                );
                markCustom();
              }}
              className="mt-3 w-full"
            />
          </label>
        </div>
      ) : null}

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          disabled={locked}
          onClick={() => void previewFx()}
          className="min-h-12 rounded-xl border border-fuchsia-300/35 bg-fuchsia-400/18 px-4 text-sm font-black text-fuchsia-50 disabled:opacity-40"
        >
          {fxBusy
            ? "Processing Voice FX..."
            : "Preview Voice FX"}
        </button>

        <button
          type="button"
          disabled={locked}
          onClick={() =>
            applyPreset(FX_PRESETS[0])
          }
          className="min-h-12 rounded-xl border border-white/15 bg-white/[0.05] px-4 text-sm font-black text-white/75 disabled:opacity-40"
        >
          Reset FX
        </button>
      </div>

      {fxResult ? (
        <div className="mt-5 rounded-2xl border border-fuchsia-300/20 bg-fuchsia-400/[0.08] p-4">
          <div className="text-xs font-black uppercase tracking-[0.16em] text-fuchsia-100/70">
            FX Preview
          </div>

          <audio
            key={fxResult.audioUrl}
            src={fxResult.audioUrl}
            controls
            preload="metadata"
            className="mt-3 w-full"
          />

          <div className="mt-2 text-xs text-white/45">
            Compare this player with the original above.
          </div>
        </div>
      ) : null}

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          disabled={locked}
          onClick={() =>
            void onFinish({
              finalAudioPath: inputPath,
              finalAudioUrl: inputUrl,
              effectsApplied: false,
              voiceFx: null,
            })
          }
          className="min-h-14 rounded-xl border border-white/15 bg-white/[0.05] px-4 text-sm font-black text-white/80 disabled:opacity-40"
        >
          {saving
            ? "Saving..."
            : "Use Original & Finish"}
        </button>

        <button
          type="button"
          disabled={locked || !fxResult}
          onClick={() => {
            if (!fxResult) return;

            void onFinish({
              finalAudioPath: fxResult.audioPath,
              finalAudioUrl: fxResult.audioUrl,
              effectsApplied: true,
              voiceFxLabel:
                activePreset?.label ||
                "Custom Voice FX",
              voiceFx,
            });
          }}
          className="min-h-14 rounded-xl border border-emerald-300/35 bg-emerald-400/20 px-4 text-sm font-black text-emerald-50 disabled:opacity-40"
        >
          {saving
            ? "Saving..."
            : "Use FX Voice & Finish"}
        </button>
      </div>
    </section>
  );
}
