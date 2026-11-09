"use client";
import {useCallback,useEffect,useState,useSyncExternalStore} from "react";
import dynamic from "next/dynamic";
import {WORKSPACES,restoredWorkspace} from "@/lib/productionStudio/workflow";
import type {Workspace} from "@/lib/productionStudio/model";
import {request,useStudio} from "./useStudio";
import Plan from "./Plan";
import GuidedCreate from "./GuidedCreate";
import RevisionHistory from "./RevisionHistory";
import {TalkbackProvider} from "./Talkback";
import {Button,Field,inputClass} from "./Controls";
import AssistantProviderPicker from "../AssistantProviderPicker";
const Storyboard=dynamic(()=>import('./Storyboard'));
const Action=dynamic(()=>import('./Action'));
const ClipEditor=dynamic(()=>import('./ClipEditor'));
const Finish=dynamic(()=>import('./Finish'));
export default function Studio({ownerKey}:{ownerKey:string}){
 const [projects,setProjects]=useState<{id:string;name:string}[]>([]),[id,setId]=useState(''),[name,setName]=useState(''),[error,setError]=useState(''),key='otg:production-studio:active:'+ownerKey;
 useEffect(()=>{let alive=true;void request('/api/production-studio/projects').then(data=>{if(!alive)return;setProjects(data.projects);const last=localStorage.getItem(key);if(data.projects.some((p:{id:string})=>p.id===last))setId(last||'');}).catch(e=>setError(e.message));return()=>{alive=false;};},[key]);
 const choose=(id:string)=>{localStorage.setItem(key,id);setId(id);};
 return <div className="min-w-0 space-y-3"><p className="text-xs uppercase text-purple-300">TEST · Six-stage filmmaking studio</p>
  <Field label="Your productions"><select className={inputClass} value={id} onChange={e=>choose(e.target.value)}><option value="">Choose a production</option>{projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
  <details open={!id||undefined}><summary className="cursor-pointer text-sm py-2">+ Create Production</summary><div className="flex gap-2 py-2"><input aria-label="New production" className={inputClass} placeholder="Name your production" value={name} onChange={e=>setName(e.target.value)}/><Button disabled={!name.trim()} onClick={()=>void request('/api/production-studio/projects',{method:'POST',body:JSON.stringify({name})}).then(async data=>{setProjects((await request('/api/production-studio/projects')).projects);choose(data.project.id);setName('');}).catch(e=>setError(e.message))}>Create</Button></div></details>
  {error&&<p role="alert">{error}</p>}{id?<ProjectStudio key={ownerKey+':'+id} ownerKey={ownerKey} id={id}/>:<p className="text-sm text-white/60">Choose or create a production. Plan the story, create its assets, then see the movie in storyboards before generating video.</p>}
 </div>;
}
function ProjectStudio({ownerKey,id}:{ownerKey:string;id:string}){
 const s=useStudio(ownerKey,id),[busy,setBusy]=useState(false),workspaceKey='otg:production-studio:workspace:'+ownerKey+':'+id;
 const legacyWorkspace=useSyncExternalStore(useCallback((notify:()=>void)=>{window.addEventListener('storage',notify);return()=>window.removeEventListener('storage',notify);},[]),useCallback(()=>localStorage.getItem(workspaceKey),[workspaceKey]),()=>null);
 const {commit,setError}=s;
 const run=useCallback((fn:()=>Promise<unknown>)=>{setBusy(true);setError('');void fn().catch(e=>setError(e.message||'This action could not complete.')).finally(()=>setBusy(false));},[setError]);
 const p=s.project,workspace=p?.workflow?.workspace||restoredWorkspace(legacyWorkspace,p||undefined);
 const navigate=async(w:Workspace,clipId?:string)=>{await s.commit({type:'workflow.navigate',workspace:w,clipId:clipId||p?.workflow?.clipId});localStorage.setItem(workspaceKey,w);};
 useEffect(()=>{const edit=(event:Event)=>{const detail=(event as CustomEvent).detail;if(detail?.projectId!==id)return;sessionStorage.setItem('production-audio-focus:'+id,String(detail.assetId||''));run(async()=>{await commit({type:'workflow.navigate',workspace:'Edit',clipId:detail.shotId});if(detail.shotId)await commit({type:'clip.edit.open',shotId:detail.shotId});});};window.addEventListener('production-edit-audio',edit);return()=>window.removeEventListener('production-edit-audio',edit);},[id,commit,run]);
 if(!p)return <p role="status">Loading your saved production…</p>;
 return <div className="min-w-0 space-y-3">
  <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">{p.name}</h2><span role="status" className="text-xs">{s.status} · revision {p.revision}{busy?' · Working…':''}</span></div>
  {s.error&&<div role="alert" className="rounded-xl border border-amber-400/30 bg-amber-500/10 p-3 space-y-2"><p>{s.error}</p><div className="flex flex-wrap gap-2"><Button onClick={()=>run(s.status.includes('Conflict')||s.status.includes('review')?s.reapply:s.flush)}>{s.status.includes('Conflict')?'Review / Reapply Pending Edits':'Retry Save'}</Button><Button onClick={()=>s.setError('')}>Dismiss</Button></div></div>}
  <nav aria-label="Production workspaces" className="flex gap-2 overflow-x-auto snap-x pb-2">{WORKSPACES.map((w,i)=><Button key={w} disabled={busy||!s.saved} aria-current={workspace===w?'step':undefined} className={'shrink-0 snap-start !px-3 !py-2 '+(workspace===w?'!bg-purple-600 !text-white !border-purple-300 font-bold shadow-md underline underline-offset-4':'!bg-white/5 !text-white/70')} onClick={()=>run(()=>navigate(w))}>{i+1}. {w}</Button>)}</nav>
  <AssistantProviderPicker scope={"production:"+ownerKey+":"+id} disabled={busy}/>
  <TalkbackProvider s={s} workspace={workspace}>
   {workspace==='Plan'?<Plan s={s} run={run} onContinue={()=>run(()=>navigate('Cast & World'))}/>:workspace==='Cast & World'?<GuidedCreate s={s} run={run} onContinue={()=>run(()=>navigate('Storyboard'))}/>:workspace==='Storyboard'?<Storyboard s={s} run={run} onContinue={()=>run(()=>navigate('Action'))}/>:workspace==='Action'?<Action s={s} run={run} onStoryboard={()=>run(()=>navigate('Storyboard'))}/>:workspace==='Edit'?<ClipEditor s={s} run={run} onFinish={()=>run(()=>navigate('Finish'))}/>:<Finish s={s} run={run}/>}
   {workspace!=='Plan'&&<details className="rounded-xl border border-white/10 p-3"><summary className="cursor-pointer text-sm">History / Recovery</summary><RevisionHistory s={s}/></details>}
  </TalkbackProvider>
 </div>;
}
