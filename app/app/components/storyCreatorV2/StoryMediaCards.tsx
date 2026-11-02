"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import {newClientRequestId} from "@/lib/client/requestId";
import type {StoryMediaCommand} from "@/lib/storyCreator/mediaContract";
type Media={id:string;status:string;command:StoryMediaCommand;url:string|null;engine:string;error:string|null;characterId:string|null;voiceId:string|null};
type Character={id:string;name:string;hasVoice:boolean};
const button="min-h-11 rounded-xl border border-white/20 px-3 py-2 text-sm disabled:opacity-40";
const input="w-full rounded-xl border border-white/20 bg-black/20 p-3 text-sm";

export function StoryMediaCards({projectId,onAvailability}:{projectId:string;onAvailability?:(enabled:boolean)=>void}) {
  const [media,setMedia]=useState<Media[]>([]),[characters,setCharacters]=useState<Character[]>([]);
  const [enabled,setEnabled]=useState(false),[error,setError]=useState(""),[expanded,setExpanded]=useState(false);
  const refreshRef=useRef<()=>Promise<void>>(async()=>{});
  useEffect(()=>{
    const controller=new AbortController();let busy=false;
    async function refresh() {
      if(busy||controller.signal.aborted)return;
      busy=true;
      try {
        const response=await fetch(`/api/story-creator/media?projectId=${encodeURIComponent(projectId)}`,{cache:"no-store",signal:controller.signal});
        const data=await response.json();if(!response.ok)throw Error(data.error||"Media status is unavailable.");
        if(controller.signal.aborted)return;
        setEnabled(data.enabled===true);onAvailability?.(data.enabled===true);
        setMedia(data.media||[]);setCharacters(data.characters||[]);setError("");
      }catch(cause){if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:"Reconnect to check your media. No new job was sent.");}
      finally{busy=false;}
    }
    refreshRef.current=refresh;void refresh();
    const timer=setInterval(()=>{if(document.visibilityState!=="hidden")void refresh();},6000);
    const wake=()=>{if(document.visibilityState!=="hidden")void refresh();};
    window.addEventListener("online",wake);window.addEventListener("focus",wake);document.addEventListener("visibilitychange",wake);
    return()=>{controller.abort();clearInterval(timer);window.removeEventListener("online",wake);window.removeEventListener("focus",wake);document.removeEventListener("visibilitychange",wake);};
  },[projectId,onAvailability]);
  const act=useCallback(async(body:Record<string,unknown>)=>{
    const response=await fetch("/api/story-creator/media",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({projectId,...body})});
    const data=await response.json();if(!response.ok)throw Error(data.error||"The action could not finish. Check status before trying again.");
    setMedia(current=>[data.media,...current.filter(r=>r.id!==data.media.id)]);await refreshRef.current();
  },[projectId]);
  if(!enabled)return null;
  return <section aria-label="Story creations" className="space-y-3 border-t border-white/10 p-4">
    <div className="flex items-center justify-between gap-2"><h3 className="font-semibold">Your creations</h3><button type="button" className={button} onClick={()=>void refreshRef.current()}>Refresh</button></div>
    {!media.length?<p className="text-sm text-white/65">Ask to create an image, edit it, animate it, or give a named character a voice.</p>:null}
    {error?<p role="status" className="text-sm text-amber-200">{error}</p>:null}
    {(expanded?media:media.slice(0,4)).map(record=><MediaCard key={record.id} record={record} characters={characters} act={act}/>)}
    {media.length>4?<button type="button" className={button} onClick={()=>setExpanded(v=>!v)}>{expanded?"Show recent":"Show older creations"}</button>:null}
  </section>;
}
function MediaCard({record,characters,act}:{record:Media;characters:Character[];act:(body:Record<string,unknown>)=>Promise<void>}) {
  const [name,setName]=useState(""),[error,setError]=useState(""),[busy,setBusy]=useState(false);
  const [action,setAction]=useState<"edit"|"video"|"voice"|null>(null),[prompt,setPrompt]=useState(""),[text,setText]=useState("");
  const [characterId,setCharacterId]=useState(record.characterId||"");
  const lock=useRef(false),request=useRef<{key:string;signature:string}|null>(null);
  const image=["image","edit"].includes(record.command.operation),ready=record.status==="ready"&&!!record.url;
  async function run(body:Record<string,unknown>) {
    if(lock.current)return;lock.current=true;setBusy(true);setError("");
    try{await act({id:record.id,...body});if(body.action==="create"){setAction(null);setPrompt("");setText("");request.current=null;}}
    catch(cause){setError(cause instanceof Error?cause.message:"Could not complete this action.");}
    finally{lock.current=false;setBusy(false);}
  }
  function create() {
    const signature=JSON.stringify([action,prompt,text]);
    if(!request.current||request.current.signature!==signature)request.current={key:newClientRequestId(),signature};
    void run({action:"create",operation:action,sourceId:record.id,prompt,text,requestKey:request.current.key});
  }
  return <article className="min-w-0 space-y-3 rounded-2xl border border-white/15 p-3">
    <div className="flex flex-wrap justify-between gap-2"><strong className="break-words">{record.command.name||"Story creation"}</strong><span className="text-xs text-white/60">{record.engine}</span></div>
    {record.status==="needs_name"?<div className="space-y-2"><label className="block text-sm">Character name<input className={input} value={name} maxLength={100} onChange={e=>setName(e.target.value)} placeholder="What is their name?"/></label><button type="button" className={button} disabled={busy||!name.trim()} onClick={()=>void run({action:"name",name})}>Name & Create</button><p className="text-xs text-white/60">You can save this character without a voice.</p></div>:null}
    {!ready&&record.status!=="needs_name"?<p role="status" className="text-sm">{({queued:"Waiting for a free GPU…",submitting:"Sending your request…",running:"Queued or creating. You can leave and come back.",failed:"Generation failed.",unknown:"Checking an unconfirmed request. No automatic retry.",canceled:"Canceled."} as Record<string,string>)[record.status]||record.status}</p>:null}
    {ready&&image?<img src={record.url!} alt={record.command.name||"Generated story image"} className="mx-auto max-h-[480px] w-auto max-w-full rounded-xl" loading="lazy"/>:null}
    {ready&&record.command.operation==="video"?<video controls playsInline preload="metadata" src={record.url!} className="max-h-[480px] w-full rounded-xl"/>:null}
    {ready&&record.command.operation==="voice"?<audio controls preload="metadata" src={record.url!} className="w-full"/>:null}
    {ready?<div className="flex flex-wrap gap-2"><a className={button} href={`${record.url}&download=1`}>Download</a>
      {image?<><button type="button" className={button} disabled={busy} onClick={()=>setAction("edit")}>Edit</button><button type="button" className={button} disabled={busy} onClick={()=>setAction("video")}>Animate · 5 sec</button></>:null}
      {record.command.subject==="character"?<button type="button" className={button} disabled={busy} onClick={()=>setAction("voice")}>{record.command.operation==="voice"?"New dialogue":"Give a voice"}</button>:null}
      {image&&record.command.subject==="character"?<button type="button" className={button} disabled={busy||!!record.characterId} onClick={()=>void run({action:"save-character"})}>{record.characterId?"Saved to Characters":"Save to Characters"}</button>:null}
    </div>:null}
    {ready&&record.command.operation==="voice"?<div className="flex flex-wrap gap-2"><label className="min-w-0 flex-1 text-sm">Assign voice (optional)<select value={characterId} onChange={e=>setCharacterId(e.target.value)} className={input}><option value="">Voice Library only</option>{characters.map(c=><option key={c.id} value={c.id}>{c.name}{c.hasVoice?" · replace saved voice":""}</option>)}</select></label><button type="button" className={button} disabled={busy} onClick={()=>void run({action:"save-voice",characterId})}>{characterId?"Save & Assign Voice":record.voiceId?"Save Voice Again":"Save Voice"}</button></div>:null}
    {action?<div className="space-y-2 rounded-xl bg-white/5 p-3"><label className="block text-sm">{action==="edit"?"What should change?":action==="video"?"What happens in the video?":"Describe the voice or delivery"}<textarea className={input} rows={2} value={prompt} maxLength={4000} onChange={e=>setPrompt(e.target.value)}/></label>{action==="voice"?<label className="block text-sm">Dialogue<textarea className={input} rows={2} value={text} maxLength={1200} onChange={e=>setText(e.target.value)}/></label>:null}<div className="flex gap-2"><button type="button" className={button} disabled={busy||!prompt.trim()||(action==="voice"&&!text.trim())} onClick={create}>{busy?"Sending…":"Create"}</button><button type="button" className={button} disabled={busy} onClick={()=>setAction(null)}>Close</button></div>{action==="voice"?<p className="text-xs text-white/60">Uses the saved voice when available. Only use voices you have permission to reuse.</p>:null}</div>:null}
    {["queued","running","needs_name"].includes(record.status)?<button type="button" className={button} disabled={busy} onClick={()=>void run({action:"cancel"})}>Cancel</button>:null}
    {record.error||error?<p role="alert" className="break-words text-sm text-amber-200">{error||record.error}</p>:null}
  </article>;
}
