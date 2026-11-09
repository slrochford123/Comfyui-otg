"use client";
import {useRef,useState} from "react";
import type {useStudio} from "./useStudio";
import {useStoredDraft} from "./useStoredDraft";
import {prepareShotImage,prepareShotVideoPrompt} from "@/lib/productionStudio/shotPreparation";
import {promptField,shotPromptKey,SHOT_PROMPT_LIMIT,type PromptTarget} from "@/lib/productionStudio/shotPrompts";
import {Button,Field,Section,inputClass} from "./Controls";
import Dictation from "./Dictation";
import {AssistantSpeech,useTalkback} from "./Talkback";
type S=ReturnType<typeof useStudio>;
export default function ShotPromptEditor({s,shotId,target,setTarget,busy,run,imageOnly=false}:{s:S;shotId:string;target:PromptTarget;setTarget:(v:PromptTarget)=>void;busy:boolean;run:(f:()=>Promise<unknown>)=>void;imageOnly?:boolean}){
 const p=s.project!,field=promptField(target),prepared=target==="storyboard"?prepareShotImage(p,shotId,s.assets):prepareShotVideoPrompt(p,shotId);
 const scope=s.scopeKey+`:shot-director:${shotId}:${target}`,[question,setQuestion]=useStoredDraft(scope,""),[sending,setSending]=useState(false),lock=useRef(false),narrator=useTalkback();
 const messages=p.assistant.filter(m=>m.shotId===shotId&&m.promptTarget===target),latest=messages.at(-1),suggestion=latest?.shotPromptSuggestion;
 const stale=!!suggestion&&suggestion.basedOnKey!==shotPromptKey(p,shotId,target,s.assets);
 const job=s.jobs.find(j=>j.kind==="assistant"&&j.input.shotId===shotId&&j.input.promptTarget===target);
 const aiBusy=s.jobs.some(j=>["assistant","asset-assistant","asset-analysis"].includes(j.kind)&&["queued","running","canceling"].includes(j.status));
 const patch=(value:string|null)=>s.change({type:"shot.settings",shotId,patch:{[field]:value}});
 const ask=(message:string)=>{
  if(lock.current||aiBusy||!message.trim())return;
  if(!confirm("Ask the AI Director to review this prompt? Existing OpenAI spending controls apply. No images or videos will be generated."))return;
  lock.current=true;setSending(true);
  run(async()=>{try{await s.job({kind:"assistant",shotId,promptTarget:target,message,planMode:false});setQuestion("");}finally{lock.current=false;setSending(false);}});
 };
 return <div id="shot-prompt-editor" className="scroll-mt-28"><Section title="Prompt & AI Director">
  {!imageOnly&&<div role="group" aria-label="Prompt to edit" className="flex flex-wrap gap-2">{([["storyboard","Starting Image Prompt"],["video","Video Prompt"]] as const).map(([v,label])=><Button key={v} aria-pressed={target===v} onClick={()=>setTarget(v)}>{label}</Button>)}</div>}
  <Field label={target==="storyboard"?"Full starting-image prompt":"Full video prompt"}><textarea rows={7} className={inputClass} value={prepared.prompt} maxLength={SHOT_PROMPT_LIMIT} disabled={busy||sending} onChange={e=>patch(e.target.value)} placeholder="Write your complete prompt, or ask the AI Director below…"/></Field>
  <p className="text-xs text-white/60">Edit, select all, or replace the full text. {p.shots[shotId]?.[field]!=null?"Custom prompt — stays as written until you edit or reset it.":"Prepared from this shot's plan and references."} Autosaved · {prepared.prompt.length}/{SHOT_PROMPT_LIMIT}</p>
  <div className="flex flex-wrap gap-2"><Button disabled={busy||sending||!prepared.prompt} onClick={()=>{if(confirm("Clear this prompt? Your approved plan, images and takes stay saved. The empty prompt cannot generate media."))patch("");}}>Clear Prompt</Button><Button disabled={busy||sending} onClick={()=>{if(confirm("Reset this prompt from the current shot plan and references? Your previous edits remain in History / Recovery."))patch(null);}}>Reset from Shot Plan</Button></div>
  {!prepared.prompt.trim()&&<p role="status" className="text-sm text-amber-200">Prompt cleared. Write a new prompt or ask the director before generating.</p>}
  <p className="text-xs text-white/60">Applies to the next generation only. Approved plan, duration, references and saved media stay unchanged. Use the reference controls separately when changing cast or location images.</p>
  <div className="border-t border-white/10 pt-3 space-y-3">
   <h4 className="font-semibold">AI Director · {target==="storyboard"?"starting image":"video"}</h4>
   <p className="text-sm text-white/70">Tell me what to edit, replace or clear. Review my proposed prompt, then apply it.</p>
   {messages.length>1&&<details><summary className="cursor-pointer py-2">Earlier conversation for this prompt</summary>{messages.slice(0,-1).map(m=><p key={m.id} className="text-sm whitespace-pre-wrap py-2"><span className="font-semibold">{m.role==="user"?"You":"Director"}: </span>{m.text}{m.decision?` (${m.decision})`:""}</p>)}</details>}
   {latest&&<article className="rounded-xl bg-white/5 p-3 space-y-3"><p className="text-sm whitespace-pre-wrap">{latest.text}</p>{latest.role==="assistant"&&<AssistantSpeech id={latest.id}/>}
    {suggestion&&!latest.decision&&<><Field label="Proposed full prompt"><textarea readOnly rows={5} className={inputClass} value={suggestion.prompt} placeholder="Proposes clearing this prompt"/></Field>{stale&&<p role="status" className="text-sm text-amber-200">This prompt or its references changed. Ask again for an updated proposal; your edits are safe.</p>}<div className="flex flex-wrap gap-2"><Button disabled={!s.saved||busy||sending||stale} onClick={()=>run(()=>s.commit({type:"shot.prompt.accept",messageId:latest.id}))}>{suggestion.prompt?"Apply Prompt":"Apply Clear Prompt"}</Button><Button disabled={!s.saved||sending} onClick={()=>run(()=>s.commit({type:"shot.prompt.reject",messageId:latest.id}))}>Reject Proposal</Button></div></>}
    {latest.decision&&<p role="status" className="text-sm">Proposal {latest.decision}. {latest.decision==="accepted"?"The full prompt above is updated and saved.":"Your current prompt was not replaced."}</p>}
   </article>}
   <Field label="Talk to the AI Director"><textarea rows={3} className={inputClass} value={question} onChange={e=>setQuestion(e.target.value)} placeholder="Replace this prompt with a close-up… / Clear the prompt…"/></Field>
   <div className="flex flex-wrap gap-2 items-start"><Dictation key={scope} url={s.url} scope={scope} disabled={busy||sending} onStart={narrator.stop} onAdd={text=>setQuestion(previous=>[previous,text].filter(Boolean).join("\n"))}/><Button disabled={!s.saved||busy||sending||aiBusy||!question.trim()} onClick={()=>ask(question)}>Ask AI Director</Button></div>
   {job&&<div className="text-sm space-y-2" role="status"><p>{job.status} · {job.message}</p>{["queued","running","canceling"].includes(job.status)?<Button disabled={job.status==="canceling"} onClick={()=>run(async()=>{await s.request(s.url+"/jobs",{method:"PATCH",body:JSON.stringify({jobId:job.id})});await s.refresh();})}>Cancel Director Request</Button>:["failed","canceled"].includes(job.status)?<Button disabled={!s.saved||busy||sending||aiBusy} onClick={()=>ask(String(job.input.message||""))}>Retry Director Request</Button>:null}</div>}
  </div>
 </Section></div>;
}
