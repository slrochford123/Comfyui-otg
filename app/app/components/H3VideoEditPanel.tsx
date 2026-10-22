"use client";
import { useEffect, useRef, useState } from "react";
import { newClientRequestId } from "@/lib/client/requestId";
type Job = { id: string; status: string; statusMessage: string; error?: string; progressPercent?: number; currentNode?: string; videoUrl?: string; galleryStatus?: string; nativeResolution?: string; durationSeconds?: number };
type GalleryVideo = { name: string; url: string; kind?: string; video?: boolean };
export default function H3VideoEditPanel({ onBack }: { onBack: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [source, setSource] = useState("");
  const [prompt, setPrompt] = useState("");
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState("");
  const [job, setJob] = useState<Job | null>(null);
  const [pending, setPending] = useState(false);
  const [gallery, setGallery] = useState<GalleryVideo[] | null>(null);
  const guard = useRef(false);
  const sourceRef = useRef("");
  const picker = useRef<HTMLInputElement>(null);
  useEffect(() => () => { if (sourceRef.current) URL.revokeObjectURL(sourceRef.current); }, []);
  const busy = pending || !!job && !["completed", "canceled", "failed"].includes(job.status);
  useEffect(() => {
    if (!job?.id || ["completed", "canceled", "failed"].includes(job.status)) return;
    const controller = new AbortController();
    const id = job.id;
    const timer = window.setInterval(() => {
      fetch(`/api/h3/generation?jobId=${encodeURIComponent(id)}`, { signal: controller.signal, cache: "no-store" })
        .then(async response => { const result = await response.json(); if (!response.ok) throw Error(result.error || "Could not read edit status."); setJob(result.job); })
        .catch(e => { if (!controller.signal.aborted) setError(e.message); });
    }, 1500);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [job?.id, job?.status]);
  function select(next: File | null) {
    if (sourceRef.current) URL.revokeObjectURL(sourceRef.current);
    sourceRef.current = ""; setSource(""); setFile(null); setDuration(0); setError(""); setJob(null);
    if (!next) return;
    if (!/\.(mp4|mov|mkv|webm|m4v)$/i.test(next.name) || (next.type && !next.type.startsWith("video/"))) { setError("Choose a video, not an image or audio file."); return; }
    sourceRef.current = URL.createObjectURL(next); setSource(sourceRef.current); setFile(next);
  }
  async function submit(action?: "cancel" | "retry") {
    if (guard.current) return;
    guard.current = true; setPending(true); setError("");
    try {
      let response: Response;
      if (action) response = await fetch("/api/h3/generation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, jobId: job?.id }) });
      else {
        if (!file || duration < 2 || duration > 10 || !prompt.trim()) throw Error("Choose a 2–10-second source video and enter an edit prompt.");
        const data = new FormData(); data.set("video", file); data.set("prompt", prompt.trim()); data.set("requestId", newClientRequestId());
        response = await fetch("/api/h3/video-edit", { method: "POST", body: data });
      }
      const result = await response.json(); if (!response.ok) throw Error(result.error || "H3 edit failed."); setJob(result.job);
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
  return <section className="mx-auto max-w-4xl space-y-4 rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-4 pb-28 text-[var(--color-text)]" data-otg="h3-video-edit">
    <button className={button} onClick={onBack} disabled={busy}>Back to H3 Studio</button>
    <h2 className="text-2xl font-bold">Edit Video · H3</h2>
    <p>Regenerate one source video with a text edit while retaining its motion and timing. Generative editing can reinterpret details; it is not a frame-perfect filter.</p>
    <p className="text-sm text-[var(--color-text-muted)]">Source: 2–10 seconds. RTX 3090 · H3 Fun ControlNet video-to-video. The full source video guides structure and timing while appearance is regenerated. Describe the desired edited result. Short clips are padded to H3’s frame grid and trimmed back to source duration. Output audio is generative.</p>
    <input ref={picker} hidden type="file" accept="video/mp4,video/quicktime,video/webm,video/x-matroska,.mp4,.mov,.mkv,.webm,.m4v" onChange={event => { select(event.target.files?.[0] || null); event.target.value = ""; }} />
    <div className="flex flex-wrap gap-2"><button className={button} disabled={busy} onClick={() => picker.current?.click()}>Select Video</button><button className={button} disabled={busy} onClick={() => void openGallery()}>Choose Video from Gallery</button>{file ? <button className={button} disabled={busy} onClick={() => select(null)}>Remove Source Video</button> : null}</div>
    {source ? <div><p>{file?.name} · {duration ? `${duration.toFixed(2)} seconds` : "Reading duration…"}</p><video key={source} src={source} controls playsInline className="max-h-80 w-full" onLoadedMetadata={event => { const value = event.currentTarget.duration; setDuration(value); if (value < 2 || value > 10) setError("Source video must be between 2 and 10 seconds. Trim longer clips before selecting them."); }} onError={() => setError("This video could not be decoded. Choose MP4 or WebM.")} /></div> : null}
    <label className="block">Edit prompt<textarea aria-label="H3 video edit prompt" rows={4} value={prompt} disabled={busy} onChange={event => setPrompt(event.target.value)} className="mt-2 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-3" placeholder="The person wears a vivid navy-blue coat, preserving the source pose, motion and camera timing." /></label>
    <div className="flex gap-2"><button className={button} disabled={busy || !file || duration < 2 || duration > 10 || !prompt.trim()} onClick={() => void submit()}>Generate Edit</button>{job && !["completed", "canceled", "failed"].includes(job.status) ? <button className={button} disabled={pending || job.status === "canceling"} onClick={() => void submit("cancel")}>{job.status === "canceling" ? "Cancelling…" : "Cancel Edit"}</button> : null}{job && ["failed", "canceled"].includes(job.status) ? <button className={button} disabled={busy} onClick={() => void submit("retry")}>Retry Edit</button> : null}</div>
    {error ? <p role="alert" className="text-[var(--color-error)]">{error}</p> : null}
    {job ? <div role="status"><p>{job.statusMessage}</p>{job.currentNode ? <p>Processing node: {job.currentNode}</p> : null}{busy ? <progress max="100" value={job.progressPercent || 0} /> : null}{job.error ? <p className="text-[var(--color-error)]">{job.error}</p> : null}</div> : null}
    {job?.status === "completed" && job.videoUrl ? <div><video key={job.id} src={job.videoUrl} controls playsInline className="max-h-96 w-full" /><p>{job.nativeResolution} · {job.durationSeconds?.toFixed(2)} seconds · {job.galleryStatus === "saved" ? "Saved to Gallery" : "Gallery save needs attention"}</p><a className={button} href={job.videoUrl + "&download=1"} download>Download Edited Video</a></div> : null}
    {gallery ? <div role="dialog" aria-modal="true" aria-label="Choose source video" className="fixed inset-0 z-[10030] overflow-y-auto bg-[var(--color-background)] p-4 pb-28"><button className={button} onClick={() => setGallery(null)}>Close Video Gallery</button><h3 className="my-4 text-xl font-bold">Choose source video</h3><div className="grid grid-cols-2 gap-3">{gallery.map(item => <button key={item.url} className={button} onClick={() => void choose(item)}><video src={item.url} preload="metadata" muted playsInline className="w-full" /><span className="break-all text-xs">{item.name}</span></button>)}</div>{!gallery.length ? <p>No saved videos.</p> : null}</div> : null}
  </section>;
}
