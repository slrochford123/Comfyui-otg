"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useMediaGpuChoice, MEDIA_GPU_ROUTING_UI_ENABLED } from "./MediaGpuControl";
import { STEMS, defaultTracks, numberWithin, type AudioSession, type AudioAsset, type AudioGpu, type Stem, type TimelineClip } from "@/lib/audioEditing/contracts";

type Asset = AudioAsset & { url?: string };
type Session = Omit<AudioSession,"assets"> & { assets: Asset[] };
type Edit = Pick<AudioSession,"title"|"tracks"|"clips"|"ducking">;
type Job = {id:string;status:string;stage:string;progress:number;elapsedSeconds?:number;assets?:Asset[]};
type Capabilities = {engines:Record<string,Partial<Record<AudioGpu,boolean>>>;notes:string[];pythonReady:boolean};
type Character = {id:string;name:string;referenceAudioPath?:string};
type Voice = {voiceId?:string;id:string;name:string};
const ENDPOINT = "/api/edit-video/audio";
const button = "min-h-11 rounded-xl border border-white/20 bg-white/5 px-3 py-2 text-sm font-semibold disabled:opacity-40 hover:bg-white/10";
const input = "min-h-11 w-full rounded-xl border border-white/20 bg-black/35 px-3 py-2 text-sm";
const labels:Record<Stem,string> = {speech:"Speech",effects:"Effects / ambience",music:"Music"};
const editOf = (s:Session):Edit => ({title:s.title,tracks:s.tracks,clips:s.clips,ducking:s.ducking});
const clone = <T,>(value:T):T => JSON.parse(JSON.stringify(value));
function Help({children}:{children:React.ReactNode}) { return <p className="text-xs leading-5 text-white/60">{children}</p>; }

