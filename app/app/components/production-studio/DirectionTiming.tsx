"use client";
import {useState} from "react";
import {directionBrief,directionKey} from "@/lib/productionStudio/shotDirection";
import {timingOptions,moveDialogueProposal,type MoveDialogueProposal} from "@/lib/productionStudio/directionTiming";
import type {DirectionBrief} from "@/lib/productionStudio/shotDirection";
import type {useStudio} from "./useStudio";
import {Button} from "./Controls";
type S=ReturnType<typeof useStudio>;
type Preview={choice:"keep"|"extend"|"move";brief:DirectionBrief;key:string;move?:MoveDialogueProposal};
export default function DirectionTiming({s,shotId,ask,edit}:{s:S;shotId:string;ask:(text:string)=>void;edit:()=>void}){
 const p=s.project!,brief=directionBrief(p,shotId),options=timingOptions(brief);
 const [preview,setPreview]=useState<Preview|null>(null),[state,setState]=useState(""),[error,setError]=useState(""),[approveBoth,setApproveBoth]=useState(false);
 const choose=(choice:Preview["choice"])=>{
  setError("");setState("");setApproveBoth(false);
  if(choice==="keep"&&!options.keep){ask(`Keep this clip at ${brief.duration} seconds. Propose a concise dialogue adjustment that fits naturally, preserving speaker identities and the entrance action. Show the exact proposed words and valid timestamps for approval; do not apply anything or add later story events.`);return;}
  try{const move=choice==="move"?moveDialogueProposal(p,shotId):undefined,next=move?.source||(choice==="keep"?options.keep:options.extend);if(!next)throw Error("The exact dialogue cannot fit within ten seconds. Choose Adjust Dialogue or Edit Manually.");setPreview({choice,brief:next,key:directionKey(p,shotId),move});}catch(e){setError(e instanceof Error?e.message:String(e));}
 };
 const apply=async()=>{
  if(!preview||state==="Applying Changes")return;setState("Applying Changes");setError("");
  try{await s.commit({type:"shot.direction.timing",shotId,basedOnKey:preview.key,choice:preview.choice,durationConsent:preview.brief.duration,targetId:preview.move?.targetId,targetKey:preview.move?.targetKey,approveBothShots:approveBoth});setPreview(null);setState("Applied");}catch(e){setState("Failed");setError(e instanceof Error?e.message:String(e));}
 };
 return <div className="space-y-3 rounded-xl border border-amber-400/30 p-3">
  <p>Your dialogue does not fit its current timing in this {brief.duration}-second clip. How would you like to fix it?</p>
  <div className="flex flex-wrap gap-2"><Button disabled={!s.saved||state==="Applying Changes"} onClick={()=>choose("keep")}>Keep {brief.duration} Seconds — Adjust Dialogue</Button>{options.extend&&<Button disabled={!s.saved||state==="Applying Changes"} onClick={()=>choose("extend")}>Extend to {options.extend.duration} Seconds</Button>}<Button disabled={!s.saved||state==="Applying Changes"} onClick={()=>choose("move")}>Move Dialogue to Next Clip</Button><Button onClick={edit}>Edit Manually</Button></div>
  <p className="text-xs text-white/60">Nothing changes until you approve. Retiming keeps the exact words; shorter dialogue is proposed by the Director for review.</p>
  {preview&&<div role="region" aria-label="Timing correction preview" className="space-y-2">
   <p className="font-semibold">Waiting for Approval · {brief.duration}s → {preview.brief.duration}s</p>
   {preview.brief.dialogue.map((d,i)=><p className="text-sm" key={i}>{d.speaker}, {d.startSeconds}–{d.endSeconds}s: “{d.line}”</p>)}
   {preview.move&&<><p className="text-sm">{preview.move.alreadyInNext?"This exact line already exists in the next clip. Remove its duplicate here and correct the next clip’s timing.":"Move these exact words to the next clip; do not add another visible person."}</p>{preview.move.target.dialogue.map((d,i)=><p className="text-sm" key={i}>Next shot · {d.speaker}, {d.startSeconds}–{d.endSeconds}s: “{d.line}”</p>)}<p>Next shot duration: {preview.move.target.duration}s. Existing takes remain unchanged.</p><label className="flex gap-2 text-sm"><input type="checkbox" checked={approveBoth} onChange={e=>setApproveBoth(e.target.checked)}/>I approve changing dialogue and the displayed timing in both clips, including their approved scene coverage.</label></>}
   <div className="flex flex-wrap gap-2"><Button disabled={!s.saved||state==="Applying Changes"||preview.key!==directionKey(p,shotId)||!!preview.move&&!approveBoth} onClick={()=>void apply()}>{preview.move?"Apply to Both Shots":`Apply ${preview.brief.duration}-Second Timing`}</Button><Button disabled={state==="Applying Changes"} onClick={()=>setPreview(null)}>Cancel Timing Change</Button></div>
   {preview.key!==directionKey(p,shotId)&&<p>The shot changed. Choose the correction again to preview the latest version.</p>}
  </div>}
  {state&&<p role="status">{state}</p>}{error&&<p role="alert">{error}</p>}
 </div>;
}
