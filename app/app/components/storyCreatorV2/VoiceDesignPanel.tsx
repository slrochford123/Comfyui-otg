"use client";

import {
  useState,
} from "react";

type VoiceProfileInput = {
  name: string;
  sampleText: string;
  direction: string;
};

type Props = {
  busy: boolean;
  onSaveVoiceProfile: (input: VoiceProfileInput) => void;
};

export function VoiceDesignPanel({
  busy,
  onSaveVoiceProfile,
}: Props) {
  const [name, setName] = useState("");
  const [sampleText, setSampleText] = useState(
    "This is the voice of the story finding its shape.",
  );
  const [direction, setDirection] = useState("");

  return (
    <section className="rounded-[20px] border border-white/10 bg-white/[0.035] p-4">
      <p className="text-xs font-black uppercase tracking-[0.16em] text-white/45">
        Voice Design
      </p>

      <h3 className="mt-2 text-lg font-black text-white">
        Voice Profile Space
      </h3>

      <div className="mt-4 grid gap-3">
        <label className="block">
          <span className="mb-2 block text-xs font-black uppercase tracking-[0.14em] text-white/45">
            Voice Name
          </span>

          <input
            value={name}
            onChange={(event) =>
              setName(event.target.value)
            }
            maxLength={120}
            placeholder="Character or narrator voice"
            className="w-full rounded-[14px] border border-white/10 bg-black/45 px-4 py-3 text-sm text-white outline-none placeholder:text-white/28 focus:border-cyan-300/40"
          />
        </label>

        <label className="block">
          <span className="mb-2 block text-xs font-black uppercase tracking-[0.14em] text-white/45">
            Sample Line
          </span>

          <textarea
            value={sampleText}
            onChange={(event) =>
              setSampleText(event.target.value)
            }
            rows={3}
            className="w-full resize-y rounded-[14px] border border-white/10 bg-black/45 px-4 py-3 text-sm leading-6 text-white outline-none placeholder:text-white/28 focus:border-cyan-300/40"
          />
        </label>

        <label className="block">
          <span className="mb-2 block text-xs font-black uppercase tracking-[0.14em] text-white/45">
            Performance Direction
          </span>

          <textarea
            value={direction}
            onChange={(event) =>
              setDirection(event.target.value)
            }
            rows={4}
            placeholder="Tone, accent, pace, texture, age, restraint, energy..."
            className="w-full resize-y rounded-[14px] border border-white/10 bg-black/45 px-4 py-3 text-sm leading-6 text-white outline-none placeholder:text-white/28 focus:border-cyan-300/40"
          />
        </label>
      </div>

      <button
        type="button"
        disabled={busy}
        onClick={() =>
          onSaveVoiceProfile({
            name,
            sampleText,
            direction,
          })
        }
        className="mt-4 rounded-[14px] border border-cyan-300/25 bg-cyan-300/[0.08] px-4 py-2.5 text-sm font-black text-cyan-50 transition hover:bg-cyan-300/[0.13] disabled:cursor-not-allowed disabled:opacity-40"
      >
        {busy ? "Saving..." : "Save voice profile"}
      </button>

      <p className="mt-3 text-xs leading-5 text-white/45">
        Saved profiles are included in Story Creator production
        packages and map to the existing character voice-preview
        route when a full Character record is created.
      </p>
    </section>
  );
}
