"use client";
import React, { useEffect, useMemo, useState } from "react";
import { H3_MEDIA_ACCEPT } from "@/lib/h3MediaTypes";
import { checkH3SmartReferences, type H3SmartReferenceCapabilities } from "@/lib/h3SmartReferences";
import type { H3RefModLibraryEntry, H3RefModSlot } from "@/lib/h3SpecialModes/refMods";
import H3RefModSlotControls from "./H3RefModSlotControls";
import { ExpandableImage } from "./ExpandedMediaViewer";

type Image = { id: string; name: string; url: string; description: string };
const button = "min-h-11 rounded-lg border border-white/20 px-3 py-2 text-sm font-bold disabled:opacity-40";
export default function H3SmartReferences(props: {
  validateSelection: boolean;
  legacyEnhancementEnabled?: boolean;
  backend: "rtx3090" | "rtx5060ti"; disabled: boolean; useFirstFrame: boolean; firstFrame: Image | null;
  onUseFirstFrame: (value: boolean) => void; onFirstImage: (file: File) => void; onFirstGallery: () => void; onRemoveFirst: () => void;
  images: Image[]; videos: number; audios: number; slots: H3RefModSlot[];
  onAddImage: (file: File) => void; onImageGallery: () => void; onRemoveImage: (id: string) => void; onMoveImage: (id: string, direction: -1 | 1) => void;
  onAddImages?: (files: File[]) => void;
  onImageDescription: (id: string, value: string) => void;
  onAddRefMod: (entry: H3RefModLibraryEntry) => void; onRemoveRefMod: (id: string) => void; onMoveRefMod: (id: string, direction: -1 | 1) => void;
  onUpdateRefMod: (id: string, patch: Partial<H3RefModSlot>) => void; onValidation: (message: string) => void;
}) {
  const {backend, onValidation} = props;
  const [picker, setPicker] = useState(false);
  const [selectionError, setSelectionError] = useState("");
  const [search, setSearch] = useState(""); const [refresh, setRefresh] = useState(0);
  const requestKey = `${backend}/${refresh}`;
  const [loaded, setLoaded] = useState<{key: string; cap: H3SmartReferenceCapabilities | null; library: H3RefModLibraryEntry[]; error: string} | null>(null);
  const cap = loaded?.key === requestKey ? loaded.cap : null;
  const library = loaded?.key === requestKey ? loaded.library : [];
  const loadError = loaded?.key === requestKey ? loaded.error : "";
  useEffect(() => {
    const abort = new AbortController();
    void (async () => {
      try {
        const options = {credentials: "include" as const, cache: "no-store" as const, signal: abort.signal};
        const responses = await Promise.all([fetch(`/api/h3/smart-references?backend=${backend}`, options), fetch(`/api/h3/special/refmods/library?backend=${backend}`, options)]);
        const [caps, entries] = await Promise.all(responses.map(r => r.json()));
        if (!responses[0].ok || !caps.capabilities) throw Error(caps.error || "Could not check reference capabilities.");
        if (abort.signal.aborted) return;
        setLoaded({key: requestKey, cap: caps.capabilities, library: responses[1].ok && Array.isArray(entries.entries) ? entries.entries : [], error: ""});
      } catch (error) { if (!abort.signal.aborted) setLoaded({key: requestKey, cap: null, library: [], error: error instanceof Error ? error.message : "Could not check reference capabilities."}); }
    })();
    return () => abort.abort();
  }, [backend, requestKey]);
  const smartActive = props.validateSelection;
  const validation = useMemo(() => {
    if (!smartActive) {
      if (props.images.length + props.videos + props.audios > 12) return "Remove a reference: H3 supports at most 12 reference media files in total.";
      return "";
    }
    if (props.legacyEnhancementEnabled) return "Turn off the legacy RefMod / Motion Lab enhancements before using Smart References, so references are not applied twice.";
    if (!cap) return loadError || "Checking the selected GPU’s reference capabilities…";
    try { checkH3SmartReferences(cap, {useFirstFrame: props.useFirstFrame, refMods: props.slots}, props.images, props.videos, props.audios, !!props.firstFrame); return ""; }
    catch (error) { return error instanceof Error ? error.message : "Recheck the references."; }
  }, [cap, loadError, smartActive, props.legacyEnhancementEnabled, props.useFirstFrame, props.slots, props.images, props.videos, props.audios, props.firstFrame]);
  useEffect(() => onValidation(validation), [validation, onValidation]);
  let selectedRefModTokens: number | null = null;
  if (cap && smartActive && !validation) {
    selectedRefModTokens = checkH3SmartReferences(cap, {useFirstFrame: props.useFirstFrame, refMods: props.slots}, props.images, props.videos, props.audios, !!props.firstFrame).refModTokens;
  }
  const canMix = cap?.mixedReferences === true;
  const imageDisabled = props.disabled || !!props.slots.length && !canMix || props.images.length >= (cap?.maxImages ?? 9);
  const modDisabled = props.disabled || !!(props.images.length + props.videos + props.audios) && !canMix || props.slots.length >= (cap?.maxRefModSlots ?? 8);
  const visible = library.filter(item => `${item.displayName || ""} ${item.name} ${item.description}`.toLowerCase().includes(search.toLowerCase()));
  return <section className="min-w-0 space-y-3 rounded-lg border border-white/15 bg-black/20 p-4" data-otg="h3-smart-references">
    <label className="flex min-h-11 items-center gap-3 text-sm font-bold">
      <input type="checkbox" checked={props.useFirstFrame} disabled={props.disabled || !cap?.firstFrame} onChange={event => props.onUseFirstFrame(event.target.checked)} />
      <span>Use as First Frame<span className="block text-xs font-normal text-white/60">Start the video from a specific opening image.</span></span>
    </label>
    {props.useFirstFrame ? <div className="rounded-lg border border-white/10 p-3">
      {props.firstFrame ? <><ExpandableImage url={props.firstFrame.url} name={props.firstFrame.name} className="mb-2 block h-32 w-full" /><p className="mb-2 break-words text-xs">{props.firstFrame.name}</p></> : <p className="mb-2 text-sm text-white/60">Choose one opening image matching the video’s aspect ratio. H3 fits it to the output canvas.</p>}
      <div className="flex flex-wrap gap-2"><label className={button}>{props.firstFrame ? "Replace Image" : "Upload Image"}<input aria-label="Upload first-frame image" hidden type="file" accept={H3_MEDIA_ACCEPT.image} disabled={props.disabled} onChange={event => {const file = event.target.files?.[0]; if (file) props.onFirstImage(file); event.currentTarget.value = "";}} /></label>
      <button type="button" className={button} disabled={props.disabled} onClick={props.onFirstGallery}>Choose from Gallery</button>
      {props.firstFrame ? <button type="button" className={button} disabled={props.disabled} onClick={props.onRemoveFirst}>Remove Image</button> : null}</div>
    </div> : null}
    <details>
      <summary className="min-h-11 cursor-pointer py-2 text-sm font-bold">Character &amp; Scene References <span className="font-normal text-white/60">· {props.images.length} images • {props.slots.length} RefMods selected</span></summary>
      <p className="mb-3 text-xs text-white/60">Mix temporary images with saved references. Each can be removed independently. Create and manage RefMods in Characters → Ref Mod Gallery.</p>
      <div className="mb-3 flex flex-wrap gap-2">
        <label className={`${button} ${imageDisabled ? "opacity-40" : "cursor-pointer"}`}>+ Add Images<input aria-label="Add reference image" hidden type="file" multiple data-max-files={Math.max(0, Math.min((cap?.maxImages ?? 9) - props.images.length, (cap?.maxTotalReferenceMedia ?? 12) - props.images.length - props.videos - props.audios))} accept={H3_MEDIA_ACCEPT.image} disabled={imageDisabled} onChange={event => {
          const files = Array.from(event.target.files || []); event.currentTarget.value = "";
          const remaining = Math.min((cap?.maxImages ?? 9) - props.images.length, (cap?.maxTotalReferenceMedia ?? 12) - props.images.length - props.videos - props.audios);
          if (files.length > remaining) {setSelectionError(`Choose at most ${remaining} more images. Nothing was discarded.`); return;}
          setSelectionError(""); if (props.onAddImages) props.onAddImages(files); else files.forEach(props.onAddImage);
        }} /></label>
        <button type="button" className={button} disabled={imageDisabled} onClick={props.onImageGallery}>Gallery Image</button>
        <button type="button" className={button} disabled={modDisabled} onClick={() => setPicker(!picker)}>+ Add RefMod</button>
      </div>
      <p className="mb-2 text-xs text-white/60">{props.images.length}/{cap?.maxImages ?? 9} images · numbered order is used for generation</p>
      {selectionError && <p role="alert" className="text-sm text-amber-100">{selectionError}</p>}
      <div className="space-y-2">
        {props.images.map((image, i) => <article key={image.id} className="flex min-w-0 flex-wrap items-center gap-3 rounded-lg border border-white/10 p-2">
          <ExpandableImage url={image.url} name={image.name} className="h-16 w-16 shrink-0" />
          <div className="min-w-0 flex-1"><p className="break-words text-sm font-bold">{image.name}</p><p className="text-xs text-white/60">Reference Image · Picture {i + 1}</p></div>
          <div className="flex flex-wrap gap-1"><button type="button" className={button} disabled={props.disabled || i === 0} aria-label={`Move ${image.name} up`} onClick={() => props.onMoveImage(image.id, -1)}>Up</button><button type="button" className={button} disabled={props.disabled || i === props.images.length - 1} aria-label={`Move ${image.name} down`} onClick={() => props.onMoveImage(image.id, 1)}>Down</button><button type="button" className={button} disabled={props.disabled} aria-label={`Remove ${image.name}`} onClick={() => props.onRemoveImage(image.id)}>Remove</button></div>
        </article>)}
        {props.slots.map((slot, i) => <article key={slot.id} className="min-w-0 rounded-lg border border-white/10 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2"><div className="min-w-0"><p className="break-words text-sm font-bold">{library.find(entry=>entry.name===slot.name)?.displayName || slot.name}</p><p className="text-xs text-white/60">Saved RefMod</p></div><div className="flex gap-1"><button type="button" className={button} disabled={props.disabled || i === 0} onClick={() => props.onMoveRefMod(slot.id, -1)}>Up</button><button type="button" className={button} disabled={props.disabled || i === props.slots.length - 1} onClick={() => props.onMoveRefMod(slot.id, 1)}>Down</button><button type="button" className={button} disabled={props.disabled} aria-label={`Remove ${slot.name}`} onClick={() => props.onRemoveRefMod(slot.id)}>Remove</button></div></div>
          <details><summary className="min-h-11 cursor-pointer py-2 text-xs font-bold">Reference strength and settings</summary><H3RefModSlotControls slot={slot} disabled={props.disabled} onChange={patch => props.onUpdateRefMod(slot.id, patch)} /></details>
        </article>)}
      </div>
      {picker && cap ? <div className="mt-3 rounded-lg border border-white/20 p-3" role="region" aria-label="Choose saved RefMod"><label className="text-xs">Search RefMods<input value={search} onChange={event => setSearch(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg bg-zinc-950 p-2 text-white" /></label><div className="mt-2 max-h-72 space-y-2 overflow-y-auto">{visible.map(entry => <button type="button" className={`${button} block w-full text-left`} disabled={props.disabled} key={entry.id} onClick={() => {props.onAddRefMod(entry); setPicker(false);}}><span className="block break-words">{entry.displayName || entry.name}</span><span className="text-xs font-normal text-white/60">{entry.kind} · {entry.description}</span></button>)}{!visible.length ? <p className="text-xs">No RefMods found on this GPU.</p> : null}</div><button type="button" className={`${button} mt-2`} onClick={() => setPicker(false)}>Close</button></div> : null}
      <p className="mt-3 text-xs text-white/60">{cap ? `Smart References guard: ${cap.maxImages} images, ${cap.maxVideos} videos, ${cap.maxAudios} audio references; ${cap.maxTotalReferenceMedia} reference media total. ${cap.maxRefModSlots} RefMod loader slots. RefMod members and copies share the media envelope. The opening frame is separate.` : "Checking workflow limits…"}</p>
      {cap && !canMix && validation !== cap.reason ? <p className="mt-2 text-xs text-amber-100">{cap.reason}</p> : null}
      <details className="mt-3"><summary className="min-h-11 cursor-pointer py-2 text-sm">Advanced Settings</summary><p className="text-xs text-white/60">Images are numbered first; RefMods follow in saved order. Reorder within either group to change its reference map. {cap?.tokenBudgetExplanation} {cap?.combinedLimitBasis}</p><p className="mt-2 text-xs text-white/60">Saved RefMod tokens: {selectedRefModTokens ?? "not available"}. Ordinary images and the opening frame are encoded at generation time and are not included in this count.</p>
      {props.images.map(image => <label key={image.id} className="mt-3 block text-xs">{image.name} · Reference notes<input disabled={props.disabled} value={image.description} onChange={event => props.onImageDescription(image.id, event.target.value)} className="mt-1 min-h-11 w-full rounded-lg bg-zinc-950 p-2 text-white" /></label>)}</details>
    </details>
    {loadError && validation !== loadError ? <p role="alert" className="text-sm text-amber-100">{loadError}</p> : null}
    {validation ? <p role="alert" className="text-sm text-amber-100">{validation}</p> : null}
    <button type="button" className="min-h-11 text-xs text-white/60 underline" disabled={props.disabled} onClick={() => setRefresh(v => v + 1)}>Recheck GPU capabilities</button>
  </section>;
}
