"use client";
import React from "react";
import type {CharacterRefCardPublic} from "@/lib/h3SpecialModes/characterRefCardContract";

export default function CharacterRefVoiceControls({voice, disabled, onChoose, onUpload, onRemove}: {
  voice: CharacterRefCardPublic["voice"]; disabled: boolean;
  onChoose: (id: string) => void; onUpload: (files: FileList | null) => void; onRemove: () => void;
}) {
  const [choices, setChoices] = React.useState<Array<{id: string; name: string}>>([]);
  const [error, setError] = React.useState("");
  React.useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/h3/special/refmods/character-card?voices=1", {credentials: "include", cache: "no-store", signal: controller.signal})
      .then(async r => {const data = await r.json(); if (!r.ok) throw Error(data.error || "Voice library unavailable."); setChoices(data.voices || []);})
      .catch(e => {if (!controller.signal.aborted) setError(e.message);});
    return () => controller.abort();
  }, []);
  return <fieldset disabled={disabled} className="space-y-3 rounded-xl border border-violet-400/30 p-3" data-otg="character-ref-voice">
    <legend className="px-2 font-bold">Character voice · optional</legend>
    {voice ? <div className="space-y-2"><p>{voice.name} · {Math.round(voice.durationSeconds)} sec</p><audio key={voice.id} controls preload="none" src={voice.url} className="max-w-full" aria-label="Saved character voice"/><button type="button" className="min-h-11 rounded-xl border border-white/20 px-3" onClick={onRemove}>Remove voice</button></div> : <p className="text-sm text-white/70">Save the look and voice together. Use 2–30 seconds of one clear voice you have permission to use.</p>}
    <label className="block text-sm">Saved voice<select aria-label="Saved character voice" value="" className="mt-1 min-h-11 w-full rounded-xl bg-zinc-900 p-2" onChange={e => {if(e.target.value) onChoose(e.target.value);}}><option value="">Choose a voice…</option>{choices.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
    <label className="block text-sm">Upload voice<input aria-label="Upload character voice" className="mt-1 block max-w-full" type="file" accept="audio/*,.wav,.mp3,.m4a,.flac,.ogg" onChange={e => {onUpload(e.target.files); e.target.value = "";}}/></label>
    {error ? <p role="alert" className="text-sm text-amber-200">{error}</p> : null}
    <p className="text-xs text-white/60">Voice reference guides H3; it is not a voice-match guarantee. Keep the original recording for voice correction after generation.</p>
  </fieldset>;
}
