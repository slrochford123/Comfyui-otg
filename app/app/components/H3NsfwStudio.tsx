"use client";
import React from "react";
import H3EnhanceButtons from "./H3EnhanceButtons";
import H3ClipLengthControl from "./H3ClipLengthControl";
import {labFinalPrompt} from "@/lib/experiments/creative";
import H3WorkspaceTabs from "./H3WorkspaceTabs";
import H3CompletedMediaActions from "./H3CompletedMediaActions";
import H3ChooseCharacter from "./H3ChooseCharacter";
import H3MediaGalleryPicker from "./H3MediaGalleryPicker";
import NativeImagePanel from "./NativeImagePanel";
import {nsfwImageAdapter} from "@/lib/client/nsfwImages";
import type {H3CardReference} from "@/lib/h3CardReferences";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { canvas, DEFAULT_LAB_SETTINGS, isRetiredExperiment, labExperiment, type Experiment, type LabSettings } from "@/lib/experiments/catalog";
import type { LabAsset, LabSession } from "@/lib/experiments/store";
import type { LabCapability, LabJob, LabLora } from "@/lib/experiments/generation";
import { newClientRequestId } from "@/lib/client/requestId";
import { newRandomSeed } from "@/lib/client/randomSeed";
import VideoSnapshotPicker from "./VideoSnapshotPicker";
import SpeechInputButton from "./SpeechInputButton";
import H3NsfwPromptTools from "./H3NsfwPromptTools";
import { DEFAULT_LAB_CREATIVE } from "@/lib/experiments/creative";
import { DEFAULT_NSFW_UI, readNsfwDraft, writeNsfwDraft, nsfwEditorKey, nsfwDirectionKey, type NsfwUiState } from "@/lib/client/h3NsfwDraft";
import { mediaStorageKey,writePersistedH3MediaFiles,readPersistedH3MediaFiles,clearPersistedH3MediaFiles } from "./h3InputPersistence";
import {labUploadMime,MAX_LAB_IMAGE_BYTES} from "@/lib/experiments/imageTypes";
import {appendH3References,MAX_H3_RENDER_REFERENCES} from "@/lib/experiments/referenceLimits";
import H3SavedUploads from "./H3SavedUploads";

const root = "/api/h3/nsfw";
const button = "min-h-11 rounded-xl border border-white/15 px-3 py-2 text-sm font-medium disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-400";
const input = "w-full min-w-0 rounded-xl border border-white/15 bg-black/25 p-3 text-base";
const card = "min-w-0 space-y-3 rounded-2xl border border-white/10 bg-black/15 p-4";
const modes = [["text", "Text"], ["image", "Image"], ["reference", "Reference"], ["edit", "Edit Video"]] as const;
type Editor = { experiment: string; settings: LabSettings };
const fresh = (experiment: string): Editor => ({ experiment, settings: { ...DEFAULT_LAB_SETTINGS, ...DEFAULT_LAB_CREATIVE, mode: "text", selectedSources: [], seedLocked: false, loras:[] } });
const keyOf = nsfwEditorKey;
const fromSession = (s: LabSession): Editor => ({ experiment: s.experiment, settings: { ...s.settings, mode: s.settings.mode === "edit-image" ? "text" : s.settings.mode, seedLocked: s.settings.seedLocked ?? false, selectedSources: s.settings.selectedSources ?? appendH3References([],s.assets.filter(a => a.role === "source").map(a => a.id),s.assets,s.settings.mode) } });
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

