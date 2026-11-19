"use client";
/* eslint-disable @next/next/no-img-element */
import React,{useCallback,useEffect,useId,useRef,useState} from 'react';
import {newClientRequestId} from '@/lib/client/requestId';
import VideoSourcePicker from './VideoSourcePicker';
import CharacterDevelopmentPanel from './CharacterDevelopmentPanel';
import ExtractedCharacterName from './ExtractedCharacterName';
import ExtractedCharacterVoiceCreator from './ExtractedCharacterVoiceCreator';
import ExtractedCharacterFinalReview from './ExtractedCharacterFinalReview';
import {MAX_EXTRACTION_VIDEO_BYTES, MAX_EXTRACTION_VIDEO_SECONDS, EXTRACTION_VIDEO_LIMIT_DESCRIPTION} from '@/lib/videoCharacters/limits';
import type {VideoSourceChoice} from '@/lib/videoCharacters/videoSourceContract';
import {characterReferenceIds, MAX_CHARACTER_REFERENCES, SOURCE_VIEW_ROLES} from '@/lib/videoCharacters/contract';
import type {ExtractionPlayerSource} from '@/lib/videoCharacters/playerSource';
import type {Workspace} from '@/lib/videoCharacters/contract';
const endpoint='/api/experiments/video-characters';
const button='min-h-11 rounded-lg border border-white/20 px-3 py-2 text-sm disabled:opacity-40';
const input='w-full min-w-0 rounded-lg border border-white/20 bg-black/30 p-2.5 text-sm';
const legacySteps=['Video','Characters','Images','Voices','Save'];
type Listing={workspaces:Array<{id:string;sourceName:string}>;sources:VideoSourceChoice[]};
async function api<T>(data?:unknown,id?:string):Promise<T>{const r=await fetch(endpoint+(id?'?id='+encodeURIComponent(id):''),{cache:'no-store',...(data?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}:{})});const b=await r.json();if(!r.ok)throw Error(b.error||'Character extraction request failed.');return b;}
export default function VideoCharacterLab({player,library=false}: {player?:ExtractionPlayerSource;library?:boolean} = {}){
 const reviewedLibraryFlow = Boolean(player) || library;
 const steps=reviewedLibraryFlow?['Video','Extract','Develop','Add Voice','Final Review']:legacySteps;
 const [selectedImages,setSelectedImages]=useState<string[]>([]);
 const [look,setLook]=useState('');
 const [confirmedVoice,setConfirmedVoice]=useState(false);
 const [angle,setAngle]=useState('face');
 const startId=useRef('');
 const started=useRef(false);
 const [voiceChoices,setVoiceChoices]=useState<Array<{id:string;name:string}>>([]);
 const [listing,setListing]=useState<Listing>({workspaces:[],sources:[]}),[w,setW]=useState<Workspace|null>(null),[source,setSource]=useState(''),[cid,setCid]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[voice,setVoice]=useState(''),[global,setGlobal]=useState(false),[target,setTarget]=useState('both');
 const [expected,setExpected]=useState(''),[separate,setSeparate]=useState(false);
 const [description,setDescription]=useState(''),[other,setOther]=useState(''),[time,setTime]=useState(0),[frame,setFrame]=useState(''),[region,setRegion]=useState<number[]|null>(null),[start,setStart]=useState(0),[end,setEnd]=useState(3),[showObjects,setShowObjects]=useState(false),[group,setGroup]=useState(''),[fixView,setFixView]=useState(''),[correction,setCorrection]=useState('');
 const alive=useRef(true),image=useRef<HTMLImageElement>(null),anchor=useRef<number[]|null>(null);
 const frameVideo=useRef<HTMLVideoElement>(null);
 const frameTicks=useId();
 const c=w?.candidates.find(c=>c.id===cid),selected=w?.candidates.filter(c=>c.selected)||[],f=w?.frames.find(f=>f.id===frame);
 const media=(file:string)=>endpoint+'?'+new URLSearchParams({id:w!.id,file});
 const loadList=useCallback(async()=>{const b=await api<Listing>();if(alive.current)setListing(b);},[]);
 useEffect(()=>{alive.current=true;if(!player)void loadList().catch(e=>setError(e.message));return()=>{alive.current=false;};},[loadList,player]);
 useEffect(()=>{
  if(!library)return;
  const url=new URL(window.location.href),id=url.searchParams.get('extractionWorkspace'),character=url.searchParams.get('extractionCharacter');
  if(!id)return;
  void execute(async()=>{const b=await api<{workspace:Workspace}>(undefined,id);if(alive.current){setW(b.workspace);setCid(b.workspace.candidates.some(c=>c.id===character)?character!:'');}});
 },[library]);
 useEffect(()=>setConfirmedVoice(false),[cid,w?.id]);
 useEffect(()=>{setDescription(c?.description||'');setVoice(c?.voiceId||'');setOther('');},[cid,c?.name,c?.description,c?.voiceId]);
 useEffect(()=>{
  if(!player||started.current)return;
  started.current=true;
  startId.current||=newClientRequestId();
  const open=async()=>{
   const opened=await api<{workspace:Workspace}>({action:'new-player',...player,requestId:startId.current});
   if(!alive.current)return;
   setW(opened.workspace);
   if(!opened.workspace.frames.length&&opened.workspace.state==='draft'){
    const analyzed=await api<{workspace:Workspace}>({action:'analyze',includeVoice:false,id:opened.workspace.id,revision:opened.workspace.revision});
    if(alive.current)setW(analyzed.workspace);
   }
  };
  void execute(open);
 },[player]);
 const wid=w?.id;
 useEffect(()=>{setTime(0);setFrame('');setRegion(null);},[wid]);
 useEffect(()=>{
  const video=frameVideo.current;
  if(!video||video.readyState<1)return;
  video.pause();
  video.currentTime=Math.min(time,Math.max(0,video.duration-.001));
 },[time,wid]);
 useEffect(()=>{if(!wid)return;let stopped=false,loading=false;async function poll(){if(loading)return;loading=true;try{const b=await api<{workspace:Workspace}>(undefined,wid);if(!stopped){setW(b.workspace);setVoiceChoices((b.workspace as Workspace & {voiceChoices?:typeof voiceChoices}).voiceChoices||[]);}}catch(e){if(!stopped)setError((e as Error).message);}finally{loading=false;}}const timer=window.setInterval(()=>void poll(),4000);return()=>{stopped=true;window.clearInterval(timer);};},[wid]);
 async function execute(task:()=>Promise<void>,rethrow=false){setBusy(true);setError('');try{await task();}catch(e){if(rethrow)throw e;if(alive.current)setError((e as Error).message);}finally{if(alive.current)setBusy(false);}}
 async function action(action:string,fields:Record<string,unknown>={},rethrow=false){if(!w)return;await execute(async()=>{const b=await api<{workspace:Workspace}>({action,id:w.id,revision:w.revision,...fields});if(alive.current)setW(b.workspace);},rethrow);}
 function point(event:React.PointerEvent){const r=image.current!.getBoundingClientRect();return [Math.max(0,Math.min(1000,(event.clientX-r.left)/r.width*1000)),Math.max(0,Math.min(1000,(event.clientY-r.top)/r.height*1000))];}
 const processing=w?.state==='analyzing'||w?.candidates.some(c=>c.views.some(v=>['queued','running','preparing','dispatching'].includes(v.state))||c.bundle&&['queued','running','dispatching','preparing'].includes(c.bundle.state));
 const references = c && w ? characterReferenceIds(c, w.candidates) : [];
 useEffect(()=>{setSelectedImages(c?.approvedViews?.map(view=>view.id)||[]);setConfirmedVoice(false);setLook(c?.look||'');},[cid]);
 const reviewImages = !c || !w ? [] : [
   ...references.flatMap(id=>{const origin=w.candidates.find(item=>item.id===id);return origin?[{id,file:origin.extractedFile||origin.file,label:c.referenceRoles?.[id]||'Captured view'}]:[];}),
   ...c.views.filter(view=>view.file&&view.state==='ready').map(view=>({id:view.id,file:view.file!,label:view.angle+(view.master?' · Upscaled':' · Reconstructed')})),
 ];
 const approvedImageIds=selectedImages.length?selectedImages:reviewImages.slice(0,1).map(item=>item.id);

 async function uploadVideo(file: File) {
  if(!file.name.toLowerCase().endsWith('.mp4'))throw Error('Choose an MP4 video.');
  if(file.size>MAX_EXTRACTION_VIDEO_BYTES)throw Error('Maximum upload is 256 MiB. Trim or compress the clip first.');
  const url=URL.createObjectURL(file),video=document.createElement('video');
  try {
   await new Promise<void>((resolve,reject)=>{
    const timer=window.setTimeout(()=>finish(Error('Could not read the video duration. Choose a readable MP4.')),15000);
    function finish(error?:Error){window.clearTimeout(timer);video.onloadedmetadata=null;video.onerror=null;if(error)reject(error);else resolve();}
    video.preload='metadata';
    video.onloadedmetadata=()=>finish(!Number.isFinite(video.duration)||video.duration<=0?Error('Choose a readable MP4 video.'):video.duration>MAX_EXTRACTION_VIDEO_SECONDS?Error('Choose an MP4 video up to three minutes. Trim the clip first.'):undefined);
    video.onerror=()=>finish(Error('Could not read this MP4 video.'));
    video.src=url;
   });
  } finally {video.removeAttribute('src');video.load();URL.revokeObjectURL(url);}
  const response=await fetch(endpoint+'?upload=1&name='+encodeURIComponent(file.name),{method:'POST',headers:{'Content-Type':'video/mp4'},body:file});
  const result=await response.json();if(!response.ok)throw Error(result.error||'Video upload failed.');
  if(!alive.current)return;
  setW(result.workspace);setCid('');setSource('');await loadList();
 }

 function chooseFrameTime(next: number) {
  setTime(next);
  setFrame(w?.frames.find(item=>Math.abs(item.time-next)<.0005)?.id||'');
  setRegion(null);
 }
 async function captureFrame() {
  if(!w)return;
  const existing=w.frames.find(item=>Math.abs(item.time-time)<.0005);
  if(existing){setFrame(existing.id);setRegion(null);return;}
  await execute(async()=>{
   const result=await api<{workspace:Workspace}>({action:'frame',id:w.id,revision:w.revision,time});
   if(!alive.current)return;
   setW(result.workspace);
   setFrame(result.workspace.frames.find(item=>Math.abs(item.time-time)<.0005)?.id||'');
   setRegion(null);
  });
 }
 function frameCrop(character?: string) {
  if(!w)return null;
  return (
   <details className="space-y-2" onToggle={event=>{
    if(event.currentTarget.open&&frameVideo.current?.readyState){
     frameVideo.current.pause();
     frameVideo.current.currentTime=time;
    }
   }}>
    <summary className="cursor-pointer text-sm">{character?'Add a reference from the clip':'Missing character or partially obscured body? Select a frame region'}</summary>
    <video ref={frameVideo} src={media('source.mp4')} muted playsInline disablePictureInPicture
     preload="metadata" aria-label="Frame preview" className={f?'hidden':'max-h-80 w-full rounded-lg bg-black object-contain'}
     onLoadedMetadata={event=>{event.currentTarget.currentTime=Math.min(time,Math.max(0,event.currentTarget.duration-.001));}}
     onError={()=>setError('The frame preview could not be loaded. Reopen the clip and try again.')} />
    {f&&<div className="relative select-none" style={{touchAction:'none'}}
     onPointerDown={event=>{anchor.current=point(event);setRegion(null);event.currentTarget.setPointerCapture(event.pointerId);}}
     onPointerMove={event=>{if(!anchor.current)return;const p=point(event),a=anchor.current;setRegion([Math.min(a[0],p[0]),Math.min(a[1],p[1]),Math.max(a[0],p[0]),Math.max(a[1],p[1])]);}}
     onPointerUp={()=>{anchor.current=null;}} onPointerCancel={()=>{anchor.current=null;}}>
     <img ref={image} draggable={false} src={media(f.file)} alt="Select a character region" className="block w-full"/>
     {region&&<div className="pointer-events-none absolute border-2 border-cyan-300 bg-cyan-300/10" style={{left:region[0]/10+'%',top:region[1]/10+'%',width:(region[2]-region[0])/10+'%',height:(region[3]-region[1])/10+'%'}}/>}
    </div>}
    <label className="block text-sm">Video frame · {time.toFixed(3)}s
     <input aria-label="Video frame" type="range" className="block min-h-11 w-full accent-violet-500"
      min={0} max={Math.max(0,w.duration-.001)} step={.001} list={frameTicks}
      value={time} aria-valuetext={`${time.toFixed(3)} seconds`} disabled={busy||processing}
      onChange={event=>chooseFrameTime(Number(event.target.value))}/>
    </label>
    <datalist id={frameTicks}>{w.frames.map(item=><option key={item.id} value={item.time}/>)}</datalist>
    <button className={button} disabled={busy||processing||!!f} onClick={()=>void captureFrame()}>Use this frame</button>
    {f&&<>
     <p className="text-xs text-white/70">Drag around the character. Reconstructed hidden details require your review.</p>
     <button className={button} disabled={!region||busy||processing}
      onClick={()=>void action('crop',{frame:f.id,box:region,character})}>{character?'Add as reference':'Add selected character region'}</button>
    </>}
   </details>
  );
 }

 return <details open={reviewedLibraryFlow ? true : undefined} className="rounded-xl border border-cyan-300/30 bg-black/20 p-3" id="video-character-prototype"><summary className="cursor-pointer text-lg font-semibold">{reviewedLibraryFlow ? "Review extracted characters" : "Video → Character & Voice · Admin prototype"}</summary>
 <div className="mt-3 min-w-0 space-y-3">{!player && <>{!library && <p className="text-sm text-white/70">TEST only. RTX 5060 Ti first, RTX 3060 fallback. Frame and voice extraction run on CPU. Reuse an existing video. Approve the recreated appearance, listen to numbered samples, then assign voices yourself.</p>}
 <label className="block text-sm">Resume extraction<select className={input} value={w?.id||''} disabled={busy} onChange={e=>{const id=e.target.value;if(!id){setW(null);return;}void execute(async()=>{const b=await api<{workspace:Workspace}>(undefined,id);if(alive.current){setW(b.workspace);setCid('');}});}}><option value="">New extraction</option>{listing.workspaces.map(x=><option key={x.id} value={x.id}>{x.sourceName}</option>)}</select></label>
 </>}
 {player&&w?.stage===0&&!processing&&<button className={button} disabled={busy} onClick={()=>void action('analyze',{includeVoice:false})}>Analyze clip</button>}
 {error&&<p role="alert" className="rounded-lg bg-red-950/60 p-3 text-sm">{error}</p>}
 {w&&<><nav aria-label="Extraction steps" className="flex gap-1 overflow-x-auto">{steps.map((s,i)=><button key={s} className={`${button} shrink-0 ${w.stage===i?'bg-violet-700/60':''}`} disabled={busy||processing} aria-current={w.stage===i?'step':undefined} onClick={()=>void action('stage',{stage:i})}>{i+1}. {s}</button>)}</nav><p role="status" className="text-sm text-cyan-200">{w.message}</p>{w.warnings.map(x=><p key={x} className="text-sm text-amber-200">{x}</p>)}</>}
 {!player&&(!w||w.stage===0)&&<div className="space-y-3"><VideoSourcePicker sources={listing.sources} value={source} disabled={busy||!!processing} onChange={setSource}/><button className={button} disabled={busy||!source} onClick={()=>void execute(async()=>{const b=await api<{workspace:Workspace}>({action:'new',source});setW(b.workspace);setSource('');await loadList();})}>Use video</button>
 <label className={`${button} inline-flex cursor-pointer items-center`}>Upload MP4<input type="file" accept="video/mp4,.mp4" className="sr-only" disabled={busy} onChange={event=>{const file=event.target.files?.[0];event.target.value='';if(file)void execute(()=>uploadVideo(file));}}/></label><p className="text-xs text-white/60">{EXTRACTION_VIDEO_LIMIT_DESCRIPTION}. Source media stays intact.</p>
 {w&&<>{!source&&<video src={media('source.mp4')} controls playsInline preload="metadata" className="max-h-80 w-full"/>}{!library && <><label className="block text-sm">Expected voices (optional)<select className={input} value={expected} onChange={e=>setExpected(e.target.value)}><option value="">Automatic</option>{[1,2,3,4,5].map(n=><option key={n} value={n}>{n}</option>)}</select></label><label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={separate} onChange={e=>setSeparate(e.target.checked)}/>Reduce music/effects first · local BandIt CPU</label></>}<button className={button} disabled={busy||processing||!!w.frames.length} onClick={()=>void action('analyze',library?{includeVoice:false}:{expectedVoices:expected?Number(expected):undefined,separate})}>{processing?'Analyzing locally…':library?'Analyze video':'Extract frames & numbered voices'}</button></>}</div>}
 {w&&w.stage===1&&<div className="space-y-3"><p className="text-sm">Select character appearances. Merge only appearances you recognize as the same identity. Link alternate forms explicitly.</p><label className="flex gap-2 text-sm"><input type="checkbox" checked={showObjects} onChange={e=>setShowObjects(e.target.checked)}/>Show all detected objects and props</label>
 <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{w.candidates.filter(c=>showObjects||c.selected||c.nameSavedAt||/person|man|woman|girl|boy|soldier|warrior|human|demon|king|queen|character|cat|dog|animal|creature|bird|dragon|bear|horse|monster|robot/i.test(c.name)).map(x=><div key={x.id} className={`min-w-0 rounded-lg border p-2 ${cid===x.id?'border-cyan-300':'border-white/15'}`}><button className="w-full text-left" onClick={()=>setCid(x.id)}><img src={media(x.file)} alt={x.name} className="h-32 w-full object-contain"/><span className="block truncate text-sm">{x.name}</span><span className="text-xs text-white/60">Extracted · {w.frames.find(f=>f.id===x.frame)?.time}s</span></button><label className="mt-1 flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={x.selected} disabled={busy||processing} onChange={e=>void action('character',{character:x.id,selected:e.target.checked})}/>Use character</label></div>)}</div>
 {frameCrop()}
 </div>}
 {w&&w.stage>=1&&w.stage<=4&&<label className="block text-sm">Character<select className={input} value={cid} onChange={e=>setCid(e.target.value)}><option value="">Choose a character…</option>{(w.stage===1?w.candidates:selected).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
 {c&&w&&w.stage>=1&&w.stage<=4&&<ExtractedCharacterName key={w.id+":"+c.id} name={c.name} saved={!!(c.nameSavedAt||c.globalId)} busy={!!(busy||processing)} onSave={name=>action('rename-character',{character:c.id,name},true)}/>}
 {c&&w?.stage===1&&<div className="space-y-2"><label className="block text-sm">Appearance<textarea className={input} value={description} maxLength={2000} onChange={e=>setDescription(e.target.value)}/></label><button className={button} disabled={busy||processing} onClick={()=>void action('character',{character:c.id,description})}>Save corrections</button>
 <select className={input} aria-label="Another appearance" value={other} onChange={e=>setOther(e.target.value)}><option value="">Another appearance or alternate form…</option>{w.candidates.filter(x=>x.id!==c.id).map(x=><option key={x.id} value={x.id}>{x.name} · {w.frames.find(f=>f.id===x.frame)?.time}s</option>)}</select><div className="flex flex-wrap gap-2"><button className={button} disabled={!other||busy||processing} onClick={()=>void action('merge',{character:c.id,other})}>Merge same identity</button><button className={button} disabled={!other||busy||processing} onClick={()=>void action('link-form',{character:c.id,other})}>Link alternate form</button>{c.mergedFrom?.includes(other)&&<button className={button} disabled={busy||processing} onClick={()=>void action('split',{character:c.id,other})}>Split appearance</button>}</div><p className="text-xs text-white/60">{c.mergedFrom?.length||0} merged appearances · {c.alternateForms.length} explicitly linked forms</p></div>}
 {c && w?.stage === 2 && <div className="space-y-3">
   <p className="text-sm">Choose up to four frames of {c.name}. Use different angles to show the face, outfit and body.</p>
   <p role="status" className="text-sm text-cyan-200">{references.length} of {MAX_CHARACTER_REFERENCES} references selected</p>
   {reviewedLibraryFlow && !!references.length && <div className="grid gap-2 sm:grid-cols-2">{references.map((id,index)=>
   <label key={id} className="block text-sm">Reference {index+1} role
    <select className={input} value={c.referenceRoles?.[id]||''} disabled={busy||processing} onChange={event=>void action('source-role',{character:c.id,reference:id,role:event.target.value})}>
      <option value="" disabled>Choose role</option>{SOURCE_VIEW_ROLES.map(role=><option key={role}>{role}</option>)}
    </select>
   </label>)}</div>}
 <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
     {w.candidates.filter(item => item.id === c.id || c.mergedFrom?.includes(item.id)).map(item => {
       const index = references.indexOf(item.id);
       const checked = index >= 0;
       const time = w.frames.find(f => f.id === (item.extractedFrame || item.frame))?.time;
       return <button key={item.id} type="button" aria-pressed={checked}
         className={`${button} min-w-0 ${checked ? 'border-cyan-300 bg-cyan-950/50' : ''}`}
         disabled={busy || processing || (checked ? references.length === 1 : references.length >= MAX_CHARACTER_REFERENCES)}
         onClick={() => void action('references', {
           character: c.id,
           references: checked ? references.filter(id => id !== item.id) : [...references, item.id],
         })}>
         <img src={media(item.extractedFile || item.file)} alt="" loading="lazy" className="h-28 w-full object-contain" />
         <span className="block">{checked ? `Reference ${index + 1}` : 'Add reference'}{time !== undefined && ` · ${time.toFixed(1)}s`}</span>
       </button>;
     })}
   </div>
   {references.length < MAX_CHARACTER_REFERENCES && frameCrop(c.id)}
   {c.views.length > 0 && <p className="text-xs text-white/60">Changing the references starts a new set of views.</p>}
   {reviewedLibraryFlow && <CharacterDevelopmentPanel workspace={w} character={c} busy={!!(busy||processing)} media={media} onAction={action}/>}
   {!reviewedLibraryFlow && <button className={button} disabled={busy || processing || !!c.views.length}
     onClick={() => void action('reconstruct', {character: c.id})}>Recreate four views · Qwen Image 2.1</button>}
   {!reviewedLibraryFlow&&<>   <div className="grid grid-cols-2 gap-2">{c.views.map(v=><figure key={v.id} className="min-w-0 rounded-lg border border-white/15 p-2">{v.file?<a href={media(v.file)} target="_blank" rel="noreferrer"><img src={media(v.file)} alt={v.angle+' reconstructed view'} className="h-52 w-full object-contain"/></a>:<p className="text-sm">{v.state==='queued'&&v.error?'Waiting for review':v.state}</p>}<figcaption className="text-xs">{v.angle} · AI reconstructed{v.gpu&&<span className="block">{v.gpu==='rtx3090'?'RTX 3090':v.gpu==='rtx5060ti'?'RTX 5060 Ti':'RTX 3060'}</span>}{v.error&&<span className="block text-amber-200">{v.error}</span>}</figcaption></figure>)}</div><details><summary className="cursor-pointer text-sm">Correct or retry one view</summary><select className={input} aria-label="View to recreate" value={fixView} onChange={e=>setFixView(e.target.value)}><option value="">Choose view…</option>{c.views.filter(v=>!v.master).map(v=><option key={v.id} value={v.id}>{v.angle} · {v.state}</option>)}</select><label className="block text-sm">Correction (optional)<textarea className={input} maxLength={1000} value={correction} onChange={e=>setCorrection(e.target.value)} placeholder="Show a front three-quarter view, with both eyes visible."/></label><button className={button} disabled={busy||processing||!fixView} onClick={()=>void action('regenerate-view',{character:c.id,view:fixView,correction})}>Recreate this view</button><p className="text-xs text-white/60">Previous image files are preserved. Appearance and voice approval must be renewed.</p></details>{!reviewedLibraryFlow && <button className={button} disabled={busy||processing||c.views.length!==4||c.views.some(v=>v.state!=='ready')} onClick={()=>void action('approve',{character:c.id})}>{c.approved?'Appearance approved':'Approve this appearance & all four views'}</button>}</>}
 </div>}
 {reviewedLibraryFlow&&c&&w?.stage===3&&<div className="space-y-3">
   <p className="text-sm">Voice is optional. Save the character first; one image is enough.</p>
   <ExtractedCharacterVoiceCreator key={w.id+":"+c.id} workspace={w} character={c} busy={!!(busy||processing)} onSaved={setW}/>
   <details className="space-y-3"><summary className="min-h-11 cursor-pointer py-2 text-sm">Use a saved voice or voice from this clip</summary>
   <button className={button} disabled={!c.globalId||busy||processing} onClick={()=>void action('analyze-voices')}>Listen to voices from the clip</button>
   {w.voices.map(sample=><div key={sample.id} className="space-y-1">
     <label className="block"><input type="radio" checked={voice===sample.id} disabled={sample.combined||sample.duration<2}
       onChange={()=>{setVoice(sample.id);setConfirmedVoice(false);}}/> {sample.name}</label>
     <audio controls preload="none" className="w-full" src={media(sample.file)}/>
     <p className="text-xs">{sample.warning}</p>
   </div>)}
   <label className="block text-sm">Or choose a saved voice<select className={input} value={voiceChoices.some(choice=>choice.id===voice)?voice:''}
     onChange={event=>{setVoice(event.target.value);setConfirmedVoice(false);}}><option value="">Choose a voice</option>{voiceChoices.map(choice=><option key={choice.id} value={choice.id}>{choice.name}</option>)}</select></label>
   <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={confirmedVoice} onChange={event=>setConfirmedVoice(event.target.checked)}/>I confirmed this is the intended voice</label>
   <button className={button} disabled={!c.globalId||!confirmedVoice||!voice||busy||processing}
     onClick={()=>void action('attach-player-voice',{character:c.id,voice,confirm:true})}>Attach Voice</button>
   </details>
 </div>}
 {!reviewedLibraryFlow&&c&&w?.stage===3&&<div className="space-y-3">{c.views.find(v=>v.angle==='face')?.file&&<img src={media(c.views.find(v=>v.angle==='face')!.file!)} alt={c.name} className="mx-auto max-h-52"/>}<p className="font-semibold">Which voice belongs to {c.name}?</p><p className="text-sm text-white/70">Listen first. Voice numbers are estimates, never matched to faces. Music/effects can remain in extracted turns.</p>{w.voices.map(v=><div key={v.id} className="space-y-2 rounded-lg border border-white/15 p-3"><label className="flex min-h-11 gap-2"><input type="radio" name={'voice-'+w.id} checked={voice===v.id} onChange={()=>setVoice(v.id)}/>{v.name} · {v.duration.toFixed(1)}s</label><audio controls preload="metadata" src={media(v.file)} className="w-full"/><p className="text-xs text-amber-200">{v.warning}</p><details><summary className="cursor-pointer text-xs">Available segments</summary>{v.segments.map((s,i)=><div key={i} className="mt-2 text-xs">{s.start.toFixed(2)}–{s.end.toFixed(2)}s{s.file&&<audio controls preload="none" src={media(s.file)} className="w-full"/>}</div>)}</details></div>)}<div className="flex flex-wrap gap-2"><button className={button} disabled={!voice||!c.approved||busy||processing} onClick={()=>void action('assign-voice',{character:c.id,voice})}>Attach Voice</button><button className={button} onClick={()=>setVoice('')}>Try Another Voice</button><button className={button} disabled={!c.approved||busy||processing} onClick={()=>void action('assign-voice',{character:c.id,voice:null})}>No Voice</button></div><p className="text-sm">{c.voiceReviewed?c.voiceId?'Voice attached by your selection.':'No voice selected.':'Appearance approval and explicit voice choice are required.'}</p><details><summary className="cursor-pointer text-sm">Choose a different speech region</summary><div className="grid grid-cols-2 gap-2"><label className="text-sm">Start (seconds)<input type="number" className={input} value={start} min={0} max={w.duration} step={.1} onChange={e=>setStart(Number(e.target.value))}/></label><label className="text-sm">End (seconds)<input type="number" className={input} value={end} min={0} max={w.duration} step={.1} onChange={e=>setEnd(Number(e.target.value))}/></label></div><button className={button} disabled={busy||processing} onClick={()=>void action('voice-region',{start,end,group})}>Extract region for listening</button><label className="block text-sm">Group this turn with (optional)<select className={input} value={group} onChange={e=>setGroup(e.target.value)}><option value="">New numbered sample</option>{w.voices.map(v=><option key={v.id} value={v.id}>{v.name}</option>)}</select></label></details></div>}
 {reviewedLibraryFlow&&c&&w?.stage===4&&<ExtractedCharacterFinalReview workspace={w} character={c} busy={!!(busy||processing)} media={media} onAction={action}/>}

 {!reviewedLibraryFlow&&c&&w?.stage===4&&<div className="space-y-3"><p className="text-sm">{c.name} · {c.approved?'Appearance approved':'Appearance needs approval'} · {c.voiceReviewed?(c.voiceId?'Manually assigned voice':'No voice'):'Voice choice needed'}</p><label className="block text-sm">Save as<select className={input} value={target} onChange={e=>setTarget(e.target.value)}><option value="card">Character Card</option><option value="refmod">RefMod</option><option value="both">Both</option></select></label><label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={global} onChange={e=>setGlobal(e.target.checked)}/>Also add this Character Card to my reusable global Characters library</label><p className="text-xs text-white/60">Private to source production by default. RefMods remain private to this prototype until a later integration. Existing characters and bundles are preserved.</p><button className={button} disabled={busy||processing||!c.approved||!c.voiceReviewed} onClick={()=>void action('save',{character:c.id,target,global})}>{target==='both'?'Save Both':target==='card'?'Save Character Card':'Create RefMod'}</button>{c.card&&<p role="status" className="text-sm text-emerald-300">Character Card saved privately.{c.globalId?' Also added to Characters.':''}</p>}{c.bundle&&<p role="status" className="text-sm text-cyan-200">RefMod: {c.bundle.state==='ready'?'Validated bundle ready · '+c.bundle.tokens+' tokens':c.bundle.state}{c.bundle.error&&' · '+c.bundle.error}{c.bundle.state==='ready'&&c.bundle.file&&<a className="ml-2 underline" href={media(c.bundle.file)}>Download RefMod bundle</a>}</p>}</div>}
 {w&&<div className="flex justify-between gap-2"><button className={button} disabled={busy||processing||w.stage===0} onClick={()=>void action('stage',{stage:w.stage-1})}>Back</button><button className={button} disabled={busy||processing||w.stage===4||!w.frames.length} onClick={()=>void action('stage',{stage:w.stage+1})}>Next · {steps[w.stage+1]||'Done'}</button></div>}
 </div></details>;
}
