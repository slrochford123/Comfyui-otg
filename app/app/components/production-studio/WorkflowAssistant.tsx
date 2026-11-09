"use client";
import type {useStudio} from "./useStudio";
import {useStoredDraft} from "./useStoredDraft";
import {Button,Field,inputClass} from "./Controls";
import Dictation from "./Dictation";
import {AssistantSpeech,useTalkback} from "./Talkback";
type S=ReturnType<typeof useStudio>;
export default function WorkflowAssistant({s,workspace,clipId,run}:{s:S;workspace:"Edit"|"Finish";clipId?:string;run:(f:()=>Promise<unknown>)=>void}){
  const [message,setMessage]=useStoredDraft(`${s.scopeKey}:assistant:${workspace}:${clipId||'movie'}`,''),n=useTalkback();
  const messages=s.project!.assistant.filter(m=>m.workspace===workspace&&(!clipId||m.shotId===clipId)),latest=[...messages].reverse().find(m=>m.workflowSuggestion&&!m.decision),busy=s.jobs.some(j=>j.kind==='assistant'&&['running','queued','canceling'].includes(j.status));
  return <details className="rounded-xl border border-purple-400/30 p-3"><summary className="cursor-pointer font-semibold">Talk to your AI filmmaker · {workspace}</summary><div className="pt-3 space-y-3">
    {latest&&<article className="rounded-xl bg-purple-500/10 p-3 space-y-2"><p>{latest.text}</p><AssistantSpeech id={latest.id}/>{!!latest.workflowSuggestion?.changes.length&&<Button disabled={!s.saved||busy} onClick={()=>run(()=>s.commit({type:'workflow.proposal.accept',messageId:latest.id}))}>Apply Proposed Changes</Button>}<Button disabled={!s.saved} onClick={()=>run(()=>s.commit({type:'workflow.proposal.reject',messageId:latest.id}))}>Keep Current Edit</Button></article>}
    <Field label={`Ask the ${workspace} filmmaker`}><textarea className={inputClass} rows={3} value={message} onChange={e=>setMessage(e.target.value)} placeholder={workspace==='Edit'?'Lower Ava’s dialogue, or describe a visual correction…':'Fade the music before the reveal, or adjust this sequence’s pacing…'}/></Field>
    <div className="flex flex-wrap gap-2"><Dictation url={s.url} scope={`${s.scopeKey}:${workspace}`} disabled={busy} onStart={n.stop} onAdd={text=>setMessage(v=>[v,text].filter(Boolean).join('\n'))}/><Button disabled={!message.trim()||!s.saved||busy} onClick={()=>{if(confirm('Ask the filmmaker using your existing AI allowance? Changes require your approval.'))run(async()=>{await s.job({kind:'assistant',workspaceMode:workspace,shotId:clipId,message});setMessage('');});}}>Ask Filmmaker</Button></div>
    {busy&&<p role="status">The filmmaker is preparing a saved proposal. You may leave and return.</p>}
    <details><summary className="cursor-pointer">Conversation history</summary>{messages.map(m=><article key={m.id} className="text-sm py-2"><p>{m.role==='user'?'You':'Filmmaker'}{m.decision?` · ${m.decision==='accepted'?'Applied':m.decision}`:''}: {m.text}</p>{m.role==='assistant'&&<AssistantSpeech id={m.id}/>}</article>)}</details>
  </div></details>;
}
