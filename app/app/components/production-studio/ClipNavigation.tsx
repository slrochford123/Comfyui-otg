"use client";
import {workingClips} from "@/lib/productionStudio/workflow";
import {plannedSeconds} from "@/lib/productionStudio/shotPolicy";
import type {Workspace} from "@/lib/productionStudio/model";
import type {useStudio} from "./useStudio";
import {Button,Field,inputClass} from "./Controls";
type S=ReturnType<typeof useStudio>;
export function activeClip(s:S){const clips=workingClips(s.project!);return {clips,clip:clips.find(c=>c.id===s.project!.workflow?.clipId)||clips[0]};}
export default function ClipNavigation({s,workspace,run}:{s:S;workspace:Workspace;run:(f:()=>Promise<unknown>)=>void}){
  const {clips,clip}=activeClip(s);if(!clip)return null;const i=clips.indexOf(clip);
  const move=(id:string)=>run(()=>s.commit({type:"workflow.navigate",workspace,clipId:id}));
  return <div className="flex flex-wrap items-end gap-2" aria-label={`${workspace} clip navigation`}>
    <div className="min-w-0 flex-1"><Field label="Current video clip"><select className={inputClass} value={clip.id} disabled={!s.saved} onChange={e=>move(e.target.value)}>{clips.map((c,n)=><option key={c.id} value={c.id}>Clip {n+1} · {plannedSeconds(c)}s · {c.description.slice(0,50)}</option>)}</select></Field></div>
    <Button disabled={!s.saved||i===0} onClick={()=>move(clips[i-1].id)}>Previous Clip</Button><Button disabled={!s.saved||i===clips.length-1} onClick={()=>move(clips[i+1].id)}>Next Clip</Button>
  </div>;
}
