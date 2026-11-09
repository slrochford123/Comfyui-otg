"use client";
import {useState} from "react";
import type {useStudio} from "./useStudio";
import {allShots,timelineDuration} from "@/lib/productionStudio/model";
import {segmentForScene} from "@/lib/productionStudio/filmStructure";
import {Button,Field,inputClass} from "./Controls";
type S=ReturnType<typeof useStudio>;
export default function SequenceReview({s,run,shotId}:{s:S;run:(f:()=>Promise<unknown>)=>void;shotId:string}){
 const p=s.project!,[scope,setScope]=useState("scene"),[seconds,setSeconds]=useState(60),scene=p.plan.acts.flatMap(a=>a.scenes).find(c=>c.shots.some(shot=>shot.id===shotId))!,segment=segmentForScene(p,scene.id);
 const shots=scope==="scene"?scene.shots:scope==="segment"?p.plan.acts.flatMap(a=>a.scenes).filter(c=>segment&&p.film?.segments[segment.id]?.sceneIds.includes(c.id)).flatMap(c=>c.shots):allShots(p).slice(allShots(p).findIndex(s=>s.id===shotId));
 const ready:string[]=[];for(const shot of shots){if(!p.shots[shot.id]?.approvedTakeId)break;ready.push(shot.id);}
 return <details className="rounded-xl border border-white/10 p-3"><summary>Reviewable sequences & segment assemblies</summary><div className="space-y-3 pt-3">
   <Field label="Assembly scope"><select className={inputClass} value={scope} onChange={e=>setScope(e.target.value)}><option value="scene">This scene</option>{segment&&<option value="segment">This working segment</option>}<option value="milestone">From this shot · custom milestone</option></select></Field>
   {scope==="milestone"&&<Field label="Review length · seconds"><input className={inputClass} type="number" min={1} value={seconds} onChange={e=>setSeconds(Number(e.target.value))}/></Field>}
   <p className="text-xs">{ready.length} contiguous approved shots available. Stops at the first missing take. Uses actual source trims and existing transitions, not six assumed ten-second clips. New arrangements keep original clip audio; edit additional music/SFX in Edit.</p>
   <Button disabled={!s.saved||!ready.length} onClick={()=>run(()=>s.commit({type:"assembly.save",shotIds:ready,name:scope==="scene"?scene.title:segment?.title||"Review milestone",...(scope==="milestone"?{maxSeconds:seconds}:{})}))}>Save Source-Linked Sequence</Button>
   {p.assemblies?.map(a=><div key={a.id} className="border-t border-white/10 pt-2"><p>{a.name} · {timelineDuration(a.timeline).toFixed(1)}s · revision {a.revision}</p><div className="flex flex-wrap gap-2"><Button disabled={!s.saved} onClick={()=>run(()=>s.job({kind:"export",assemblyId:a.id,settings:{aspect:p.brief.aspect,resolution:720,fps:24,format:"mp4",filename:a.name+" review"}}))}>Render CPU Review</Button><Button disabled={!s.saved} onClick={()=>{if(confirm("Load this sequence into Edit? The current timeline will remain in Undo and History. Original sources are preserved."))run(()=>s.commit({type:"assembly.edit",assemblyId:a.id}));}}>Load Sequence into Edit</Button><Button disabled={!s.saved} onClick={()=>run(()=>s.commit({type:"assembly.edit",assemblyId:a.id,append:true}))}>Append to Edit</Button></div></div>)}
 </div></details>;
}
