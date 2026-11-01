"use client";

import React from "react";
import type { H3RefModSlot, H3RefModComponents, H3RefModCategory, H3RefModSourceKind } from "@/lib/h3SpecialModes/refMods";

const field = "mt-1 min-h-11 w-full rounded-lg border border-white/15 bg-zinc-950 p-2 text-sm text-white";
export default function H3RefModSlotControls({ slot, onChange, disabled = false }: { slot: H3RefModSlot; onChange: (patch: Partial<H3RefModSlot>) => void; disabled?: boolean }) {
  return <fieldset disabled={disabled} className="mt-3 space-y-3">
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="text-sm">Reference influence · {Math.round(slot.strength * 100)}%
        <input aria-label="Reference influence" className="mt-2 block min-h-11 w-full" type="range" min={0} max={1} step={0.05} value={slot.strength} onChange={event => onChange({ strength: Number(event.target.value) })} />
        <span className="block text-xs text-white/55">Lower gives the prompt more freedom. Higher follows this reference more closely.</span>
      </label>
      <label className="text-sm">Use from this reference
        <select aria-label="Use from this reference" className={field} value={slot.components} onChange={event => onChange({ components: event.target.value as H3RefModComponents })}>
          <option value="Auto">Automatic (recommended)</option><option value="All">Appearance and sound</option><option value="Visual">Appearance / motion only</option><option value="Audio">Sound / voice only</option>
        </select>
        <span className="mt-1 block text-xs text-white/55">Automatic uses the appearance, motion and sound saved in the RefMod.</span>
      </label>
    </div>
    <details className="rounded-lg border border-white/10 p-3">
      <summary className="min-h-11 cursor-pointer text-sm font-bold">Advanced reference settings</summary>
      <p className="mb-3 text-xs text-white/55">The saved reference supplies these defaults. Change them only to fine-tune its contribution.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">Library name<input className={field} value={slot.name} onChange={event => onChange({ name: event.target.value })} /><span className="block text-xs text-white/55">Exact saved RefMod name. Choose it from Add RefMod to avoid typing.</span></label>
        <label className="text-sm">Reference role<select className={field} value={slot.category} onChange={event => onChange({ category: event.target.value as H3RefModCategory })}>{["character", "motion", "audio", "bundle", "uncategorized"].map(value => <option key={value} value={value}>{value}</option>)}</select><span className="block text-xs text-white/55">Tells the prompt whether to use a person’s identity, movement, sound or a bundle.</span></label>
        <label className="text-sm">Saved source type<select className={field} value={slot.sourceKind} onChange={event => onChange({ sourceKind: event.target.value as H3RefModSourceKind })}>{["unknown", "image", "video", "audio", "bundle"].map(value => <option key={value} value={value}>{value}</option>)}</select><span className="block text-xs text-white/55">Match the media used to create the RefMod so prompt references map correctly.</span></label>
        {(["visualStrength", "audioStrength"] as const).map(key => <label key={key} className="text-sm">{key === "visualStrength" ? "Appearance / motion influence" : "Sound / voice influence"}<input className={field} type="number" min={0} max={1} step={0.05} value={slot[key]} onChange={event => onChange({ [key]: Number(event.target.value) })} /><span className="block text-xs text-white/55">Multiplies the main influence for this component. 1 keeps it unchanged; 0 disables it.</span></label>)}
        <label className="text-sm">Reference copies<input className={field} type="number" min={1} max={10} step={1} value={slot.copies} onChange={event => onChange({ copies: Number(event.target.value) })} /><span className="block text-xs text-white/55">Repeats the reference tokens to reinforce them. Keep 1 normally; more uses extra memory.</span></label>
      </div>
      <label className="mt-3 block text-sm">Reference notes<input className={field} value={slot.description} onChange={event => onChange({ description: event.target.value })} placeholder="What should this reference contribute?" /><span className="block text-xs text-white/55">Describe the identity, movement or sound you want retained.</span></label>
    </details>
  </fieldset>;
}
