"use client";
import {useState} from "react";
import type {useStudio} from "./useStudio";
import type {HandoffPreview} from "@/lib/productionStudio/storyHandoffTypes";
import {Button} from "./Controls";
export default function LinkedStory({s,run}:{s:ReturnType<typeof useStudio>;run:(f:()=>Promise<unknown>)=>void}){
  const p=s.project!,link=p.storyLink,[preview,setPreview]=useState<HandoffPreview|null>(null);
  if(!link)return null;
  const old=new Map(link.canon.map(f=>[f.id,JSON.stringify(f)]));
  const changed=preview?.canon.filter(f=>old.get(f.id)!==JSON.stringify(f))||[];
  const removed=link.canon.filter(f=>preview&&!preview.canon.some(n=>n.id===f.id));
  return <details className="rounded-xl border border-purple-300/25 p-3 min-w-0"><summary className="cursor-pointer text-sm">Linked story: {link.title} · {link.episode}</summary><div className="space-y-3 pt-3 text-sm">
    <p>The director uses {link.canon.length} approved story facts and the saved conversation context. Episode planning and clip revisions are proposed here for approval.</p>
    <a className="underline" href={'/app?tab=machine&storyProject='+encodeURIComponent(link.storyId)}>Return to Story Creator</a>
    <Button disabled={!s.saved} onClick={()=>run(async()=>setPreview(await s.request('/api/production-studio/story-handoff?storyId='+encodeURIComponent(link.storyId))))}>Review Story Creator Updates</Button>
    {preview&&<div className="space-y-2"><p>{changed.length} added/changed facts · {removed.length} removed facts. {preview.approvedPlan&&preview.planVersion!==p.storyPlanVersion?'A newer plan is available. Use Connect Story Creator to import and review it separately.':''}</p><div className="max-h-60 overflow-y-auto">{changed.map(f=><p key={f.id}>Updated: {f.subject} — {f.value}</p>)}{removed.map(f=><p key={f.id}>Removed: {f.subject} — {f.value}</p>)}</div><details><summary>Review latest working conversation</summary>{preview.workingNotes.map(m=><p key={m.id} className="whitespace-pre-wrap break-words">{m.role}: {m.text}</p>)}</details><p>Applying updates changes the director’s context. Approved clips, prompts, images, and takes remain saved.</p><Button disabled={!s.saved||preview.sourceKey===link.sourceKey} onClick={()=>run(async()=>{await s.request('/api/production-studio/story-handoff',{method:'PATCH',body:JSON.stringify({productionId:p.id,sourceKey:preview.sourceKey,revision:p.revision})});await s.refresh();setPreview(null);})}>Apply Reviewed Story Context</Button></div>}
  </div></details>;
}
