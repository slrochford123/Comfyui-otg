"use client";
import {useRef,useState} from "react";
import type {useStudio} from "./useStudio";
import {allShots,DEFAULT_SHOT} from "@/lib/productionStudio/model";
import {relevantEarlierShots} from "@/lib/productionStudio/shotPreparation";
import {Button,Field,inputClass,mediaUrl} from "./Controls";
type S=ReturnType<typeof useStudio>;
export default function ShotContinuity({s,run,shotId}:{s:S;run:(f:()=>Promise<unknown>)=>void;shotId:string}){
 const p=s.project!,shots=allShots(p),settings=p.shots[shotId]||DEFAULT_SHOT,earlier=relevantEarlierShots(p,shotId);
 const [open,setOpen]=useState(settings.continuity==="previous-frame"),[seconds,setSeconds]=useState(""),video=useRef<HTMLVideoElement>(null);
 const source=shots.find(v=>v.id===settings.continuitySourceShotId),take=source?.takes.find(t=>t.id===p.shots[source.id]?.approvedTakeId),image=source?p.shots[source.id]?.storyboardId:undefined;
 return <div className="rounded-xl border border-white/10 p-3 space-y-2">
  <div className="flex flex-wrap gap-2"><Button aria-pressed={!open} onClick={()=>{setOpen(false);s.change({type:"shot.settings",shotId,patch:{continuity:"new-angle",firstImageId:"",useStoryboardFirstFrame:false}});}}>Create New Starting Image</Button>{!!earlier.length&&<Button aria-expanded={open} onClick={()=>setOpen(true)}>Continue from Previous Frame</Button>}</div>
  {!open&&<p className="text-xs text-white/60">A fresh composition is the default for a new camera angle. Approved identities and selected continuity references are preserved.</p>}
  {!!earlier.length&&<details open={open||undefined}><summary className="cursor-pointer py-2 text-sm">Earlier shots & continuity reference</summary><div className="space-y-3">
   <p className="text-xs text-white/60">Suggested match: Shot {shots.indexOf(earlier[0].shot)+1} · {earlier[0].shot.cameraFraming}. Check that the framing and story state fit. You can choose any earlier approved shot, not just the previous one.</p>
   <Field label="Earlier approved shot"><select className={inputClass} value={settings.continuitySourceShotId||""} onChange={e=>{setSeconds("");s.change({type:"shot.settings",shotId,patch:{continuitySourceShotId:e.target.value,continuity:open?"previous-frame":"new-angle"}});}}><option value="">Select a source (no automatic chaining)</option>{earlier.map(({shot})=><option key={shot.id} value={shot.id}>Shot {shots.indexOf(shot)+1} · {shot.cameraFraming} · {shot.description.slice(0,70)}</option>)}</select></Field>
   {source&&<><p className="text-sm">{source.description}</p>{open&&take?.assetId&&<><video ref={video} key={take.assetId} controls playsInline preload="metadata" aria-label="Earlier approved video for frame selection" className="w-full max-h-64 rounded-xl" src={mediaUrl(p.id,take.assetId)}/><Button onClick={()=>setSeconds(String(video.current?.currentTime||0))}>Select Displayed Frame</Button></>}
    {open&&<><Field label="Source time in seconds · blank for last approved frame"><input className={inputClass} type="number" min={0} max={10} step={.01} value={seconds} onChange={e=>setSeconds(e.target.value)}/></Field><Button disabled={!s.saved||!take?.assetId} onClick={()=>run(()=>s.action("/shot-frame",{shotId,seconds:seconds===""?null:Number(seconds)}))}>Use Earlier Frame Candidate</Button>{!take?.assetId&&<p className="text-sm">This earlier shot has an approved image but no approved video yet. Its image can guide Create with AI.</p>}</>}
    <Button disabled={!s.saved||!settings.storyboardId||!image} onClick={()=>{if(confirm("Use your AI allowance to compare the current image with this earlier image? This flags possible discrepancies, not guaranteed continuity."))run(()=>s.action("/continuity-review",{shotId,approved:true}));}}>Ask AI to Review Continuity</Button>
    <label className="flex gap-2 items-center text-sm"><input type="checkbox" checked={!!settings.continuityReviewed} onChange={e=>s.change({type:"shot.settings",shotId,patch:{continuityReviewed:e.target.checked}})}/>I reviewed the cut and accept intentional differences</label>
   </>}
  </div></details>}
  <details><summary className="cursor-pointer text-sm py-2">Physical continuity notes</summary><div className="space-y-2"><Field label="Recurring camera setup"><input className={inputClass} value={settings.cameraSetup||""} onChange={e=>s.change({type:"shot.settings",shotId,patch:{cameraSetup:e.target.value}})}/></Field><Field label="Established state / intentional changes"><textarea className={inputClass} value={settings.continuityNotes||""} onChange={e=>s.change({type:"shot.settings",shotId,patch:{continuityNotes:e.target.value}})} placeholder="Same wardrobe, cup in right hand, seated at counter…"/></Field></div></details>
  {p.assistant.filter(m=>m.id.startsWith(`continuity-${shotId}-`)).slice(-1).map(m=><p key={m.id} className="whitespace-pre-wrap text-sm">{m.text}</p>)}
 </div>;
}