export default function UnifiedAudioEditingPanel({onOpenDialogue,initialSection="Remove"}:{onOpenDialogue:(source?:{path:string;name:string;url:string})=>void;initialSection?:string}) {
  const [section,setSection] = useState(initialSection);
  const [session,setSession] = useState<Session|null>(null);
  const [edit,setEdit] = useState<Edit|null>(null);
  const [history,setHistory] = useState<Edit[]>([]);
  const [jobs,setJobs] = useState<Job[]>([]);
  const [cap,setCap] = useState<Capabilities>({engines:{},notes:[],pythonReady:false});
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");
  const [notice,setNotice] = useState("");
  const [gpu,setGpu] = useState<AudioGpu>("rtx3090");
  const [preference]=useMediaGpuChoice();
  const routing=MEDIA_GPU_ROUTING_UI_ENABLED?preference:gpu;
  const engineReady=(name:string)=>routing==="auto" ? !!(cap.engines[name]?.rtx3090||cap.engines[name]?.rtx5060ti) : !!cap.engines[name]?.[routing];
  const [comparison,setComparison] = useState("original");
  const [selectedAsset,setSelectedAsset] = useState("");
  const [audioCompare,setAudioCompare] = useState({assetId:"",original:false});
  const [cursor,setCursor] = useState(0);
  const [createKind,setCreateKind] = useState("speech");
  const [dialogue,setDialogue] = useState("");
  const [description,setDescription] = useState("A natural, clear adult voice, warm and conversational.");
  const [reference,setReference] = useState("");
  const [expression,setExpression] = useState("");
  const [variant,setVariant] = useState("flash");
  const [seconds,setSeconds] = useState(8);
  const [seed,setSeed] = useState(42);
  const [characters,setCharacters] = useState<Character[]>([]);
  const [voices,setVoices] = useState<Voice[]>([]);
  const [voiceName,setVoiceName] = useState("");
  const [assignCharacter,setAssignCharacter] = useState("");
  const [newCharacterName,setNewCharacterName] = useState("");
  const [library,setLibrary] = useState<Array<{id:string;name:string;origin:string}>>([]);
  const [libraryOpen,setLibraryOpen] = useState(false);
  const [strength,setStrength] = useState(.35);
  const [enhanceEngine,setEnhanceEngine] = useState("ffmpeg");
  const [musicPrompt,setMusicPrompt] = useState("Warm instrumental cafe jazz, acoustic piano and gentle brushed drums, no singing, no speech.");
  const [musicSeconds,setMusicSeconds] = useState(30);
  const [effectsMode,setEffectsMode] = useState("automatic");
  const [effectsPrompt,setEffectsPrompt] = useState("");
  const [effectsSeconds,setEffectsSeconds] = useState(5);
  const [target,setTarget] = useState<Stem>("speech");
  const [separator,setSeparator] = useState("bandit");
  const [openClip,setOpenClip] = useState("");
  const [gallery,setGallery] = useState<Array<{name:string;scope?:string;source?:string}>>([]);
  const [galleryOpen,setGalleryOpen] = useState(false);
  const [sessions,setSessions] = useState<Array<{id:string;title:string}>>([]);
  const videoRef = useRef<HTMLVideoElement>(null);
  const restoredInputSession = useRef("");
  const activeJob = jobs.find(j=>j.status==="queued"||j.status==="running");
  const activeJobId = activeJob?.id;
  const sessionId = session?.id;
  const source = session?.assets.find(a=>a.id===session.sourceId);
  const exported = session?.assets.filter(a=>a.origin==="edited-export").at(-1);
  const preview = comparison==="edited"&&exported?exported:source;
  const audioAssets = session?.assets.filter(a=>a.kind==="audio")||[];
  const selected = session?.assets.find(a=>a.id===selectedAsset);
  const originalAudio = selected?.sourceAssetId ? session?.assets.find(a=>a.id===selected.sourceAssetId) : undefined;
  const urlFor = (asset:Asset,download=false) => `${ENDPOINT}?session=${session?.id}&asset=${asset.id}${download?"&download=1":""}`;

  const api = useCallback(async (body:Record<string,unknown>) => {
    const res = await fetch(ENDPOINT,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
    const data = await res.json();
    if (!res.ok||!data.ok) throw Error(data.error||"Audio operation failed.");
    return data;
  },[]);
  const accept = useCallback((next:Session) => {
    setSession(next);setEdit(clone(editOf(next)));
    localStorage.setItem("slr:audio-session:v1",next.id);
    localStorage.removeItem(`slr:audio-draft:${next.id}`);
  },[]);
  const load = useCallback(async (id:string,replaceEdit=true) => {
    const res = await fetch(`${ENDPOINT}?session=${encodeURIComponent(id)}`,{cache:"no-store"});
    const data = await res.json();
    if (!res.ok||!data.ok) throw Error(data.error||"Session unavailable.");
    setSession(data.session);setJobs(data.jobs||[]);setCap(data.capabilities);
    if(restoredInputSession.current!==id) {
      restoredInputSession.current=id;
      try {
        const form=JSON.parse(localStorage.getItem(`slr:audio-inputs:${id}`)||"null");
        if(form) {
          setDialogue(String(form.dialogue||"").slice(0,5000));setDescription(String(form.description||"A natural, clear adult voice."));
          setReference(String(form.reference||""));setExpression(String(form.expression||""));setVariant(form.variant==="base"?"base":"flash");
          setMusicPrompt(String(form.musicPrompt||""));setMusicSeconds(numberWithin(form.musicSeconds,30,10,600));
          setEffectsPrompt(String(form.effectsPrompt||""));setEffectsMode(form.effectsMode==="manual"?"manual":"automatic");setEffectsSeconds(numberWithin(form.effectsSeconds,5,.1,7200));
          setSeconds(numberWithin(form.seconds,5,.5,8));setSeed(numberWithin(form.seed,42,0,2147483647));
          if(["rtx3090","rtx5060ti","cpu"].includes(form.gpu))setGpu(form.gpu);
          setSeparator(form.separator==="bandit"?"bandit":"tiger");
        }
      }catch { /* invalid local drafts cannot prevent authenticated server recovery */ }
    }
    if (replaceEdit) {
      let restored:Edit|undefined;
      try {
        const draft=JSON.parse(localStorage.getItem(`slr:audio-draft:${id}`)||"null");
        if(draft?.revision===data.session.revision)restored=draft.edit;
      } catch { /* a corrupt browser draft never prevents server recovery */ }
      setEdit(clone(restored||editOf(data.session)));
      if(restored)setNotice("Restored your unsaved timeline edits from this browser.");
    }
    localStorage.setItem("slr:audio-session:v1",id);
    return data;
  },[]);
  const execute = async (fn:()=>Promise<void>) => {
    setBusy(true);setError("");setNotice("");
    try { await fn(); } catch(e) { setError(e instanceof Error?e.message:"Audio operation failed."); }
    finally { setBusy(false); }
  };
  useEffect(()=>{
    let canceled=false;
    void (async()=>{
      try {
        const res=await fetch(ENDPOINT,{cache:"no-store"});const data=await res.json();
        if(!res.ok||!data.ok)throw Error(data.error||"Audio Editing unavailable.");
        if(canceled)return;
        setCap(data.capabilities);setSessions(data.sessions||[]);
        const saved=localStorage.getItem("slr:audio-session:v1");
        if(saved&&(data.sessions||[]).some((s:{id:string})=>s.id===saved))await load(saved);
        else if(data.sessions?.length)await load(data.sessions[0].id);
        else {const result=await api({action:"new"});if(!canceled)accept(result.session);}
      }catch(e){if(!canceled)setError(e instanceof Error?e.message:"Audio Editing unavailable.");}
    })();
    void fetch("/api/characters",{cache:"no-store"}).then(r=>r.json()).then(d=>{if(!canceled)setCharacters(d.items||[]);}).catch(()=>{});
    void fetch("/api/voice/models",{cache:"no-store"}).then(r=>r.json()).then(d=>{if(!canceled)setVoices((d.items||[]).filter((v:Voice)=>v.voiceId));}).catch(()=>{});
    return()=>{canceled=true;};
  },[accept,api,load]);
  useEffect(()=>{
    if(!activeJobId||!sessionId)return;
    const timer=setInterval(()=>{void load(sessionId,true).then(data=>{
      const last=(data.jobs as Job[]).find(j=>j.id===activeJobId);
      if(last?.status==="failed")setError(last.stage);
      if(last?.status==="completed"){
        const audio=last.assets?.find(a=>a.kind==="audio");
        if(audio)setSelectedAsset(audio.id);
        if(last.assets?.some(a=>a.kind==="video"))setComparison("edited");
        setNotice("Processing complete. Preview the result or add the new audio to your timeline.");
      }
    }).catch(e=>setError(e.message));},1800);
    return()=>clearInterval(timer);
  },[activeJobId,sessionId,load]);
  useEffect(()=>{
    if(!sessionId)return;
    const timer=setTimeout(()=>localStorage.setItem(`slr:audio-inputs:${sessionId}`,JSON.stringify({dialogue,description,reference,expression,variant,seconds,seed,musicPrompt,musicSeconds,effectsMode,effectsPrompt,effectsSeconds,gpu,separator})),400);
    return()=>clearTimeout(timer);
  },[sessionId,dialogue,description,reference,expression,variant,seconds,seed,musicPrompt,musicSeconds,effectsMode,effectsPrompt,effectsSeconds,gpu,separator]);
  const change = (patch:Partial<Edit>) => {
    if(!edit)return;
    setHistory(h=>[...h.slice(-39),clone(edit)]);
    const next={...edit,...patch};
    setEdit(next);
    if(session)localStorage.setItem(`slr:audio-draft:${session.id}`,JSON.stringify({revision:session.revision,edit:next}));
  };
  const save = async () => {
    if(!session||!edit)throw Error("Create a session first.");
    const data=await api({action:"update",sessionId:session.id,revision:session.revision,edit});
    accept(data.session);return data.session as Session;
  };
  const process = (operation:string,params:Record<string,unknown>={},assetId?:string) => execute(async()=>{
    const saved=await save();
    const cpu=["import","mix","extract"].includes(operation)||operation==="enhance"&&params.engine!=="mossformer";
    const result=await api({action:"process",sessionId:saved.id,operation,params,assetId,gpu:cpu?"cpu":routing});
    await load(saved.id);
    if(result.cached)setNotice("Using the existing separated tracks; no AI inference was rerun.");
  });
  const upload = (file:File|undefined) => execute(async()=>{
    if(!file||!session)return;
    await save();
    const form=new FormData();form.set("session",session.id);form.set("file",file);
    const res=await fetch(ENDPOINT,{method:"POST",body:form});const data=await res.json();
    if(!res.ok||!data.ok)throw Error(data.error||"Upload failed.");
    accept(data.session);setSelectedAsset(data.assetId);await load(session.id);
  });
  const addClip = (asset:Asset) => {
    if(!edit)return;
    const lane:Stem=asset.suggestedLane || (asset.origin.startsWith("AuK")?"speech":/music|instrumental|ACE-Step/i.test(`${asset.origin} ${asset.name}`)?"music":"effects");
    const clipId=typeof crypto.randomUUID==="function"?crypto.randomUUID():Array.from(crypto.getRandomValues(new Uint32Array(4)),n=>n.toString(16).padStart(8,"0")).join("");
    change({clips:[...edit.clips,{id:clipId,assetId:asset.id,lane,start:cursor,trimStart:0,length:asset.duration,gain:1,fadeIn:0,fadeOut:0,loop:false,muted:false}]});
    setOpenClip(clipId);
    setSection("Add");
  };
  const patchClip = (id:string,patch:Partial<TimelineClip>) => change({clips:edit!.clips.map(c=>c.id===id?{...c,...patch}:c)});

  return <section className="rounded-3xl border border-white/15 bg-black/40 p-3 text-white sm:p-5" data-testid="unified-audio-editing">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><h2 className="text-lg font-bold">Audio Editing</h2><Help>Separate, create and mix audio. Your original video stays unchanged.</Help></div>
      <button className={button} disabled={busy||!!activeJob} onClick={()=>void execute(async()=>{const d=await api({action:"new"});accept(d.session);setJobs([]);setHistory([]);setComparison("original");})}>New session</button>
    </div>
    {error&&<div role="alert" className="my-3 rounded-xl border border-red-400/40 bg-red-500/10 p-3 text-sm">{error}<button className="ml-3 underline" onClick={()=>setError("")}>Dismiss</button></div>}
    {notice&&<p role="status" className="my-2 text-sm text-emerald-200">{notice}</p>}
    {session&&edit&&<>
      <div className="my-3 grid gap-2 sm:grid-cols-2">
        <label className="text-xs">Session name<input className={input} value={edit.title} onChange={e=>change({title:e.target.value})}/></label>
        <label className="text-xs">Open saved session<select className={input} value={session.id} disabled={!!activeJob} onChange={e=>void execute(async()=>{await load(e.target.value);})}>
          {[{id:session.id,title:session.title},...sessions.filter(s=>s.id!==session.id)].map(s=><option key={s.id} value={s.id}>{s.title}</option>)}</select></label>
      </div>
      {!source?<div className="flex flex-wrap gap-2 rounded-xl border border-dashed border-white/25 p-4">
        <label className={button}>Upload video<input className="sr-only" type="file" accept="video/*" disabled={busy} onChange={e=>void upload(e.target.files?.[0])}/></label>
        <button className={button} onClick={()=>void execute(async()=>{const r=await fetch("/api/gallery?media=videos&sort=newest&per=500");const d=await r.json();if(!r.ok)throw Error(d.error||"Gallery unavailable");setGallery(d.items||d.files||[]);setGalleryOpen(true);})}>Choose gallery video</button>
      </div>:<div className="my-3 overflow-hidden rounded-xl border border-white/10 bg-black">
        <video ref={videoRef} src={preview?urlFor(preview):undefined} controls playsInline preload="metadata" className="max-h-80 w-full object-contain" onLoadedMetadata={e=>{e.currentTarget.currentTime=Math.min(cursor,e.currentTarget.duration||0);}} onTimeUpdate={e=>setCursor(e.currentTarget.currentTime)}/>
        <div className="flex flex-wrap items-center gap-2 p-2"><button className={button} aria-pressed={comparison==="original"} onClick={()=>setComparison("original")}>Original</button>
          <button className={button} disabled={!exported} aria-pressed={comparison==="edited"} onClick={()=>setComparison("edited")}>Edited preview</button>
          <span className="text-xs text-white/65">{source.duration.toFixed(2)}s · playhead {cursor.toFixed(2)}s</span></div>
      </div>}
      {galleryOpen&&<div className="my-3 max-h-64 overflow-auto rounded-xl border border-white/15 p-2" role="dialog" aria-label="Choose gallery video">
        <button className={button} onClick={()=>setGalleryOpen(false)}>Close gallery</button>
        {gallery.map((item,i)=><button className={`${button} my-1 block w-full text-left`} key={`${item.name}-${i}`} onClick={()=>void execute(async()=>{await save();const r=await api({action:"import-gallery",sessionId:session.id,name:item.name,scope:item.scope||item.source});accept(r.session);setGalleryOpen(false);await load(session.id);})}>{item.name}</button>)}
      </div>}
      {activeJob&&<div role="status" aria-live="polite" className="my-3 rounded-xl bg-violet-500/10 p-3"><div className="flex justify-between gap-2"><p className="text-sm">{activeJob.stage}</p><button className={button} onClick={()=>void execute(async()=>{await api({action:"cancel",sessionId:session.id,jobId:activeJob.id});await load(session.id);})}>Cancel job</button></div><progress className="w-full" max={100} value={activeJob.progress}/><Help>{Math.round(activeJob.elapsedSeconds||0)} seconds elapsed. You may leave and return to this session.</Help></div>}
      <div className="grid grid-cols-4 gap-1" role="tablist" aria-label="Audio tools">{["Remove","Add","Create","Enhance"].map(name=><button key={name} role="tab" aria-selected={section===name} className={`${button} ${section===name?"border-violet-400 bg-violet-500/25":""}`} onClick={()=>setSection(name)}>{name}</button>)}</div>
      <fieldset disabled={busy||!!activeJob} className="mt-3 min-w-0 space-y-3">
        {section==="Remove"&&<>
          <p className="text-sm font-semibold">Original soundtrack</p>
          <Help>Keep any combination of the source audio. Added timeline clips have their own controls in Add. Effects includes ambience and animal sounds. AI separation is approximate; compare quiet details with the original.</Help>
          <div className="grid gap-2 sm:grid-cols-3">{STEMS.map(stem=><div key={stem} className="rounded-xl border border-white/15 p-3">
            <label className="flex min-h-11 items-center gap-2 font-semibold"><input type="checkbox" checked={edit.tracks[stem].keep} onChange={e=>change({tracks:{...edit.tracks,[stem]:{...edit.tracks[stem],keep:e.target.checked}}})}/>Keep {labels[stem]}</label>
            <label className="text-xs">Volume {Math.round(edit.tracks[stem].gain*100)}%<input aria-label={`${stem} volume`} className="my-2 w-full" type="range" min="0" max="200" value={Math.round(edit.tracks[stem].gain*100)} onChange={e=>change({tracks:{...edit.tracks,[stem]:{...edit.tracks[stem],gain:Number(e.target.value)/100}}})}/></label>
            <div className="flex flex-wrap gap-2"><button className={button} aria-pressed={edit.tracks[stem].solo} onClick={()=>change({tracks:{...edit.tracks,[stem]:{...edit.tracks[stem],solo:!edit.tracks[stem].solo}}})}>Solo</button><button className={button} onClick={()=>change({tracks:{...edit.tracks,[stem]:{...edit.tracks[stem],keep:!edit.tracks[stem].keep}}})}>{edit.tracks[stem].keep?"Mute":"Unmute"}</button></div>
            {session.stems[stem]&&<audio className="mt-2 w-full" controls preload="none" src={`${ENDPOINT}?session=${session.id}&asset=${session.stems[stem]}`}/>}
          </div>)}</div>
          {source&&!source.channels&&<Help>This video has no original soundtrack. Use Add or Create to give it audio.</Help>}
          <div className="flex flex-wrap gap-2"><button className={button} disabled={!source?.channels||!engineReady(separator==="bandit"?"separate-bandit":"separate")} onClick={()=>void process("separate",{engine:separator})}>{STEMS.every(s=>session.stems[s])&&session.separation?.engine===(separator==="bandit"?"BandIt v2 English":"TIGER-DnR")?"Reuse separated tracks":"Separate tracks"}</button>
            <button className={button} onClick={()=>change({tracks:Object.fromEntries(STEMS.map(s=>[s,{...edit.tracks[s],keep:false,solo:false}])) as Edit["tracks"]})}>Mute all</button>
            <button className={button} onClick={()=>change({tracks:defaultTracks()})}>Reset tracks</button></div>
          {session.separation?.warnings.map(w=><Help key={w}>{w}</Help>)}
          {session.separation&&<Help>Current source tracks: {session.separation.engine}. Changing volume does not rerun AI. Use Separate tracks only to change the separation method.</Help>}
        </>}
        {section==="Add"&&<>
          <Help>Upload or select audio below, then Add to timeline at the video playhead. Overlapping clips are mixed without shortening the source video.</Help>
          <label className={`${button} inline-flex`}>Upload audio<input className="sr-only" type="file" accept="audio/*,.webm" onChange={e=>void upload(e.target.files?.[0])}/></label>
          <button className={`${button} ml-2`} onClick={()=>void execute(async()=>{const res=await fetch(`${ENDPOINT}?library=1`,{cache:"no-store"});const data=await res.json();if(!res.ok||!data.ok)throw Error(data.error||"Audio library unavailable");setLibrary(data.items);setLibraryOpen(true);})}>Choose saved audio</button>
          {libraryOpen&&<div className="max-h-60 space-y-1 overflow-auto rounded-xl border border-white/15 p-2"><button className={button} onClick={()=>setLibraryOpen(false)}>Close audio library</button>
            {!library.length&&<Help>No saved audio yet. Upload audio, extract a track, or generate a new asset.</Help>}
            {library.map(item=><button className={`${button} block w-full text-left`} key={item.id} onClick={()=>void execute(async()=>{await save();const data=await api({action:"import-library",sessionId:session.id,libraryId:item.id});accept(data.session);setSelectedAsset(data.assetId);setLibraryOpen(false);})}>{item.name} · {item.origin}</button>)}
          </div>}
          <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={edit.ducking} onChange={e=>change({ducking:e.target.checked})}/>Lower music automatically beneath speech</label>
          {source&&edit.clips.length>0&&<div className="rounded-xl border border-white/15 p-2" aria-label="Added audio timeline overview">
            <div className="mb-1 flex justify-between text-xs text-white/60"><span>Added clips</span><span>0 – {source.duration.toFixed(1)}s</span></div>
            {STEMS.map(stem=><div className="flex items-center gap-2" key={stem}><span className="w-16 shrink-0 text-xs">{stem==="effects"?"Effects":labels[stem]}</span><div className="relative my-1 h-8 min-w-0 flex-1 overflow-hidden rounded bg-white/5" role="img" aria-label={`${labels[stem]} positions: ${edit.clips.filter(c=>c.lane===stem).map(c=>`${c.start.toFixed(1)} to ${(c.start+c.length).toFixed(1)} seconds`).join(", ")||"empty"}`}>
              {edit.clips.filter(c=>c.lane===stem&&c.start<source.duration).map((clip,index)=><span key={clip.id} className={`absolute h-5 truncate rounded px-1 text-[10px] ${clip.muted?"bg-white/10 text-white/30":stem==="speech"?"bg-cyan-500/50":stem==="music"?"bg-violet-500/60":"bg-amber-500/50"}`} style={{left:`${clip.start/source.duration*100}%`,width:`${Math.max(.3,Math.min(clip.length,source.duration-clip.start)/source.duration*100)}%`,top:index%2*8}}>{audioAssets.find(a=>a.id===clip.assetId)?.name}</span>)}
              <span className="pointer-events-none absolute inset-y-0 w-px bg-white/70" style={{left:`${Math.min(100,cursor/source.duration*100)}%`}}/>
            </div></div>)}
          </div>}
          {edit.clips.map(clip=><div key={clip.id} className="rounded-xl border border-white/15 p-2"><button className="flex min-h-11 w-full items-center justify-between gap-2 text-left" aria-expanded={openClip===clip.id} onClick={()=>setOpenClip(openClip===clip.id?"":clip.id)}><span className="min-w-0"><strong className="block truncate text-sm">{audioAssets.find(a=>a.id===clip.assetId)?.name}</strong><span className="text-xs text-white/60">{labels[clip.lane]} · {clip.start.toFixed(1)}–{(clip.start+clip.length).toFixed(1)}s · {Math.round(clip.gain*100)}%{clip.muted?" · muted":""}</span></span><span className="text-xs">{openClip===clip.id?"Hide":"Edit"}</span></button>
            {source&&clip.start>=source.duration&&<Help>This clip starts after the video ends. Move it earlier to include it in the export.</Help>}
            {source&&clip.start<source.duration&&clip.start+clip.length>source.duration&&<Help>Audio beyond {source.duration.toFixed(1)} seconds is trimmed at export; the video is never extended or shortened. Trim or move this clip to keep the full line.</Help>}
            {openClip===clip.id&&<><div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <label className="col-span-2 text-xs">Replace clip audio<select className={input} value={clip.assetId} onChange={e=>patchClip(clip.id,{assetId:e.target.value,trimStart:0})}>{audioAssets.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
              <label className="text-xs">Track<select className={input} value={clip.lane} onChange={e=>patchClip(clip.id,{lane:e.target.value as Stem})}>{STEMS.map(s=><option key={s} value={s}>{labels[s]}</option>)}</select></label>
              {([['Start', 'start'],['Trim in','trimStart'],['Length','length'],['Fade in','fadeIn'],['Fade out','fadeOut']] as const).map(([label,key])=><label key={key} className="text-xs">{label} (s)<input className={input} type="number" min="0" step="0.1" value={clip[key]} onChange={e=>patchClip(clip.id,{[key]:Number(e.target.value)})}/></label>)}
              <label className="text-xs">Volume %<input className={input} type="number" min="0" max="200" value={Math.round(clip.gain*100)} onChange={e=>patchClip(clip.id,{gain:Number(e.target.value)/100})}/></label>
              <div className="flex flex-col justify-center gap-2 text-sm"><label><input type="checkbox" checked={clip.loop} onChange={e=>patchClip(clip.id,{loop:e.target.checked})}/> Loop</label><label><input type="checkbox" checked={clip.muted} onChange={e=>patchClip(clip.id,{muted:e.target.checked})}/> Mute</label></div>
            </div><button className={`${button} mt-2`} onClick={()=>change({clips:edit.clips.filter(c=>c.id!==clip.id)})}>Remove clip</button></>}
          </div>)}
        </>}
        {section==="Create"&&<>
          <div className="flex flex-wrap gap-2">{["speech","music","effects"].map(k=><button className={button} aria-pressed={createKind===k} key={k} onClick={()=>setCreateKind(k)}>Create {k}</button>)}</div>
          {createKind==="speech"?<>
            <label className="block text-sm">Dialogue<textarea className={`${input} min-h-24`} value={dialogue} maxLength={5000} onChange={e=>setDialogue(e.target.value)} placeholder="Type exactly what the character should say."/></label>
            <label className="block text-sm">Voice<select className={input} value={reference} onChange={e=>setReference(e.target.value)}><option value="">Create a new voice from a description</option>
              <optgroup label="Character Library">{characters.filter(c=>c.referenceAudioPath).map(c=><option key={c.id} value={`character:${c.id}`}>{c.name}</option>)}</optgroup>
              <optgroup label="Saved reference voices">{voices.map(v=><option key={v.id} value={`voice:${v.voiceId}`}>{v.name}</option>)}</optgroup></select></label>
            {!reference&&<label className="block text-sm">Describe the voice<textarea className={input} value={description} onChange={e=>setDescription(e.target.value)}/></label>}
            <details className="rounded-xl border border-white/15 p-3"><summary className="cursor-pointer text-sm font-semibold">Advanced speech settings</summary><div className="mt-2 grid gap-2 sm:grid-cols-2">
              <label className="text-xs">Delivery / emotion<input className={input} value={expression} onChange={e=>setExpression(e.target.value)} placeholder="e.g. comforting, deliberate pace"/><Help>Optional instruction, not a guaranteed emotion or pace control.</Help></label>
              <label className="text-xs">AuK variant<select className={input} value={variant} onChange={e=>setVariant(e.target.value)}><option value="flash">AuK-Flash · 4 steps</option><option value="base" disabled={!engineReady("speech-base")}>AuK Base · 32 steps{!engineReady("speech-base")?" · not yet qualified":""}</option></select></label>
              <label className="text-xs">Short-segment length (seconds)<input className={input} type="number" min="0.5" max={gpu==="rtx5060ti"?5:8} step="0.5" value={Math.min(seconds,gpu==="rtx5060ti"?5:8)} onChange={e=>setSeconds(Number(e.target.value))}/><Help>Up to 5 seconds per segment on 5060 Ti, 8 on 3090. Longer dialogue is split and assembled automatically with a reused reference voice.</Help></label>
              <label className="text-xs">Seed<input className={input} type="number" min="0" value={seed} onChange={e=>setSeed(Number(e.target.value))}/><Help>Reuse a reference for voice identity. A seed alone does not guarantee consistency.</Help></label>
            </div></details>
            <button className={button} disabled={!dialogue.trim()||!(variant==="base"?engineReady("speech-base"):engineReady("speech"))} onClick={()=>void process("speech",{text:dialogue,description,expression,variant,seconds,seed,
              ...(reference.startsWith("character:")?{characterId:reference.slice(10)}:reference.startsWith("voice:")?{voiceId:reference.slice(6)}:{})})}>Generate speech</button>
            <button className={`${button} ml-2`} onClick={()=>void execute(async()=>{if(source){await save();const data=await api({action:"prepare-dialogue",sessionId:session.id});onOpenDialogue(data.source);}else onOpenDialogue();})}>Dialogue replacement / trained voices</button>
            <Help>Use voices you own or are authorized to reproduce. Saving a reference does not train a voice model. No automatic lip-sync is claimed.</Help>
          </>:createKind==="music"?<>
            <label className="block text-sm">Describe the music<textarea className={`${input} min-h-24`} value={musicPrompt} maxLength={2000} onChange={e=>setMusicPrompt(e.target.value)}/></label>
            <label className="block text-sm">Music length (seconds)<input className={input} type="number" min="10" max="600" value={musicSeconds} onChange={e=>setMusicSeconds(Number(e.target.value))}/></label>
            <Help>ACE-Step 1.5 Turbo · 8 steps · instrumental. Describe mood, instruments, pace and environment. Generated music remains an editable asset; it never shortens your video.</Help>
            <button className={button} disabled={!musicPrompt.trim()||!engineReady("music")} onClick={()=>void process("music",{prompt:musicPrompt,seconds:musicSeconds,seed})}>Generate instrumental music</button>
            {!engineReady("music")&&<Help>This music engine has not been qualified on the selected device. Existing music can be uploaded or selected in Add.</Help>}
          </>:<div className="space-y-3 rounded-xl border border-white/15 p-3">
            <label className="block text-sm">Sound effects<select className={input} value={effectsMode} onChange={e=>setEffectsMode(e.target.value)}><option value="automatic">Automatic — follow the visible action</option><option value="manual">Manual — describe a sound</option></select></label>
            <label className="block text-sm">{effectsMode==="automatic"?"Optional guidance":"Describe the sound"}<textarea className={`${input} min-h-24`} value={effectsPrompt} maxLength={2000} onChange={e=>setEffectsPrompt(e.target.value)} placeholder="A lion roaring, birds and a soft breeze. No music or dialogue."/></label>
            <label className="block text-sm">Length (seconds)<input className={input} type="number" min="0.1" max={effectsMode==="automatic"?Math.max(.1,(source?.duration||5)-cursor):600} step="0.1" value={effectsMode==="automatic"?Math.min(effectsSeconds,Math.max(.1,(source?.duration||5)-cursor)):effectsSeconds} onChange={e=>setEffectsSeconds(Number(e.target.value))}/></label>
            <Help>{effectsMode==="automatic"?"Starts at the video playhead. Video-conditioned AI follows visible motion; exact timing and recognition are not guaranteed. Longer selections are assembled from overlapping windows.":"Describe one effect or ambience. Add the result to the timeline to position it."}</Help>
            <Help>Sony Woosh weights are restricted to non-commercial evaluation. Available here only as an isolated private TEST experiment, not commercially cleared.</Help>
            <button className={button} disabled={!engineReady("effects")||(effectsMode==="automatic"&&!source)||(effectsMode==="manual"&&!effectsPrompt.trim())} onClick={()=>void process("effects",{mode:effectsMode,prompt:effectsPrompt,seconds:effectsSeconds,start:cursor,seed})}>Generate sound effects</button>
          </div>}
        </>}
        {section==="Enhance"&&<>
          <Help>Conservative track-specific cleanup. This does not create surround sound or recover missing original detail. Select an isolated stem or uploaded audio, then compare both versions below.</Help>
          <div className="grid gap-2 sm:grid-cols-2"><label className="text-sm">Audio to enhance<select className={input} value={selectedAsset} onChange={e=>setSelectedAsset(e.target.value)}><option value="">Select audio</option>{audioAssets.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
            <label className="text-sm">Audio type<select className={input} value={target} onChange={e=>setTarget(e.target.value as Stem)}>{STEMS.map(s=><option key={s} value={s}>{labels[s]}</option>)}</select></label></div>
          <label className="block text-sm">Cleanup strength {Math.round(strength*100)}%<input className="w-full" type="range" min="0" max="100" value={strength*100} onChange={e=>setStrength(Number(e.target.value)/100)}/></label>
          <Help>Start low, especially for whispers, laughter, reverb and quiet effects. Speech cleanup is never applied automatically to another track.</Help>
          <details><summary className="min-h-11 cursor-pointer text-sm">Advanced enhancement settings</summary>
            <label className="text-xs">Enhancement method<select className={input} value={enhanceEngine} onChange={e=>setEnhanceEngine(e.target.value)}><option value="ffmpeg">Conservative cleanup · CPU</option><option value="mossformer" disabled={target!=="speech"||!engineReady("enhance-mossformer")}>MossFormer2 · speech restoration{!engineReady("enhance-mossformer")?" · not yet qualified":""}</option></select></label>
            <Help>Conservative cleanup uses transparent filters. MossFormer2 is a neural speech model: compare words, quiet speech and overlapping voices carefully.</Help>
          </details>
          <button className={button} disabled={!selectedAsset||(enhanceEngine==="mossformer"&&(target!=="speech"||!engineReady("enhance-mossformer")))} onClick={()=>void process("enhance",{target,strength,engine:enhanceEngine},selectedAsset)}>Enhance selected audio</button>
        </>}
        {selected?.kind==="audio"&&<div className="rounded-xl border border-violet-400/30 p-3"><strong className="text-sm">{selected.name}</strong>
          {originalAudio&&<div className="my-2 flex flex-wrap gap-2"><button className={button} aria-pressed={audioCompare.assetId===selected.id&&audioCompare.original} onClick={()=>setAudioCompare({assetId:selected.id,original:true})}>Original audio</button><button className={button} aria-pressed={audioCompare.assetId!==selected.id||!audioCompare.original} onClick={()=>setAudioCompare({assetId:selected.id,original:false})}>Enhanced audio</button></div>}
          <audio controls preload="none" className="my-2 w-full" src={urlFor(originalAudio&&audioCompare.assetId===selected.id&&audioCompare.original?originalAudio:selected)}/>
          <div className="flex flex-wrap gap-2"><button className={button} onClick={()=>addClip(selected)}>Add at {cursor.toFixed(1)}s</button><a className={button} href={urlFor(selected,true)}>Download audio</a><button className={button} onClick={()=>void execute(async()=>{await api({action:"save-gallery",sessionId:session.id,assetId:selected.id});setNotice("Audio saved to your existing audio library.");})}>Save audio to library</button></div>
        </div>}
        <details className="rounded-xl border border-white/15 p-3"><summary className="cursor-pointer text-sm font-semibold">Audio assets & extraction</summary>
          <Help>Export the original soundtrack, separated stems, generated audio or edited mix. Select a clean speech asset to save a reference voice.</Help>
          <select aria-label="Select audio asset" className={`${input} my-2`} value={selectedAsset} onChange={e=>setSelectedAsset(e.target.value)}><option value="">Select an audio asset</option>{audioAssets.map(a=><option key={a.id} value={a.id}>{a.name} · {a.duration.toFixed(1)}s</option>)}</select>
          {selected&&<><audio controls preload="none" className="w-full" src={urlFor(selected)}/><div className="my-2 flex flex-wrap gap-2"><button className={button} onClick={()=>addClip(selected)}>Add to timeline at {cursor.toFixed(1)}s</button><a className={button} href={urlFor(selected,true)}>Download audio</a>
            <button className={button} onClick={()=>void process("extract",{start:cursor,length:Math.min(10,selected.duration)},selected.id)}>Extract voice sample at playhead</button></div>
            <details><summary className="min-h-11 cursor-pointer text-sm">Save reference voice / assign character</summary><div className="space-y-2"><input className={input} aria-label="Reference voice name" value={voiceName} onChange={e=>setVoiceName(e.target.value)} placeholder="Voice name"/>
              <select className={input} aria-label="Assign voice to character" value={assignCharacter} onChange={e=>setAssignCharacter(e.target.value)}><option value="">Save to Voice Library only</option><option value="__new__">Create a new voice-first character</option>{characters.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select>
              {assignCharacter==="__new__"&&<input className={input} aria-label="New character name" value={newCharacterName} onChange={e=>setNewCharacterName(e.target.value)} placeholder="Character name"/>}
              <Help>Choose a clean, single-speaker sample. This creates a reusable reference, not a trained Applio/RVC model.</Help>
              <button className={button} disabled={!voiceName.trim()||(assignCharacter==="__new__"&&!newCharacterName.trim())} onClick={()=>void execute(async()=>{await api({action:"save-voice",sessionId:session.id,assetId:selected.id,name:voiceName,text:dialogue,description,
                characterId:assignCharacter&&assignCharacter!=="__new__"?assignCharacter:undefined,newCharacterName:assignCharacter==="__new__"?newCharacterName:undefined});
                const [v,c]=await Promise.all([fetch("/api/voice/models").then(r=>r.json()),fetch("/api/characters").then(r=>r.json())]);setVoices((v.items||[]).filter((item:Voice)=>item.voiceId));setCharacters(c.items||[]);
                setNotice("Reference saved to your existing Voice Library and selected character.");})}>Save reference voice</button>
            </div></details></>}
        </details>
        <div className="flex flex-wrap items-center gap-2 border-t border-white/10 pt-3">
          <button className={button} disabled={!history.length} onClick={()=>{const next=history.at(-1);if(next){setEdit(next);setHistory(h=>h.slice(0,-1));if(session)localStorage.setItem(`slr:audio-draft:${session.id}`,JSON.stringify({revision:session.revision,edit:next}));}}}>Undo</button>
          <button className={button} onClick={()=>void execute(async()=>{await save();setNotice("Session saved.");})}>Save session</button>
          <button className={`${button} border-violet-400 bg-violet-500/20`} disabled={!source||!cap.pythonReady} onClick={()=>void process("mix")}>Build preview / export</button>
          {exported&&<><a className={button} href={urlFor(exported,true)}>Download video</a><button className={button} onClick={()=>void execute(async()=>{await api({action:"save-gallery",sessionId:session.id,assetId:exported.id});setNotice("Edited video saved to your gallery.");})}>Save video to gallery</button></>}
        </div>
        <details><summary className="min-h-11 cursor-pointer text-sm">Advanced processing & help</summary>
          {MEDIA_GPU_ROUTING_UI_ENABLED ? <Help>Use Rendering GPU above for Automatic or Manual routing. Mixing and conservative cleanup run on CPU.</Help> : <label className="text-xs">AI processing device<select className={input} value={gpu} onChange={e=>setGpu(e.target.value as AudioGpu)}><option value="rtx3090">RTX 3090</option><option value="rtx5060ti">RTX 5060 Ti</option><option value="cpu">CPU where supported</option></select></label>}
          <label className="text-xs">Separation method<select className={input} value={separator} onChange={e=>setSeparator(e.target.value)}><option value="bandit" disabled={!engineReady("separate-bandit")}>BandIt v2 · recommended{!engineReady("separate-bandit")?" · unavailable on this device":""}</option><option value="tiger">TIGER-DnR · alternative</option></select></label>
          <Help>Separate again only when deliberately changing the separation method. BandIt v2 weights carry CC-BY-SA-4.0 terms. Neither method guarantees perfect isolation.</Help>
          <Help>Mixing/export runs on CPU. AI operations are admitted only when their selected engine is qualified and the GPU is available. Existing work is never interrupted. Saving sliders does not rerun separation.</Help>
          {cap.notes.map(n=><Help key={n}>{n}</Help>)}
        </details>
      </fieldset>
    </>}
  </section>;
}
