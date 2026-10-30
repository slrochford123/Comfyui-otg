"use client";
import React, {useEffect, useRef, useState} from "react";
import {NATIVE_IMAGE_MODELS, type NativeImageModel} from "@/lib/images/nativeImageModels";
import {waitForNativeImage, type NativeImageResult} from "@/lib/client/nativeImages";
import {newClientRequestId} from "@/lib/client/requestId";

export default function NativeImagePanel({h3Only = false, sourcePath, sourceUrl, onComplete, onBack, ownerKey, defaultOrientation}: {
  h3Only?: boolean; sourcePath?: string; sourceUrl?: string; onComplete?: (result: NativeImageResult) => void; onBack?: () => void; ownerKey?: string; defaultOrientation?: string;
}) {
  const [model, setModel] = useState<NativeImageModel>(h3Only ? "minimax-h3-image" : "fibo2-edit-turbo");
  const [prompt, setPrompt] = useState("");
  const [orientation, setOrientation] = useState(defaultOrientation || (h3Only ? "square" : "source"));
  const [file, setFile] = useState<File | null>(null);
  const [seed, setSeed] = useState("");
  const [jobId, setJobId] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [gallerySaved, setGallerySaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<NativeImageResult | null>(null);
  const controller = useRef<AbortController | null>(null);
  const submitting = useRef(false);
  const complete = useRef(onComplete);
  useEffect(() => {complete.current = onComplete;}, [onComplete]);
  useEffect(() => () => controller.current?.abort(), []);
  // Owner-scoped resume pointer only; prompts, paths and source image bytes
  // are not put in browser storage. A reload never duplicates GPU work.
  const storageKey = ownerKey ? `otg:native-image:${ownerKey}:v1` : null;
  useEffect(() => {
    if (!storageKey) return;
    try {const saved = localStorage.getItem(storageKey); if (saved) setJobId(saved);} catch {}
  }, [storageKey]);
  useEffect(() => {
    if (!jobId) return;
    const abort = new AbortController(); controller.current = abort; setBusy(true);
    if (storageKey) {try {localStorage.setItem(storageKey, jobId);} catch {}}
    void waitForNativeImage(jobId, {signal: abort.signal, onStatus: setStatus}).then(output => {
      setResult(output); complete.current?.(output);
      if (storageKey) {try {localStorage.removeItem(storageKey);} catch {}}
    }).catch(e => {if (e.name !== "AbortError") setError(e.message);}).finally(() => {if (!abort.signal.aborted) setBusy(false);});
    return () => abort.abort();
  }, [jobId, storageKey]);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (busy || submitting.current) return;
    submitting.current = true;
    setBusy(true); setError(""); setStatus("Preparing"); setResult(null); setGallerySaved(false);
    const body = new FormData();
    const dimensions = orientation === "portrait" ? [768, 1344] : orientation === "landscape" ? [1344, 768] : [1024, 1024];
    body.set("model", model); body.set("prompt", prompt); body.set("seed", seed);
    if (orientation !== "source") {body.set("width", String(dimensions[0])); body.set("height", String(dimensions[1]));}
    try {
      body.set("clientRequestId", newClientRequestId());
      if (file) body.set("image", file);
      else if (sourcePath) body.set("imageAPath", sourcePath);
      else if (sourceUrl) {
        const image = await fetch(sourceUrl, {credentials: "same-origin"});
        if (!image.ok) throw Error("The selected source image could not be read.");
        body.set("image", new File([await image.blob()], "source.png", {type: "image/png"}));
      }
      const response = await fetch("/api/images/native", {method: "POST", credentials: "include", body});
      const output = await response.json();
      if (!response.ok || !output.jobId) throw Error(output.error || "Image request failed.");
      setJobId(output.jobId);
    } catch (e) {setError((e as Error).message); setBusy(false);}
    finally {submitting.current = false;}
  }
  async function cancel() {
    try {
      const response = await fetch(`/api/images/native?jobId=${encodeURIComponent(jobId)}`, {method: "DELETE", credentials: "include"});
      const output = await response.json();
      if (!response.ok) throw Error(output.error || "Cancellation could not be confirmed.");
      if (output.status === "canceled") {
        controller.current?.abort(); setJobId(""); setBusy(false); setStatus("Canceled");
        if (storageKey) {try {localStorage.removeItem(storageKey);} catch {}}
      } else setStatus(output.status);
    } catch (e) {setError((e as Error).message);}
  }
  async function saveGallery() {
    if (!result || saving || gallerySaved) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/images/native?jobId=${encodeURIComponent(result.jobId)}`, {method: "PATCH", credentials: "include"});
      const output = await response.json();
      if (!response.ok) throw Error(output.error || "Gallery save failed.");
      setGallerySaved(true);
    } catch (e) {setError((e as Error).message);}
    finally {setSaving(false);}
  }
  return <section className="space-y-3 rounded-xl border border-violet-300/25 bg-zinc-950 p-4 text-white" aria-label={h3Only ? "H3 Text to Image" : "Fibo image editing"}>
    <div className="flex items-center justify-between gap-3"><h2 className="text-xl font-bold">{h3Only ? "H3 · Text to Image" : "Fibo · Image Edit"}</h2>{onBack ? <button type="button" onClick={onBack} className="min-h-11 px-3">Back to H3</button> : null}</div>
    <p className="text-sm text-white/65">{h3Only ? "Official H3 still-image workflow · 30 native steps · no audio or video generation." : "Edit an uploaded image or the selected background. The original stays unchanged. Fibo weights are for non-commercial research."} Uses your Auto / Manual GPU selection.</p>
    <form onSubmit={submit} className="space-y-3">
      {!h3Only ? <label className="block text-sm">Model<select value={model} disabled={busy} onChange={e => setModel(e.target.value as NativeImageModel)} className="ml-2 min-h-11 rounded-lg bg-zinc-900 px-3"><option value="fibo2-edit-turbo">Turbo · 4 steps</option><option value="fibo2-dev">Dev · 50 steps</option></select></label> : null}
      {!h3Only ? <label className="block text-sm">Source image{sourcePath || sourceUrl ? " (selected background ready)" : ""}<input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={e => setFile(e.target.files?.[0] || null)} className="mt-2 block w-full" /></label> : null}
      <label className="block text-sm">{h3Only ? "Describe your image" : "Describe the change"}<textarea rows={4} maxLength={12000} value={prompt} disabled={busy} onChange={e => setPrompt(e.target.value)} required className="mt-1 w-full rounded-lg border border-white/20 bg-zinc-900 p-3" /></label>
      <label className="block text-sm">Canvas<select value={orientation} disabled={busy} onChange={e => setOrientation(e.target.value)} className="ml-2 min-h-11 rounded-lg bg-zinc-900 px-3">{!h3Only ? <option value="source">Match source aspect · approximately 1 MP</option> : null}<option value="square">Square · 1024 × 1024</option><option value="portrait">Portrait · 768 × 1344</option><option value="landscape">Landscape · 1344 × 768</option></select></label>
      {!h3Only ? <p className="text-xs text-white/60">Fibo scales and center-crops references to the selected canvas. Match source minimizes cropping; exact output dimensions appear with the result.</p> : null}
      <details><summary className="cursor-pointer text-sm">Advanced</summary><label className="mt-2 block text-sm">Seed (blank = random)<input value={seed} disabled={busy} onChange={e => setSeed(e.target.value)} inputMode="numeric" className="ml-2 rounded border border-white/20 bg-zinc-900 p-2" /></label></details>
      <button type="submit" disabled={busy || !prompt.trim() || (!h3Only && !file && !sourcePath && !sourceUrl)} className="min-h-11 rounded-lg bg-violet-500 px-5 font-bold disabled:opacity-50">{busy ? "Working…" : h3Only ? "Create image" : "Apply edit"}</button>
    </form>
    {status && busy ? <p role="status">{status} · job {jobId || "preparing"}</p> : null}
    {busy && jobId ? <button type="button" onClick={() => void cancel()} className="min-h-11 rounded-lg border border-white/20 px-4">Cancel this image job</button> : null}
    {error ? <p role="alert" className="text-red-300">{error}</p> : null}
    {result ? <div className="space-y-2"><img src={result.imageUrl} alt="Generated image result" className="max-h-[65vh] w-full rounded-lg object-contain" /><div className="flex flex-wrap gap-2"><a href={result.imageUrl} download={`${NATIVE_IMAGE_MODELS[result.model].label}.png`} className="inline-flex min-h-11 items-center rounded-lg border border-white/20 px-4">Download PNG</a><button type="button" onClick={() => void saveGallery()} disabled={saving || gallerySaved} className="min-h-11 rounded-lg border border-white/20 px-4 disabled:opacity-50">{gallerySaved ? "Saved to Gallery" : saving ? "Saving…" : "Save to Gallery"}</button></div><p className="text-xs text-white/60">{result.width} × {result.height} · Seed {result.seed}. Saved as a separate owner-scoped image.</p></div> : null}
  </section>;
}
