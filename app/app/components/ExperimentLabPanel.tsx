"use client";
import { useEffect, useRef, useState } from "react";
import { canvas, H3_LICENSE_URL, H3_LICENSE_NOTICE, type Experiment, type LabKind } from "@/lib/experiments/catalog";
import type { LabAsset, LabSession } from "@/lib/experiments/store";

const endpoint = "/api/experiments";
const input = "w-full min-w-0 rounded-lg border border-white/20 bg-black/30 p-2.5 text-sm";
const button = "min-h-11 rounded-lg border border-white/20 px-3 py-2 text-sm disabled:opacity-40";
type CatalogResponse = { catalog: Experiment[]; sessions: LabSession[] };
async function api<T>(url = endpoint, data?: unknown): Promise<T> {
  const response = await fetch(url, { cache: "no-store", credentials: "same-origin", ...(data ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) } : {}) });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status}).`);
  return body;
}
const mediaUrl = (asset: LabAsset) => `${endpoint}/assets?id=${encodeURIComponent(asset.id)}`;
function Media({ asset, videoRef }: { asset: LabAsset; videoRef?: (video: HTMLVideoElement | null) => void }) {
  return <figure className="min-w-0 rounded-xl border border-white/10 bg-black/20 p-2">
    {asset.mime.startsWith("video/") ? <video ref={videoRef} className="max-h-72 w-full rounded-lg" src={mediaUrl(asset)} controls playsInline preload="metadata" />
      : asset.mime.startsWith("image/") ? /* eslint-disable-next-line @next/next/no-img-element */ <img className="max-h-60 w-full rounded-lg object-contain" src={mediaUrl(asset)} alt={asset.name} loading="lazy" />
      : <audio className="w-full" src={mediaUrl(asset)} controls preload="metadata" />}
    <figcaption className="mt-2 break-all text-xs text-white/70">{asset.name} · {asset.role === "comparison" ? "Imported comparison — not app-generated" : "Source reference"}<a className="ml-2 text-cyan-300 underline" href={`${mediaUrl(asset)}&download=1`}>Download</a></figcaption>
    <details className="mt-1 text-xs text-white/60"><summary>Integrity</summary><p className="break-all">SHA256 {asset.sha256}</p><p>{asset.bytes.toLocaleString()} bytes</p></details>
  </figure>;
}
export default function ExperimentLabPanel({ kind }: { kind: LabKind }) {
  const [catalog, setCatalog] = useState<Experiment[]>([]), [sessions, setSessions] = useState<LabSession[]>([]);
  const [selected, setSelected] = useState(""), [draft, setDraft] = useState<LabSession | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  const [showArchived, setShowArchived] = useState(false), [progress, setProgress] = useState<number | null>(null);
  const [uploadRole, setUploadRole] = useState<"source" | "comparison">("source");
  const upload = useRef<XMLHttpRequest | null>(null), videos = useRef(new Map<string, HTMLVideoElement>()), alive = useRef(true);
  const entry = catalog.find(item => item.id === selected);
  const dirty = !!draft && JSON.stringify(draft) !== JSON.stringify(sessions.find(item => item.id === draft.id));
  const visibleSessions = sessions.filter(item => item.experiment === selected && item.archived === showArchived);
  const comparison = draft?.assets.filter(asset => asset.role === "comparison") || [];
  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();
    void fetch(endpoint, { cache: "no-store", signal: controller.signal }).then(async response => {
      const result = await response.json(); if (!response.ok) throw new Error(result.error);
      if (!alive.current) return;
      const filtered = (result as CatalogResponse).catalog.filter(item => item.kind === kind);
      setCatalog(filtered); setSelected(filtered[0]?.id || ""); setSessions(result.sessions);
    }).catch(reason => { if (alive.current && reason.name !== "AbortError") setError(reason.message); });
    const players = videos.current;
    return () => { alive.current = false; controller.abort(); upload.current?.abort(); players.clear(); };
  }, [kind]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  function accept(session: LabSession) { setSessions(current => [session, ...current.filter(item => item.id !== session.id)]); setDraft(session); }
  async function act(action: () => Promise<void>) {
    setBusy(true); setError(""); setMessage("");
    try { await action(); } catch (reason) { if (alive.current) setError(reason instanceof Error ? reason.message : "Request failed."); }
    finally { if (alive.current) setBusy(false); }
  }
  async function save(value = draft) {
    if (!value) throw new Error("Create a test plan first.");
    const result = await api<{ session: LabSession }>(endpoint, { ...value, action: "update" });
    if (alive.current) accept(result.session); return result.session;
  }
  function patch(update: Partial<LabSession["settings"]>) { setDraft(current => current ? { ...current, settings: { ...current.settings, ...update } } : null); }
  async function attach(file: File) {
    if (!draft || draft.archived) return;
    if (file.size > 128 * 1024 ** 2) throw new Error("Choose a file no larger than 128 MiB.");
    const saved = dirty ? await save() : draft;
    const params = new URLSearchParams({ session: saved.id, name: file.name, role: uploadRole });
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest(); upload.current = xhr;
      xhr.open("POST", `${endpoint}/assets?${params}`); xhr.setRequestHeader("Content-Type", file.type === "audio/x-wav" ? "audio/wav" : file.type); xhr.timeout = 180000;
      xhr.upload.onprogress = event => { if (alive.current) setProgress(event.lengthComputable ? Math.round(event.loaded / event.total * 100) : 0); };
      xhr.onload = () => { try { const body = JSON.parse(xhr.responseText); if (xhr.status < 200 || xhr.status >= 300) throw new Error(body.error || "Upload failed."); if (alive.current) { accept(body.session); setMessage("Private asset validated and saved. No generation was started."); } resolve(); } catch (reason) { reject(reason); } };
      xhr.onerror = () => reject(new Error("Upload connection lost. Reload the plan before retrying."));
      xhr.ontimeout = () => reject(new Error("Upload timed out. Reload the plan before retrying."));
      xhr.onabort = () => reject(new Error("Upload canceled.")); setProgress(0); xhr.send(file);
    }).finally(() => { upload.current = null; if (alive.current) setProgress(null); });
  }
  const dimensions = draft ? canvas(draft.settings) : null;
  return <section className="mx-auto w-full max-w-6xl space-y-4 pb-12" aria-label={kind === "testing" ? "Testing workspace" : "H3 administrator workspace"}>
    <header className="space-y-2"><p className="text-xs font-semibold uppercase tracking-wider text-cyan-300">TEST only · administrator research workspace</p><h1 className="text-2xl font-semibold">{kind === "testing" ? "Testing" : "H3 Admin — NSFW Model Testing"}</h1><p className="text-sm text-white/70">Separate plans, uploads and comparisons. Existing H3 choices, galleries and PROD are unchanged. Nothing here promotes itself.</p></header>
    {error && <div role="alert" className="rounded-lg border border-red-400/40 bg-red-950/30 p-3 text-sm">{error}</div>}
    {message && <div role="status" className="text-sm text-emerald-300">{message}</div>}
    <label className="block text-sm">{kind === "testing" ? "Experiment" : "Model version"}<select aria-label={kind === "testing" ? "Experiment" : "Model version"} className={`${input} mt-1`} value={selected} disabled={busy || !catalog.length} onChange={event => { if (dirty) { setError("Save or reset this plan before changing experiments."); return; } setSelected(event.target.value); setDraft(null); setError(""); setMessage(""); }}>
      {catalog.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
    {entry && <>
      <div className="rounded-xl border border-white/10 p-4 text-sm"><h2 className="font-semibold">{entry.title}</h2><p className="mt-1 text-white/80">{entry.purpose}</p><p className="mt-2 text-white/60">{entry.replaces}</p>
        <details className="mt-3"><summary className="cursor-pointer text-cyan-300">Recipe, sources and compatibility</summary><p className="my-2">{entry.recipe}</p>
          {entry.filename && <p className="break-all text-xs">Candidate: {entry.filename} · {entry.sizeGiB} GiB · CivitAI version {entry.versionId}<br />SHA256 {entry.sha256}</p>}
          <ul className="mt-2 space-y-1">{entry.sources.map((source, index) => <li key={source}><a className="text-cyan-300 underline" href={source} target="_blank" rel="noreferrer">Source {index + 1}</a></li>)}</ul>
          {entry.id !== "director-studio" && <><p className="mt-2 text-xs text-white/70">{H3_LICENSE_NOTICE}</p><a className="mt-2 inline-block text-cyan-300 underline" href={H3_LICENSE_URL} target="_blank" rel="noreferrer">Publisher license</a></>}
        </details></div>
      <div className="rounded-xl border border-amber-400/30 bg-amber-950/20 p-4 text-sm"><h2 className="font-semibold text-amber-200">Planning available · generation not enabled</h2><ul className="mt-2 list-disc space-y-1 pl-5">{entry.blockers.map(blocker => <li key={blocker}>{blocker}</li>)}</ul><p className="mt-2 text-white/70">Saved plans and uploaded comparisons are not proof of model readiness. No substitute workflow will run.</p></div>
      <div className="flex flex-wrap items-center gap-2"><button type="button" className={button} disabled={busy || dirty} onClick={() => void act(async () => { const result = await api<{ session: LabSession }>(endpoint, { action: "create", experiment: selected }); accept(result.session); setShowArchived(false); })}>New test plan</button>
        <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={showArchived} disabled={busy || dirty} onChange={event => { setShowArchived(event.target.checked); setDraft(null); }} />Archived plans</label>
        <select className={`${input} sm:!w-auto`} aria-label="Saved plan" value={draft?.id || ""} disabled={busy || dirty} onChange={event => setDraft(sessions.find(item => item.id === event.target.value) || null)}><option value="">Choose a saved plan</option>{visibleSessions.map(item => <option key={item.id} value={item.id}>{item.title} · {new Date(item.updated).toLocaleString()}</option>)}</select>
      </div></>}
    {draft && <div className="space-y-4 rounded-xl border border-white/15 p-4">
      <label className="block text-sm">Plan name<input className={`${input} mt-1`} maxLength={120} value={draft.title} disabled={busy || draft.archived} onChange={event => setDraft({ ...draft, title: event.target.value })} /></label>
      {entry?.id !== "director-studio" && <fieldset disabled={busy || draft.archived} className="grid min-w-0 grid-cols-2 gap-3 md:grid-cols-3"><legend className="mb-2 text-sm font-semibold">Requested generation targets — not yet executable</legend>
        <label className="text-sm">Mode<select aria-label="Mode" className={`${input} mt-1`} value={draft.settings.mode} onChange={e => patch({ mode: e.target.value as LabSession["settings"]["mode"] })}><option value="text">Text → video</option><option value="image">Image → video</option><option value="reference">Reference → video</option><option value="edit">Edit video</option></select></label>
        <label className="text-sm">Resolution<select aria-label="Resolution" className={`${input} mt-1`} value={draft.settings.resolution} onChange={e => patch({ resolution: e.target.value as LabSession["settings"]["resolution"] })}><option value="0.2">0.2 MP</option><option value="0.6">0.6 MP</option><option value="1">1 MP</option></select></label>
        <label className="text-sm">Orientation<select aria-label="Orientation" className={`${input} mt-1`} value={draft.settings.orientation} onChange={e => patch({ orientation: e.target.value as LabSession["settings"]["orientation"] })}><option value="landscape">Landscape</option><option value="portrait">Portrait</option></select></label>
        <label className="text-sm">GPU preference<select aria-label="GPU preference" className={`${input} mt-1`} value={draft.settings.gpu} onChange={e => patch({ gpu: e.target.value as LabSession["settings"]["gpu"] })}><option value="auto">Auto · 3090 first</option><option value="rtx3090">RTX 3090</option><option value="rtx5060ti">RTX 5060 Ti</option></select></label>
        <label className="text-sm">Recipe<select aria-label="Recipe" className={`${input} mt-1`} value={draft.settings.recipe} onChange={e => patch({ recipe: e.target.value as LabSession["settings"]["recipe"] })}><option value="author">Model-specific author recipe</option><option value="turbo8" disabled>8-step Turbo · unqualified</option></select></label>
        <label className="text-sm">Seed<input type="number" min={0} max={Number.MAX_SAFE_INTEGER} step={1} className={`${input} mt-1`} value={draft.settings.seed} onChange={e => patch({ seed: Number(e.target.value) })} /></label>
        <label className="col-span-2 block text-sm md:col-span-3">Duration · {draft.settings.seconds} seconds<input aria-label="Duration in seconds" className="mt-2 w-full" type="range" min={2} max={15} step={1} value={draft.settings.seconds} onChange={e => patch({ seconds: Number(e.target.value) })} /></label>
      </fieldset>}
      {entry?.id !== "director-studio" && <p className="text-xs text-white/65">Target canvas {dimensions?.width} × {dimensions?.height} · 24 FPS · {draft.settings.seconds * 24} delivered frames. Native framing, trimming, attention and every mode require qualification; SLA and 15-second support are not promised. Auto requires shared GPU admission before execution can be enabled.</p>}
      <label className="block text-sm">{entry?.id === "director-studio" ? "Director concept" : "Scene prompt"}<textarea className={`${input} mt-1 min-h-28`} placeholder="Describe the subject, action, setting, camera and sound. For references, identify each subject." maxLength={8000} value={draft.settings.prompt} disabled={busy || draft.archived} onChange={e => patch({ prompt: e.target.value })} /></label>
      <details><summary className="cursor-pointer text-sm text-cyan-300">Review notes and acceptance checklist</summary><p className="my-2 text-xs text-white/65">Record identity, hands/anatomy, intended actions, detail, flicker, audio, duration and cold/warm timings. Leave unknown results blank. A successful upload is not a successful model test.</p><textarea aria-label="Review notes" className={`${input} min-h-28`} value={draft.notes} maxLength={16000} disabled={busy || draft.archived} onChange={e => setDraft({ ...draft, notes: e.target.value })} /></details>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={button} disabled={busy || !dirty || draft.archived} onClick={() => void act(async () => { await save(); setMessage("Plan saved. No generation or promotion occurred."); })}>Save plan</button>
        <button type="button" className={button} disabled={busy || !dirty} onClick={() => setDraft(sessions.find(item => item.id === draft.id) || null)}>Reset unsaved changes</button>
        <button type="button" className={button} disabled={busy || dirty} onClick={() => void act(async () => { const result = await api<CatalogResponse>(); setSessions(result.sessions); setDraft(result.sessions.find(item => item.id === draft.id) || null); setMessage("Saved plan reloaded."); })}>Reload saved plan</button>
        <a className={button} href={`${endpoint}?export=${draft.id}`}>Export saved manifest</a>
        <button type="button" className={button} disabled={busy || dirty} onClick={() => void act(async () => { await save({ ...draft, archived: !draft.archived }); setShowArchived(!draft.archived); setMessage(draft.archived ? "Plan restored." : "Plan archived. All files retained and recoverable."); })}>{draft.archived ? "Restore plan" : "Archive plan"}</button>
        {dirty && <span className="text-xs text-amber-200">Unsaved changes</span>}
      </div>
      <div className="space-y-3 border-t border-white/10 pt-4"><h2 className="font-semibold">Private references and comparisons</h2><p className="text-xs text-white/65">Admin-only, outside normal galleries. Up to 12 assets per plan; 128 MiB per file; 2 GiB per administrator. Use content you have permission to use. Archiving retains files.</p>
        <div className="flex flex-wrap items-center gap-2"><select aria-label="Upload purpose" className={`${input} sm:!w-auto`} disabled={busy || draft.archived} value={uploadRole} onChange={e => setUploadRole(e.target.value as "source" | "comparison")}><option value="source">Source image / video / audio</option><option value="comparison">Comparison result from elsewhere</option></select>
          <label className={`${button} max-w-full`}>Attach file<input aria-label="Attach private file" type="file" className="block max-w-full pt-1 text-xs" accept="image/png,image/jpeg,image/webp,video/mp4,video/webm,audio/wav,audio/mpeg,audio/flac" disabled={busy || draft.archived} onChange={e => { const file = e.target.files?.[0]; e.target.value = ""; if (file) void act(() => attach(file)); }} /></label>
          {progress !== null && <><span role="status" className="text-xs">{progress < 100 ? `Uploading ${progress}%` : "Validating media…"}</span><button type="button" className={button} onClick={() => upload.current?.abort()}>Cancel upload</button></>}
        </div>
        <div className="grid min-w-0 gap-3 sm:grid-cols-2">{draft.assets.filter(asset => asset.role === "source").map(asset => <Media key={asset.id} asset={asset} />)}</div>
        {comparison.length > 0 && <><h3 className="text-sm font-semibold">Side-by-side review · imported media</h3><div className="flex flex-wrap gap-2">{[0, 0.5, 2, 4, 6, 8, 9.5].map(second => <button key={second} type="button" className={button} onClick={() => { for (const video of videos.current.values()) { video.pause(); if (Number.isFinite(video.duration)) video.currentTime = Math.min(second, Math.max(0, video.duration - 0.04)); } }}>{second}s</button>)}</div><p className="text-xs text-white/60">Matching-time review without changing the files. Seeking clamps to each clip’s duration. Use each player for playback and audio.</p><div className="grid min-w-0 gap-3 sm:grid-cols-2">{comparison.map(asset => <Media key={asset.id} asset={asset} videoRef={video => { if (video) videos.current.set(asset.id, video); else videos.current.delete(asset.id); }} />)}</div></>}
      </div>
    </div>}
    <footer className="text-xs text-white/60">Promotion path: research evidence → owner approval → normal TEST integration and regression tests → separate GitHub/PROD approval. No promotion or generation endpoint is enabled in this release.</footer>
  </section>;
}
