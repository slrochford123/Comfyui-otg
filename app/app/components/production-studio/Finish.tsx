"use client";
import {useState} from "react";
import {allShots,timelineDuration} from "@/lib/productionStudio/model";
import {workingClips} from "@/lib/productionStudio/workflow";
import type {useStudio} from "./useStudio";
import {Button,Field,Section,inputClass} from "./Controls";
import {Editor,Export} from "./Editor";
import AudioMixer from "./AudioMixer";
import StageJobs from "./StageJobs";
import WorkflowAssistant from "./WorkflowAssistant";
import SequenceReview from "./SequenceReview";
type S=ReturnType<typeof useStudio>;
export default function Finish({s,run}:{s:S;run:(f:()=>Promise<unknown>)=>void}){
 const p=s.project!,[scope,setScope]=useState('segment'),shots=scope==='production'?allShots(p):workingClips(p),approved=shots.filter(c=>p.shots[c.id]?.approvedTakeId),t=p.timeline;
 const move=(i:number,d:number)=>{const clips=[...t.clips],to=i+d;if(to<0||to>=clips.length)return;clips.splice(to,0,...clips.splice(i,1));s.change({type:'timeline.set',timeline:{...t,clips}});};
 return <div className="space-y-4" aria-label="Finish workspace"><Section title="Finish Your Movie"><p>{t.clips.length} assembled clips · {timelineDuration(t).toFixed(1)} seconds. Sources, clip edits and music remain independently editable.</p>
  <Field label="Assembly scope"><select className={inputClass} value={scope} onChange={e=>setScope(e.target.value)}><option value="segment">Current working section / segment</option><option value="production">Entire production</option></select></Field>
  <Button disabled={!s.saved||!approved.length} onClick={()=>{if(!t.clips.length||confirm('Update the assembly from these approved clips and their saved edits? Existing independent soundtrack placement stays saved. Undo and revisions preserve the prior arrangement.'))run(()=>s.commit({type:'finish.assemble',shotIds:approved.map(c=>c.id)}));}}>{t.clips.length?'Update from Approved Clips':'Load Approved Clips'}</Button>
  {approved.length<shots.length&&<p className="text-xs text-amber-200">{shots.length-approved.length} clips still need an approved take. You can finish a partial sequence.</p>}
  <div className="flex overflow-x-auto snap-x gap-3 pb-2" aria-label="Movie clip sequence">{t.clips.map((c,i)=><article key={c.id} className="shrink-0 w-56 snap-start rounded-xl border border-white/10 p-3 space-y-2"><p className="text-sm">Clip {i+1} · {(c.out-c.in).toFixed(2)}s</p><p className="text-xs line-clamp-2">{s.assets.find(a=>a.id===c.assetId)?.name}</p><div className="flex gap-2"><Button disabled={!i} onClick={()=>move(i,-1)}>Earlier</Button><Button disabled={i===t.clips.length-1} onClick={()=>move(i,1)}>Later</Button></div><details><summary className="cursor-pointer text-sm">Trim & transition</summary>{(['in','out'] as const).map(k=><Field key={k} label={`${i+1} ${k} · seconds`}><input className={inputClass} type="number" step={.01} value={c[k]} onChange={e=>s.change({type:'timeline.set',timeline:{...t,clips:t.clips.map(v=>v.id===c.id?{...v,[k]:Number(e.target.value)}:v)}})}/></Field>)}<Field label={`Clip ${i+1} transition`}><select className={inputClass} value={c.transition} onChange={e=>s.change({type:'timeline.set',timeline:{...t,clips:t.clips.map(v=>v.id===c.id?{...v,transition:e.target.value,transitionSeconds:e.target.value==='cut'?0:.25}:v)}})}>{['cut','fade','dissolve'].map(v=><option key={v}>{v}</option>)}</select></Field></details></article>)}</div>
  <Button disabled={!s.saved||!t.clips.length||s.jobs.some(j=>j.kind==='export'&&['queued','running','canceling'].includes(j.status))} onClick={()=>run(()=>s.job({kind:'export',settings:{aspect:p.brief.aspect,resolution:720,fps:24,format:'mp4',filename:p.name+' movie preview'}}))}>Render Movie Preview</Button>
 </Section>
 <StageJobs s={s} run={run} kinds={['export']}/>
 <details className="rounded-xl border border-purple-400/30 p-3"><summary className="cursor-pointer font-semibold">Continuous Music & Soundtrack</summary><p className="text-sm py-2">Import, choose or generate one track across multiple clips. Placement, looping, fades, automation and ducking are saved separately from video takes.</p><AudioMixer s={s} run={run} initialTrack="music"/></details>
 <Export s={s} run={run}/>
 <details className="rounded-xl border border-white/10 p-3"><summary className="cursor-pointer">Advanced timeline, captions & source replacement</summary><Editor s={s} run={run}/></details>
 {shots[0]&&<SequenceReview s={s} run={run} shotId={shots[0].id}/>}
 <WorkflowAssistant s={s} workspace="Finish" run={run}/>
 </div>;
}