export default function H3NsfwStudio({ownerKey="", testVideoFinishing=false}:{ownerKey?:string; testVideoFinishing?:boolean}) {
  const [catalog, setCatalog] = useState<Experiment[]>([]), [capabilities, setCapabilities] = useState<LabCapability[]>([]);
  const [sessions, setSessions] = useState<LabSession[]>([]), [session, setSession] = useState<LabSession | null>(null);
  const [editor, setEditor] = useState<Editor>(() => fresh("eros-beta7"));
  const editorRef = useRef(editor), sessionRef = useRef(session), savedKey = useRef(keyOf(editor));
  const [savedSignature, setSavedSignature] = useState(() => keyOf(editor));
  const saveChain = useRef<Promise<unknown>>(Promise.resolve()), alive = useRef(true), acting = useRef(false);
  const pendingRequest = useRef<{ key: string; id: string } | null>(null), upload = useRef<XMLHttpRequest | null>(null);
  const [loaded, setLoaded] = useState(false), [busy, setBusy] = useState(false), [saveStatus, setSaveStatus] = useState(""), [error, setError] = useState("");
  const [failedPromptAction,setFailedPromptAction]=useState<{action:"enhance";level:NsfwUiState["strength"]}|{action:"direct"}|null>(null);
  const [jobs, setJobs] = useState<LabJob[]>([]), [progress, setProgress] = useState<number | null>(null);
  const [micStatus,setMicStatus]=useState("");
  const [ui,setUi]=useState<NsfwUiState>(DEFAULT_NSFW_UI),uiRef=useRef(ui),restored=useRef(false);
  const {promptUndo,inputUndo,strength}=ui;
  const [loras,setLoras]=useState<LabLora[]>([]),[conflict,setConflict]=useState(false),[clock,setClock]=useState(()=>Date.now());
  const [uploadType, setUploadType] = useState("image/*"), fileInput = useRef<HTMLInputElement>(null);
  const [snapshotOpen, setSnapshotOpen] = useState(false);
  const [snapshotUrl,setSnapshotUrl]=useState<string>();
  const [snapshotReplace,setSnapshotReplace]=useState<string>();
  const [chooseCharacter,setChooseCharacter]=useState(false);
  const [galleryKind,setGalleryKind]=useState<"image"|"video">();
  const [imageCreate,setImageCreate]=useState(false);
  const [historyLimit,setHistoryLimit]=useState(20);
  const settings = editor.settings, ids = settings.selectedSources || [];
  const capability = capabilities.find(c => c.model === editor.experiment), recipe = capability?.recipe;
  const stillAdapter=useMemo(()=>nsfwImageAdapter(editor.experiment,catalog.find(m=>m.id===editor.experiment)?.title||editor.experiment,!!capability?.modes.includes("text-image")),[editor.experiment,catalog,capability]);
  const assets = session?.assets || [], sources = ids.map(id => assets.find(a => a.id === id)).filter((a): a is LabAsset => !!a);
  const unused = assets.filter(a => a.role === "source" && !a.removedFromSaved && !ids.includes(a.id));
  const dirty = keyOf(editor) !== savedSignature;
  const latest = jobs[0], result = assets.find(a => a.id === latest?.output);
  const activeJobs = jobs.filter(j => !["completed", "failed", "canceled"].includes(j.state) || !j.cleanedUp);
  const dimensions = canvas(settings);
  const formatTime=(seconds:number)=>`${Math.floor(Math.max(0,seconds)/60)}m ${Math.floor(Math.max(0,seconds)%60)}s`;
  const imageCount = sources.filter(a => a.mime.startsWith("image/")).length;
  const videoCount = sources.filter(a => a.mime.startsWith("video/")).length;
  const audioCount = sources.filter(a => a.mime.startsWith("audio/")).length;
  const inputProblem = settings.mode!=="text"&&audioCount>0&&settings.experimentalAudioReferences!==true ? "Remove the selected audio or enable Advanced imported audio references." : settings.mode === "text" ? ""
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
  function rememberPrompt() {
    const {prompt,directedPrompt} = editorRef.current.settings;
    const previous = uiRef.current.promptUndo.at(-1);
    if (typeof previous === "string" ? previous === prompt && !directedPrompt : previous?.prompt === prompt && directedPrompt) return;
    updateUi({promptUndo:[...uiRef.current.promptUndo.slice(-19),directedPrompt ? {prompt,directedPrompt:true} : prompt]});
  }
  function setInputUndo(value:string[]|null){updateUi({inputUndo:value});}
  function setStrength(value:NsfwUiState["strength"]){updateUi({strength:value});}

  const remember = useCallback((next: LabSession) => {
    if (sessionRef.current?.id === next.id) {
      const hidden=new Set(sessionRef.current.assets.filter(a=>a.removedFromSaved).map(a=>a.id));
      next = { ...next, assets: [...next.assets.map(a=>hidden.has(a.id)?{...a,removedFromSaved:true}:a), ...sessionRef.current.assets.filter(a => !next.assets.some(n => n.id === a.id))] };
    }
    sessionRef.current = next;
    if (alive.current) { setSession(next); setSessions(current => [next, ...current.filter(s => s.id !== next.id)]); }
    persist();
  }, [persist]);
  const change = useCallback((next: Editor) => { editorRef.current = next; setEditor(next); setSaveStatus(keyOf(next) === savedKey.current ? (sessionRef.current ? "Saved" : "") : "Saved on device · syncing…");persist(); },[persist]);
  const patch = useCallback((update: Partial<LabSettings>) => {
    const current = editorRef.current;
    const settings = {...current.settings,...update};
    const directionChanged = (["prompt","mode","seconds","stylePresetId","visualStyle","cameraFeel","shotFlow","orientation","selectedSources"] as const)
      .some(key => update[key] !== undefined && update[key] !== current.settings[key]);
    if (update.directedPrompt === false || (directionChanged && update.directedPrompt === undefined)) delete settings.directedPrompt;
    change({...current,settings});
  },[change]);
  const load=useCallback((next: LabSession | null, model = editorRef.current.experiment)=> {
    const value = next ? fromSession(next) : fresh(model);
    setImageCreate(value.settings.mode==="text-image");
    sessionRef.current = next; editorRef.current = value; savedKey.current = keyOf(value);
    setSavedSignature(keyOf(value));
    setSession(next); setEditor(value); setJobs([]); setHistoryLimit(20);setError("");setMicStatus(""); setSaveStatus(next ? "Saved" : ""); pendingRequest.current = null;
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
      load(matching||data.sessions.find(s => !s.archived) || null, data.catalog[0]?.id || "eros-beta7");
      if(recovered && (matching||!recovered.sessionId) && (data.catalog.some(c=>c.id===recovered.editor.experiment)||isRetiredExperiment(recovered.editor.experiment))){
        editorRef.current=recovered.editor;setEditor(recovered.editor);setImageCreate(recovered.editor.settings.mode==="text-image");uiRef.current={...DEFAULT_NSFW_UI,...recovered.ui};setUi(uiRef.current);pendingRequest.current=recovered.pending;
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
    acting.current = true; setBusy(true); setError(""); setFailedPromptAction(null);
    try { await task(); } catch (e) { if (alive.current) setError(messageOf(e)); if (propagateError) throw e; }
    finally { acting.current = false; if (alive.current) setBusy(false); }
  }
  const replacePrompt = useCallback((value: string, directedPrompt = false) => {
    const previous = editorRef.current.settings;
    if (value !== previous.prompt || directedPrompt !== Boolean(previous.directedPrompt)) {
      const entry = previous.directedPrompt ? {prompt:previous.prompt,directedPrompt:true as const} : previous.prompt;
      updateUi({promptUndo:[...uiRef.current.promptUndo.slice(-19),entry]});
      patch({prompt:value,directedPrompt});
    }
  },[patch,updateUi]);
  function undoPrompt() {
    const previous = uiRef.current.promptUndo.at(-1);
    if (previous === undefined) return;
    patch(typeof previous === "string" ? {prompt:previous,directedPrompt:false} : previous);
    updateUi({promptUndo:uiRef.current.promptUndo.slice(0,-1)});
  }
  function applyDirectedPrompt(prompt: string) {
    const {suggestionKey} = uiRef.current;
    if (suggestionKey && suggestionKey !== nsfwDirectionKey(editorRef.current)) {
      setError("The scene or its controls changed. Direct the current scene again.");
      return false;
    }
    replacePrompt(prompt,Boolean(suggestionKey));
    return true;
  }
  function selectInputs(next: string[]) { setInputUndo(editorRef.current.settings.selectedSources || []); patch({ selectedSources: next }); }
  async function removeUpload(id:string) {
    const response=await fetch(mediaUrl(id),{method:"DELETE",credentials:"same-origin"});
    const data=await response.json();
    if(!response.ok)throw new Error(data.error||"Could not remove this saved upload.");
    if(sessionRef.current?.id===data.session.id)remember({...sessionRef.current!,assets:data.session.assets});
  }
  useEffect(()=>{
    if(!session?.id)return;let stopped=false;
    // Migrate a cached copy of an old embedded plan, keeping independent edits.
    api<{plans:{prompt:string}[]}>(`${root}/prompt?sessionId=${session.id}`).then(data=>{
      if(!stopped&&uiRef.current.suggestion&&data.plans?.some(plan=>plan.prompt===uiRef.current.suggestion))updateUi({suggestion:"",suggestionKey:undefined});
    }).catch(()=>{});
    return()=>{stopped=true;};
  },[session?.id,updateUi]);
  async function enhance(level: NsfwUiState["strength"]) {
    setStrength(level);
    await requestPrompt({action:"enhance",level});
  }
  async function requestPrompt(operation: {action:"enhance";level:NsfwUiState["strength"]} | {action:"direct"}) {
    const current=await save(true);if(!current)return;
    const id=newClientRequestId();
    updateUi({builderId:id,builderKey:nsfwDirectionKey(fromSession(current))});
    try { await api(root+"/prompt",{sessionId:current.id,revision:current.revision,requestId:id,...operation}); }
    catch(error) { updateUi({builderId:"",builderKey:undefined});setFailedPromptAction(operation);throw error; }
  }
  useEffect(()=>{
    if(!loaded||!ui.builderId||busy)return;let stopped=false,polling=false;const id=ui.builderId;
    async function poll(){if(polling)return;polling=true;try{
      const data=await api<import("@/lib/experiments/nsfwDirector").NsfwDirectorResult>(`${root}/prompt?id=${id}`);
      if(stopped||uiRef.current.builderId!==id||data.sessionId&&data.sessionId!==sessionRef.current?.id)return;
      if(data.status==="completed"){
        setError("");setFailedPromptAction(null);
        const changed = uiRef.current.builderKey && uiRef.current.builderKey!==nsfwDirectionKey(editorRef.current);
        const finished={builderId:"",builderKey:undefined};
        if(data.kind==="plan"&&data.plan){updateUi({...finished,suggestion:"",suggestionKey:undefined});}
        else if(data.kind==="enhance"){
          updateUi(finished);
          if(editorRef.current.settings.prompt.trim()===data.originalPrompt&&data.prompt)replacePrompt(data.prompt);
          else setError("The scene draft changed while enhancing. Your newer text was kept.");
        } else if(changed){
          updateUi(finished);
          setError("The scene or its controls changed while directing. Direct the current scene again.");
        } else updateUi({...finished,suggestion:data.prompt,suggestionKey:data.directedPrompt ? nsfwDirectionKey(editorRef.current) : undefined,directorReply:data.reply});
      }
      else if(["failed","canceled","needs_attention"].includes(data.status)){updateUi({builderId:"",builderKey:undefined});setFailedPromptAction(data.kind==="enhance"?{action:"enhance",level:uiRef.current.strength}:{action:"direct"});setError(data.error||"Prompt request failed. Your text is unchanged.");}
    }catch(e){if(!stopped)setError(messageOf(e));}finally{polling=false;}}
    void poll();const timer=window.setInterval(()=>void poll(),3000);return()=>{stopped=true;clearInterval(timer);};
  },[loaded,ui.builderId,busy,replacePrompt,updateUi]);
  async function attach(file: File, snapshot = false) {
    const mime=labUploadMime(file.name,file.type),isImage=mime.startsWith("image/");
    if (file.size > (isImage?MAX_LAB_IMAGE_BYTES:128 * 1024 ** 2)) throw new Error(isImage?"Choose an image under 512 MB; large resolutions are prepared automatically.":"Choose an audio/video file under 128 MB.");
    const current = await save(true);
    if (!current) return;
    const before = new Set(current.assets.map(a => a.id));
    let addedAssets:LabAsset[]=[];
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
            addedAssets=added;
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
    return addedAssets;
  }
  async function attachBatch(files: File[]) {
    const state = editorRef.current.settings;
    const selected = (state.selectedSources || []).map(id => sessionRef.current?.assets.find(a => a.id === id)).filter(Boolean);
    const replacing = ["image", "edit-image"].includes(state.mode);
    if (files.length > (replacing ? 1 : MAX_H3_RENDER_REFERENCES - selected.length)) throw new Error("Too many references for this render. Nothing was discarded.");
    for (const kind of ["image","video","audio"]) {
      const added=files.filter(file=>labUploadMime(file.name,file.type).startsWith(kind+"/"));
      const maximum=kind==="image"?(replacing?1:9):kind==="video"?(state.mode==="edit"?1:3):(state.mode==="edit"?0:3);
      const remaining=maximum-(replacing?0:selected.filter(a=>a?.mime.startsWith(kind+"/")).length);
      if(added.length>remaining)throw new Error(`Choose at most ${remaining} more ${kind} files. Nothing was discarded.`);
      if(added.some(file=>file.size>(kind==="image"?MAX_LAB_IMAGE_BYTES:128*1024**2)))throw new Error("A selected file exceeds the upload size limit. Nothing was added.");
    }
    for (const file of files) await attach(file);
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
  async function restoreTake(id:string){
    const receipt=await api<{graph?:Record<string,{class_type:string;inputs:Record<string,unknown>}>;request:{model:string;settings:LabSettings;sources:{assetId:string;kind?:string}[]}}>(`${root}?receipt=${id}`);
    const imported=receipt.request.settings.experimentalAudioReferences??Boolean(receipt.request.sources.some(s=>s.kind==="audio")||Object.values(receipt.graph||{}).some(n=>Object.keys(n.inputs||{}).some(k=>k.startsWith("ref_video_audios."))));
    change({experiment:receipt.request.model,settings:{...receipt.request.settings,experimentalAudioReferences:imported,directedPrompt:true,selectedSources:receipt.request.sources.map(s=>s.assetId)}});
    await save(true);setError("Previous take settings restored. Review the compiled prompt, then press Create video when ready.");
  }
  function tag(asset: LabAsset) {
    const kind = asset.mime.split("/")[0], index = sources.filter(a => a.mime.startsWith(kind + "/")).findIndex(a => a.id === asset.id) + 1;
    if (kind === "audio" && videoCount) return "Audio reference";
    return `${kind === "image" ? "Picture" : kind === "video" ? "Video" : "Audio"} ${index}`;
  }

  return <section aria-label="H3 NSFW workspace" className="mx-auto w-full max-w-4xl space-y-4 pb-8">
    <header className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-xl font-semibold">H3 NSFW</h2><span className="text-xs text-white/60">{saveStatus || "Private workspace"}</span></header>
    {conflict&&<div role="alert" className="space-y-2 rounded-xl border border-amber-400/40 p-3 text-sm"><p>A newer server draft exists. Your recovered edits are kept here.</p><div className="flex flex-wrap gap-2"><button className={button} disabled={busy} onClick={()=>{setConflict(false);void act(async()=>{await save(true);});}}>Use recovered draft</button><button className={button} disabled={busy} onClick={()=>load(sessionRef.current)}>Use server draft</button></div></div>}
    {error && <div role="alert" className="rounded-xl border border-red-400/40 bg-red-950/30 p-3 text-sm"><p>{error}</p><button className={`${button} mt-2`} disabled={busy||!!ui.builderId} onClick={() => void act(async () => { if (!loaded) window.location.reload(); else if(failedPromptAction)await requestPrompt(failedPromptAction);else if(uiRef.current.pendingUpload)await resumeUpload();else await save(); })}>{ui.builderId?"Checking prompt…":failedPromptAction?.action==="enhance"?"Retry Enhance":failedPromptAction?"Retry Direct Scene":ui.pendingUpload?"Retry upload":"Retry save"}</button></div>}
    {!loaded ? <p role="status">Loading workspace…</p> : <>
      {retired && <p role="status" className="rounded-xl border border-amber-400/30 p-3 text-sm">{labExperiment(editor.experiment)?.title} was removed. Choose another model to generate. Your prompt, references and past results are kept.</p>}
        <fieldset disabled={busy} className="grid grid-cols-2 gap-2"><legend className="mb-2 text-sm text-white/70">Model</legend><button type="button" className={button} disabled title="Exact checkpoint is not qualified in TEST">Crimson Pika</button>{catalog.filter(model => model.id !== "prism-pika" || editor.experiment === "prism-pika" && !!session).map(model => <button className={`${button} ${editor.experiment === model.id ? "bg-violet-600/50 border-violet-400/60" : ""}`} key={model.id} aria-pressed={editor.experiment === model.id} onClick={() => change({ experiment: model.id, settings: { ...editorRef.current.settings, recipe: "author" } })}>{model.id === "eros-beta7" ? "H3 Eros Max Beta 7" : model.title}</button>)}</fieldset>
      <H3WorkspaceTabs label="NSFW categories" value={imageCreate?"still":"video"} items={[{id:"video",label:"Video"},{id:"still",label:"Text to Image"}]} disabled={busy} onChange={id=>setImageCreate(id==="still")}/>
      {imageCreate?<NativeImagePanel h3Only ownerKey={ownerKey+":nsfw"} adapter={stillAdapter} unavailableReason={stillAdapter.available?undefined:"This NSFW checkpoint has no qualified Text-to-Image route yet. A model-specific qualification job is required. No standard model will be substituted."}/>:<>
      <H3WorkspaceTabs label="Not Safe for Work methods" value={settings.manualPrompt?"manual":settings.mode} disabled={busy}
        items={[...modes.map(([id,label])=>({id,label,unavailable:!capability?.modes.includes(id)?"This mode is not qualified for the selected checkpoint.":undefined})),{id:"manual",label:"Manual"}]}
        onChange={id=>patch(id==="manual"?{manualPrompt:!settings.manualPrompt}:{mode:id as LabSettings["mode"],manualPrompt:false})}/>
      {settings.manualPrompt&&<p className="text-sm text-white/65">Manual prompt · paste or write your complete H3 prompt. References and model settings still apply.</p>}
      {settings.mode==="edit"&&<H3WorkspaceTabs label="Edit Video tools" value="edit" onChange={()=>{}} items={[{id:"edit",label:"Edit"},...['Body Swap','Character Swap','Character Swapping V2','RefMod Character Swap'].map(label=>({id:label,label,unavailable:"This tool is not qualified with the selected NSFW checkpoint. No standard checkpoint will be substituted."}))]}/>}

      <div className={card}>
        <label htmlFor="private-h3-prompt" className="block font-semibold">Your scene</label>
        <textarea id="private-h3-prompt" className={`${input} min-h-40 resize-y`} maxLength={8000} placeholder="Describe the scene you want to create…" value={settings.prompt} disabled={busy} onFocus={rememberPrompt} onChange={e => patch({ prompt: e.target.value })} />
        <SpeechInputButton key={session?.id||"new-scene"} label="Dictate H3 NSFW scene" endpoint="/api/local-dictation" className={button} disabled={busy||conflict} onStatus={setMicStatus} onTranscript={text=>replacePrompt([editorRef.current.settings.prompt,text].filter(Boolean).join("\n"))}/>
        {micStatus&&<p role="status" className="text-sm text-white/65">{micStatus}</p>}
        <div className="flex flex-wrap gap-2">
          <button className={button} disabled={busy || !settings.prompt} onClick={() => replacePrompt("")}>Clear text</button>
          <button className={button} disabled={busy || !promptUndo.length} onClick={undoPrompt}>Undo text</button>
          {!settings.manualPrompt&&<H3EnhanceButtons disabled={busy||!!ui.builderId||!settings.prompt.trim()} selected={strength} buttonClass={button} onEnhance={level=>void act(()=>enhance(level))}/>}

        </div>
      </div>
      {!settings.manualPrompt&&<H3NsfwPromptTools dictationScope={session?.id||"new-scene"} settings={settings} model={editor.experiment} ui={ui} disabled={busy||conflict} loras={loras} onPatch={patch} onUi={updateUi} onPrompt={applyDirectedPrompt} onBuild={()=>void act(()=>requestPrompt({action:"direct"}))}/>}
      <H3ClipLengthControl value={settings.seconds} onChange={seconds=>patch({seconds})} disabled={busy} extended buttonClass={button}/>
      {ui.pendingUpload&&!busy&&<div role="status" className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-400/30 p-3 text-sm"><span className="min-w-0 flex-1 truncate">Interrupted upload · {ui.pendingUpload.name}</span><button className={button} onClick={()=>void act(resumeUpload)}>Resume upload</button><button className={button} onClick={()=>void act(async()=>{updateUi({pendingUpload:null});await clearPersistedH3MediaFiles(`otg:h3:nsfw:upload:${ownerKey}`);})}>Discard upload</button></div>}
      {(settings.mode !== "text" || ids.length > 0) && <div className={card}>
        <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">{settings.mode==="image"?"First Image":"Reference Deck"} {sources.length ? `· ${sources.length}` : ""}</h3><div className="flex gap-2"><button className={button} disabled={busy || !ids.length} onClick={() => selectInputs([])}>Clear inputs</button><button className={button} disabled={busy || !inputUndo} onClick={() => { patch({ selectedSources: inputUndo || [] }); setInputUndo(null); }}>Undo removal</button></div></div>
        {settings.mode === "text" ? <p className="text-sm text-amber-200">Text mode does not use these references.</p> : <>
          <div className="flex flex-wrap gap-2">{settings.mode==="reference"&&<><button className={button} disabled={busy} onClick={()=>setChooseCharacter(true)}>Choose Character</button><button className={button} disabled title="Visual RefMod encoding must be qualified for this checkpoint. Choose its approved character image instead.">Add RefMod</button></>}<button className={button} disabled={busy} onClick={()=>setGalleryKind("image")}>Gallery Image</button>{["reference","edit"].includes(settings.mode)&&<button className={button} disabled={busy} onClick={()=>setGalleryKind("video")}>Gallery Video</button>}{["image", "video", "audio"].filter(kind => kind === "image" || (kind === "video" && ["reference", "edit"].includes(settings.mode)) || (kind === "audio" && settings.mode === "reference" && settings.experimentalAudioReferences===true)).map(kind => <button key={kind} className={button} disabled={busy} onClick={() => { setUploadType(kind + "/*"); if (fileInput.current) { fileInput.current.accept = kind + "/*"; fileInput.current.click(); } }}>+ {kind[0].toUpperCase() + kind.slice(1)}</button>)}<button className={button} disabled={busy} onClick={() => {setSnapshotUrl(undefined);setSnapshotReplace(undefined);setSnapshotOpen(true);}}>Snapshot</button></div>
          {inputProblem && <p className="text-sm text-white/60">{inputProblem}</p>}
        </>}
        {settings.mode==="image"&&<div className="rounded-xl border border-white/10 p-3"><p className="font-semibold">Last Image</p><p className="text-sm text-white/60">Last-frame conditioning is not qualified in this NSFW graph yet. The first-frame guide remains available.</p><fieldset disabled className="mt-2 flex flex-wrap gap-2"><button className={button}>Upload Last Image</button><button className={button}>Gallery Last Image</button><button className={button}>Snapshot Last Image</button></fieldset></div>}
        {settings.mode==="reference"&&<p className="text-xs text-white/60">Choose one approved character image at a time. Visual RefMod loading needs qualification for this checkpoint; use its approved character images meanwhile. Picture numbers guide references, not exact timestamps.</p>}
        <input ref={fileInput} type="file" multiple={!['image','edit-image'].includes(settings.mode)} data-max-files={['image','edit-image'].includes(settings.mode)?1:Math.max(0,Math.min(uploadType.startsWith('image')?9-imageCount:3-(uploadType.startsWith('video')?videoCount:audioCount),MAX_H3_RENDER_REFERENCES-sources.length))} accept={uploadType} className="hidden" aria-label="Add reference file" disabled={busy} onChange={event => { const files = Array.from(event.target.files || []); event.target.value = ""; if (files.length) void act(() => attachBatch(files)); }} />
        {progress !== null && <div role="status" className="flex items-center gap-2 text-sm"><progress className="min-w-0 flex-1" value={progress} max={100} aria-label="Upload progress" /><span>{progress===100?"Preparing…":`${progress}%`}</span><button className={button} onClick={() => upload.current?.abort()}>Cancel upload</button></div>}
        <div className="grid gap-3 sm:grid-cols-2">{sources.map((asset, index) => <article key={asset.id} aria-label={`Reference ${asset.name}`} className="min-w-0 space-y-2 rounded-xl border border-white/10 p-2">
          <Media asset={asset} small /><div className="flex items-center justify-between gap-2"><span className="text-sm font-medium">{tag(asset)}</span><button className={button} disabled={busy} aria-label={`Remove ${asset.name}`} onClick={() => selectInputs(ids.filter(id => id !== asset.id))}>Remove</button></div>
          {asset.mime.startsWith("image/")&&<button className={button} disabled={busy} onClick={()=>{setSnapshotReplace(asset.id);setSnapshotUrl(undefined);setSnapshotOpen(true);}}>Replace with Snapshot</button>}
          {settings.referenceCharacters?.[asset.id]&&<p className="text-xs text-white/60">Saved Character Card image · {settings.referenceCharacters[asset.id].imageId}</p>}
          <p className="truncate text-xs text-white/60" title={asset.name}>{asset.name}</p>
          {sources.length > 1 && <div className="flex gap-2"><button className={button} aria-label={`Move ${asset.name} earlier`} disabled={busy || index === 0} onClick={() => { const next = [...ids]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; selectInputs(next); }}>↑ Earlier</button><button className={button} aria-label={`Move ${asset.name} later`} disabled={busy || index === ids.length - 1} onClick={() => { const next = [...ids]; [next[index + 1], next[index]] = [next[index], next[index + 1]]; selectInputs(next); }}>↓ Later</button></div>}
        </article>)}</div>
        <H3SavedUploads items={unused.map(a=>({id:a.id,name:a.name,kind:a.mime.split("/")[0] as "image"|"video"|"audio",url:mediaUrl(a.id)+(a.mime.startsWith("image/")?"&thumbnail=1":"")}))} disabled={busy}
          note="Remove hides an upload from this list. Past renders are kept."
          canAdd={a=>appendH3References(ids,[a.id],assets,settings.mode).includes(a.id)}
          onAdd={id=>selectInputs(appendH3References(ids,[id],assets,settings.mode))} onRemove={id=>void act(()=>removeUpload(id))}/>
      </div>}
      <div className={card}>
        <h3 className="font-semibold">Output</h3>
        <fieldset disabled={busy} className="grid grid-cols-3 gap-2"><legend className="mb-2 text-sm text-white/70">Resolution</legend>{(["0.2", "0.6", "1"] as const).map(value => <button className={`${button} ${settings.resolution === value ? "bg-violet-600/50" : ""}`} aria-pressed={settings.resolution === value} key={value} onClick={() => patch({ resolution: value })}>{value === "0.2" ? "Seed Hunter" : value === "0.6" ? "Normal" : "Enhanced"}</button>)}</fieldset>

        <fieldset disabled={busy} className="grid grid-cols-2 gap-2" aria-label="Orientation">{(["landscape", "portrait"] as const).map(value => <button className={`${button} ${settings.orientation === value ? "bg-violet-600/50" : ""}`} key={value} aria-pressed={settings.orientation === value} onClick={() => patch({ orientation: value })}>{value === "portrait" ? "Portrait" : "Landscape"}</button>)}</fieldset>

        <fieldset className="grid grid-cols-2 gap-2" aria-label="Render"><legend className="mb-2 text-sm text-white/70">Render</legend>{[8, 20].map(steps => <button className={`${button} ${recipe?.steps === steps ? "bg-violet-600/50" : ""}`} key={steps} disabled={busy || recipe?.steps !== steps} aria-pressed={recipe?.steps === steps} title={recipe?.steps !== steps ? "Not available for this model" : "Verified model recipe"} onClick={() => patch({ recipe: "author" })}>{steps === 8 ? "Turbo" : "Native"}</button>)}</fieldset>
        <p className="text-xs text-white/60">{available ? "RTX 3090" : "This mode is currently unavailable"} · {dimensions.width} × {dimensions.height}{settings.mode !== "edit-image" ? ` · ${settings.seconds}s` : ""}</p>
        {testVideoFinishing && settings.mode !== "edit-image" && <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" role="switch" disabled={busy} checked={settings.upscale1080p ?? settings.resolution !== "0.2"}
            onChange={e => patch({ upscale1080p: e.target.checked })} />1080p Upscaler (RelayVSR)
        </label>}
        {(settings.seconds > 5 || settings.resolution !== "0.2") && settings.mode !== "edit-image" && <p className="text-xs text-amber-200">Larger or longer renders are experimental.</p>}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="text-white/70" aria-live="polite">{settings.seedLocked ? "Same seed each time" : "Random seed each time"}</span>
        <label className="flex min-h-11 cursor-pointer items-center gap-2 px-2"><input type="checkbox" className="h-5 w-5 accent-violet-500" checked={!!settings.seedLocked} disabled={busy} onChange={e => patch({ seedLocked: e.target.checked })} />Lock seed</label>
      </div>
      <details className={card}><summary className="cursor-pointer font-medium">Advanced settings & help</summary>
        <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={settings.experimentalAudioReferences===true} disabled={busy} onChange={e=>patch({experimentalAudioReferences:e.target.checked})}/>Experimental imported audio references</label>
        <p className="text-xs text-white/60">Off: H3 generates its own acting and environment. Video soundtracks and saved voices are not conditioning. Turning this off requires removing selected standalone audio before generation.</p>
        <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" disabled checked={false} readOnly/>60 FPS (RIFE) · qualification required</label><p className="text-xs text-white/60">60 FPS RIFE and additional GPU routes require qualification for this private checkpoint. They are not silently substituted.</p>
        <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">GPU<select className={`${input} mt-1`} value={settings.gpu} disabled={busy} onChange={e => patch({ gpu: e.target.value as LabSettings["gpu"] })}><option value="auto">Auto · qualified RTX 3090</option><option value="rtx3090">RTX 3090</option><option value="rtx5060ti" disabled>RTX 5060 Ti · not qualified</option></select></label><label className="text-sm">Seed<input type="number" min={0} max={Number.MAX_SAFE_INTEGER} step={1} className={`${input} mt-1`} value={settings.seed} disabled={busy || !settings.seedLocked} onChange={e => patch({ seed: Number(e.target.value) })} /></label></div>
        <p className="text-sm text-white/65">Lock seed to reuse or enter a number for comparisons. Job receipts retain each generated seed. Mention &lt;Picture 1&gt; or &lt;Video 1&gt; in your prompt to identify references. Reordering changes their numbers. Edit video regenerates the scene; it does not preserve every original pixel.</p>
        <p className="text-sm text-white/65">{capability?.reason} {recipe?.note} {recipe && `${recipe.steps} steps · ${recipe.sampler} · ${recipe.attention}.`} The available render recipe is selected automatically for each model.</p>
        <p className="text-xs text-white/50">No saved-upload or result count limit; available disk space applies. Large images: up to 512 MB. Audio/video: 128 MB. Per-render reference limits still apply. Originals stay private. Clear inputs does not delete files.</p>
      </details>
      <details className={card}><summary className="cursor-pointer font-medium">Exact compiled prompt</summary><pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words text-sm">{labFinalPrompt(settings,(settings.loras||[]).flatMap(selection=>loras.find(l=>l.id===selection.id&&l.models.includes(editor.experiment))?.triggerWords||[]))}</pre><p className="mt-2 text-xs text-white/60">{sources.map(a=>`${tag(a)} = ${a.name}`).join(" · ")||"No imported references"}</p></details>
      {loraProblem&&<p role="alert" className="text-sm text-amber-200">Remove the unavailable LoRA or choose its qualified model.</p>}
      <div className="flex flex-wrap gap-2"><button className={`${button} min-w-0 flex-1 bg-violet-600 text-base font-semibold`} disabled={busy || conflict || loraProblem || !available || !settings.prompt.trim() || !!inputProblem || activeJobs.length >= 4} onClick={() => void act(generate)}>{busy ? (progress !== null ? "Uploading…" : "Working…") : settings.mode === "edit-image" ? "Create image" : "Create video"}</button><button className={button} disabled={busy||conflict} onClick={()=>void act(async()=>{change(fresh("eros-beta7"));updateUi({...DEFAULT_NSFW_UI,dismissedJob:uiRef.current.dismissedJob});pendingRequest.current=null;persist();await save(true);})}>Reset options</button></div>
      {latest && ui.dismissedJob!==latest.id && <div className={card} aria-label="Latest result"><h3 className="font-semibold">{latest.state === "completed" ? "Ready" : latest.state === "failed" ? "Generation failed" : latest.state === "canceled" ? "Canceled" : latest.state==="queued"?"Queued":"Generating…"}</h3><p role="status" className="text-sm text-white/70">{latest.stage}</p>
        <progress className="block h-3 w-full accent-violet-500" aria-label="Generation progress" max={100} value={latest.state==="completed"?100:latest.state==="queued"?0:latest.progressPercent}/>
        <div className="flex flex-wrap justify-between gap-2 text-sm text-white/65"><span>{latest.state==="queued"?`Waiting · ${formatTime(clock/1000-latest.created)}`:latest.started?`Elapsed · ${formatTime((latest.completed||clock/1000)-latest.started)}`:latest.totalSeconds!==undefined?`Generation time · ${formatTime(latest.totalSeconds)}`:"Preparing…"}</span><span>{latest.state==="completed"?"100%":latest.estimatedRemainingSeconds!==undefined?`About ${formatTime(latest.estimatedRemainingSeconds)} left`:latest.progress?.samplingRemainingSeconds!==undefined&&latest.progress.step<latest.progress.total?`Sampling · about ${formatTime(latest.progress.samplingRemainingSeconds)} left`:latest.state==="running"?"Time left · estimating…":""}</span></div>
        {!result&&!!latest.previewVersion&&<div className="space-y-1"><p className="text-xs text-white/60">Live preview · approximate, silent</p><video key={latest.previewVersion} src={`${root}/preview?jobId=${latest.id}&v=${latest.previewVersion}`} className="max-h-96 w-full rounded-xl bg-black" aria-label="Live generation preview" muted autoPlay loop playsInline controls preload="auto"/></div>}
        {latest.finishingRetry && <button type="button" className={button} disabled={busy} onClick={() => void act(async () => {
          await api(root,{action:"retry-finishing",jobId:latest.id});
          setJobs(current => current.map(job => job.id === latest.id ? {...job,state:"running",stage:"Generated · awaiting upscale retry",finishingRetry:false} : job));
        })}>Retry finishing</button>}
        {result && <><Media asset={result} />{result.mime.startsWith("video/")&&<H3CompletedMediaActions voiceSource={{nsfwAssetId:result.id}} extraction={latest.generationMode==="text"?{engine:"h3-nsfw",jobId:latest.id}:undefined}/>}<div className="flex flex-wrap gap-2"><button className={button} disabled>Saved to NSFW Gallery</button>{result.mime.startsWith("video/")&&<><button className={button} onClick={()=>{setSnapshotUrl(mediaUrl(result.id));setSnapshotReplace(undefined);setSnapshotOpen(true);}}>Snapshot</button><button className={button} disabled={busy} onClick={()=>void act(async()=>{patch({mode:"reference",experimentalAudioReferences:false,selectedSources:[]});await save();const r=await fetch(mediaUrl(result.id));if(!r.ok)throw Error("The completed video is unavailable.");await attach(new File([await r.blob()],result.name,{type:result.mime}));})}>Use as Reference</button><button className={button} disabled={busy} onClick={()=>{patch({mode:"image",experimentalAudioReferences:false});setSnapshotUrl(mediaUrl(result.id));setSnapshotReplace(undefined);setSnapshotOpen(true);}}>Continue Scene · choose last frame</button><button className={button} disabled={busy} onClick={()=>void act(()=>restoreTake(latest.id))}>Retry · review settings</button></>}<a className={`${button} inline-flex items-center`} href={`${mediaUrl(result.id)}&download=1`}>Download {result.mime.startsWith("image/") ? "image" : "video"}</a><button className={button} disabled={busy} onClick={()=>updateUi({dismissedJob:latest.id})}>Clear {result.mime.startsWith("image/")?"image":"video"}</button></div></>}
      </div>}
      {activeJobs.map(job => <div className="flex items-center justify-between gap-2 rounded-xl border border-white/10 p-3" key={job.id}><span className="min-w-0 text-sm">{job.model} · {job.stage}</span><button className={button} disabled={busy} onClick={() => void act(async () => { await api(root, { action: "cancel", jobId: job.id }); })}>Cancel job</button></div>)}
      <details className={card}><summary className="cursor-pointer font-medium">History & saved drafts</summary>
        <div className="flex flex-wrap gap-2"><button className={button} disabled={busy} onClick={() => void act(async () => { await save(); load(null); })}>New draft</button><button className={button} disabled={busy || !dirty} onClick={() => void act(async () => { await save(); })}>Save draft</button></div>
        <label className="block text-sm">Saved draft<select aria-label="Saved draft" className={`${input} mt-1`} value={session?.id || ""} disabled={busy} onChange={event => { const id = event.target.value; void act(async () => { await save(); const data = await api<{ sessions: LabSession[] }>(root); setSessions(data.sessions); load(data.sessions.find(s => s.id === id) || null); }); }}><option value="">New draft</option>{sessions.filter(s => !s.archived).map(s => <option key={s.id} value={s.id}>{s.title} · {new Date(s.updated).toLocaleString()}</option>)}</select></label>
        {jobs.slice(0,historyLimit).map(job => <details key={job.id} className="border-t border-white/10 py-2"><summary className="cursor-pointer py-2 text-sm">{job.model} · {job.state} · {new Date(job.created * 1000).toLocaleString()}</summary>{assets.find(a => a.id === job.output) && <Media asset={assets.find(a => a.id === job.output)!} />}<a className="my-2 inline-block text-sm text-cyan-300 underline" href={`${root}?receipt=${job.id}`}>Technical receipt</a>{job.output && <a className="ml-3 text-sm text-cyan-300 underline" href={`${mediaUrl(job.output)}&download=1`}>Download result</a>}</details>)}
        {jobs.length>historyLimit&&<button className={button} onClick={()=>setHistoryLimit(n=>n+20)}>Show older results</button>}
      </details>
      {chooseCharacter&&<H3ChooseCharacter refMods={[]} onRefMod={()=>{}} onClose={()=>setChooseCharacter(false)} onImage={(file,binding)=>void act(async()=>{const added=await attach(file);if(added?.[0]){patch({referenceCharacters:{...editorRef.current.settings.referenceCharacters,[added[0].id]:binding}});await save();}})}/>}
      {galleryKind&&<H3MediaGalleryPicker kind={galleryKind} includeNsfw onClose={()=>setGalleryKind(undefined)} onPick={file=>act(async()=>{await attach(file,true);},true)}/>}
      </>}
      {snapshotOpen && createPortal(<fieldset disabled={busy} className="contents">
        <VideoSnapshotPicker allowFrameEdit initialVideoUrl={snapshotUrl} open={snapshotOpen} onClose={() => { if (!acting.current) setSnapshotOpen(false); }} onSnapshot={({file})=>act(async()=>{const added=await attach(file,true);const id=added?.[0]?.id;if(id&&snapshotReplace){const previous=editorRef.current.settings.selectedSources||[];if(!previous.includes(snapshotReplace))throw Error("The snapshot destination was removed. The new image remains in Saved uploads.");selectInputs([...new Set(previous.filter(v=>v!==id).map(v=>v===snapshotReplace?id:v))]);await save();}setSnapshotOpen(false);},true)} />
      </fieldset>, document.body)}
    </>}
  </section>;
}
