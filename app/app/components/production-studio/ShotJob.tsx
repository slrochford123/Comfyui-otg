"use client";
import type {useStudio} from "./useStudio";
import {Button} from "./Controls";
type S=ReturnType<typeof useStudio>;
export const shotJobBusy=(s:S,id:string)=>s.jobs.some(j=>j.input.shotId===id&&["queued","running","canceling","attention"].includes(j.status));
export default function ShotJob({s,shotId,kinds,run,retry}:{s:S;shotId:string;kinds:string[];run:(f:()=>Promise<unknown>)=>void;retry:(kind:string)=>void}){
 const jobs=s.jobs.filter(j=>j.input.shotId===shotId&&kinds.includes(j.kind)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
 const visible=jobs.filter(j=>["queued","running","canceling","attention"].includes(j.status));
 if(jobs[0]&&!visible.includes(jobs[0]))visible.push(jobs[0]);
 return <div aria-live="polite" className="space-y-2">{visible.map(j=><div key={j.id} className="rounded-xl border border-white/10 p-3 text-sm space-y-2">
  <p>{j.kind==="audio-finish"?"Cinematic audio":j.kind==="storyboard"?"Starting image":j.kind==="finish"?"Finishing approved take":"Video take"} · {j.status==="running"&&j.queueStatus?j.queueStatus:j.status}</p><p>{j.message}</p>
  {["queued","running","canceling"].includes(j.status)&&<><progress aria-label={`${j.kind} progress`} max={100} value={j.progress} className="w-full"/><Button disabled={j.status==="canceling"} onClick={()=>run(async()=>{await s.request(s.url+"/jobs",{method:"PATCH",body:JSON.stringify({jobId:j.id})});await s.refresh();})}>Cancel {j.kind==="storyboard"?"Image":"Job"}</Button></>}
  {j.status==="failed"&&<Button disabled={!s.saved||shotJobBusy(s,shotId)} onClick={()=>retry(j.kind)}>Retry {j.kind==="finish"?"Finishing":"with Current Shot"}</Button>}
  {j.status==="attention"&&<p className="text-amber-200">Submission needs checking on its original worker before another attempt. Your sources remain saved.</p>}
 </div>)}</div>;
}
