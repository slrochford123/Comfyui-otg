"use client";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_H3_STUDIO_PLAN, H3_STUDIO_WORKFLOWS, automaticH3Plan, makeLocalH3Plan, parseH3StudioPlan, reconcileH3StudioPlan, studioDimensions, studioFrames, type H3StudioPlan } from "@/lib/h3StudioPlan";
import type { H3StudioCatalogItem } from "@/lib/h3StudioRegistry";
import { newClientRequestId } from "@/lib/client/requestId";
import css from "./H3StudioControls.module.css";
import VideoSnapshotPicker from "./VideoSnapshotPicker";
export type H3StudioController = "auto" | "manual";
type Asset = { id: string; kind: "image" | "video" | "audio"; role: "first" | "last" | "reference"; name: string; sha256: string; version: number | string; metadata: { durationSeconds?: number; width?: number; height?: number; hasAudio?: boolean }; url: string };
type Source = { id: string; file: File; kind: Asset["kind"]; role: Asset["role"]; description: string; includeAudio: boolean; clipStartSeconds: number; revision: number; asset?: Asset; registrationAsset?: Asset; error?: string };
type Preview = { manifest: { executable: boolean; experimental?: boolean; blockedReasons: string[]; steps: number; sampler: string; templateSha256: string }; graph: unknown; estimate: { explanation: string; generationCredits?: number | null; generationSeconds?: number | null }; review: { id: string; mediaFingerprint: string } };
type Quote = { id: string; estimatedUsd: number | null; qualified: boolean; unavailable: string[] };
type Job = { id: string; status: string; statusMessage: string; progressPercent?: number | null; error?: string | null; videoUrl?: string | null; galleryUrl?: string | null; galleryStatus?: string; galleryError?: string | null; nativeResolution?: string | null; approximatePreview?: { imageUrl: string; label: string } | null };
type HistoryItem = Pick<Job, "id" | "status" | "statusMessage">;
type Props = { ownerKey: string; backend?: H3StudioPlan["backend"]; onBackendChange?: (backend: NonNullable<H3StudioPlan["backend"]>) => void; controller?: H3StudioController; onControllerChange?: (controller: H3StudioController) => void; manualMenu?: boolean; onOpenManualControls?: () => void; onBackToStudio?: () => void; initialSourceVideo?: File; videoEditControls?: boolean; sourceBlockMessage?: string; onBusyChange?: (busy: boolean) => void };
const isActive = (job: Job | null) => !!job && !["completed", "failed", "canceled"].includes(job.status);
const MEDIA_ACCEPT = { image: ".png,.jpg,.jpeg,.webp", video: ".mp4,.mov,.mkv,.webm,.m4v", audio: ".wav,.mp3,.ogg,.flac,.m4a" };
function sourceError(file: File, kind: Source["kind"]) {
  const extension = file.name.toLowerCase().match(/\.[^.]+$/)?.[0];
  if (!extension || !MEDIA_ACCEPT[kind].split(",").includes(extension)) return `Choose a supported ${kind} file (${MEDIA_ACCEPT[kind]}).`;
  if (!file.size || file.size > (kind === "image" ? 20 : 128) * 1024 ** 2) return `Choose a nonempty ${kind} file up to ${kind === "image" ? 20 : 128} MB.`;
  return undefined;
}
// Empty text is a valid editing state; strict parsing still guards every request.
function reconcileDraft(plan: H3StudioPlan, patch: Partial<H3StudioPlan>, catalog?: H3StudioCatalogItem[]) {
  const draft = { ...plan, ...patch };
  const next = reconcileH3StudioPlan(plan, { ...patch, prompt: draft.prompt.trim() ? draft.prompt : "Draft", originalPrompt: draft.originalPrompt.trim() ? draft.originalPrompt : "Draft" }, catalog);
  return { ...next, prompt: draft.prompt, originalPrompt: draft.originalPrompt };
}
function sourceWorkflow(sources: Source[]): H3StudioPlan["workflowId"] { return sources.some(source => source.kind === "video") ? "reference-edit" : sources.some(source => source.role === "first") ? "native-i2v" : sources.length ? "native-r2v" : "native-t2v"; }
function localUrl(value: string | null | undefined) { return value?.startsWith("/api/") && !value.includes("\\") ? value : undefined; }
function livePreviewUrl(value?: string | null) {
  if (!value || value.length > 32 * 1024 ** 2) return undefined;
  return localUrl(value) || (/^data:(?:image\/(?:jpeg|png|webp|gif)|video\/(?:mp4|webm));base64,[a-zA-Z0-9+/=\s]+$/.test(value) ? value : undefined);
}
async function responseJson(response: Response) {
  const data = await response.json();
  if (!response.ok || data.ok === false) throw new Error(data.error || "H3 request failed. Try again.");
  return data;
}
function deleteAsset(id: string) { void fetch(`/api/h3/studio/media?id=${encodeURIComponent(id)}`, { method: "DELETE", credentials: "include", keepalive: true }).catch(() => {}); }
function SourcePreview({ source }: { source: Source }) {
  const element = useRef<HTMLImageElement | HTMLVideoElement | HTMLAudioElement | null>(null);
  useEffect(() => {
    const next = URL.createObjectURL(source.file);
    if (element.current) element.current.src = next;
    return () => URL.revokeObjectURL(next);
  }, [source.file]);
  if (source.kind === "image") return <img ref={node => { element.current = node; }} className={css.media} alt={`Source: ${source.file.name}`} />;
  if (source.kind === "video") return <video ref={node => { element.current = node; }} className={css.media} controls playsInline preload="metadata" />;
  return <audio ref={node => { element.current = node; }} className={css.media} controls preload="metadata" />;
}
export default function H3StudioControls({ ownerKey, backend: controlledBackend, onBackendChange, controller: controlledController, onControllerChange, manualMenu = false, onOpenManualControls, onBackToStudio, initialSourceVideo, videoEditControls = false, sourceBlockMessage = "", onBusyChange }: Props) {
  const [localController, setLocalController] = useState<H3StudioController>("auto");
  const controller = controlledController ?? localController;
  function setController(next: H3StudioController) { setLocalController(next); onControllerChange?.(next); }
  const [plan, setPlan] = useState<H3StudioPlan>(() => ({ ...DEFAULT_H3_STUDIO_PLAN, backend: controlledBackend ?? "rtx3090", workflowId: videoEditControls ? "reference-edit" : "native-t2v" }));
  const [catalogLoading, setCatalogLoading] = useState(true);
  const backend = plan.backend ?? "rtx3090";
  const reviewedPlanElement = useRef<HTMLDivElement>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const [snapshotRole, setSnapshotRole] = useState<Source["role"] | null>(null);
  const sourcesRef = useRef<Source[]>([]);
  const [catalog, setCatalog] = useState<H3StudioCatalogItem[]>([]);
  const [experimental, setExperimental] = useState(false);
  const [directGeneration, setDirectGeneration] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [autoSettings, setAutoSettings] = useState<{ manifest: Preview["manifest"]; estimate: Preview["estimate"] } | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [consent, setConsent] = useState(false);
  const [externalMediaConsent, setExternalMediaConsent] = useState(false);
  const [generationConsent, setGenerationConsent] = useState(false);
  const [directorPlanReady, setDirectorPlanReady] = useState(false);
  const [clarification, setClarification] = useState("");
  const [presetName, setPresetName] = useState("");
  const [presets, setPresets] = useState<Array<{ name: string; plan: H3StudioPlan }>>([]);
  const inFlight = useRef(false);
  const abort = useRef<AbortController | null>(null);
  const revision = useRef(0);
  const [job, setJob] = useState<Job | null>(null);
  const jobRef = useRef<Job | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const historyRef = useRef<HistoryItem[]>([]);
  const jobGuard = useRef(false);
  const [jobBusy, setJobBusy] = useState(false);
  const jobAbort = useRef<AbortController | null>(null);
  const requestId = useRef<string | null>(null);
  const submittedPlan = useRef<{ jobId: string; plan: H3StudioPlan; mediaIdentity: string } | null>(null);
  function mediaIdentity() { return JSON.stringify(sourcesRef.current.map(source => [source.asset?.id, source.asset?.sha256, source.asset?.version, source.role, source.description, source.includeAudio, source.clipStartSeconds])); }
  const storageKey = `otg:h3:studio-presets:v1:${encodeURIComponent(ownerKey)}`;
  const historyKey = `otg:h3:studio-history:v1:${encodeURIComponent(ownerKey)}`;
  const invalidate = useCallback((clearClarification = true) => {
    revision.current++; abort.current?.abort(); requestId.current = null;
    setPreview(null); setAutoSettings(null); setQuote(null); setConsent(false); setGenerationConsent(false); setDirectorPlanReady(false); setMessage("");
    if (clearClarification) setClarification("");
  }, []);
  function updateSources(next: Source[]) {
    invalidate(); setExternalMediaConsent(false);
    sourcesRef.current = next; setSources(next);
    if (controller === "auto") setPlan(plan => reconcileDraft(plan, { workflowId: videoEditControls ? "reference-edit" : sourceWorkflow(next) }, catalog));
  }
  function updateSource(id: string, patch: Partial<Pick<Source, "file" | "role" | "description" | "includeAudio" | "clipStartSeconds">>) {
    const source = sourcesRef.current.find(source => source.id === id);
    if (!source || jobGuard.current || isActive(jobRef.current)) return;
    if (patch.file) { const error = sourceError(patch.file, source.kind); if (error) { setMessage(error); return; } }
    updateSources(sourcesRef.current.map(source => {
      if (source.id !== id) return source;
      const previous = source.asset || source.registrationAsset;
      if (patch.file && previous) deleteAsset(previous.id);
      return { ...source, ...patch, revision: source.revision + 1, asset: undefined, registrationAsset: patch.file ? undefined : previous, error: undefined };
    }));
  }
  function addSources(files: FileList | File[] | null, kind: Source["kind"], role: Source["role"]) {
    if (!files?.length || isActive(jobRef.current) || jobGuard.current) return;
    for (const file of Array.from(files)) { const error = sourceError(file, kind); if (error) { setMessage(error); return; } }
    const added: Source[] = Array.from(files).map(file => ({ id: newClientRequestId(), file, kind, role, description: "", includeAudio: false, clipStartSeconds: 0, revision: 0 }));
    const kept = role === "reference" ? sourcesRef.current : sourcesRef.current.filter(source => {
      if (source.role !== role) return true;
      const previous = source.asset || source.registrationAsset; if (previous) deleteAsset(previous.id);
      return false;
    });
    updateSources([...kept, ...(role === "reference" ? added : added.slice(0, 1))]);
  }
  const acceptJob = useCallback((next: Job) => {
    if (!next?.id || !next.status) throw new Error("The server did not return an H3 job. Refresh before retrying.");
    jobRef.current = next; setJob(next);
    const entries = [{ id: next.id, status: next.status, statusMessage: next.statusMessage }, ...historyRef.current.filter(item => item.id !== next.id)].slice(0, 20);
    historyRef.current = entries; setHistory(entries);
    try { localStorage.setItem(historyKey, JSON.stringify(entries)); } catch { /* Job status remains available without device storage. */ }
  }, [historyKey]);
  useEffect(() => {
    const signal = new AbortController();
    setPlan({ ...DEFAULT_H3_STUDIO_PLAN, workflowId: videoEditControls ? "reference-edit" : "native-t2v" }); setCatalog([]); setPreview(null); setQuote(null); setMessage(""); setPresets([]); setDirectorPlanReady(false); setConsent(false); setExternalMediaConsent(false); revision.current++;
    sourcesRef.current = []; setSources([]); jobRef.current = null; setJob(null); historyRef.current = []; setHistory([]); submittedPlan.current = null; setGenerationConsent(false); setClarification("");
    setExperimental(false); setDirectGeneration(false); setAutoSettings(null);
    try { const stored = JSON.parse(localStorage.getItem(storageKey) || "[]"); if (Array.isArray(stored)) setPresets(stored.slice(0, 20).map(p => ({ name: String(p.name).slice(0, 60), plan: parseH3StudioPlan(p.plan) }))); } catch { /* Ignore invalid/obsolete device presets. */ }
    try {
      const stored = JSON.parse(localStorage.getItem(historyKey) || "[]");
      if (Array.isArray(stored)) {
        const entries = stored.filter(item => item && typeof item.id === "string" && typeof item.status === "string" && typeof item.statusMessage === "string").slice(0, 20);
        historyRef.current = entries; setHistory(entries);
        if (entries[0]) fetch(`/api/h3/generation?jobId=${encodeURIComponent(entries[0].id)}`, { credentials: "include", cache: "no-store", signal: signal.signal }).then(responseJson).then(data => { if (!signal.signal.aborted && data.job) acceptJob(data.job); }).catch(() => {});
      }
    } catch { /* Ignore obsolete history. */ }
    return () => { signal.abort(); abort.current?.abort(); jobAbort.current?.abort(); };
  }, [storageKey, historyKey, acceptJob, videoEditControls]);
  useEffect(() => {
    if (controlledBackend && controlledBackend !== backend) { invalidate(); setPlan(current => ({ ...current, backend: controlledBackend })); }
  }, [controlledBackend, backend, invalidate]);
  useEffect(() => {
    const signal = new AbortController();setCatalogLoading(true);setCatalog([]);
    fetch(backend === "rtx3090" ? "/api/h3/studio" : "/api/h3/studio?backend=rtx5060ti", { signal: signal.signal, credentials: "include" }).then(responseJson).then(data => {
      if (signal.signal.aborted) return;
      setCatalog(data.catalog || []);setExperimental(data.experimental === true);setDirectGeneration(data.directGeneration === true);
      setPlan(current => reconcileDraft(current, {}, data.catalog || []));
    }).catch(() => { if (!signal.signal.aborted) setMessage("Catalog unavailable for the selected GPU. Check worker readiness before creating video."); })
      .finally(() => { if (!signal.signal.aborted) setCatalogLoading(false); });
    return () => signal.abort();
  }, [backend, ownerKey]);
  useEffect(() => {
    if (!initialSourceVideo && !videoEditControls) return;
    invalidate(); setExternalMediaConsent(false);
    const retained = videoEditControls ? sourcesRef.current.filter(source => source.kind !== "video") : [];
    for (const source of sourcesRef.current.filter(source => source.kind === "video")) { const previous = source.asset || source.registrationAsset; if (previous) deleteAsset(previous.id); }
    const next: Source[] = initialSourceVideo ? [...retained, { id: newClientRequestId(), file: initialSourceVideo, kind: "video", role: "reference", description: "Prepared source video selection", includeAudio: false, clipStartSeconds: 0, revision: 0 }] : retained;
    sourcesRef.current = next; setSources(next);
    setPlan(plan => reconcileDraft(plan, { workflowId: "reference-edit" }));
  }, [initialSourceVideo, ownerKey, invalidate, videoEditControls]);
  useEffect(() => { if (videoEditControls && preview?.review.id) reviewedPlanElement.current?.focus(); }, [videoEditControls, preview?.review.id]);
  // A new local ID/revision represents byte or metadata identity, including same-count replacement.
  const registrationKey = JSON.stringify(sources.map(source => [source.id, source.revision]));
  useEffect(() => {
    const signal = new AbortController();
    const pending = sourcesRef.current.filter(source => !source.asset && !source.error);
    const timer = window.setTimeout(() => {
      void Promise.all(pending.map(async source => {
        let asset: Asset | undefined;
        try {
          const metadata = { role: source.role, description: source.description, includeAudio: source.includeAudio, clipStartSeconds: source.clipStartSeconds };
          const form = new FormData(); form.set("file", source.file); Object.entries(metadata).forEach(([key, value]) => form.set(key, String(value)));
          const options = source.registrationAsset ? { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: source.registrationAsset.id, ...metadata }) } : { method: "POST", body: form };
          const data = await responseJson(await fetch("/api/h3/studio/media", { ...options, credentials: "include", signal: signal.signal }));
          asset = data.asset;
          if (!asset?.id || !asset.sha256 || asset.version == null || asset.kind !== source.kind || asset.role !== source.role) throw new Error("Media registration returned an invalid asset. Select the file again.");
          if (signal.signal.aborted) { if (!source.registrationAsset) deleteAsset(asset.id); return; }
          const next = sourcesRef.current.map(item => item.id === source.id && item.revision === source.revision ? { ...item, asset, registrationAsset: undefined } : item);
          if (!next.some(item => item.asset?.id === asset?.id)) { if (!source.registrationAsset) deleteAsset(asset.id); return; }
          sourcesRef.current = next; setSources(next);
        } catch (error) {
          if (signal.signal.aborted) { if (asset?.id && !source.registrationAsset) deleteAsset(asset.id); return; }
          const next = sourcesRef.current.map(item => item.id === source.id && item.revision === source.revision ? { ...item, error: error instanceof Error ? error.message : "Media could not be registered." } : item);
          sourcesRef.current = next; setSources(next);
        }
      }));
    }, 250);
    return () => { window.clearTimeout(timer); signal.abort(); };
  }, [registrationKey, ownerKey]);
  const jobId = job?.id, jobStatus = job?.status, galleryStatus = job?.galleryStatus;
  useEffect(() => {
    if (!jobId || ["completed", "failed", "canceled"].includes(jobStatus || "") && !(jobStatus === "completed" && ["pending", "saving"].includes(galleryStatus || ""))) return;
    const signal = new AbortController(); let timer: number;
    async function poll() {
      try {
        const data = await responseJson(await fetch(`/api/h3/generation?jobId=${encodeURIComponent(jobId!)}`, { credentials: "include", cache: "no-store", signal: signal.signal }));
        if (!signal.signal.aborted && data.job && jobRef.current?.id === jobId) acceptJob(data.job);
      } catch (error) { if (!signal.signal.aborted) setMessage(error instanceof Error ? error.message : "Status unavailable. Refresh to reconnect."); }
      if (!signal.signal.aborted) timer = window.setTimeout(poll, 1500);
    }
    timer = window.setTimeout(poll, 1500);
    return () => { signal.abort(); window.clearTimeout(timer); };
  }, [jobId, jobStatus, galleryStatus, acceptJob]);
  function change(patch: Partial<H3StudioPlan>) {
    invalidate();
    try {
      const next = reconcileDraft(plan, videoEditControls ? { ...patch, workflowId: "reference-edit" } : controller === "auto" ? { workflowId: sourceWorkflow(sourcesRef.current), ...patch } : patch, catalog);
      setPlan(next);if (patch.backend) onBackendChange?.(patch.backend);
    }
    catch (error) { setMessage(error instanceof Error ? error.message : "Check the selected settings."); }
  }
  const media = { first: sources.some(source => source.role === "first"), images: sources.filter(source => source.kind === "image" && source.role === "reference").length, videos: sources.filter(source => source.kind === "video").length, audios: sources.filter(source => source.kind === "audio").length };
  const mediaReady = sources.every(source => !!source.asset && !source.error);
  const mediaIssue = videoEditControls && (sourceBlockMessage || !media.videos) ? sourceBlockMessage || "Select and prepare a source video before creating an edit."
    : sources.some(source => source.role === "last") && !media.first ? "Choose a first frame before adding a last frame."
    : media.first && sources.some(source => source.role === "reference") ? "Use first/last frames together, or change all images to references. These inputs cannot be combined."
    : sources.some(source => source.kind === "video" && source.asset?.metadata.durationSeconds != null && source.clipStartSeconds + plan.durationSeconds > source.asset.metadata.durationSeconds + .05) ? "Choose a complete video window matching the selected 5- or 10-second duration."
    : "";
  const active = isActive(job);
  useEffect(() => { onBusyChange?.(active || jobBusy); }, [active, jobBusy, onBusyChange]);
  async function request(action: "preview" | "quote" | "director", retainedPlan?: H3StudioPlan) {
    if (inFlight.current || jobGuard.current || isActive(jobRef.current) || mediaIssue || !sourcesRef.current.every(source => source.asset && !source.error)) return;
    if (action === "director" && (!quote?.id || !quote.qualified || quote.estimatedUsd === null || !consent || sourcesRef.current.length > 0 && !externalMediaConsent)) return;
    if (clarification && action !== "quote" && !retainedPlan) return;
    let draft: H3StudioPlan;
    try { draft = retainedPlan ? parseH3StudioPlan(retainedPlan) : controller === "auto" && action !== "director" && !directorPlanReady ? makeLocalH3Plan(plan.originalPrompt, media, plan) : parseH3StudioPlan(plan); if (controller === "auto") draft = automaticH3Plan(draft); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Check the plan."); return; }
    inFlight.current = true; setBusy(true); setMessage(""); setGenerationConsent(false);
    setPreview(null);
    if (action === "preview" || action === "director") { setQuote(null); setConsent(false); }
    const current = revision.current;
    const signal = new AbortController(); abort.current = signal;
    try {
      const response = await fetch("/api/h3/studio", { method: "POST", credentials: "include", signal: signal.signal,
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, plan: draft, mediaIds: sourcesRef.current.map(source => source.asset!.id), externalMediaConsent, ...(action === "director" ? { quoteId: quote!.id, plannerConsent: consent } : {}) }) });
      const data = await responseJson(response);
      if (revision.current !== current || signal.signal.aborted) return;
      if (action === "quote") {
        if (!data.quote?.id) throw new Error("A current planner quote is unavailable.");
        setPlan(draft); setQuote({ ...data.quote, qualified: data.quote.qualified ?? data.qualified ?? false, unavailable: Array.isArray(data.unavailable) ? data.unavailable.filter((reason: unknown) => typeof reason === "string") : [] }); setConsent(false);
      }
      else if (action === "director") {
        const question = typeof data.reply?.question === "string" ? data.reply.question.trim() : "";
        setPreview(null); setQuote(null); setConsent(false); setGenerationConsent(false); requestId.current = null;
        if (question || data.requiresClarification) { setDirectorPlanReady(false); setClarification(question || (typeof data.reply?.unavailable === "string" ? data.reply.unavailable : "Add more detail to your video description.")); }
        else { setPlan(controller === "auto" ? automaticH3Plan(parseH3StudioPlan(data.plan)) : parseH3StudioPlan(data.plan)); setDirectorPlanReady(true); setClarification(""); setMessage(data.reply?.rationale || "Director plan ready. Create Video starts generation."); }
      }
      else {
        if (!data.review?.id || !data.review.mediaFingerprint) throw new Error("The server did not return a current media review. Preview again before generating.");
        setPlan(draft); setPreview(data); requestId.current = null;
      }
    } catch (error) { if (!signal.signal.aborted && revision.current === current) setMessage(error instanceof Error ? error.message : "Plan unavailable."); }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function execute(retainedPlan?: H3StudioPlan) {
    if (jobGuard.current || inFlight.current || isActive(jobRef.current) || !directGeneration && (!preview?.manifest.executable || !preview.review?.id || !generationConsent) || !mediaReady || mediaIssue || clarification) return;
    let draft: H3StudioPlan;
    try { draft = parseH3StudioPlan(retainedPlan || plan); } catch (error) { setMessage(error instanceof Error ? error.message : "Check your prompt and settings."); return; }
    jobGuard.current = true; setJobBusy(true); setMessage("");
    const signal = new AbortController(); jobAbort.current = signal;
    // Retain the key after uncertain failures so a repeated submit cannot duplicate a job.
    requestId.current ||= newClientRequestId();
    try {
      const data = await responseJson(await fetch("/api/h3/studio/execute", { method: "POST", credentials: "include", signal: signal.signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ plan: draft, ...(!directGeneration ? { reviewId: preview!.review.id, generationConsent: true } : {}), mediaIds: sourcesRef.current.map(source => source.asset!.id), requestId: requestId.current }) }));
      if (!signal.signal.aborted) { acceptJob(data.job); submittedPlan.current = { jobId: data.job.id, plan: draft, mediaIdentity: mediaIdentity() }; setPreview(null); setQuote(null); setConsent(false); setGenerationConsent(false); }
    } catch (error) { if (!signal.signal.aborted) setMessage(error instanceof Error ? error.message : "Submission status unknown. Try the same submit again to reconnect."); }
    finally { jobGuard.current = false; setJobBusy(false); }
  }
  async function createAutomatic(retainedPlan?: H3StudioPlan) {
    if (inFlight.current || jobGuard.current || isActive(jobRef.current) || !mediaReady || mediaIssue || clarification) return;
    let draft: H3StudioPlan;
    try { draft = automaticH3Plan(retainedPlan || (directorPlanReady ? parseH3StudioPlan(plan) : makeLocalH3Plan(plan.originalPrompt, media, plan))); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Check your video description."); return; }
    inFlight.current = true; jobGuard.current = true; setBusy(true); setJobBusy(true); setMessage(""); setPreview(null);
    const current = revision.current, signal = new AbortController(); abort.current = signal; jobAbort.current = signal;
    requestId.current ||= newClientRequestId();
    try {
      const data = await responseJson(await fetch("/api/h3/studio/auto", { method: "POST", credentials: "include", signal: signal.signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ plan: draft, mediaIds: sourcesRef.current.map(source => source.asset!.id), requestId: requestId.current }) }));
      if (signal.signal.aborted || revision.current !== current) return;
      const submitted = parseH3StudioPlan(data.plan || draft);
      acceptJob(data.job); setPlan(submitted); setAutoSettings(data.settings || null);
      submittedPlan.current = { jobId: data.job.id, plan: submitted, mediaIdentity: mediaIdentity() };
      requestId.current = null; setQuote(null); setConsent(false); setGenerationConsent(false);
    } catch (error) { if (!signal.signal.aborted && revision.current === current) setMessage(error instanceof Error ? error.message : "Submission status unknown. Click Create Video again to reconnect to the same request."); }
    finally { inFlight.current = false; jobGuard.current = false; setBusy(false); setJobBusy(false); }
  }
  function prepareRetry() {
    const retained = submittedPlan.current;
    if (!retained || retained.jobId !== jobRef.current?.id || retained.mediaIdentity !== mediaIdentity()) { setMessage("Restore the source media and preview a new plan before generating again."); return; }
    setPlan(retained.plan); setDirectorPlanReady(true); setGenerationConsent(false);
    if (controller === "auto") { requestId.current = null; void createAutomatic(retained.plan); return; }
    if (directGeneration) { requestId.current = null; void execute(retained.plan); return; }
    void request("preview", retained.plan);
  }
  async function jobAction(action: "refresh" | "cancel" | "gallery", id = jobRef.current?.id) {
    if (!id || jobGuard.current || inFlight.current) return;
    jobGuard.current = true; setJobBusy(true); setMessage("");
    const signal = new AbortController(); jobAbort.current = signal;
    try {
      const response = action === "refresh" ? await fetch(`/api/h3/generation?jobId=${encodeURIComponent(id)}`, { credentials: "include", cache: "no-store", signal: signal.signal }) : await fetch(action === "gallery" ? "/api/h3/generation/gallery" : "/api/h3/generation", { method: "POST", credentials: "include", signal: signal.signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...(action === "gallery" ? {} : { action }), jobId: id }) });
      const data = await responseJson(response);
      if (signal.signal.aborted) return;
      if (action === "gallery" && !data.job) {
        const refreshed = await responseJson(await fetch(`/api/h3/generation?jobId=${encodeURIComponent(id)}`, { credentials: "include", cache: "no-store", signal: signal.signal }));
        if (!signal.signal.aborted && refreshed.job) acceptJob(refreshed.job);
      } else if (data.job) acceptJob(data.job);
    } catch (error) { if (!signal.signal.aborted) setMessage(error instanceof Error ? error.message : "Job action failed."); }
    finally { jobGuard.current = false; setJobBusy(false); }
  }
  function savePreset() {
    try {
      const name = presetName.trim().slice(0, 60); if (!name) return setMessage("Name this preset.");
      const next = [...presets.filter(p => p.name !== name), { name, plan: parseH3StudioPlan(plan) }].slice(-20);
      localStorage.setItem(storageKey, JSON.stringify(next)); setPresets(next); setMessage("Preset saved on this device for this account. Media is not copied.");
    } catch { setMessage("Enter a valid plan and enable device storage to save a preset."); }
  }
  function reorder(index: number, offset: number) {
    const loras = [...plan.loras]; const target = index + offset;
    if (target < 0 || target >= loras.length) return;
    [loras[index], loras[target]] = [loras[target], loras[index]]; change({ loras });
  }
  const dimensions = studioDimensions(plan);
  const ref2va = plan.workflowId === "native-r2v" || plan.workflowId === "reference-edit";
  const omniRef = plan.workflowId === "native-r2v";
  const shown = catalog.filter(l => (!category || l.categories.includes(category)) && `${l.name} ${l.version} ${l.category}`.toLowerCase().includes(query.toLowerCase()));
  const planActions = <div className={css.row}><button type="button" disabled={busy || jobBusy || active || !mediaReady || !!mediaIssue || !plan.originalPrompt.trim() || !!clarification} onClick={() => controller === "auto" ? void createAutomatic() : directGeneration ? void execute() : void request("preview")}>{busy || jobBusy ? "Preparing video…" : controller === "auto" || videoEditControls || directGeneration ? "Create Video" : "Preview Video Plan (no cost)"}</button>{directGeneration && controller === "manual" ? <button type="button" disabled={busy || jobBusy || active || !mediaReady || !!mediaIssue || !plan.originalPrompt.trim()} onClick={() => void request("preview")}>View Plan (optional)</button> : null}<button type="button" disabled={busy || jobBusy || active} onClick={() => change({ ...DEFAULT_H3_STUDIO_PLAN })}>Reset plan (keep media)</button></div>;
  return <section className={css.studio} aria-label="H3 Auto and Manual controllers">
    <h2>{videoEditControls ? "H3 Reference Video Edit" : "H3 Video Studio"}</h2>
    <div className={css.controller} aria-label="Studio controller"><button type="button" aria-pressed={controller === "auto"} onClick={() => setController("auto")}>Auto Mode</button><button type="button" aria-pressed={controller === "manual"} onClick={() => setController("manual")}>Manual Mode</button></div>
    <label className={css.notice}>Rendering GPU<select aria-label="H3 rendering GPU" disabled={busy || jobBusy || active || catalogLoading} value={backend} onChange={e => change({ backend: e.target.value as NonNullable<H3StudioPlan["backend"]> })}><option value="rtx3090">RTX 3090</option><option value="rtx5060ti">RTX 5060 Ti</option></select></label>
    {manualMenu ? <p className={css.notice}>Choose an H3 Studio option below, or select Manual for complete creative controls.</p> : null}
    {/* Keep drafts/media mounted when returning to the original Studio menu. Job polling and Safe Cancel stay visible below. */}
    <div hidden={manualMenu} data-otg="h3-studio-plan-controls">
    {controller === "manual" && onBackToStudio ? <button type="button" onClick={onBackToStudio}>Back to H3 Studio</button> : null}
    {experimental ? <p role="status" className={css.notice}>Owner Experimental Mode · private TEST · {backend === "rtx3090" ? "RTX 3090" : "RTX 5060 Ti"}. Installed configurations may be run before generation testing. Outputs and quality are unverified.</p> : null}
    <p className={css.notice}>{controller === "auto" ? "Describe your video and add optional media. Create Video starts one generation using SLA Attention and a matching 8-step Turbo workflow." : "Complete manual controls · choose a workflow, compatible models, references and creative settings."}</p>
    <fieldset className={css.fields} disabled={active || jobBusy || busy || catalogLoading}>
    <label>{videoEditControls ? "Edit prompt" : "Video description"}<textarea aria-label={videoEditControls ? "Reference video edit prompt" : undefined} rows={4} maxLength={4000} value={plan.originalPrompt} onChange={e => change({ originalPrompt: e.target.value, prompt: e.target.value })} /></label>
    {clarification ? <p role="status">{clarification} Update the video description to answer, then request a new plan.</p> : null}
    <div className={css.grid}>
      <label>{videoEditControls ? "Resolution (MP)" : "Quality"}<select value={plan.quality} onChange={e => change({ quality: e.target.value as H3StudioPlan["quality"] })}><option value="0.2">0.2 MP</option><option value="0.6">0.6 MP</option><option value="1">1 MP</option></select></label>
      <label>Aspect<select value={plan.orientation} onChange={e => change({ orientation: e.target.value as H3StudioPlan["orientation"] })}><option value="landscape">Landscape</option><option value="portrait">Portrait</option></select></label>
      <label>Duration<select value={plan.durationSeconds} onChange={e => change({ durationSeconds: Number(e.target.value) as 5 | 10 })}><option value={5}>5 seconds</option><option value={10}>10 seconds</option></select></label>
      <label>Audio<select value={plan.audio} onChange={e => change({ audio: e.target.value as H3StudioPlan["audio"] })}><option value="generated">H3 generated</option><option value="original" disabled={controller === "auto" ? !media.videos : plan.workflowId !== "reference-edit"}>Original source (video edit only)</option><option value="mute">Muted</option></select></label>
    </div>
    {videoEditControls && controller === "auto" ? <div className={css.grid}>
      <label>Generation mode<select value={plan.profile} onChange={e => change({ profile: e.target.value as H3StudioPlan["profile"] })}><option value="native">Native H3 · 20 steps</option><option value="ref2va-8step">Turbo LoRA · Ref2VA 8 steps</option></select></label>
      <label>SLA attention<input type="checkbox" checked={plan.attention === "project-sla"} onChange={e => change({ attention: e.target.checked ? "project-sla" : "dense" })} /></label>
      <p className={css.notice}>0.2 MP: 608 × 352 · 0.6 MP: 1056 × 608 · 1 MP: 1344 × 768. Portrait reverses dimensions. Turbo uses the matching Ref2VA 8-step adapter; Native does not load it.</p>
    </div> : null}
    {videoEditControls ? <>{planActions}{mediaIssue ? <p role="status">{mediaIssue}</p> : <p className={css.notice}>{directGeneration ? "Create Video starts your edit using the selected inputs." : "Create Video reviews the edit locally first; approve the generation estimate to submit it."}</p>}</> : null}
    <fieldset className={css.fields} aria-label="Source media">
      <legend>Optional source media</legend>
      <div className={css.grid}>{(videoEditControls ? ["image", "audio"] as const : ["image", "video", "audio"] as const).map(kind => <label key={kind}>Add {kind} references<input type="file" accept={MEDIA_ACCEPT[kind]} multiple onChange={event => { addSources(event.target.files, kind, "reference"); event.target.value = ""; }} /></label>)}</div>
      <div className={css.row}>{!videoEditControls && (controller === "auto" || plan.workflowId === "native-i2v") ? <><button type="button" onClick={() => setSnapshotRole("first")}>First-frame input from video</button><button type="button" onClick={() => setSnapshotRole("last")}>Last-frame input from video</button></> : <button type="button" onClick={() => setSnapshotRole("reference")}>Reference image from video</button>}</div>
      {sources.map((source, index) => <article className={css.status} key={source.id} aria-label={`Source ${index + 1}`}>
        <p>{source.file.name} · {source.kind}</p><SourcePreview source={source} />
        <div className={css.grid}>
          <label>Role for {source.file.name}<select value={source.role} disabled={source.kind !== "image" || videoEditControls} onChange={event => updateSource(source.id, { role: event.target.value as Source["role"] })}><option value="reference">Reference</option><option value="first" disabled={sources.some(item => item.id !== source.id && item.role === "first")}>First frame</option><option value="last" disabled={sources.some(item => item.id !== source.id && item.role === "last")}>Last frame</option></select></label>
          <label>Description for {source.file.name}<input maxLength={1000} value={source.description} onChange={event => updateSource(source.id, { description: event.target.value })} /></label>
          {source.kind === "video" ? <><label>Include audio from {source.file.name}<input type="checkbox" disabled={source.asset?.metadata.hasAudio === false} checked={source.includeAudio} onChange={event => updateSource(source.id, { includeAudio: event.target.checked })} /></label><label>Clip start seconds for {source.file.name}<input type="number" min={0} step={0.1} max={source.asset?.metadata.durationSeconds == null ? undefined : Math.max(0, source.asset.metadata.durationSeconds - plan.durationSeconds)} value={source.clipStartSeconds} onChange={event => updateSource(source.id, { clipStartSeconds: Math.max(0, Number(event.target.value) || 0) })} /></label><p className={css.notice}>Selected window: {source.clipStartSeconds.toFixed(2)}–{(source.clipStartSeconds + plan.durationSeconds).toFixed(2)} seconds. Choose 5 or 10 seconds in Duration.</p></> : null}
          {!(videoEditControls && source.kind === "video") ? <label>Replace {source.file.name}<input type="file" accept={MEDIA_ACCEPT[source.kind]} onChange={event => { const file = event.target.files?.[0]; if (file) updateSource(source.id, { file }); event.target.value = ""; }} /></label> : null}
        </div>
        <p className={css.notice}>{source.error || (source.asset ? `Ready · version ${source.asset.version}${source.asset.metadata.durationSeconds ? ` · ${source.asset.metadata.durationSeconds.toFixed(2)} seconds` : ""}` : "Registering media…")}</p>
        <div className={css.row}>{source.error ? <button type="button" onClick={() => updateSource(source.id, {})}>Retry media registration</button> : null}{!(videoEditControls && source.kind === "video") ? <button type="button" onClick={() => { const previous = source.asset || source.registrationAsset; if (previous) deleteAsset(previous.id); updateSources(sourcesRef.current.filter(item => item.id !== source.id)); }}>Remove {source.file.name}</button> : null}</div>
      </article>)}
      <p className={css.notice}>PNG, JPEG and WebP images up to 20 MB; video and audio up to 128 MB. Images can be first/last frames or references. Video references use the selected clip start and duration. Media stays private unless you approve sharing with the optional AI Director.</p>
    </fieldset>
    {!videoEditControls && mediaIssue ? <p role="status">{mediaIssue}</p> : null}
    <p className={css.notice}>{dimensions.width} × {dimensions.height} · 24 FPS · {studioFrames(plan.durationSeconds)} generation frames · {backend === "rtx3090" ? "RTX 3090" : "RTX 5060 Ti"}. Temporal-grid surplus is trimmed explicitly to the requested duration. Jobs stay on your selected GPU; they do not switch automatically.</p>
    {plan.workflowId === "reference-edit" ? <p className={css.notice}>Source fit: preserve aspect ratio and pad to the selected canvas. Reference-guided editing can reinterpret motion and identity; it is not a frame-perfect structural filter.</p> : null}
    {controller === "manual" ? <>
      <label>Generation prompt<textarea rows={4} maxLength={4000} value={plan.prompt} onChange={e => change({ prompt: e.target.value })} /></label>
      <div className={css.grid}>
        <label>Workflow<select value={plan.workflowId} disabled={videoEditControls} onChange={e => change({ workflowId: e.target.value as H3StudioPlan["workflowId"] })}>{H3_STUDIO_WORKFLOWS.map(w => <option key={w.id} value={w.id}>{w.label}</option>)}</select></label>
        <label>Checkpoint<select value={plan.checkpoint} disabled={omniRef} onChange={e => change({ checkpoint: e.target.value as H3StudioPlan["checkpoint"] })}><option value="standard">{omniRef ? "FastH3 OmniRef INT8 · selected C" : "Native H3 (INT8)"}</option><option value="singularity" disabled={!ref2va || omniRef}>Singularity v1.3 (Ref2VA)</option></select></label>
        <label>Acceleration<select value={plan.profile} disabled={omniRef} onChange={e => change({ profile: e.target.value as H3StudioPlan["profile"] })}><option value="fl2va-8step" disabled={ref2va}>FL2VA 8-step Turbo</option><option value="native">Native · 20 steps</option><option value="ref2va-8step" disabled={!ref2va}>{omniRef ? "OmniRef · distilled 8 steps (no adapter)" : "Ref2VA · 8-step adapter"}</option></select></label>
        {omniRef ? <p className={css.notice}>VSA attention · 10% keep · Euler / simple · 8 steps. Reference generation uses the selected OmniRef workflow, not Singularity or the old Turbo adapter.</p> : <label>Native H3 SLA<input type="checkbox" checked={plan.attention === "project-sla"} onChange={e => change({ attention: e.target.checked ? "project-sla" : "dense" })} /></label>}
        <label>Seed<input type="number" min={0} max={Number.MAX_SAFE_INTEGER} step={1} value={plan.seed} onChange={e => change({ seed: Number(e.target.value) })} /></label>
        <label>Independent Combat V2<input type="checkbox" disabled={plan.checkpoint !== "singularity"} checked={plan.combatEnabled} onChange={e => change({ combatEnabled: e.target.checked })} /></label>
        <label>Camera<select value={plan.camera} onChange={e => change({ camera: e.target.value as H3StudioPlan["camera"] })}>{["none", "static", "pan", "dolly", "tracking"].map(value => <option key={value}>{value}</option>)}</select></label>
        <label>Motion<select value={plan.motion} onChange={e => change({ motion: e.target.value as H3StudioPlan["motion"] })}>{["none", "subtle", "dynamic"].map(value => <option key={value}>{value}</option>)}</select></label>
        <label>Sampler<input value={plan.sampler} readOnly /></label><label>Scheduler<input value={plan.scheduler} readOnly /></label><label>Steps<input type="number" value={plan.steps} readOnly /></label>
      </div>
      {!omniRef ? <p className={css.notice}>Native: res_multistep / simple, 20 steps. Ref2VA Turbo: Euler / simple, 8 steps, shifts 12 / 3. Uncheck Native H3 SLA for explicit dense attention. Other samplers, 4-step, guide/control and continuation variants remain unavailable until their exact compatibility is qualified. Singularity retains automatic Realism; Combat stays independent.</p> : null}
      <details><summary>Selected LoRA catalog ({catalog.length} of 60 loaded)</summary>
        <label>Search LoRAs<input value={query} onChange={e => setQuery(e.target.value)} /></label>
        <label>Category<select value={category} onChange={e => setCategory(e.target.value)}><option value="">All researched categories</option>{[...new Set(catalog.flatMap(l => l.categories))].sort().map(c => <option key={c}>{c}</option>)}</select></label>
        <ul className={css.catalog}>{shown.map(l => <li key={l.id}><strong>{l.name}</strong><p>{l.version} · {l.installation} · {l.rights}</p><p className={css.notice}>{l.blockedReasons.join(" · ") || "Installed · experimental, generation untested"}</p><button type="button" disabled={!!l.blockedReasons.length || plan.loras.length >= 3 || plan.loras.some(s => s.id === l.id)} onClick={() => change({ loras: [...plan.loras, { id: l.id, strength: l.strength?.min ?? 1, enabled: true }] })}>Add {l.name}</button></li>)}</ul>
      </details>
      <ol className={css.stack}>{plan.loras.map((l, i) => <li key={l.id}><span>{catalog.find(c => c.id === l.id)?.name || l.id}</span><label>Enabled<input type="checkbox" checked={l.enabled} onChange={e => change({ loras: plan.loras.map((v, n) => n === i ? { ...v, enabled: e.target.checked } : v) })} /></label><label>Strength<input type="number" min={0} max={2} step={0.05} value={l.strength} onChange={e => change({ loras: plan.loras.map((v, n) => n === i ? { ...v, strength: Number(e.target.value) } : v) })} /></label><div className={css.row}><button type="button" disabled={i === 0} aria-label={`Move LoRA ${i + 1} earlier`} onClick={() => reorder(i, -1)}>Earlier</button><button type="button" disabled={i === plan.loras.length - 1} aria-label={`Move LoRA ${i + 1} later`} onClick={() => reorder(i, 1)}>Later</button></div><button type="button" onClick={() => change({ loras: plan.loras.filter((_, n) => n !== i) })}>Remove LoRA {i + 1}</button></li>)}</ol>
      <details><summary>Reusable device presets</summary><label>Preset name<input maxLength={60} value={presetName} onChange={e => setPresetName(e.target.value)} /></label><button type="button" onClick={savePreset}>Save preset</button>{presets.map(p => <div className={css.row} key={p.name}><button type="button" onClick={() => change(p.plan)}>Load {p.name}</button><button type="button" onClick={() => { const next = presets.filter(v => v.name !== p.name); try { localStorage.setItem(storageKey, JSON.stringify(next)); setPresets(next); } catch { setMessage("Device storage unavailable."); } }}>Delete preset {p.name}</button></div>)}</details>
    </> : <details><summary>Optional AI Director</summary>
      <p className={css.notice}>Get an estimate before approving a paid planner call. Generation remains separately authorized; owner experiments do not imply qualification.</p>
      {sources.length ? <label><input type="checkbox" checked={externalMediaConsent} onChange={event => { invalidate(false); setExternalMediaConsent(event.target.checked); }} />Allow the AI Director to receive the selected media for this plan.</label> : null}
      <button type="button" disabled={busy || !mediaReady || !!mediaIssue || !plan.originalPrompt.trim()} onClick={() => request("quote")}>Estimate AI planning cost</button>
      {quote ? <div className={css.status}>Planner estimate: {quote.estimatedUsd === null ? "Pricing unavailable" : `$${quote.estimatedUsd.toFixed(5)}`} USD. {quote.qualified ? "" : "AI planning is unavailable: no compatible installed capability is available for these references."}{quote.unavailable.length ? <ul>{quote.unavailable.map(reason => <li key={reason}>{reason}</li>)}</ul> : null}<label><input type="checkbox" disabled={!quote.qualified || quote.estimatedUsd === null} checked={consent} onChange={e => setConsent(e.target.checked)} />I approve one planner call at the displayed estimate.</label><button type="button" disabled={busy || !consent || !quote.qualified || quote.estimatedUsd === null || sources.length > 0 && !externalMediaConsent || !!clarification} onClick={() => request("director")}>Ask AI Director</button></div> : null}
    </details>}
    {!videoEditControls ? planActions : null}
    </fieldset>
    {controller === "manual" && preview ? <div className={css.status} ref={reviewedPlanElement} tabIndex={-1} aria-label="Reviewed video plan">
      <strong>Video Plan</strong><p>{plan.prompt}</p><p>{plan.workflowId} · {preview.manifest.steps} steps · {preview.manifest.sampler}</p>
      <p>{preview.estimate.explanation}</p><p>Generation credits: {preview.estimate.generationCredits ?? "not measured"} · Runtime estimate: {preview.estimate.generationSeconds == null ? "not measured" : `${preview.estimate.generationSeconds} seconds`}</p>
      {preview.manifest.blockedReasons.length ? <ul>{preview.manifest.blockedReasons.map(reason => <li key={reason}>{reason}</li>)}</ul> : null}
      {!directGeneration ? <label><input type="checkbox" checked={generationConsent} disabled={!preview.manifest.executable || active || jobBusy} onChange={event => setGenerationConsent(event.target.checked)} />I approve one generation at the displayed generation estimate.</label> : null}
      <div className={css.row}><button type="button" disabled={active || jobBusy} onClick={() => { setController("manual"); onOpenManualControls?.(); }}>Edit Plan in Manual</button>
        <button type="button" disabled={!preview.manifest.executable || !mediaReady || !directGeneration && !generationConsent || busy || active || jobBusy} onClick={() => void execute()}>{jobBusy ? "Submitting…" : directGeneration ? "Create Video" : "Generate reviewed video"}</button></div>
      <details><summary>Inspect sanitized API graph / manifest</summary><pre>{JSON.stringify(preview, null, 2)}</pre><button type="button" onClick={() => { const url = URL.createObjectURL(new Blob([JSON.stringify(preview, null, 2)], { type: "application/json" })); const link = document.createElement("a"); link.href = url; link.download = "h3-plan.json"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }}>Export sanitized plan</button></details>
    </div> : null}
    </div>
    {controller === "auto" && autoSettings ? <details className={css.status}><summary>Video settings</summary><p>{plan.workflowId} · SLA Attention · 8-step Turbo</p><p>{dimensions.width} × {dimensions.height} · {plan.durationSeconds} seconds</p><p>{autoSettings.estimate.explanation}</p><button type="button" disabled={active || jobBusy || busy} onClick={() => { setController("manual"); onOpenManualControls?.(); }}>Edit Plan in Manual</button></details> : null}
    {message ? <p role="status">{message}</p> : null}
    {job ? <section className={css.status} aria-label="H3 Studio job">
      <h3>{job.statusMessage || job.status}</h3><p className={css.notice}>Job {job.id} · {job.status}</p>
      {active ? <><progress aria-label="Generation progress" max={100} value={Math.max(0, Math.min(100, job.progressPercent || 0))} /><p className={css.notice}>Estimated progress · waiting for confirmed backend status.</p></> : null}
      {job.error ? <p role="alert">{job.error}</p> : null}
      {active && livePreviewUrl(job.approximatePreview?.imageUrl) ? <figure>{job.approximatePreview?.imageUrl.startsWith("data:video/") ? <video className={css.media} src={livePreviewUrl(job.approximatePreview?.imageUrl)} aria-label="Approximate generation preview" autoPlay loop muted playsInline controls /> : <img className={css.media} src={livePreviewUrl(job.approximatePreview?.imageUrl)} alt="Approximate generation preview" />}<figcaption>Approximate preview · final video may differ</figcaption></figure> : null}
      <div className={css.row}><button type="button" disabled={jobBusy} onClick={() => void jobAction("refresh")}>Refresh job</button>{active ? <button type="button" disabled={jobBusy || job.status === "canceling"} onClick={() => void jobAction("cancel")}>{job.status === "canceling" ? "Canceling…" : "Safe Cancel"}</button> : <button type="button" disabled={jobBusy || busy || !mediaReady || submittedPlan.current?.jobId !== job.id || submittedPlan.current.mediaIdentity !== mediaIdentity()} onClick={prepareRetry}>{controller === "auto" ? "Retry Video" : "Prepare retry"}</button>}</div>
      {!active ? <p className={css.notice}>{controller === "auto" ? "Retry starts one new video using the retained inputs." : "Retry prepares a fresh plan review using retained media. Approve the new generation estimate before submitting. For an older job, select its source media and preview a new plan."}</p> : null}
      {job.status === "completed" && localUrl(job.videoUrl) ? <><video className={css.media} src={localUrl(job.videoUrl)} controls playsInline /><p>{job.nativeResolution} · {job.galleryStatus === "saved" ? "Saved to Gallery" : job.galleryStatus === "failed" ? "Gallery save failed" : "Saving to Gallery…"}</p><div className={css.row}><a className={css.link} href={`${localUrl(job.videoUrl)}${job.videoUrl!.includes("?") ? "&" : "?"}download=1`} download>Download video</a>{localUrl(job.galleryUrl) ? <a className={css.link} href={localUrl(job.galleryUrl)}>Open Gallery video</a> : null}{job.galleryStatus === "failed" ? <button type="button" disabled={jobBusy} onClick={() => void jobAction("gallery")}>Retry Gallery save</button> : null}</div>{job.galleryError ? <p>{job.galleryError}</p> : null}</> : null}
    </section> : null}
    {history.length ? <details><summary>Recent H3 jobs ({history.length})</summary><ul className={css.stack}>{history.map(item => <li key={item.id}><button type="button" disabled={jobBusy || active && item.id !== job?.id} onClick={() => void jobAction("refresh", item.id)}>{item.statusMessage || item.status} · {item.id}</button></li>)}</ul><p className={css.notice}>Recent jobs on this device and account. Open a job to load its current status.</p></details> : null}
    <VideoSnapshotPicker open={snapshotRole !== null} onClose={() => setSnapshotRole(null)} onSnapshot={({ file }) => { if (snapshotRole) addSources([file], "image", snapshotRole); }} />
  </section>;
}
