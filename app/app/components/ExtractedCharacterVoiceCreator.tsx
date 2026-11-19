'use client';
import React,{useEffect,useId,useRef,useState} from 'react';
import {newClientRequestId} from '@/lib/client/requestId';
import type {Workspace,Candidate} from '@/lib/videoCharacters/contract';
import type {CharacterVoiceAudition,CharacterVoiceOptions,CharacterVoiceProvider} from '@/lib/videoCharacters/voiceContract';
const endpoint='/api/experiments/video-characters/voice';
const button='min-h-11 rounded-lg border border-white/20 px-3 py-2 text-sm disabled:opacity-40';
const input='w-full min-w-0 rounded-lg border border-white/20 bg-black/30 p-2.5 text-sm';
type Reply={audition:CharacterVoiceAudition|null;options?:CharacterVoiceOptions;workspace?:Workspace;error?:string};
async function request(url:string,body?:unknown):Promise<Reply>{const r=await fetch(url,{cache:'no-store',...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});const b=await r.json();if(!r.ok)throw Error(b.error||'Voice request failed. Your saved voice is unchanged.');return b;}
export default function ExtractedCharacterVoiceCreator({workspace,character,busy,onSaved}:{workspace:Workspace;character:Candidate;busy:boolean;onSaved:(w:Workspace)=>void}){
 const [open,setOpen]=useState(false),[provider,setProvider]=useState<CharacterVoiceProvider>('qwen3'),[description,setDescription]=useState(''),[draftReady,setDraftReady]=useState(false);
 const [options,setOptions]=useState<CharacterVoiceOptions|null>(null),[audition,setAudition]=useState<CharacterVoiceAudition|null>(null),[working,setWorking]=useState(false),[error,setError]=useState('');
 const alive=useRef(true),pending=useRef(false),id=useId();
 const draftKey='slr:character-voice:v1:'+workspace.id+':'+character.id;
 const query=endpoint+'?'+new URLSearchParams({id:workspace.id,character:character.id});
 useEffect(()=>{alive.current=true;try{const draft=JSON.parse(localStorage.getItem(draftKey)||'null');if(draft){setDescription(String(draft.description||'').slice(0,650));if(draft.provider==='elevenlabs')setProvider('elevenlabs');}}catch{/* Keep usable when storage is unavailable. */}setDraftReady(true);return()=>{alive.current=false;};},[draftKey]);
 useEffect(()=>{if(!draftReady)return;try{localStorage.setItem(draftKey,JSON.stringify({provider,description}));}catch{/* A failed local draft must not prevent generation. */}},[draftKey,draftReady,provider,description]);
 useEffect(()=>{if(!open||!character.globalId)return;let stopped=false;setOptions(null);void request(query+'&options=1&provider='+provider).then(b=>{if(!stopped){setOptions(b.options||null);setAudition(b.audition);}}).catch(e=>{if(!stopped)setError(e.message);});return()=>{stopped=true;};},[open,character.globalId,query,provider]);
 const active=!!audition&&['starting','queued','running','registering'].includes(audition.status);
 useEffect(()=>{if(!open||!active)return;let stopped=false,loading=false;const poll=async()=>{if(loading)return;loading=true;try{const b=await request(query);if(!stopped)setAudition(b.audition);}catch(e){if(!stopped)setError((e as Error).message);}finally{loading=false;}};const timer=window.setInterval(()=>void poll(),3000);return()=>{stopped=true;window.clearInterval(timer);};},[open,active,query]);
 async function submit(action:'generate'|'use',preview?:string){
  if(pending.current)return;pending.current=true;setWorking(true);setError('');
  try{const b=await request(endpoint,{action,id:workspace.id,revision:workspace.revision,character:character.id,...(action==='generate'?{provider,description,requestId:newClientRequestId(),consent:true}:{audition:audition?.id,preview})});if(alive.current){setAudition(b.audition);if(b.workspace)onSaved(b.workspace);}}
  catch(e){if(alive.current)setError((e as Error).message);}finally{pending.current=false;if(alive.current)setWorking(false);}
 }
 const ready=provider==='qwen3'?options?.qwenAvailable:options?.elevenAvailable;
 const visible=audition?.provider===provider?audition:null;
 return <section className="min-w-0 space-y-3">
  <button type="button" className={button} disabled={!character.globalId||busy} aria-expanded={open} aria-controls={id} onClick={()=>setOpen(!open)}>Create Voice</button>
  {!character.globalId&&<p className="text-xs text-white/70">Save the character first. One image is enough; a Character Card or RefMod is not required.</p>}
  {open&&<div id={id} className="min-w-0 space-y-3 rounded-lg border border-white/15 p-3">
   <p className="text-sm">Describe the voice. We prepare the voice instructions and a short English sample for you.</p>
   <fieldset disabled={working||active||busy} className="flex flex-wrap gap-2"><legend className="mb-1 text-sm">Create with</legend>
    {([['qwen3','Qwen — Local'],['elevenlabs','ElevenLabs — Uses Credits']] as const).map(([value,label])=><label key={value} className="flex min-h-11 items-center gap-2 rounded-lg border border-white/20 px-3"><input type="radio" name={id+'-provider'} checked={provider===value} onChange={()=>setProvider(value)}/>{label}</label>)}
   </fieldset>
   <label htmlFor={id+'-description'} className="block text-sm">Describe the voice<textarea id={id+'-description'} className={input} maxLength={650} rows={3} value={description} disabled={working||active||busy} onChange={e=>setDescription(e.target.value)} placeholder="A warm young man's voice, bright and slightly playful."/></label>
   {provider==='elevenlabs'&&<p className="text-xs text-amber-200">{options?.creditNote||'Uses ElevenLabs credits for a preview set. Checking availability…'}{options?.remaining!=null?' Account budget remaining: '+options.remaining.toLocaleString()+'.':''} Use This Voice also saves your selection to ElevenLabs.</p>}
   {options&&!ready&&<p role="status" className="text-sm text-amber-200">{provider==='qwen3'?'The local Qwen voice worker is unavailable.':options.elevenMessage}</p>}
   <button type="button" className={button} disabled={!ready||working||active||busy||!description.trim()} onClick={()=>void submit('generate')}>{working?'Working…':visible?.previews.length?'Try Again':'Generate Voice'}</button>
   {active&&<p role="status" className="text-sm">{audition?.message||'Preparing your voice…'} Your current saved voice is unchanged.</p>}
   {error&&<p role="alert" className="text-sm text-amber-200">{error}</p>}
   {visible?.status==='failed'&&<p role="alert" className="text-sm text-amber-200">{visible.message}</p>}
   {visible?.previews.map((preview,index)=><div key={preview.id} className="space-y-2">
    {visible.previews.length>1&&<p className="text-sm">Voice {index+1}</p>}
    <audio controls preload="none" src={preview.audioUrl} className="w-full" aria-label={'Voice preview '+(index+1)}/>
    <button type="button" className={button} disabled={working||busy||visible.status==='saved'} onClick={()=>void submit('use',preview.id)}>{visible.status==='saved'&&visible.selectedPreview===preview.id?'Voice saved':'Use This Voice'}</button>
   </div>)}
   {visible?.status==='saved'&&<p role="status" className="text-sm text-emerald-200">Saved to {character.name}. Previous voice versions are kept.</p>}
  </div>}
 </section>;
}
