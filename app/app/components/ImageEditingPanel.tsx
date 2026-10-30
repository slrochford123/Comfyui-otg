"use client";
import React, {useRef, useState} from "react";
import ImageEditEngineSelect from "./ImageEditEngineSelect";
import {nativeEditEngineLabel, type NativeEditEngine} from "@/lib/client/nativeImages";
import {runImageEdit, type ImageEditResult} from "@/lib/client/imageEditing";

export default function ImageEditingPanel({sourceUrl, onComplete}: {sourceUrl: string; onComplete: (result: ImageEditResult) => void}) {
  const [engine, setEngine] = useState<NativeEditEngine>("qwen");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const submitting = useRef(false);
  async function apply() {
    if (submitting.current || !prompt.trim()) return;
    submitting.current = true; setBusy(true); setError(""); setStatus("Preparing source image…");
    try {
      const response = await fetch(sourceUrl, {credentials: "include", cache: "no-store"});
      if (!response.ok) throw Error("The source image could not be loaded.");
      const blob = await response.blob();
      const result = await runImageEdit({engine, image: new File([blob], "source.png", {type: blob.type || "image/png"}),
        prompt, seed: String(Math.floor(Math.random() * 2 ** 32)), onSubmitted: id => setStatus(`${nativeEditEngineLabel(engine)} · job ${id}`)});
      onComplete(result); setStatus("Edit added as a new candidate. Original preserved.");
    } catch (reason) {setError((reason as Error).message);}
    finally {submitting.current = false; setBusy(false);}
  }
  return <section className="space-y-3" aria-label="Edit selected image">
    <ImageEditEngineSelect value={engine} onChange={setEngine} disabled={busy} />
    <label className="block text-sm">Describe the change<textarea value={prompt} onChange={event => setPrompt(event.target.value)} disabled={busy} rows={4} className="mt-1 w-full rounded-lg border border-white/20 bg-zinc-950 p-3" /></label>
    <button type="button" disabled={busy || !prompt.trim()} onClick={() => void apply()} className="min-h-11 rounded-lg bg-violet-500 px-4 font-bold disabled:opacity-50">{busy ? "Editing…" : "Apply edit"}</button>
    {status ? <p role="status" className="break-all text-xs">{status}</p> : null}
    {error ? <p role="alert" className="text-sm text-red-300">{error}</p> : null}
  </section>;
}
