"use client";
import React, { useEffect, useRef, useState } from "react";
import { newClientRequestId } from "@/lib/client/requestId";
type Job = { id: string; status: string; statusMessage: string; error?: string; progressPercent?: number; videoUrl?: string; galleryStatus?: string; nativeResolution?: string; durationSeconds?: number; approximatePreview?: { imageUrl: string } };
type GalleryVideo = { name: string; url: string; kind?: string; video?: boolean };
type SourceAsset = { id: string; url: string; duration: number; name: string };
function previewUrl(value?: string) {
  if (!value || value.length > 32 * 1024 ** 2) return undefined;
  if (value.startsWith("/api/") && !value.includes("\\")) return value;
  return /^data:(?:image\/(?:jpeg|png|webp|gif)|video\/(?:mp4|webm));base64,[a-zA-Z0-9+/=\s]+$/.test(value) ? value : undefined;
}
export function trimTime(seconds: number) { return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${(seconds % 60).toFixed(2).padStart(5, "0")}`; }
export default function H3VideoEditPanel({ onBack, authenticatedOwnerKey = "", studioBusy = false }: { onBack: () => void; authenticatedOwnerKey?: string; studioBusy?: boolean }) {
  const [quality, setQuality] = useState("0.6");
  const [file, setFile] = useState<File | null>(null);
  const [source, setSource] = useState("");
  const [prompt, setPrompt] = useState("");
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState("");
  const [job, setJob] = useState<Job | null>(null);
  const [pending, setPending] = useState(false);
  const [gallery, setGallery] = useState<GalleryVideo[] | null>(null);
  const [asset, setAsset] = useState<SourceAsset | null>(null);
  const [selection, setSelection] = useState<SourceAsset | null>(null);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(0);
  const [operation, setOperation] = useState("");
  const operationAbort = useRef<AbortController | null>(null);
  const uploadId = useRef("");
  const generation = useRef(0);
  const ownedAssets = useRef(new Set<string>());
  const guard = useRef(false);
  const sourceRef = useRef("");
  const picker = useRef<HTMLInputElement>(null);
  const output = useRef<HTMLVideoElement>(null);
  const requestId = useRef("");
  useEffect(() => { requestId.current = ""; }, [selection?.id, prompt, quality]);
  function removeAsset(id: string) { ownedAssets.current.delete(id); void fetch("/api/h3/video-edit/source", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, remove: true }), keepalive: true }); }
  useEffect(() => () => { operationAbort.current?.abort(); if (sourceRef.current) URL.revokeObjectURL(sourceRef.current); for (const id of ownedAssets.current) { void fetch("/api/h3/video-edit/source", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, remove: true }), keepalive: true }); } }, []);
  const active = !!job && !["completed", "canceled", "failed"].includes(job.status);
  const busy = pending || active;
  const preview = previewUrl(job?.approximatePreview?.imageUrl);
  useEffect(() => {
    if (!job?.id || (["completed", "canceled", "failed"].includes(job.status) && !(job.status === "completed" && job.galleryStatus === "pending"))) return;
    const controller = new AbortController();
    const id = job.id;
    const timer = window.setInterval(() => {
      fetch(`/api/h3/generation?jobId=${encodeURIComponent(id)}`, { signal: controller.signal, cache: "no-store" })
        .then(async response => { const result = await response.json(); if (!response.ok) throw Error(result.error || "Could not read edit status."); setJob(result.job); })
        .catch(e => { if (!controller.signal.aborted) setError(e.message); });
    }, 1500);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [job?.id, job?.status, job?.galleryStatus]);
  function select(next: File | null) {
    generation.current += 1; operationAbort.current?.abort();
    for (const id of [...ownedAssets.current]) removeAsset(id);
    setAsset(null); setSelection(null); setStart(0); setEnd(0);
    if (sourceRef.current) URL.revokeObjectURL(sourceRef.current);
    sourceRef.current = ""; setSource(""); setFile(null); setDuration(0); setError(""); setJob(null);
    if (!next) return;
    if (!/\.(mp4|mov|mkv|webm|m4v)$/i.test(next.name) || (next.type && !next.type.startsWith("video/"))) { setError("Choose a video, not an image or audio file."); return; }
    sourceRef.current = URL.createObjectURL(next); setSource(sourceRef.current); setFile(next);
    void prepare(next);
  }
  async function json(response: Response) { const result = await response.json(); if (!response.ok) throw Error(result.error || "Video operation failed."); return result; }
  async function prepare(next: File) {
    if (guard.current) return;
    guard.current = true; setPending(true); setError("");
    const version = generation.current;
    const controller = new AbortController(); operationAbort.current = controller;
    const id = newClientRequestId(); uploadId.current = id;
    try {
      if (next.size > 512 * 1024 ** 2) throw Error("Choose a video smaller than 512 MB.");
      let upload;
      const size = 8 * 1024 ** 2, count = Math.ceil(next.size / size);
      for (let index = 0; index < count; index++) {
        setOperation(`Uploading video · ${Math.round(index / count * 100)}%`);
        const data = new FormData();
        Object.entries({ uploadId: id, kind: "video", name: next.name, type: next.type, size: String(next.size), chunkIndex: String(index), chunkCount: String(count) }).forEach(([key, value]) => data.set(key, value));
        data.set("chunk", next.slice(index * size, (index + 1) * size), next.name);
        upload = (await json(await fetch("/api/h3/generation/upload", { method: "POST", body: data, signal: controller.signal }))).upload;
      }
      setOperation("Checking source video…");
      const result = await json(await fetch("/api/h3/video-edit/source", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "import", upload }), signal: controller.signal }));
      ownedAssets.current.add(result.asset.id);
      if (version !== generation.current || controller.signal.aborted) { removeAsset(result.asset.id); return; }
      setAsset(result.asset); setDuration(result.asset.duration); setStart(0); setEnd(Math.min(10, result.asset.duration));
      if (result.asset.duration <= 10) setSelection(result.asset);
    } catch (e) { if (!controller.signal.aborted && version === generation.current) setError(e instanceof Error ? e.message : "Video upload failed."); }
    finally {
      void fetch(`/api/h3/generation/upload?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      uploadId.current = ""; operationAbort.current = null; guard.current = false; setPending(false); setOperation("");
    }
  }
  async function trim() {
    if (!asset || guard.current) return;
    guard.current = true; setPending(true); setError(""); setOperation("Trimming selection…");
    const controller = new AbortController(); operationAbort.current = controller;
    try {
      const result = await json(await fetch("/api/h3/video-edit/source", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "trim", id: asset.id, start, end }), signal: controller.signal }));
      ownedAssets.current.add(result.asset.id);
      if (controller.signal.aborted) { removeAsset(result.asset.id); return; }
      if (selection && selection.id !== asset.id) removeAsset(selection.id);
      setSelection(result.asset);
    } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Video trim failed."); }
    finally { operationAbort.current = null; guard.current = false; setPending(false); setOperation(""); }
  }
  async function cancelPreparation() {
    const controller = operationAbort.current;
    if (!controller) return;
    setOperation("Cancelling…");
    try {
      if (asset) await json(await fetch("/api/h3/video-edit/source", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: asset.id }) }));
      if (uploadId.current) await json(await fetch(`/api/h3/generation/upload?id=${encodeURIComponent(uploadId.current)}`, { method: "DELETE" }));
      controller.abort();
    } catch (e) { setError(e instanceof Error ? e.message : "Cancellation could not be confirmed."); }
  }
  async function submit(action?: "cancel" | "retry" | "gallery") {
    if (guard.current) return;
    guard.current = true; setPending(true); setError("");
    try {
      let response: Response;
      if (action === "cancel" || action === "gallery") response = await fetch(action === "gallery" ? "/api/h3/generation/gallery" : "/api/h3/generation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...(action === "cancel" ? { action } : {}), jobId: job?.id }) });
      else {
        if (!selection || !prompt.trim()) throw Error("Choose and prepare a 2–10-second video selection and enter an edit prompt.");
        if (action === "retry" || !requestId.current) requestId.current = newClientRequestId();
        response = await fetch("/api/h3/video-edit/simple", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceId: selection.id, prompt: prompt.trim(), quality, requestId: requestId.current }) });
      }
      const result = await response.json(); if (!response.ok) throw Error(result.error || "H3 edit failed.");
      if (action === "gallery" && !result.job && job) setJob((await json(await fetch(`/api/h3/generation?jobId=${encodeURIComponent(job.id)}`, { cache: "no-store" }))).job);
      else { setJob(result.job); if (!action || action === "retry") requestId.current = ""; }
    } catch (e) { setError(e instanceof Error ? e.message : "H3 edit failed."); }
    finally { guard.current = false; setPending(false); }
  }
  async function openGallery() {
    setError("");
    try { const response = await fetch("/api/gallery?media=video&per=100", { cache: "no-store" }); const result = await response.json(); if (!response.ok) throw Error(result.error || "Gallery unavailable."); setGallery((result.items || []).filter((item: GalleryVideo) => item.video || item.kind === "video")); }
    catch (e) { setError(e instanceof Error ? e.message : "Gallery unavailable."); }
  }
  async function choose(item: GalleryVideo) {
    try { const url = new URL(item.url, location.origin); if (url.origin !== location.origin || !url.pathname.startsWith("/api/gallery/file")) throw Error("Unsupported Gallery source."); const response = await fetch(url); if (!response.ok) throw Error("Could not load the selected video."); select(new File([await response.blob()], item.name, { type: "video/mp4" })); setGallery(null); }
    catch (e) { setError(e instanceof Error ? e.message : "Gallery selection failed."); }
  }
  const button = "min-h-11 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2 disabled:opacity-50";
  return <section className="mx-auto min-w-0 max-w-4xl space-y-4 rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-4 pb-28 text-[var(--color-text)]" data-otg="h3-video-edit">
    <button className={button} onClick={onBack} disabled={busy}>Back to H3 Studio</button>
    <h2 className="text-2xl font-bold">Edit Video</h2>
    <p className="text-sm text-[var(--color-text-muted)]">Choose a 2–10-second portion, describe your edit and create the video. Its duration and orientation follow your clip. Generative editing may reinterpret details.</p>
    <input ref={picker} aria-label="Source video file" hidden type="file" accept="video/mp4,video/quicktime,video/webm,video/x-matroska,.mp4,.mov,.mkv,.webm,.m4v" onChange={event => { select(event.target.files?.[0] || null); event.target.value = ""; }} />
    <div className="flex flex-wrap gap-2"><button className={button} disabled={busy} onClick={() => picker.current?.click()}>Select Video</button><button className={button} disabled={busy} onClick={() => void openGallery()}>Choose Video from Gallery</button>{file ? <button className={button} disabled={busy} onClick={() => select(null)}>Remove Source Video</button> : null}</div>
    {error ? <p role="alert" className="break-words text-[var(--color-error)]">{error}</p> : null}
    {source ? <div className="min-w-0"><p className="break-words">{file?.name} · {duration ? `${duration.toFixed(2)} seconds` : "Checking video…"}</p><video key={source} src={source} controls playsInline className="max-h-80 w-full" onError={() => setError("This video could not be decoded. Choose MP4 or WebM.")} /></div> : null}
    {operation ? <div role="status" className="space-y-2"><p>{operation}</p><button className={button} onClick={() => void cancelPreparation()} disabled={operation === "Cancelling…"}>Cancel {operation.startsWith("Trimming") ? "Trim" : "Upload"}</button></div> : null}
    {file && !asset && !busy ? <button className={button} onClick={() => void prepare(file)}>Retry Upload</button> : null}
    {asset ? <fieldset disabled={busy} className="min-w-0 space-y-3 rounded-xl border border-[var(--color-border)] p-3" data-otg="h3-video-trim"><legend>Timeline selection</legend>
      <label className="block">Start: {trimTime(start)}<input aria-label="Trim start timeline" type="range" min={0} max={Math.max(0, duration - 2)} step="0.01" value={start} onChange={e => { const value = Number(e.target.value); setStart(value); setEnd(Math.min(duration, Math.max(value + 2, Math.min(end, value + 10)))); setSelection(null); }} className="block min-h-11 w-full" /></label>
      <label className="block">End: {trimTime(end)}<input aria-label="Trim end timeline" type="range" min={Math.min(duration, start + 2)} max={Math.min(duration, start + 10)} step="0.01" value={end} onChange={e => { setEnd(Number(e.target.value)); setSelection(null); }} className="block min-h-11 w-full" /></label>
      <div className="grid min-w-0 grid-cols-2 gap-3">{(["Start", "End"] as const).map(label => <label key={label} className="min-w-0">{label} seconds<input aria-label={`Trim ${label.toLowerCase()} seconds`} type="number" inputMode="decimal" step="0.01" min={0} max={duration} value={label === "Start" ? start : end} onChange={e => { (label === "Start" ? setStart : setEnd)(Number(e.target.value)); setSelection(null); }} className="block min-h-11 w-full min-w-0 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-2" /></label>)}</div>
      <p>Selected: {(end - start).toFixed(2)} sec</p><div className="flex flex-wrap gap-2"><button className={button} disabled={!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > duration || end - start < 2 || end - start > 10} onClick={() => void trim()}>Trim Selection</button>{duration <= 10 ? <button className={button} onClick={() => { setStart(0); setEnd(duration); setSelection(asset); }}>Use Full Video</button> : null}</div>
    </fieldset> : null}
    {selection ? <div><h3 className="font-semibold">{selection.id === asset?.id ? "Full video ready" : "Trimmed clip preview"} · {selection.duration.toFixed(2)} sec</h3><video key={selection.id} src={selection.url} controls playsInline className="max-h-80 w-full" /></div> : null}
    <label className="block">Megapixel size<select aria-label="Megapixel size" disabled={busy} value={quality} onChange={e => setQuality(e.target.value)} className="mt-2 block min-h-11 w-full min-w-0 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3"><option value="0.2">0.2 MP</option><option value="0.6">0.6 MP</option><option value="1">1 MP</option></select></label>
    <label className="block">Edit prompt<textarea aria-label="H3 video edit prompt" rows={4} maxLength={4000} value={prompt} disabled={busy} onChange={event => setPrompt(event.target.value)} className="mt-2 w-full min-w-0 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3" placeholder="Describe what you want changed in this video." /></label>
    {!authenticatedOwnerKey ? <p>Sign in to create a video.</p> : null}
    <div className="flex flex-wrap gap-2"><button className={button} disabled={busy || studioBusy || !authenticatedOwnerKey || !selection || !prompt.trim()} onClick={() => void submit()}>Create Video</button>{active ? <button className={button} disabled={pending || job?.status === "canceling"} onClick={() => void submit("cancel")}>{job?.status === "canceling" ? "Cancelling…" : "Safe Cancel"}</button> : null}{job && ["failed", "canceled"].includes(job.status) ? <button className={button} disabled={busy || studioBusy || !selection} onClick={() => void submit("retry")}>Retry</button> : null}</div>
    {job ? <div role="status"><p>{job.statusMessage}</p>{active ? <progress aria-label="Generation progress" max="100" value={job.progressPercent || 0} /> : null}{job.error ? <p className="text-[var(--color-error)]">{job.error}</p> : null}</div> : null}
    {active && preview ? <figure>{preview.startsWith("data:video/") ? <video aria-label="Generation preview" src={preview} autoPlay loop muted playsInline controls className="max-h-80 w-full object-contain" /> : <img src={preview} alt="Generation preview" className="max-h-80 w-full object-contain" />}<figcaption className="text-sm">Live preview · final video may differ</figcaption></figure> : null}
    {job?.status === "completed" && job.videoUrl ? <div className="space-y-3"><video ref={output} key={job.id} src={job.videoUrl} controls playsInline className="max-h-96 w-full" /><p>{job.nativeResolution} · {job.durationSeconds?.toFixed(2)} seconds · {job.galleryStatus === "saved" ? "Saved to Gallery" : job.galleryStatus === "failed" ? "Gallery save needs attention" : "Saving to Gallery…"}</p><div className="flex flex-wrap gap-2"><a className={button} href={job.videoUrl + (job.videoUrl.includes("?") ? "&" : "?") + "download=1"} download>Download Video</a><button className={button} onClick={() => { void output.current?.requestFullscreen?.().catch(() => setError("Use the player fullscreen control to expand the video.")); }}>Expand Video</button>{job.galleryStatus !== "saved" ? <button className={button} disabled={pending} onClick={() => void submit("gallery")}>Save to Gallery</button> : null}</div></div> : null}
    {gallery ? <div role="dialog" aria-modal="true" aria-label="Choose source video" className="fixed inset-0 z-[10030] overflow-y-auto bg-[var(--color-background)] p-4 pb-28"><button className={button} onClick={() => setGallery(null)}>Close Video Gallery</button><h3 className="my-4 text-xl font-bold">Choose source video</h3><div className="grid min-w-0 grid-cols-2 gap-3">{gallery.map(item => <button key={item.url} className={button + " min-w-0"} onClick={() => void choose(item)}><video src={item.url} preload="metadata" muted playsInline className="w-full" /><span className="break-all text-xs">{item.name}</span></button>)}</div>{!gallery.length ? <p>No saved videos.</p> : null}</div> : null}
  </section>;
}
