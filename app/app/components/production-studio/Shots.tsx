"use client";
import {useState,useEffect,useRef} from "react";
import {useStoredDraft} from "./useStoredDraft";
import {plannedSeconds,nativeShotSeconds} from "@/lib/productionStudio/shotPolicy";
import {shotContext} from "@/lib/productionStudio/shotDirector";
import {segmentForScene} from "@/lib/productionStudio/filmStructure";
import ShotContinuity from "./ShotContinuity";
import ShotStoryboard from "./ShotStoryboard";
import ShotVideo,{ShotVideoSettings} from "./ShotVideo";
import ShotPromptEditor from "./ShotPromptEditor";
import ShotDirection,{DirectionTechnical} from "./ShotDirection";
import {shotJobBusy} from "./ShotJob";
import {shotNarration,prepareShotImage} from "@/lib/productionStudio/shotPreparation";
import {useTalkback,PlaybackControls} from "./Talkback";
import SequenceReview from "./SequenceReview";
import {allShots,shotPhase} from "@/lib/productionStudio/model";
import type {useStudio} from "./useStudio";
import {Button,Field,inputClass} from "./Controls";
import ClipControls from "./ClipControls";
import {startingImageReady} from "@/lib/productionStudio/clipConfiguration";
type S=ReturnType<typeof useStudio>;
export default function Shots({s,run}:{s:S;run:(fn:()=>Promise<unknown>)=>void}){
 const p=s.project!,shots=allShots(p),[selected,setSelected]=useStoredDraft(s.scopeKey+":selected-shot",""),[submitting,setSubmitting]=useState(false),[savedLater,setSavedLater]=useState(false),[advanced,setAdvanced]=useState(false),[imageEditor,setImageEditor]=useState(false);
 const lock=useRef(false),narrator=useTalkback(),shot=shots.find(x=>x.id===selected)||shots[0],text=shot?shotNarration(p,shot.id):"",stop=narrator.stop;
 useEffect(()=>()=>stop(),[shot?.id,text,stop]);
 if(!shot)return <p>Expand and approve one scene's camera coverage in Plan. Planning does not generate video.</p>;
 const {settings,scene}=shotContext(p,shot.id),segment=segmentForScene(p,scene.id),act=p.plan.acts.find(a=>a.scenes.some(v=>v.id===scene.id)),index=shots.indexOf(shot),busy=submitting||shotJobBusy(s,shot.id);
 const stage=settings.shotStage||"direction";
 const changeStage=async(value:"image"|"direction"|"review",retake=false)=>{narrator.stop();await s.commit({type:"shot.settings",shotId:shot.id,patch:{shotStage:value,retakeMode:retake}});setAdvanced(false);setImageEditor(false);};
 const openRetake=()=>run(()=>changeStage("direction",true));
 const moveTo=(i:number)=>run(async()=>{await s.flush();narrator.stop();setSelected(shots[i].id);setSavedLater(false);setAdvanced(false);setImageEditor(false);});
 const generation=(kind:string,extra:Record<string,unknown>={})=>{
  if(lock.current||busy)return;
  const prepared=kind==="storyboard"?prepareShotImage(p,shot.id,s.assets):undefined;
  if(!confirm(kind==="regenerate"?"Create a NEW high-quality take? Its performance may differ; existing takes stay saved.":kind==="finish"?"Upscale the approved video to approximately 1 MP? The source and timing stay preserved.":kind==="storyboard"?["Generate a starting image for this shot?",...(prepared?.warnings||[])].join("\n"):"Generate this approved shot direction? Previous takes stay saved."))return;
  lock.current=true;setSubmitting(true);run(async()=>{try{await s.job({kind,shotId:shot.id,confirmReferenceWarnings:true,...extra});}finally{lock.current=false;setSubmitting(false);}});
 };
 return <div className="space-y-4 min-w-0">
  <p className="text-xs text-purple-200">{p.plan.acts.length>1?act?.title+" › ":""}{segment?segment.title+" › ":""}{scene.title} › Video Clip {index+1}</p>
  <Field label="Current video clip"><select className={inputClass} value={shot.id} onChange={e=>moveTo(shots.findIndex(v=>v.id===e.target.value))}>{shots.map((v,i)=><option key={v.id} value={v.id}>Video Clip {i+1} · {v.description.slice(0,50)} · {shotPhase(p,v,s.jobs)}</option>)}</select></Field>
  <div className="flex justify-between items-center gap-2"><h3 className="font-semibold text-lg">Video Clip {index+1} — {plannedSeconds(shot)} seconds</h3><Button aria-label="Listen to Video Clip" disabled={!s.saved} onClick={()=>void narrator.playShot(shot.id,text)}>🔊</Button></div>
  {narrator.activeId===shot.id&&<PlaybackControls/>}
  {!!shot.takes.length&&stage!=="review"&&<div className="flex flex-wrap gap-2">{!settings.retakeMode&&<Button disabled={!s.saved} onClick={openRetake}>Change with AI</Button>}<Button disabled={!s.saved} onClick={()=>run(()=>changeStage("review"))}>View Existing Takes</Button></div>}
  <nav aria-label="Video clip creation steps" className="grid grid-cols-3 gap-2">{([["image","Image"],["direction","Direction"],["review","Review"]] as const).map(([value,label])=><Button key={value} aria-current={stage===value?"step":undefined} className={stage===value?"!bg-purple-700/40 !px-2":"!px-2"} disabled={!s.saved} onClick={()=>run(()=>changeStage(value))}>{label}</Button>)}</nav>
  {p.plan.status!=="approved"&&<div className="rounded-xl border border-amber-400/30 p-3"><p>Camera coverage changed. Review it before generating; previous media are retained.</p><Button disabled={!s.saved} onClick={()=>run(()=>s.commit({type:"shots.approve"}))}>Approve Camera Coverage</Button></div>}
  {stage==="image"&&<><ShotStoryboard key={shot.id} s={s} run={run} shotId={shot.id} generate={generation} busy={busy} editPrompt={()=>{setAdvanced(true);setImageEditor(true);}}/><Button disabled={!s.saved||!startingImageReady(p,shot.id)} onClick={()=>run(()=>changeStage("direction"))}>Continue to Video Direction</Button></>}
  {stage==="direction"&&<ShotDirection key={shot.id} s={s} run={run} shotId={shot.id} busy={busy} onApproved={()=>changeStage("review")} onImage={()=>run(()=>changeStage("image"))} onGenerate={async(retakeTakeId)=>{await changeStage("review");const latest=shot.takes.filter(t=>t.assetId).at(-1),a=s.assets.find(a=>a.id===latest?.assetId);generation((retakeTakeId?a?.metadata.quality==="hq":settings.quality?settings.quality==="hq":a?.metadata.quality==="hq")?"regenerate":"preview",retakeTakeId?{retakeTakeId}:{});}}/>}
  {stage==="review"&&<ShotVideo key={shot.id} s={s} run={run} shotId={shot.id} generate={generation} busy={busy} editPrompt={shot.takes.length?openRetake:()=>run(()=>changeStage("direction"))}/>}
  <details open={advanced} onToggle={e=>setAdvanced(e.currentTarget.open)} className="rounded-xl border border-white/10 p-3"><summary className="cursor-pointer">References & Settings</summary><div className="space-y-4 pt-4">
   <p className="text-xs">{nativeShotSeconds(plannedSeconds(shot))}s native source → {plannedSeconds(shot)}s review range. No speed change. Original source retained.</p>
   <ClipControls key={shot.id} s={s} shotId={shot.id} run={run} busy={busy}/>
   <ShotContinuity s={s} run={run} shotId={shot.id}/>
   <Button aria-expanded={imageEditor} onClick={()=>setImageEditor(v=>!v)}>Edit Starting-Image Prompt</Button>
   {imageEditor&&<ShotPromptEditor key={shot.id} s={s} run={run} shotId={shot.id} target="storyboard" setTarget={()=>{}} busy={busy} imageOnly/>}
   <details><summary className="cursor-pointer py-2">Approved plan & camera coverage</summary><div className="space-y-3">
    <p className="text-xs">Changing these plan fields requires camera-coverage approval again. Use video direction above for take-specific changes.</p>
    {(["description","cameraFraming","cameraMovement"] as const).map((key,i)=><Field key={key} label={["Planned action","Framing","Camera movement"][i]}><textarea className={inputClass} value={shot[key]} onChange={e=>s.change({type:"shot.patch",shotId:shot.id,patch:{[key]:e.target.value}})}/></Field>)}
    <Field label="Planned duration · 1–10 seconds"><input className={inputClass} type="number" min={1} max={10} step={.1} value={plannedSeconds(shot)} onChange={e=>{const v=Number(e.target.value);if(v>=1&&v<=10)s.change({type:"shot.patch",shotId:shot.id,patch:{plannedDurationSeconds:v}});}}/></Field>
    <p className="text-sm">Original dialogue: {shot.dialogue.map(d=>d.speaker+": "+d.line).join(" / ")}</p>
    <div className="flex flex-wrap gap-2"><Button disabled={!s.saved||busy} onClick={()=>run(()=>s.commit({type:"shot.add",sceneId:scene.id}))}>+ Video Clip</Button><Button disabled={!index||busy} onClick={()=>s.change({type:"shot.move",shotId:shot.id,direction:-1})}>Move Earlier</Button><Button disabled={index===shots.length-1||busy} onClick={()=>s.change({type:"shot.move",shotId:shot.id,direction:1})}>Move Later</Button><Button disabled={!s.saved||busy} onClick={()=>{if(confirm("Remove this planned shot? Its media and previous revisions remain recoverable."))run(()=>s.commit({type:"shot.remove",shotId:shot.id}));}}>Remove Video Clip</Button></div>
   </div></details>
   <SequenceReview s={s} run={run} shotId={shot.id}/>
  </div></details>
  <div className="flex flex-wrap gap-2"><Button disabled={!index||!s.saved} onClick={()=>moveTo(index-1)}>Previous Clip</Button><Button disabled={index===shots.length-1||!s.saved} className={settings.finalAssetId?"!bg-purple-700/40":""} onClick={()=>moveTo(index+1)}>Next Clip</Button><Button disabled={!s.saved} onClick={()=>run(async()=>{await s.flush();setSavedLater(true);})}>Save and Continue Later</Button></div>
  {savedLater&&<p role="status" className="text-sm">Saved. Resume this step later; unfinished work is not marked complete.</p>}
 </div>;
}
