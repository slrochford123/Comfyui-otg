"use client";
import React, {useCallback, useEffect, useRef, useState} from "react";
import ImageEditEngineSelect from "./ImageEditEngineSelect";
import ImageComparisonSlider from "./ImageComparisonSlider";
import {comparisonPending, emptyComparisonDraft, loadComparison, newComparisonJob, saveComparison, submitComparison, type ComparisonDraft, type ComparisonJob} from "@/lib/client/beforeAfter";

const button = "min-h-12 rounded-xl border border-white/20 bg-white/5 px-4 py-3 text-sm font-bold text-white disabled:opacity-40";
type GalleryImage = {name: string; url: string};
export default function BeforeAfterPanel({owner}: {owner: string}) {
  const [draft, setDraft] = useState<ComparisonDraft>(emptyComparisonDraft);
  const [source, setSource] = useState<File | null>(null), [sourceUrl, setSourceUrl] = useState("");
  const [ready, setReady] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [error, setError] = useState("");
  const [gallery, setGallery] = useState<GalleryImage[] | null>(null);
  const [recovery, setRecovery] = useState(0);
  const current = useRef(draft), input = useRef<HTMLInputElement>(null), submitting = useRef(false), mounted = useRef(false);
  const hydrated = useRef(false);
  const ownerEpoch = useRef(0), persistence = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pending = comparisonPending(draft.job), locked = busy || pending || !ready;
  const edited = draft.job?.status === "completed" ? draft.job.imageUrl : "";
  const change = useCallback((patch: Partial<ComparisonDraft>) => {
    const next = {...current.current, ...patch}; current.current = next; setDraft(next);
    clearTimeout(persistence.current);
    persistence.current = setTimeout(() => {void saveComparison(owner, next).catch(() => setError("Device storage is full or unavailable. Keep this page open and save your image."));}, 120);
    return next;
  }, [owner]);
  useEffect(() => {
    mounted.current = true; hydrated.current = false; const epoch = ++ownerEpoch.current; setReady(false);
    void loadComparison(owner).then(saved => {if (mounted.current && ownerEpoch.current === epoch) {current.current = saved.draft; setDraft(saved.draft); setSource(saved.source); hydrated.current = true; setReady(true);}})
      .catch(() => {if (mounted.current && ownerEpoch.current === epoch) setError("Enable browser storage to keep your original and recover edits safely.");});
    const flush = () => {clearTimeout(persistence.current); if (hydrated.current) void saveComparison(owner, current.current).catch(() => {});};
    window.addEventListener("pagehide", flush);
    return () => {flush(); mounted.current = false; ++ownerEpoch.current; window.removeEventListener("pagehide", flush);};
  }, [owner]);
  useEffect(() => {
    if (!source) {setSourceUrl(""); return;}
    const url = URL.createObjectURL(source); setSourceUrl(url); return () => URL.revokeObjectURL(url);
  }, [source]);
  useEffect(() => {
    if (!ready || !draft.job || !comparisonPending(draft.job)) return;
    const id = draft.job.jobId, epoch = ownerEpoch.current, controller = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    const check = async () => {
      if (!comparisonPending(current.current.job)) return;
      try {
        const response = await fetch(`/api/images/before-after?jobId=${id}`, {credentials: "include", cache: "no-store", signal: controller.signal});
        const result = await response.json();
        if (controller.signal.aborted || epoch !== ownerEpoch.current || current.current.job?.jobId !== id) return;
        if (!response.ok) {
          if (response.status === 401 || response.status === 403) {setError("Sign in to the same account to recover this edit."); return;}
          if (response.status === 404 && source && !submitting.current) {
            // Android may terminate the upload before the server receives it.
            // Retry that exact durable UUID, never create another GPU job.
            submitting.current = true;
            try {
              const restored = await submitComparison(current.current.job!, source, current.current.prompt);
              if (!controller.signal.aborted && epoch === ownerEpoch.current && current.current.job?.jobId === id) change({job: restored});
            } catch (reason) {
              const status = (reason as Error & {status?: number}).status;
              if (!controller.signal.aborted && status && status >= 400 && status < 500) {
                change({job: {...current.current.job!, status: "failed", error: (reason as Error).message}});
                setError((reason as Error).message); return;
              }
            } finally {submitting.current = false;}
          }
          setMessage(response.status === 404 ? "Recovering the original upload. No duplicate render will be created." : "Reconnecting to your edit…");
        } else {
          if (result.jobId !== id) throw Error("Mismatched comparison job.");
          change({job: result as ComparisonJob});
          if (result.status === "completed") {setMessage("Ready to compare."); setError(""); return;}
          if (["failed", "canceled"].includes(result.status)) {setError(result.error || "The edit did not finish. You can try again."); return;}
          setMessage(result.status === "unknown" ? "Submission needs checking. Your original is safe; this job will not be sent twice." : result.status === "running" ? "Editing your image…" : "Waiting in the GPU queue…");
        }
      } catch {if (!controller.signal.aborted) setMessage("Reconnecting to your existing edit…");}
      if (!controller.signal.aborted) timer = setTimeout(check, 2500);
    };
    void check();
    const resume = () => {if (document.visibilityState === "visible") {clearTimeout(timer); controller.abort(); /* the visibility listener below triggers a fresh watcher */ setRecovery(value => value + 1);}};
    document.addEventListener("visibilitychange", resume);
    return () => {controller.abort(); clearTimeout(timer); document.removeEventListener("visibilitychange", resume);};
  // Status changes do not create another polling loop; only a new job/resume does.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, draft.job?.jobId, owner, change, recovery]);

  async function chooseSource(file: File) {
    if (locked) return;
    setError(""); setMessage(""); setBusy(true); const epoch = ownerEpoch.current;
    try {
      if (!file.size || file.size > 64 * 1024 * 1024) throw Error("Choose an image up to 64 MB. Large photos are optimized for editing; your original is kept.");
      const next = {...current.current, job: null, saved: false, position: 50};
      clearTimeout(persistence.current); await saveComparison(owner, next, file);
      if (!mounted.current || epoch !== ownerEpoch.current) return;
      current.current = next; setDraft(next); setSource(file); setGallery(null);
    } catch (reason) {if (epoch === ownerEpoch.current) setError((reason as Error).message);}
    finally {if (epoch === ownerEpoch.current) setBusy(false);}
  }
  async function generate() {
    if (submitting.current || locked || !source || !current.current.prompt.trim()) return;
    submitting.current = true; setError(""); const epoch = ownerEpoch.current;
    const job = newComparisonJob(current.current.engine, current.current.job?.seed);
    const next = change({job, saved: false, position: 50});
    let sent = false;
    try {
      clearTimeout(persistence.current); await saveComparison(owner, next);
      setMessage("Submitting your edit…");
      sent = true;
      const result = await submitComparison(job, source, next.prompt);
      if (mounted.current && epoch === ownerEpoch.current && current.current.job?.jobId === job.jobId) {change({job: result}); setRecovery(value => value + 1);}
    } catch (reason) {
      if (mounted.current && epoch === ownerEpoch.current && current.current.job?.jobId === job.jobId) {
        const status = (reason as Error & {status?: number}).status;
        change({job: {...job, status: !sent || status && status >= 400 && status < 500 ? "failed" : "unknown", error: (reason as Error).message}});
        setError((reason as Error).message);
      }
    } finally {submitting.current = false;}
  }
  async function save() {
    if (!edited || !draft.job || busy) return;
    setBusy(true); setError(""); const epoch = ownerEpoch.current, id = draft.job.jobId;
    try {
      const response = await fetch(`/api/images/before-after?jobId=${id}`, {method: "PATCH", credentials: "include"});
      const result = await response.json();
      if (!response.ok) throw Error(result.error || "Saving failed. Try Save again; do not regenerate.");
      if (mounted.current && epoch === ownerEpoch.current && current.current.job?.jobId === id) {change({saved: true}); setMessage("Edited image saved to Gallery. Original unchanged.");}
    } catch (reason) {if (mounted.current && epoch === ownerEpoch.current) setError((reason as Error).message);}
    finally {if (mounted.current && epoch === ownerEpoch.current) setBusy(false);}
  }
  async function openGallery() {
    setBusy(true); setError(""); const epoch = ownerEpoch.current;
    try {
      const response = await fetch("/api/gallery?media=image&sort=newest&per=80", {credentials: "include", cache: "no-store"});
      const result = await response.json();
      if (!response.ok) throw Error(result.error || "Gallery is unavailable.");
      type Item = {name?: string; fileName?: string; sourceName?: string; url?: string; source?: string; kind?: string; video?: boolean};
      const items: Item[] = (Array.isArray(result.items) ? result.items : Array.isArray(result.files) ? result.files : []);
      if (mounted.current && epoch === ownerEpoch.current) setGallery(items.filter(item => !item.video && item.kind !== "video" && /\.(png|jpe?g|webp|gif|avif)$/i.test(item.fileName || item.sourceName || item.name || ""))
        .map(item => {const name = item.fileName || item.sourceName || item.name!; return {name, url: item.url || `/api/gallery/file?name=${encodeURIComponent(name)}&scope=${encodeURIComponent(item.source || "user")}`};}));
    } catch (reason) {if (epoch === ownerEpoch.current) setError((reason as Error).message);}
    finally {if (epoch === ownerEpoch.current) setBusy(false);}
  }
  async function gallerySource(item: GalleryImage) {
    try {
      const response = await fetch(item.url, {credentials: "include", cache: "no-store"});
      if (!response.ok) throw Error("That gallery image could not be loaded.");
      const blob = await response.blob(); await chooseSource(new File([blob], item.name, {type: blob.type}));
    } catch (reason) {setError((reason as Error).message);}
  }
  async function clear() {
    if (locked) return;
    const next = emptyComparisonDraft(); clearTimeout(persistence.current);
    try {await saveComparison(owner, next, null); current.current = next; setDraft(next); setSource(null); setMessage(""); setError("");}
    catch {setError("The saved comparison could not be cleared. Try again.");}
  }
  return <section data-otg="before-after-panel" aria-label="Before & After" className="space-y-4 rounded-3xl border border-white/10 bg-black/40 p-4 md:p-5">
    <h2 className="text-2xl font-black">Before &amp; After</h2>
    <div className="flex flex-wrap gap-2">
      <button type="button" disabled={locked} className={button} onClick={() => input.current?.click()}>{source ? "Change Image" : "Add Image"}</button>
      <button type="button" disabled={locked} className={button} onClick={() => void openGallery()}>Gallery Image</button>
      <button type="button" disabled={locked || !source} className={button} onClick={() => void clear()}>Clear</button>
      <input ref={input} type="file" accept="image/*" aria-label="Original image" className="hidden" disabled={locked} onChange={event => {const file = event.target.files?.[0]; event.target.value = ""; if (file) void chooseSource(file);}} />
    </div>
    {sourceUrl ? edited ? <ImageComparisonSlider before={sourceUrl} after={edited} position={draft.position} onChange={position => change({position})} />
      : <img src={sourceUrl} alt="Original image" className="max-h-[55vh] w-full rounded-2xl bg-black object-contain" />
      : <div className="rounded-2xl border border-dashed border-white/20 p-8 text-center text-sm text-white/55">Choose an original image to get started.</div>}
    <label className="block text-sm font-bold">Describe the change
      <textarea rows={3} maxLength={12000} disabled={locked} value={draft.prompt} placeholder="Make the white suit black. Keep everything else unchanged."
        onChange={event => change({prompt: event.target.value})} className="mt-2 w-full rounded-xl border border-white/20 bg-zinc-950 p-3 text-white" />
    </label>
    <ImageEditEngineSelect value={draft.engine} onChange={engine => change({engine})} disabled={locked} />
    <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
      <button type="button" disabled={locked || !source || !draft.prompt.trim()} onClick={() => void generate()} className={button + " bg-violet-600"}>{pending ? "Editing…" : draft.job ? "Try Again" : "Generate Edit"}</button>
      <button type="button" disabled={locked || !draft.job} className={button} onClick={() => {change({job: null, saved: false, position: 50}); setError(""); setMessage("Original restored. Your prompt is kept.");}}>Undo</button>
      {edited ? <>
        <button type="button" disabled={busy || draft.saved} className={button} onClick={() => void save()}>{draft.saved ? "Saved to Gallery" : "Save to Gallery"}</button>
        <a className={button + " text-center"} href={edited + "&download=1"} download={`before-after-${draft.job!.jobId}.png`}>Download</a>
      </> : null}
      {pending ? <button type="button" className={button} onClick={() => setRecovery(value => value + 1)}>Check Status</button> : null}
    </div>
    {pending ? <div role="progressbar" aria-label="Image edit in progress" className="h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full w-1/3 animate-pulse rounded-full bg-violet-400" /></div> : null}
    {message ? <p role="status" className="text-sm text-white/70">{message}</p> : null}
    {error ? <p role="alert" className="text-sm text-red-200">{error}</p> : null}
    {gallery !== null ? <section aria-label="Choose gallery image" className="rounded-2xl border border-white/20 p-3">
      <div className="mb-3 flex items-center justify-between gap-3"><h3 className="font-bold">Choose an image</h3><button type="button" className={button} onClick={() => setGallery(null)}>Close Gallery</button></div>
      {gallery.length ? <div className="grid max-h-96 grid-cols-3 gap-2 overflow-auto">{gallery.map(item => <button key={item.url} type="button" disabled={locked} aria-label={`Use ${item.name}`} className="overflow-hidden rounded-xl border border-white/15" onClick={() => void gallerySource(item)}><img loading="lazy" src={item.url} alt={item.name} className="aspect-square w-full object-cover" /></button>)}</div> : <p>No images in your Gallery yet.</p>}
    </section> : null}
  </section>;
}
