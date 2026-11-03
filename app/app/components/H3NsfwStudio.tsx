"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { canvas, DEFAULT_LAB_SETTINGS, isRetiredExperiment, labExperiment, type Experiment, type LabSettings } from "@/lib/experiments/catalog";
import type { LabAsset, LabSession } from "@/lib/experiments/store";
import type { LabCapability, LabJob, LabLora } from "@/lib/experiments/generation";
import { newClientRequestId } from "@/lib/client/requestId";
import { newRandomSeed } from "@/lib/client/randomSeed";
import VideoSnapshotPicker from "./VideoSnapshotPicker";
import H3NsfwPromptTools from "./H3NsfwPromptTools";
import { DEFAULT_LAB_CREATIVE, labH3Mode } from "@/lib/experiments/creative";
import { DEFAULT_NSFW_UI, readNsfwDraft, writeNsfwDraft, nsfwEditorKey, type NsfwUiState } from "@/lib/client/h3NsfwDraft";
import { mediaStorageKey,writePersistedH3MediaFiles,readPersistedH3MediaFiles,clearPersistedH3MediaFiles } from "./h3InputPersistence";
import {labUploadMime,MAX_LAB_IMAGE_BYTES} from "@/lib/experiments/imageTypes";
import {appendH3References,MAX_H3_RENDER_REFERENCES} from "@/lib/experiments/referenceLimits";

const root = "/api/h3/nsfw";
const button = "min-h-11 rounded-xl border border-white/15 px-3 py-2 text-sm font-medium disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-400";
const input = "w-full min-w-0 rounded-xl border border-white/15 bg-black/25 p-3 text-base";
const card = "min-w-0 space-y-3 rounded-2xl border border-white/10 bg-black/15 p-4";
const modes = [["text", "Text"], ["image", "Image"], ["reference", "Reference"], ["edit", "Edit video"], ["edit-image", "Edit image"]] as const;
type Editor = { experiment: string; settings: LabSettings };
const fresh = (experiment: string): Editor => ({ experiment, settings: { ...DEFAULT_LAB_SETTINGS, ...DEFAULT_LAB_CREATIVE, mode: "text", selectedSources: [], seedLocked: false, loras:[] } });
const keyOf = nsfwEditorKey;
const fromSession = (s: LabSession): Editor => ({ experiment: s.experiment, settings: { ...s.settings, seedLocked: s.settings.seedLocked ?? false, selectedSources: s.settings.selectedSources ?? appendH3References([],s.assets.filter(a => a.role === "source").map(a => a.id),s.assets,s.settings.mode) } });
const messageOf = (error: unknown) => error instanceof Error ? error.message : "Could not complete that action. Please try again.";
const mediaUrl = (id: string) => `${root}/assets?id=${encodeURIComponent(id)}`;

