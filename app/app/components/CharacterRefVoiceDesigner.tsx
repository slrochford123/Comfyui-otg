"use client";
import React from "react";
type Engine={id:string;name:string;available:boolean;detail:string};
type Audition={job?:string;engine:string;description:string;text:string;status:string;message:string;progress:number;elapsedSeconds:number;audioUrl?:string|null};
const endpoint="/api/h3/special/refmods/character-card/voice";
const button="min-h-11 rounded-xl border border-white/20 px-3 py-2 disabled:opacity-40";
const input="mt-1 min-h-11 w-full rounded-xl bg-zinc-900 p-2";
export default function CharacterRefVoiceDesigner({cardId,revision,disabled,onApprove}:{cardId:string;revision:number;disabled:boolean;onApprove:(job:string)=>void}){
  const [engines,setEngines]=React.useState<Engine[]>([]),[audition,setAudition]=React.useState<Audition|null>(null);
  const engine="qwen3";
  const [description,setDescription]=React.useState(""),[text,setText]=React.useState("Hello there. It is good to meet you. Let us begin our adventure together.");
  const [error,setError]=React.useState(""),[working,setWorking]=React.useState(false),[loaded,setLoaded]=React.useState(false);
  const active=!!audition&&["queued","running"].includes(audition.status);
  React.useEffect(()=>{
    const controller=new AbortController();
    void fetch(endpoint+"?card="+cardId,{credentials:"include",cache:"no-store",signal:controller.signal}).then(async response=>{
      const data=await response.json();if(!response.ok)throw Error(data.error||"Could not open voice design.");
      setEngines(data.engines);setAudition(data.audition);
      let draft=data.audition;try{draft=JSON.parse(localStorage.getItem("otg:refvoice:"+cardId)||"null")||draft;}catch{}
      // Old engine choices never restore a removed provider. Keep the user's text.
      if(draft){setDescription(draft.description);setText(draft.text);}
      setLoaded(true);
    }).catch(e=>{if(!controller.signal.aborted)setError(e.message);});
    return()=>controller.abort();
  },[cardId]);
  React.useEffect(()=>{if(loaded)try{localStorage.setItem("otg:refvoice:"+cardId,JSON.stringify({engine,description,text}));}catch{}},[loaded,cardId,engine,description,text]);
  React.useEffect(()=>{
    if(!active)return;const controller=new AbortController();let pending=false;
    const refresh=async()=>{if(pending||document.visibilityState==="hidden")return;pending=true;try{
      const response=await fetch(endpoint+"?card="+cardId,{credentials:"include",cache:"no-store",signal:controller.signal}),data=await response.json();
      if(!response.ok)throw Error(data.error||"Unable to check the voice job.");setAudition(data.audition);
    }catch(e){if(!controller.signal.aborted)setError((e as Error).message);}finally{pending=false;}};
    const timer=setInterval(()=>void refresh(),3000);window.addEventListener("focus",refresh);
    return()=>{controller.abort();clearInterval(timer);window.removeEventListener("focus",refresh);};
  },[active,cardId]);
  async function action(action:"generate"|"cancel"){
    setWorking(true);setError("");try{
      const response=await fetch(endpoint,{method:"POST",credentials:"include",headers:{"Content-Type":"application/json"},body:JSON.stringify({action,card:cardId,revision,engine,description,text})}),data=await response.json();
      if(!response.ok)throw Error(data.error||"Voice request failed.");setAudition(data.audition);
    }catch(e){setError((e as Error).message);}finally{setWorking(false);}
  }
  const selected=engines.find(e=>e.id===engine);
  return <div className="space-y-3" data-otg="refvoice-design">
    <fieldset disabled={disabled||working||active} className="space-y-3">
      <p className="text-sm">Qwen3-TTS{loaded&&!selected?.available?" · unavailable":""}</p>
      <label className="block text-sm">Describe the voice<textarea aria-label="Describe the voice" className={input} maxLength={1000} rows={3} value={description} onChange={e=>setDescription(e.target.value)} placeholder="Warm, low-pitched voice with a gentle, playful delivery"/></label>
      <label className="block text-sm">Sample line<textarea aria-label="Voice sample line" className={input} maxLength={180} rows={2} value={text} onChange={e=>setText(e.target.value)}/></label>
      <button type="button" className={button+" bg-violet-500/40"} disabled={!loaded||!selected?.available||!description.trim()||!text.trim()} onClick={()=>void action("generate")}>{audition?"Try another voice":"Generate voice"}</button>
    </fieldset>
    {audition?<div className="space-y-2"><p role="status" className="text-sm">{audition.message} · {Math.round(audition.elapsedSeconds||0)} sec</p>{active?<><progress aria-label="Voice generation progress" className="w-full" value={audition.progress} max={100}/><button type="button" className={button} disabled={working} onClick={()=>void action("cancel")}>Cancel voice generation</button></>:null}
      {audition.audioUrl?<><audio key={audition.job} aria-label="New voice preview" controls preload="none" src={audition.audioUrl} className="max-w-full"/><button type="button" className={button+" bg-violet-500/40"} disabled={disabled||working} onClick={()=>onApprove(audition.job!)}>Approve this voice</button><p className="text-xs text-white/60">Only the approved sample is attached to your character.</p></>:null}</div>:null}
    {error?<p role="alert" className="text-sm text-amber-200">{error}</p>:null}
  </div>;
}
