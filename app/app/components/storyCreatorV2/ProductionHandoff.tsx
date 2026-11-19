"use client";
import {useEffect,useState} from "react";
import type {HandoffPreview} from "@/lib/productionStudio/storyHandoffTypes";
import {request} from "../production-studio/useStudio";
export default function ProductionHandoff({projectId,busy=false}:{projectId:string;busy?:boolean}) {
  const [enabled,setEnabled]=useState(false),[preview,setPreview]=useState<HandoffPreview|null>(null),[open,setOpen]=useState(false),[working,setWorking]=useState(false),[error,setError]=useState("");
  const [episode,setEpisode]=useState("Episode 1"),[seconds,setSeconds]=useState(900),[style,setStyle]=useState("Realistic live-action, natural lighting, consistent character appearance"),[selected,setSelected]=useState<string[]>([]);
  useEffect(()=>{const c=new AbortController();fetch('/api/production-studio/availability',{signal:c.signal}).then(r=>r.json()).then(v=>setEnabled(v.enabled===true)).catch(()=>{});return()=>c.abort();},[]);
  async function review(){setWorking(true);setError("");try{const p:HandoffPreview=await request('/api/production-studio/story-handoff?storyId='+encodeURIComponent(projectId));setPreview(p);setSeconds(p.targetSeconds);setSelected(p.assets.filter(a=>a.approved).map(a=>a.id));setOpen(true);}catch(e){setError(e instanceof Error?e.message:"Could not prepare handoff.");}finally{setWorking(false);}}
  const go=(id:string)=>window.location.assign('/app?tab=storyboard&productionProject='+encodeURIComponent(id));
  async function send(){if(!preview)return;setWorking(true);setError("");try{const result=await request('/api/production-studio/story-handoff',{method:'POST',body:JSON.stringify({storyId:projectId,sourceKey:preview.sourceKey,episode,targetSeconds:seconds,style,assetIds:selected})});go(result.project.id);}catch(e){setError(e instanceof Error?e.message:"Could not save production. Refresh the preview and retry.");setWorking(false);}}
  if(!enabled)return null;
  const cls="min-h-11 rounded-xl border border-white/20 bg-white/5 px-3 py-2 text-sm disabled:opacity-40";
  return <section aria-label="Episode production handoff" className="rounded-xl border border-purple-300/25 p-3 space-y-3 min-w-0">
    <button type="button" className={cls} disabled={working||busy} onClick={()=>void review()}>{working?'Preparing…':'Send Episode to Production'}</button>
    <p className="text-xs text-white/65">Continue your story with the AI director. Prepare clips up to 10 seconds; generation starts only when you request it.</p>
    {error&&<p role="alert">{error}</p>}
    {open&&preview&&<div className="space-y-3">
      {preview.productions.map(p=><button key={p.id} type="button" className={cls+" block"} disabled={working} onClick={()=>go(p.id)}>Continue {p.episode} in Production</button>)}
      <label className="block text-sm">Episode name<input className={cls+" block w-full"} maxLength={160} value={episode} onChange={e=>setEpisode(e.target.value)}/></label>
      <label className="block text-sm">Episode duration (seconds)<input className={cls+" block w-full"} type="number" min={1} max={86400} disabled={preview.approvedPlan} value={seconds} onChange={e=>setSeconds(Number(e.target.value))}/></label>
      <label className="block text-sm">Visual style<input className={cls+" block w-full"} maxLength={2000} value={style} onChange={e=>setStyle(e.target.value)}/></label>
      <p className="text-sm">{preview.approvedPlan?`Approved plan v${preview.planVersion} · ${preview.scenes} scenes · ${preview.clips} clips. Its timing is preserved.`:'No approved episode plan yet. Production will open with your story memory so you can develop and approve an outline first.'}</p>
      <details><summary className="cursor-pointer text-sm">Review story context · {preview.canon.length} approved facts</summary><div className="max-h-64 overflow-y-auto text-sm space-y-2">{preview.canon.map(f=><p key={f.id}>{f.subject}: {f.predicate} — {f.value}</p>)}<p>Recent conversation is included as working notes, not approved canon.</p>{preview.workingNotes.map(m=><p key={m.id} className="whitespace-pre-wrap break-words">{m.role}: {m.text}</p>)}</div></details>
      <details><summary className="cursor-pointer text-sm">Choose references · {selected.length} selected</summary><p className="text-xs py-2">Selecting an image or voice approves that version for this production. Other creations stay in Story Creator.</p><div className="max-h-64 overflow-y-auto">{preview.assets.length===0&&<p className="text-sm">No completed images or voices yet. Add assets later in Cast & World.</p>}{preview.assets.map(a=><label key={a.id} className="flex items-center gap-2 min-h-11 text-sm"><input type="checkbox" checked={selected.includes(a.id)} onChange={e=>setSelected(ids=>e.target.checked?[...ids,a.id]:ids.filter(id=>id!==a.id))}/>{a.name} · {a.role}{a.approved?' · approved':''}</label>)}</div></details>
      <p className="text-xs text-white/60">A saved copy links back to this story. Reopening the same episode preserves its production work. No paid request or media generation runs during transfer.</p>
      <div className="flex gap-2 flex-wrap"><button type="button" className={cls+" bg-purple-600"} disabled={working||busy||!episode.trim()||seconds<1||seconds>86400} onClick={()=>void send()}>Confirm & Open Production</button><button type="button" className={cls} disabled={working} onClick={()=>setOpen(false)}>Close</button><button type="button" className={cls} disabled={working} onClick={()=>void review()}>Refresh preview</button></div>
    </div>}
  </section>;
}