async function api<T>(url: string, data?: unknown): Promise<T> {
  const response = await fetch(url, { cache: "no-store", credentials: "same-origin", ...(data === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }) });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status}).`);
  return body;
}

function Media({ asset, small = false }: { asset: LabAsset; small?: boolean }) {
  const size = small ? "max-h-32" : "max-h-96";
  if (asset.mime.startsWith("video/")) return <video className={`${size} w-full rounded-lg bg-black`} src={mediaUrl(asset.id)} controls playsInline preload="metadata" aria-label={asset.name} />;
  // Private, authenticated media is served by the existing owner-scoped route.
  // eslint-disable-next-line @next/next/no-img-element
  if (asset.mime.startsWith("image/")) return <img className={`${size} w-full rounded-lg object-contain`} src={mediaUrl(asset.id)} alt={asset.name} loading="lazy" />;
  return <audio className="w-full max-w-full" src={mediaUrl(asset.id)} controls preload="metadata" aria-label={asset.name} />;
}

export default function H3NsfwStudio({ownerKey=""}:{ownerKey?:string}) {
  const [catalog, setCatalog] = useState<Experiment[]>([]), [capabilities, setCapabilities] = useState<LabCapability[]>([]);
  const [sessions, setSessions] = useState<LabSession[]>([]), [session, setSession] = useState<LabSession | null>(null);
  const [editor, setEditor] = useState<Editor>(() => fresh("prism-pika"));
  const editorRef = useRef(editor), sessionRef = useRef(session), savedKey = useRef(keyOf(editor));
  const [savedSignature, setSavedSignature] = useState(() => keyOf(editor));
  const saveChain = useRef<Promise<unknown>>(Promise.resolve()), alive = useRef(true), acting = useRef(false);
  const pendingRequest = useRef<{ key: string; id: string } | null>(null), upload = useRef<XMLHttpRequest | null>(null);
  const [loaded, setLoaded] = useState(false), [busy, setBusy] = useState(false), [saveStatus, setSaveStatus] = useState(""), [error, setError] = useState("");
  const [jobs, setJobs] = useState<LabJob[]>([]), [progress, setProgress] = useState<number | null>(null);
  const [ui,setUi]=useState<NsfwUiState>(DEFAULT_NSFW_UI),uiRef=useRef(ui),restored=useRef(false);
  const {promptUndo,inputUndo,strength}=ui;
  const [loras,setLoras]=useState<LabLora[]>([]),[conflict,setConflict]=useState(false),[clock,setClock]=useState(()=>Date.now());
  const [uploadType, setUploadType] = useState("image/*"), fileInput = useRef<HTMLInputElement>(null);
  const [snapshotOpen, setSnapshotOpen] = useState(false);
  const [savedUploadLimit,setSavedUploadLimit]=useState(20),[historyLimit,setHistoryLimit]=useState(20);
  const settings = editor.settings, ids = settings.selectedSources || [];
  const capability = capabilities.find(c => c.model === editor.experiment), recipe = capability?.recipe;
  const assets = session?.assets || [], sources = ids.map(id => assets.find(a => a.id === id)).filter((a): a is LabAsset => !!a);
  const unused = assets.filter(a => a.role === "source" && !ids.includes(a.id));
  const dirty = keyOf(editor) !== savedSignature;
  const latest = jobs[0], result = assets.find(a => a.id === latest?.output);
  const activeJobs = jobs.filter(j => !["completed", "failed", "canceled"].includes(j.state) || !j.cleanedUp);
  const dimensions = canvas(settings);
  const formatTime=(seconds:number)=>`${Math.floor(Math.max(0,seconds)/60)}m ${Math.floor(Math.max(0,seconds)%60)}s`;
  const imageCount = sources.filter(a => a.mime.startsWith("image/")).length;
  const videoCount = sources.filter(a => a.mime.startsWith("video/")).length;
  const audioCount = sources.filter(a => a.mime.startsWith("audio/")).length;
  const inputProblem = settings.mode === "text" ? ""
    : ["image", "edit-image"].includes(settings.mode) ? (sources.length === 1 && imageCount === 1 ? "" : "Choose one image.")
    : settings.mode === "edit" ? (videoCount === 1 && audioCount === 0 && imageCount <= 9 ? "" : "Choose one video, with optional images.")
    : !sources.length ? "Add an image, video or audio reference."
    : imageCount > 9 || videoCount > 3 || audioCount > 3 || sources.length>MAX_H3_RENDER_REFERENCES ? "For one render: up to 9 images, 3 videos and 3 audio; 12 total. Saved uploads are unlimited." : "";
  const retired = isRetiredExperiment(editor.experiment);
  const available = !retired && !!capability?.modes.includes(settings.mode) && settings.gpu !== "rtx5060ti";
  const loraProblem=(settings.loras||[]).some(s=>!loras.some(l=>l.id===s.id&&l.models.includes(editor.experiment)));
  const persist=useCallback(()=>{
    if(!restored.current)return;
    if(!writeNsfwDraft(ownerKey,{version:1,sessionId:sessionRef.current?.id||null,savedKey:savedKey.current,editor:editorRef.current,ui:uiRef.current,pending:pendingRequest.current,updatedAt:Date.now()})&&alive.current)setSaveStatus("Server save only · device storage unavailable");
  },[ownerKey]);
  const updateUi=useCallback((patch:Partial<NsfwUiState>)=>{uiRef.current={...uiRef.current,...patch};setUi(uiRef.current);persist();},[persist]);
  function setPromptUndo(value:string[]|((current:string[])=>string[])){updateUi({promptUndo:typeof value==="function"?value(uiRef.current.promptUndo):value});}
  function setInputUndo(value:string[]|null){updateUi({inputUndo:value});}
  function setStrength(value:NsfwUiState["strength"]){updateUi({strength:value});}

  const remember = useCallback((next: LabSession) => {
    if (sessionRef.current?.id === next.id) next = { ...next, assets: [...next.assets, ...sessionRef.current.assets.filter(a => !next.assets.some(n => n.id === a.id))] };
    sessionRef.current = next;
    if (alive.current) { setSession(next); setSessions(current => [next, ...current.filter(s => s.id !== next.id)]); }
    persist();
  }, [persist]);
  function change(next: Editor) { editorRef.current = next; setEditor(next); setSaveStatus(keyOf(next) === savedKey.current ? (sessionRef.current ? "Saved" : "") : "Saved on device · syncing…");persist(); }
  function patch(update: Partial<LabSettings>) { change({ ...editorRef.current, settings: { ...editorRef.current.settings, ...update } }); }
  const load=useCallback((next: LabSession | null, model = editorRef.current.experiment)=> {
    const value = next ? fromSession(next) : fresh(model);
    sessionRef.current = next; editorRef.current = value; savedKey.current = keyOf(value);
    setSavedSignature(keyOf(value));
    setSession(next); setEditor(value); setJobs([]); setSavedUploadLimit(20);setHistoryLimit(20);setError(""); setSaveStatus(next ? "Saved" : ""); pendingRequest.current = null;
    uiRef.current={...DEFAULT_NSFW_UI};setUi(uiRef.current);setConflict(false);persist();
  },[persist]);
  // Serialize saves. Read the latest revision at execution time, but never
  // replace newer typing with the response from an earlier save or job poll.
  const save = useCallback((force = false): Promise<LabSession | null> => {
    const task = saveChain.current.catch(() => {}).then(async () => {
      const value = editorRef.current, signature = keyOf(value);
      if (signature === savedKey.current && (sessionRef.current || !force)) return sessionRef.current;
      if (alive.current) setSaveStatus("Saving…");
      let current = sessionRef.current;
      if (!current) {
        current = (await api<{ session: LabSession }>(root, { action: "create", experiment: value.experiment })).session;
        remember(current);
      }
      const response = await api<{ session: LabSession }>(root, { ...current, action: "update", experiment: value.experiment, settings: value.settings });
      remember(response.session); savedKey.current = signature;
      persist();
      if (alive.current) { setSavedSignature(signature); setSaveStatus(keyOf(editorRef.current) === signature ? "Saved" : "Unsaved changes"); }
      return response.session;
    });
    saveChain.current = task;
    return task;
  }, [remember,persist]);
  useEffect(() => {
    alive.current = true;
    let stopped = false;
    void api<{ catalog: Experiment[]; sessions: LabSession[]; capabilities: LabCapability[];loras?:LabLora[] }>(root).then(data => {
      if (stopped) return;
      setCatalog(data.catalog); setCapabilities(data.capabilities); setSessions(data.sessions);setLoras(data.loras||[]);
      const recovered=readNsfwDraft(ownerKey),matching=recovered?.sessionId?data.sessions.find(s=>s.id===recovered.sessionId&&!s.archived):null;
      load(matching||data.sessions.find(s => !s.archived) || null, data.catalog[0]?.id || "prism-pika");
      if(recovered && (matching||!recovered.sessionId) && (data.catalog.some(c=>c.id===recovered.editor.experiment)||isRetiredExperiment(recovered.editor.experiment))){
        editorRef.current=recovered.editor;setEditor(recovered.editor);uiRef.current={...DEFAULT_NSFW_UI,...recovered.ui};setUi(uiRef.current);pendingRequest.current=recovered.pending;
        const serverKey=matching?keyOf(fromSession(matching)):keyOf(fresh(recovered.editor.experiment));
        const collision=!!matching&&serverKey!==recovered.savedKey&&serverKey!==keyOf(recovered.editor);
        savedKey.current=serverKey;setSavedSignature(serverKey);setConflict(collision);setSaveStatus(collision?"Recovered draft · newer server draft available":serverKey===keyOf(recovered.editor)?"Saved":"Recovered on device · syncing…");
        const pending=uiRef.current.pendingUpload;
        if(pending&&matching?.id===pending.sessionId){
          const uploaded=matching.assets.find(a=>!pending.before.includes(a.id)&&a.name===pending.name&&a.bytes===pending.size);
          if(uploaded){
            const selected=pending.snapshot&&["image","edit-image"].includes(editorRef.current.settings.mode)?[]:pending.selectedBefore;
            editorRef.current={...editorRef.current,settings:{...editorRef.current.settings,selectedSources:appendH3References(selected,[uploaded.id],matching.assets,editorRef.current.settings.mode)}};setEditor(editorRef.current);
            uiRef.current={...uiRef.current,pendingUpload:null};setUi(uiRef.current);void clearPersistedH3MediaFiles(`otg:h3:nsfw:upload:${ownerKey}`);
          }
        }
      }
      restored.current=true;persist();setLoaded(true);
    }).catch(e => { if (!stopped) setError(messageOf(e)); });
    return () => { stopped = true; alive.current = false; upload.current?.abort(); };
  }, [ownerKey,persist,load]);
  useEffect(() => {
    if (!loaded || !dirty || busy || conflict) return;
    const timer = window.setTimeout(() => void save().catch(e => { if (alive.current) { setSaveStatus("Not saved"); setError(messageOf(e)); } }), 650);
    return () => window.clearTimeout(timer);
  }, [editor, loaded, dirty, busy, conflict,save]);
  useEffect(() => {
    const flush=()=>persist();window.addEventListener("pagehide",flush);document.addEventListener("visibilitychange",flush);
    return ()=>{persist();window.removeEventListener("pagehide",flush);document.removeEventListener("visibilitychange",flush);};
  }, [persist]);
  const sessionId = session?.id;
  useEffect(() => {
    if (!sessionId) return;
    let stopped = false, polling = false;
    async function refresh() {
      if (polling) return; polling = true;
      try {
        const data = await api<{ jobs: LabJob[]; session: LabSession }>(`${root}?jobs=${sessionId}`);
        const current = sessionRef.current;
        if (!stopped && current && current.id === sessionId) {
          setJobs(data.jobs);
          if(pendingRequest.current&&data.jobs.some(j=>j.id===pendingRequest.current?.id)){pendingRequest.current=null;persist();}
          // A poll must not roll back an autosave revision.
          remember({ ...current, assets: data.session.assets });
        }
      } catch (e) { if (!stopped) setError(messageOf(e)); }
      finally { polling = false; }
    }
    const resume=()=>{if(document.visibilityState!=="hidden")void refresh();};
    void refresh(); const timer = window.setInterval(() => void refresh(), 3000);
    window.addEventListener("pageshow",resume);window.addEventListener("focus",resume);window.addEventListener("online",resume);document.addEventListener("visibilitychange",resume);
    return () => { stopped = true; window.clearInterval(timer);window.removeEventListener("pageshow",resume);window.removeEventListener("focus",resume);window.removeEventListener("online",resume);document.removeEventListener("visibilitychange",resume); };
  }, [sessionId, remember,persist]);
  useEffect(()=>{if(!activeJobs.length)return;const timer=window.setInterval(()=>setClock(Date.now()),1000);return()=>clearInterval(timer);},[activeJobs.length]);
  async function act(task: () => Promise<void>, propagateError = false) {
    if (acting.current) {
      if (propagateError) throw new Error("Wait for the current action to finish.");
      return;
    }
    acting.current = true; setBusy(true); setError("");
    try { await task(); } catch (e) { if (alive.current) setError(messageOf(e)); if (propagateError) throw e; }
    finally { acting.current = false; if (alive.current) setBusy(false); }
  }
  function replacePrompt(value: string) {
    const previous = editorRef.current.settings.prompt;
    setPromptUndo(current => [...current.slice(-19), previous]); patch({ prompt: value });
  }
  function selectInputs(next: string[]) { setInputUndo(editorRef.current.settings.selectedSources || []); patch({ selectedSources: next }); }
  async function enhance() {
    const original = editorRef.current.settings.prompt;
    const data = await api<{ enhancedPrompt?: string; prompt?: string }>("/api/enhance-prompt", {
      prompt: original, enhanceLevel: strength, contextType: settings.mode === "edit-image" ? "generate" : "video",
      mediaMode: settings.mode === "edit-image" ? "image" : "video", videoGenerationType: settings.mode,
      durationSeconds: settings.seconds, workflowLabel: "MiniMax H3",
    });
    const value = String(data.enhancedPrompt || data.prompt || "").trim();
    if (!value || value.length > 8000) throw new Error("Enhancement did not return a usable prompt. Your text is unchanged.");
    replacePrompt(value);
  }
  async function buildPrompt(){
    const current=await save(true);if(!current)return;
    const id=newClientRequestId();updateUi({builderId:id});
    try{await api(root+"/prompt",{sessionId:current.id,requestId:id});}catch(e){updateUi({builderId:""});throw e;}
  }
  useEffect(()=>{
    if(!loaded||!ui.builderId||busy)return;let stopped=false,polling=false;const id=ui.builderId;
    async function poll(){if(polling)return;polling=true;try{
      const data=await api<{status:string;prompt:string;error?:string}>(`${root}/prompt?id=${id}`);
      if(stopped)return;
      if(data.status==="completed"){updateUi({suggestion:data.prompt,builderId:""});}
      else if(data.status==="failed"){updateUi({builderId:""});setError(data.error||"Prompt Builder failed. Your text is unchanged.");}
    }catch(e){if(!stopped)setError(messageOf(e));}finally{polling=false;}}
    void poll();const timer=window.setInterval(()=>void poll(),3000);return()=>{stopped=true;clearInterval(timer);};
  },[loaded,ui.builderId,busy,updateUi]);
  async function askDirector(){
    const state=editorRef.current.settings,view=uiRef.current;
    const data=await api<{prompt:string;reply:string;conversationId:string}>("/api/openai-ai/h3-director",{message:view.directorDraft||"Improve this scene prompt while preserving the chosen controls.",conversationId:view.directorId,currentPrompt:state.prompt,mode:labH3Mode(state.mode),durationSeconds:state.seconds,quality:state.resolution,orientation:state.orientation,visualStyle:state.stylePresetId==="none"?state.visualStyle:state.stylePresetId,cameraFeel:state.cameraFeel,shotFlow:state.shotFlow,references:sources.map(a=>({kind:a.mime.split('/')[0],name:a.name})),loras:(state.loras||[]).map(s=>({...s,label:loras.find(l=>l.id===s.id)?.displayName,triggerWords:loras.find(l=>l.id===s.id)?.triggerWords}))});
    if(!data.prompt?.trim())throw new Error("No prompt returned. Your text is unchanged.");
    updateUi({suggestion:data.prompt,directorReply:data.reply||"Prompt ready to review.",directorId:data.conversationId});
  }
  async function attach(file: File, snapshot = false) {
    const mime=labUploadMime(file.name,file.type),isImage=mime.startsWith("image/");
    if (file.size > (isImage?MAX_LAB_IMAGE_BYTES:128 * 1024 ** 2)) throw new Error(isImage?"Choose an image under 512 MB; large resolutions are prepared automatically.":"Choose an audio/video file under 128 MB.");
    const current = await save(true);
    if (!current) return;
    const before = new Set(current.assets.map(a => a.id));
    const uploadKey=`otg:h3:nsfw:upload:${ownerKey}`,blobKey=mediaStorageKey(uploadKey,"pending");
    if(ownerKey){
      try{await writePersistedH3MediaFiles(uploadKey,[{key:blobKey,file}]);}catch{setError("Device storage could not retain this file. Keep the app open until upload finishes; server drafts are retained.");}
      updateUi({pendingUpload:{sessionId:current.id,name:file.name.slice(0,120).replace(/[\x00-\x1f\x7f/\\]/g,"_"),type:file.type,size:file.size,lastModified:file.lastModified,snapshot,before:[...before],selectedBefore:editorRef.current.settings.selectedSources||[],storageKey:blobKey}});
    }
    const params = new URLSearchParams({ session: current.id, name: file.name, role: "source" });
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest(); upload.current = xhr;
      xhr.open("POST", `${root}/assets?${params}`); xhr.setRequestHeader("Content-Type", mime); xhr.timeout = 240000;
      xhr.upload.onprogress = event => { if (alive.current) setProgress(event.lengthComputable ? Math.round(event.loaded / event.total * 100) : 0); };
      xhr.onload = () => {
        try {
          const body = JSON.parse(xhr.responseText);
          if (xhr.status < 200 || xhr.status >= 300) throw new Error(body.error || "Upload failed.");
          if (alive.current) {
            remember(body.session);
            const added = (body.session as LabSession).assets.filter(a => a.role === "source" && !before.has(a.id));
            // Single-image modes replace the selection, not the saved source.
            // Reference/edit-video modes append the frame beside other inputs.
            const previous = snapshot && ["image", "edit-image"].includes(editorRef.current.settings.mode) ? [] : editorRef.current.settings.selectedSources || [];
            selectInputs(appendH3References(previous,added.map(a=>a.id),body.session.assets,editorRef.current.settings.mode));
          }
          resolve();
        } catch (e) { reject(e); }
      };
      xhr.onerror = () => reject(new Error("Upload connection lost. Check Saved uploads before retrying."));
      xhr.ontimeout = () => reject(new Error("Upload timed out. Check Saved uploads before retrying."));
      xhr.onabort = () => reject(new Error("Upload canceled.")); setProgress(0); xhr.send(file);
    }).finally(() => { upload.current = null; if (alive.current) setProgress(null); });
    await save();
    updateUi({pendingUpload:null});if(ownerKey)await clearPersistedH3MediaFiles(uploadKey);
  }
  async function resumeUpload(){
    const pending=uiRef.current.pendingUpload;if(!pending)return;
    const files=await readPersistedH3MediaFiles([{...pending,id:"pending",kind:pending.type.split('/')[0] as "image"|"video"|"audio",description:"",storageKey:pending.storageKey}]);
    const file=files.get(pending.storageKey);if(!file)throw new Error("The interrupted file is no longer stored on this device. Choose it again; saved uploads are retained.");
    const data=await api<{session:LabSession}>(`${root}?jobs=${pending.sessionId}`);remember(data.session);
    const existing=data.session.assets.find(a=>!pending.before.includes(a.id)&&a.name===pending.name&&a.bytes===pending.size);
    if(existing){selectInputs(appendH3References(pending.selectedBefore,[existing.id],data.session.assets,editorRef.current.settings.mode));await save();updateUi({pendingUpload:null});await clearPersistedH3MediaFiles(`otg:h3:nsfw:upload:${ownerKey}`);return;}
    await attach(file,pending.snapshot);
  }
  async function generate() {
    // An uncertain POST is still the same intent. Allocate once BEFORE saving,
    // and retain the chosen seed + request ID until the response is accepted.
    const intentKey = () => JSON.stringify([sessionRef.current?.id, keyOf(editorRef.current)]);
    if (pendingRequest.current?.key !== intentKey()) {
      const id = newClientRequestId();
      if (!editorRef.current.settings.seedLocked) patch({ seed: newRandomSeed(editorRef.current.settings.seed) });
      pendingRequest.current = { key: intentKey(), id };
      persist();
    }
    const pending = pendingRequest.current;
    const current = await save(true);
    if (!current) return;
    pending.key = intentKey(); // A new draft now has its durable session ID.
    persist();
    const selected = current.settings.mode === "text" ? [] : current.settings.selectedSources || [];
    const data = await api<{ job: LabJob }>(root, { action: "generate", id: current.id, revision: current.revision, requestId: pending.id, sources: selected });
    setJobs(currentJobs => [data.job, ...currentJobs.filter(j => j.id !== data.job.id)]); pendingRequest.current = null;persist();
  }
  function tag(asset: LabAsset) {
    const kind = asset.mime.split("/")[0], index = sources.filter(a => a.mime.startsWith(kind + "/")).findIndex(a => a.id === asset.id) + 1;
    if (kind === "audio" && videoCount) return "Audio reference";
    return `${kind === "image" ? "Picture" : kind === "video" ? "Video" : "Audio"} ${index}`;
  }

  return <section aria-label="H3 NSFW workspace" className="mx-auto w-full max-w-4xl space-y-4 pb-8">
    <header className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-xl font-semibold">H3 NSFW</h2><span className="text-xs text-white/60">{saveStatus || "Private workspace"}</span></header>
    {conflict&&<div role="alert" className="space-y-2 rounded-xl border border-amber-400/40 p-3 text-sm"><p>A newer server draft exists. Your recovered edits are kept here.</p><div className="flex flex-wrap gap-2"><button className={button} disabled={busy} onClick={()=>{setConflict(false);void act(async()=>{await save(true);});}}>Use recovered draft</button><button className={button} disabled={busy} onClick={()=>load(sessionRef.current)}>Use server draft</button></div></div>}
    {error && <div role="alert" className="rounded-xl border border-red-400/40 bg-red-950/30 p-3 text-sm"><p>{error}</p><button className={`${button} mt-2`} disabled={busy} onClick={() => void act(async () => { if (!loaded) window.location.reload(); else if(uiRef.current.pendingUpload)await resumeUpload();else await save(); })}>{ui.pendingUpload?"Retry upload":"Retry save"}</button></div>}
    {!loaded ? <p role="status">Loading workspace…</p> : <>
      {retired && <p role="status" className="rounded-xl border border-amber-400/30 p-3 text-sm">{labExperiment(editor.experiment)?.title} was removed. Choose another model to generate. Your prompt, references and past results are kept.</p>}
      <fieldset disabled={busy} className="grid grid-cols-2 gap-2 sm:grid-cols-5" aria-label="Generation mode">{modes.map(([mode, label]) => <button type="button" key={mode} className={`${button} ${settings.mode === mode ? "bg-violet-600/50 border-violet-400/60" : "bg-black/20"}`} aria-pressed={settings.mode === mode} disabled={!capability?.modes.includes(mode)} onClick={() => patch({ mode })}>{label}</button>)}</fieldset>
      <div className={card}>
        <label htmlFor="private-h3-prompt" className="block font-semibold">Your scene</label>
        <textarea id="private-h3-prompt" className={`${input} min-h-40 resize-y`} maxLength={8000} placeholder="Describe the scene you want to create…" value={settings.prompt} disabled={busy} onFocus={event => { const previous = event.target.value; setPromptUndo(current => current.at(-1) === previous ? current : [...current.slice(-19), previous]); }} onChange={e => patch({ prompt: e.target.value })} />
        <div className="flex flex-wrap gap-2">
          <button className={button} disabled={busy || !settings.prompt} onClick={() => replacePrompt("")}>Clear text</button>
          <button className={button} disabled={busy || !promptUndo.length} onClick={() => { patch({ prompt: promptUndo.at(-1)! }); setPromptUndo(current => current.slice(0, -1)); }}>Undo text</button>
          <button className={`${button} bg-violet-600/50`} disabled={busy || !settings.prompt.trim()} onClick={() => void act(enhance)}>Enhance</button>
          <select aria-label="Enhancement length" className="min-h-11 min-w-0 rounded-xl border border-white/15 bg-black/25 px-2 text-sm" value={strength} disabled={busy} onChange={e => setStrength(e.target.value as typeof strength)}><option value="short">Short</option><option value="medium">Medium</option><option value="long">Long</option></select>
        </div>
      </div>
      <H3NsfwPromptTools settings={settings} model={editor.experiment} ui={ui} disabled={busy||conflict} loras={loras} onPatch={patch} onUi={updateUi} onPrompt={replacePrompt} onBuild={()=>void act(buildPrompt)} onDirector={()=>void act(askDirector)}/>
      {ui.pendingUpload&&!busy&&<div role="status" className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-400/30 p-3 text-sm"><span className="min-w-0 flex-1 truncate">Interrupted upload · {ui.pendingUpload.name}</span><button className={button} onClick={()=>void act(resumeUpload)}>Resume upload</button><button className={button} onClick={()=>void act(async()=>{updateUi({pendingUpload:null});await clearPersistedH3MediaFiles(`otg:h3:nsfw:upload:${ownerKey}`);})}>Discard upload</button></div>}
      {(settings.mode !== "text" || ids.length > 0) && <div className={card}>
        <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">References {sources.length ? `· ${sources.length}` : ""}</h3><div className="flex gap-2"><button className={button} disabled={busy || !ids.length} onClick={() => selectInputs([])}>Clear inputs</button><button className={button} disabled={busy || !inputUndo} onClick={() => { patch({ selectedSources: inputUndo || [] }); setInputUndo(null); }}>Undo removal</button></div></div>
        {settings.mode === "text" ? <p className="text-sm text-amber-200">Text mode does not use these references.</p> : <>
          <div className="flex flex-wrap gap-2">{["image", "video", "audio"].filter(kind => kind === "image" || (kind === "video" && ["reference", "edit"].includes(settings.mode)) || (kind === "audio" && settings.mode === "reference")).map(kind => <button key={kind} className={button} disabled={busy} onClick={() => { setUploadType(kind + "/*"); if (fileInput.current) { fileInput.current.accept = kind + "/*"; fileInput.current.click(); } }}>+ {kind[0].toUpperCase() + kind.slice(1)}</button>)}<button className={button} disabled={busy} onClick={() => setSnapshotOpen(true)}>Snapshot</button></div>
          {inputProblem && <p className="text-sm text-white/60">{inputProblem}</p>}
        </>}
        <input ref={fileInput} type="file" accept={uploadType} className="hidden" aria-label="Add reference file" disabled={busy} onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void act(() => attach(file)); }} />
        {progress !== null && <div role="status" className="flex items-center gap-2 text-sm"><progress className="min-w-0 flex-1" value={progress} max={100} aria-label="Upload progress" /><span>{progress===100?"Preparing…":`${progress}%`}</span><button className={button} onClick={() => upload.current?.abort()}>Cancel upload</button></div>}
        <div className="grid gap-3 sm:grid-cols-2">{sources.map((asset, index) => <article key={asset.id} aria-label={`Reference ${asset.name}`} className="min-w-0 space-y-2 rounded-xl border border-white/10 p-2">
          <Media asset={asset} small /><div className="flex items-center justify-between gap-2"><span className="text-sm font-medium">{tag(asset)}</span><button className={button} disabled={busy} aria-label={`Remove ${asset.name}`} onClick={() => selectInputs(ids.filter(id => id !== asset.id))}>Remove</button></div>
          <p className="truncate text-xs text-white/60" title={asset.name}>{asset.name}</p>
          {sources.length > 1 && <div className="flex gap-2"><button className={button} aria-label={`Move ${asset.name} earlier`} disabled={busy || index === 0} onClick={() => { const next = [...ids]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; selectInputs(next); }}>↑ Earlier</button><button className={button} aria-label={`Move ${asset.name} later`} disabled={busy || index === ids.length - 1} onClick={() => { const next = [...ids]; [next[index + 1], next[index]] = [next[index], next[index + 1]]; selectInputs(next); }}>↓ Later</button></div>}
        </article>)}</div>
        {unused.length > 0 && <details><summary className="min-h-11 cursor-pointer py-2 text-sm">Saved uploads · {unused.length}</summary><p className="mb-2 text-xs text-white/60">Kept for reuse, not deleted. Remove a selected reference to make room in this render.</p>{unused.slice(0,savedUploadLimit).map(a => <div className="flex min-w-0 items-center gap-2 py-1" key={a.id}><span className="min-w-0 flex-1 truncate text-sm">{a.name}</span><button className={button} disabled={busy||!appendH3References(ids,[a.id],assets,settings.mode).includes(a.id)} aria-label={`Add back ${a.name}`} onClick={() => selectInputs(appendH3References(ids,[a.id],assets,settings.mode))}>Add back</button></div>)}{unused.length>savedUploadLimit&&<button className={button} onClick={()=>setSavedUploadLimit(n=>n+20)}>Show more saved uploads</button>}</details>}
      </div>}
      <div className={card}>
        <h3 className="font-semibold">Output</h3>
        <fieldset disabled={busy} className="grid grid-cols-3 gap-2"><legend className="mb-2 text-sm text-white/70">Resolution</legend>{(["0.2", "0.6", "1"] as const).map(value => <button className={`${button} ${settings.resolution === value ? "bg-violet-600/50" : ""}`} aria-pressed={settings.resolution === value} key={value} onClick={() => patch({ resolution: value })}>{value === "1" ? "1.0" : value} MP</button>)}</fieldset>
        {settings.mode !== "edit-image" && <label className="block text-sm">Duration · {settings.seconds} seconds<input aria-label="Duration in seconds" className="mt-2 block min-h-11 w-full accent-violet-500" type="range" min={2} max={15} step={1} value={settings.seconds} disabled={busy} onChange={e => patch({ seconds: Number(e.target.value) })} /></label>}
        <fieldset disabled={busy} className="grid grid-cols-2 gap-2" aria-label="Orientation">{(["landscape", "portrait"] as const).map(value => <button className={`${button} ${settings.orientation === value ? "bg-violet-600/50" : ""}`} key={value} aria-pressed={settings.orientation === value} onClick={() => patch({ orientation: value })}>{value === "portrait" ? "Portrait" : "Landscape"}</button>)}</fieldset>
        <fieldset disabled={busy} className="grid grid-cols-2 gap-2"><legend className="mb-2 text-sm text-white/70">Model</legend>{catalog.map(model => <button className={`${button} ${editor.experiment === model.id ? "bg-violet-600/50 border-violet-400/60" : ""}`} key={model.id} aria-pressed={editor.experiment === model.id} onClick={() => change({ experiment: model.id, settings: { ...editorRef.current.settings, recipe: "author" } })}>{model.title}</button>)}</fieldset>
        <fieldset className="grid grid-cols-2 gap-2" aria-label="Render"><legend className="mb-2 text-sm text-white/70">Render</legend>{[8, 20].map(steps => <button className={`${button} ${recipe?.steps === steps ? "bg-violet-600/50" : ""}`} key={steps} disabled={busy || recipe?.steps !== steps} aria-pressed={recipe?.steps === steps} title={recipe?.steps !== steps ? "Not available for this model" : "Verified model recipe"} onClick={() => patch({ recipe: "author" })}>{steps === 8 ? "Turbo" : "Native"}</button>)}</fieldset>
        <p className="text-xs text-white/60">{available ? "RTX 3090" : "This mode is currently unavailable"} · {dimensions.width} × {dimensions.height}{settings.mode !== "edit-image" ? ` · ${settings.seconds}s` : ""}</p>
        {(settings.seconds > 5 || settings.resolution !== "0.2") && settings.mode !== "edit-image" && <p className="text-xs text-amber-200">Larger or longer renders are experimental.</p>}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="text-white/70" aria-live="polite">{settings.seedLocked ? "Same seed each time" : "Random seed each time"}</span>
        <label className="flex min-h-11 cursor-pointer items-center gap-2 px-2"><input type="checkbox" className="h-5 w-5 accent-violet-500" checked={!!settings.seedLocked} disabled={busy} onChange={e => patch({ seedLocked: e.target.checked })} />Lock seed</label>
      </div>
      <details className={card}><summary className="cursor-pointer font-medium">Advanced settings & help</summary>
        <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">GPU<select className={`${input} mt-1`} value={settings.gpu} disabled={busy} onChange={e => patch({ gpu: e.target.value as LabSettings["gpu"] })}><option value="auto">Auto · available GPUs</option><option value="rtx3090">RTX 3090</option><option value="rtx5060ti" disabled>RTX 5060 Ti · not qualified</option></select></label><label className="text-sm">Seed<input type="number" min={0} max={Number.MAX_SAFE_INTEGER} step={1} className={`${input} mt-1`} value={settings.seed} disabled={busy || !settings.seedLocked} onChange={e => patch({ seed: Number(e.target.value) })} /></label></div>
        <p className="text-sm text-white/65">Lock seed to reuse or enter a number for comparisons. Job receipts retain each generated seed. Mention &lt;Picture 1&gt; or &lt;Video 1&gt; in your prompt to identify references. Reordering changes their numbers. Edit video regenerates the scene; it does not preserve every original pixel.</p>
        <p className="text-sm text-white/65">{capability?.reason} {recipe?.note} {recipe && `${recipe.steps} steps · ${recipe.sampler} · ${recipe.attention}.`} The available render recipe is selected automatically for each model.</p>
        <p className="text-xs text-white/50">No saved-upload or result count limit; available disk space applies. Large images: up to 512 MB. Audio/video: 128 MB. Per-render reference limits still apply. Originals stay private. Clear inputs does not delete files.</p>
      </details>
      {loraProblem&&<p role="alert" className="text-sm text-amber-200">Remove the unavailable LoRA or choose its qualified model.</p>}
      <div className="flex flex-wrap gap-2"><button className={`${button} min-w-0 flex-1 bg-violet-600 text-base font-semibold`} disabled={busy || conflict || loraProblem || !available || !settings.prompt.trim() || !!inputProblem || activeJobs.length >= 4} onClick={() => void act(generate)}>{busy ? (progress !== null ? "Uploading…" : "Working…") : settings.mode === "edit-image" ? "Create image" : "Create video"}</button><button className={button} disabled={busy||conflict} onClick={()=>void act(async()=>{change(fresh("prism-pika"));updateUi({...DEFAULT_NSFW_UI,dismissedJob:uiRef.current.dismissedJob});pendingRequest.current=null;persist();await save(true);})}>Reset options</button></div>
      {latest && ui.dismissedJob!==latest.id && <div className={card} aria-label="Latest result"><h3 className="font-semibold">{latest.state === "completed" ? "Ready" : latest.state === "failed" ? "Generation failed" : latest.state === "canceled" ? "Canceled" : latest.state==="queued"?"Queued":"Generating…"}</h3><p role="status" className="text-sm text-white/70">{latest.stage}</p>
        <progress className="block h-3 w-full accent-violet-500" aria-label="Generation progress" max={100} value={latest.state==="completed"?100:latest.state==="queued"?0:latest.progressPercent}/>
        <div className="flex flex-wrap justify-between gap-2 text-sm text-white/65"><span>{latest.state==="queued"?`Waiting · ${formatTime(clock/1000-latest.created)}`:latest.started?`Elapsed · ${formatTime((latest.completed||clock/1000)-latest.started)}`:latest.totalSeconds!==undefined?`Generation time · ${formatTime(latest.totalSeconds)}`:"Preparing…"}</span><span>{latest.state==="completed"?"100%":latest.estimatedRemainingSeconds!==undefined?`About ${formatTime(latest.estimatedRemainingSeconds)} left`:latest.progress?.samplingRemainingSeconds!==undefined&&latest.progress.step<latest.progress.total?`Sampling · about ${formatTime(latest.progress.samplingRemainingSeconds)} left`:latest.state==="running"?"Time left · estimating…":""}</span></div>
        {!result&&!!latest.previewVersion&&<div className="space-y-1"><p className="text-xs text-white/60">Live preview · approximate, silent</p><video key={latest.previewVersion} src={`${root}/preview?jobId=${latest.id}&v=${latest.previewVersion}`} className="max-h-96 w-full rounded-xl bg-black" aria-label="Live generation preview" muted autoPlay loop playsInline controls preload="auto"/></div>}
        {result && <><Media asset={result} /><div className="flex flex-wrap gap-2"><a className={`${button} inline-flex items-center`} href={`${mediaUrl(result.id)}&download=1`}>Download {result.mime.startsWith("image/") ? "image" : "video"}</a><button className={button} disabled={busy} onClick={()=>updateUi({dismissedJob:latest.id})}>Clear {result.mime.startsWith("image/")?"image":"video"}</button></div></>}
      </div>}
      {activeJobs.map(job => <div className="flex items-center justify-between gap-2 rounded-xl border border-white/10 p-3" key={job.id}><span className="min-w-0 text-sm">{job.model} · {job.stage}</span><button className={button} disabled={busy} onClick={() => void act(async () => { await api(root, { action: "cancel", jobId: job.id }); })}>Cancel job</button></div>)}
      <details className={card}><summary className="cursor-pointer font-medium">History & saved drafts</summary>
        <div className="flex flex-wrap gap-2"><button className={button} disabled={busy} onClick={() => void act(async () => { await save(); load(null); })}>New draft</button><button className={button} disabled={busy || !dirty} onClick={() => void act(async () => { await save(); })}>Save draft</button></div>
        <label className="block text-sm">Saved draft<select aria-label="Saved draft" className={`${input} mt-1`} value={session?.id || ""} disabled={busy} onChange={event => { const id = event.target.value; void act(async () => { await save(); const data = await api<{ sessions: LabSession[] }>(root); setSessions(data.sessions); load(data.sessions.find(s => s.id === id) || null); }); }}><option value="">New draft</option>{sessions.filter(s => !s.archived).map(s => <option key={s.id} value={s.id}>{s.title} · {new Date(s.updated).toLocaleString()}</option>)}</select></label>
        {jobs.slice(0,historyLimit).map(job => <details key={job.id} className="border-t border-white/10 py-2"><summary className="cursor-pointer py-2 text-sm">{job.model} · {job.state} · {new Date(job.created * 1000).toLocaleString()}</summary>{assets.find(a => a.id === job.output) && <Media asset={assets.find(a => a.id === job.output)!} />}<a className="my-2 inline-block text-sm text-cyan-300 underline" href={`${root}?receipt=${job.id}`}>Technical receipt</a>{job.output && <a className="ml-3 text-sm text-cyan-300 underline" href={`${mediaUrl(job.output)}&download=1`}>Download result</a>}</details>)}
        {jobs.length>historyLimit&&<button className={button} onClick={()=>setHistoryLimit(n=>n+20)}>Show older results</button>}
      </details>
      {snapshotOpen && createPortal(<fieldset disabled={busy} className="contents">
        <VideoSnapshotPicker open={snapshotOpen} onClose={() => { if (!acting.current) setSnapshotOpen(false); }} onSnapshot={({ file }) => act(() => attach(file, true), true)} />
      </fieldset>, document.body)}
    </>}
  </section>;
}
