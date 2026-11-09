"use client";
import {useState} from "react";
import {directionApproved,directionBrief,directionProblems} from "@/lib/productionStudio/shotDirection";
import {storyboardCurrent} from "@/lib/productionStudio/workflow";
import {DEFAULT_SHOT} from "@/lib/productionStudio/model";
import {plannedSeconds} from "@/lib/productionStudio/shotPolicy";
import type {useStudio} from "./useStudio";
import {Button,Field,inputClass} from "./Controls";
import ClipNavigation,{activeClip} from "./ClipNavigation";
import AssetPreview from "./AssetPreview";
import ShotDirection,{DirectionSummary} from "./ShotDirection";
import ShotVideo from "./ShotVideo";
import ClipControls from "./ClipControls";
import ShotContinuity from "./ShotContinuity";
type S=ReturnType<typeof useStudio>;
export default function Action({s,run,onStoryboard}:{s:S;run:(f:()=>Promise<unknown>)=>void;onStoryboard:()=>void}){
 const p=s.project!,{clips,clip}=activeClip(s),[reprompt,setReprompt]=useState(false),[submitting,setSubmitting]=useState(false);
 if(!clip||!p.shots[clip.id])return <p>Plan a video clip and approve its storyboard first.</p>;
 const settings=p.shots[clip.id]||DEFAULT_SHOT,brief=directionBrief(p,clip.id),image=s.assets.find(a=>a.id===settings.storyboardId),busy=submitting||s.jobs.some(j=>j.input.shotId===clip.id&&['queued','running','canceling','attention'].includes(j.status));
 const generate=(kind:string,extra:Record<string,unknown>={})=>{
  if(busy)return;if(!confirm(kind==='finish'?'Upscale the approved take? Source video and audio remain saved.':'Generate a new take with the displayed settings? Earlier takes remain saved.'))return;
  setSubmitting(true);run(async()=>{try{await s.job({kind,shotId:clip.id,...extra});}finally{setSubmitting(false);}});
 };
 const method=clip.generationApproach==='text-to-video'?'text':clip.generationApproach==='image-to-video'?'image':settings.referenceIds.length===1&&settings.referenceIds[0]===settings.storyboardId?'storyboard-reference':'references';
 return <div className="space-y-4" aria-label="Action workspace">
  <ClipNavigation s={s} workspace="Action" run={run}/><h3 className="text-lg font-semibold">Video Clip {clips.indexOf(clip)+1} — {plannedSeconds(clip)} seconds</h3>
  {image&&<div className="max-w-xl"><AssetPreview asset={image}/></div>}
  <DirectionSummary brief={brief}/>
  {!storyboardCurrent(p,clip.id)&&<div role="status" className="rounded-xl border border-amber-300/30 p-3"><p>The current storyboard sequence needs approval. Previous takes remain playable below.</p><Button onClick={onStoryboard}>Review in Storyboard</Button></div>}
  <Field label="Generate this clip using"><select className={inputClass} value={method} disabled={!s.saved||busy} onChange={e=>run(()=>s.commit({type:'clip.method',shotId:clip.id,method:e.target.value}))}><option value="image">Start from Image · actual first frame</option><option value="storyboard-reference">Use Storyboard as Reference</option><option value="references">Use Selected References / RefMods</option><option value="text">Text Only · no references</option></select></Field>
  <p className="text-xs text-white/60">{method==='image'?'The image is connected to native first-frame conditioning; unsupported combinations are blocked.':method==='text'?'No character, image, audio, video or RefMod references are supplied. Established identities may vary.':'References guide identity and composition, not necessarily frame zero.'}</p>
  {!directionApproved(p,clip.id)&&!!settings.storyboardApproval&&settings.storyboardApproved&&<div className="space-y-2"><p className="text-sm text-amber-200">Review the selected mode/settings before generation. {directionProblems(p,clip.id).join(' ')}</p><Button disabled={!s.saved||busy} onClick={()=>run(()=>s.commit({type:'shot.direction.approve',shotId:clip.id,brief,durationConsent:brief.duration}))}>Approve Direction for These Settings</Button></div>}
  <details className="rounded-xl border border-white/10 p-3"><summary className="cursor-pointer font-medium">References & Settings</summary><ClipControls s={s} run={run} shotId={clip.id} busy={busy}/><ShotContinuity s={s} run={run} shotId={clip.id}/></details>
  {reprompt&&<ShotDirection key={clip.id} context="Action" s={s} run={run} shotId={clip.id} busy={busy} onImage={onStoryboard} onApproved={async()=>setReprompt(false)}/>}
  <ShotVideo key={clip.id+'video'} context="Action" s={s} run={run} shotId={clip.id} busy={busy} generate={generate} editPrompt={()=>setReprompt(v=>!v)}/>
  <div className="flex flex-wrap gap-2"><Button disabled={!s.saved} onClick={()=>run(s.flush)}>Save and Continue Later</Button><Button disabled={!s.saved||!settings.approvedTakeId} onClick={()=>run(()=>s.commit({type:'workflow.navigate',workspace:'Edit',clipId:clip.id}))}>Edit Approved Clip</Button>{clips[clips.indexOf(clip)+1]&&<Button disabled={!s.saved||!settings.approvedTakeId} onClick={()=>run(()=>s.commit({type:'workflow.navigate',workspace:'Action',clipId:clips[clips.indexOf(clip)+1].id}))}>Next Clip</Button>}</div>
 </div>;
}
