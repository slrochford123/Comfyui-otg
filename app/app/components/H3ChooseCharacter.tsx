"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { loadSavedCharacters } from "@/lib/characters/libraryClient";
import type { CharacterRecord } from "@/lib/characters/store";
import { h3CardImages, type H3CardReference } from "@/lib/h3CardReferences";
import type { H3SmartRefModInfo } from "@/lib/h3SmartReferences";

const control = "min-h-11 rounded-lg border border-white/20 px-3 py-2";
export default function H3ChooseCharacter({ onClose, onImage, refMods, onRefMod }: {
  onClose: () => void;
  onImage: (file: File, binding: H3CardReference, description: string) => void;
  refMods: H3SmartRefModInfo[];
  onRefMod: (name: string) => void;
}) {
  const [cards, setCards] = useState<CharacterRecord[]>([]);
  const [cardId, setCardId] = useState("");
  const [imageId, setImageId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const abort = new AbortController();
    void loadSavedCharacters(abort.signal).then(setCards).catch(error => {
      if (!abort.signal.aborted) setError(error.message);
    });
    return () => abort.abort();
  }, []);
  const card = cards.find(item => item.id === cardId);
  const images = card ? h3CardImages(card) : [];
  const image = images.find(item => item.id === imageId) || images[0];
  const mods = refMods.filter(item => item.characterKey === cardId && item.kind !== "audio");
  async function add() {
    if (!card || !image) return;
    setBusy(true);
    setError("");
    try {
      const url = "/api/file?path=" + encodeURIComponent(image.path);
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) throw Error("The approved character image could not be opened.");
      const blob = await response.blob();
      const ext = blob.type.includes("jpeg") ? "jpg" : blob.type.includes("webp") ? "webp" : "png";
      const name = card.name + " · " + image.label + "." + ext;
      onImage(new File([blob], name, { type: blob.type }), { characterId: card.id, imageId: image.id, version: card.updatedAt }, [card.name, image.look, card.description].filter(Boolean).join(". "));
      onClose();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not add the character.");
    } finally {
      setBusy(false);
    }
  }
  return createPortal(<div role="dialog" aria-modal="true" aria-label="Choose Character" className="fixed inset-0 z-[12001] flex items-start justify-center overflow-auto bg-black/75 p-3 sm:items-center">
    <div className="w-full max-w-lg space-y-3 rounded-xl bg-zinc-950 p-4 text-white">
      <div className="flex justify-between gap-2"><h2 className="font-bold">Choose Character</h2><button type="button" className={control} onClick={onClose} disabled={busy}>Close</button></div>
      <label className="block text-sm">Character Card
        <select className={control + " mt-1 w-full bg-zinc-900"} value={cardId} onChange={event => {setCardId(event.target.value); setImageId("");}}>
          <option value="">Choose a saved character</option>
          {cards.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>
      {image && <>
        <label className="block text-sm">Approved image or look
          <select className={control + " mt-1 w-full bg-zinc-900"} value={image.id} onChange={event => setImageId(event.target.value)}>
            {images.map(item => <option key={item.id} value={item.id}>{[item.label, item.look].filter(Boolean).join(" · ")}</option>)}
          </select>
        </label>
        <img src={"/api/file?path=" + encodeURIComponent(image.path)} alt={image.label} className="max-h-[35dvh] w-full object-contain" />
        <button type="button" className={control} disabled={busy} onClick={() => void add()}>Add to Reference Deck</button>
      </>}
      {!!mods.length && <details><summary className="cursor-pointer py-2">Visual RefMods</summary><div className="flex flex-wrap gap-2">
        {mods.map(mod => <button type="button" className={control} key={mod.name} onClick={() => { onRefMod(mod.name); onClose(); }}>Add {mod.name.split("/").at(-1)}</button>)}
      </div></details>}
      {error && <p role="alert" className="text-amber-200">{error}</p>}
    </div>
  </div>, document.body);
}
