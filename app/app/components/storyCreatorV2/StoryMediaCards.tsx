"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import {StoryImagePreview,StoryMediaPreview} from "./StoryPreview";
import {newClientRequestId} from "@/lib/client/requestId";
import type {StoryMediaCommand} from "@/lib/storyCreator/mediaContract";
type SaveHints={characterTarget?:{id:string;name:string}|null;characterImageId?:string|null;characterImageName?:string|null;approvedVoiceMediaId?:string|null;characterVoiceSaved?:boolean};
type Media=SaveHints&{imageNotice?:string;imageSize?:{width:number;height:number};id:string;projectId:string;sourceMessageId:string;status:string;command:StoryMediaCommand;url:string|null;engine:string;error:string|null;characterId:string|null;voiceId:string|null;cancelRequested?:boolean;stage?:string;durationSeconds?:number;license?:string;voiceNotice?:string;voiceCandidates?:number;voiceCandidate?:number;voiceAuditionText?:string};
type Character={id:string;name:string;hasVoice:boolean};
const button="min-h-11 rounded-xl border border-white/20 px-3 py-2 text-sm disabled:opacity-40";
const input="w-full rounded-xl border border-white/20 bg-black/20 p-3 text-sm";

export function StoryMediaCards({projectId,removedMessages,onAvailability,onChatAvailability,onFocus,resultId}:{projectId:string;removedMessages?:ReadonlySet<string>;onAvailability?:(enabled:boolean)=>void;
  onChatAvailability?:(enabled:boolean)=>void;onFocus?:(media:{id:string;name:string})=>void;resultId?:string}) {
  const [media,setMedia]=useState<Media[]>([]),[characters,setCharacters]=useState<Character[]>([]);
  const [chatMedia,setChatMedia]=useState(false);
  const [enabled,setEnabled]=useState(false),[error,setError]=useState(""),[expanded,setExpanded]=useState(false);
  const [lightweightImage,setLightweightImage]=useState(false);
  const [lightweightEdit,setLightweightEdit]=useState(false);
  const [openAIImage,setOpenAIImage]=useState(false);
  const [voiceAuto,setVoiceAuto]=useState(false);
  const hidden=useRef(new Set<string>());
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
        setChatMedia(data.chatMedia===true);onChatAvailability?.(data.chatMedia===true);
        setEnabled(data.enabled===true);onAvailability?.(data.enabled===true);
        setLightweightImage(data.lightweightImage===true);
        setLightweightEdit(data.lightweightEdit===true);
        setOpenAIImage(data.openAIImage===true);
        setVoiceAuto(data.voiceAuto===true);
        setMedia((data.media||[]).filter((item:Media)=>!hidden.current.has(item.id)));setCharacters(data.characters||[]);setError("");
      }catch(cause){if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:"Reconnect to check your media. No new job was sent.");}
      finally{busy=false;}
    }
    refreshRef.current=refresh;void refresh();
    const timer=setInterval(()=>{if(document.visibilityState!=="hidden")void refresh();},6000);
    const wake=()=>{if(document.visibilityState!=="hidden")void refresh();};
    window.addEventListener("online",wake);window.addEventListener("focus",wake);document.addEventListener("visibilitychange",wake);
    return()=>{controller.abort();clearInterval(timer);window.removeEventListener("online",wake);window.removeEventListener("focus",wake);document.removeEventListener("visibilitychange",wake);};
  },[projectId,onAvailability,onChatAvailability]);
  const act=useCallback(async(body:Record<string,unknown>)=>{
    if (body.action==="remove-from-chat") {
      const id=String(body.id);
      const params=new URLSearchParams({projectId,kind:"media",id});
      const response=await fetch("/api/story-creator/messages?"+params,{method:"DELETE"});
      const data=await response.json();
      if(!response.ok)throw Error(data.error||"Could not remove this creation from chat.");
      hidden.current.add(id);
      setMedia(current=>current.filter(item=>item.id!==id));
      await refreshRef.current();
      return;
    }
    const response=await fetch("/api/story-creator/media",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({projectId,...body})});
    const data=await response.json();if(!response.ok)throw Error(data.error||"The action could not finish. Check status before trying again.");
    setMedia(current=>[data.media,...current.filter(r=>r.id!==data.media.id)]);await refreshRef.current();
  },[projectId]);
  if(!enabled)return null;
  const visible=media.filter(item=>!removedMessages?.has(item.sourceMessageId));
  const selected=visible.find(item=>item.id===resultId);
  const ordered=selected?[selected,...visible.filter(item=>item.id!==selected.id)]:visible;
  return <section aria-label="Story creations" className="space-y-3 border-t border-white/10 p-4">
    <div className="flex items-center justify-between gap-2"><h3 className="font-semibold">Your creations</h3><button type="button" className={button} onClick={()=>void refreshRef.current()}>Refresh</button></div>
    {lightweightImage||openAIImage?<StoryImageForm act={act} local={lightweightImage} cloud={openAIImage}/>:null}
    {!visible.length?<p className="text-sm text-white/65">Ask to create an image, edit it, animate it, or give a named character a voice.{chatMedia?" You can also ask for music or sound effects.":""}</p>:null}
    {error?<p role="status" className="text-sm text-amber-200">{error}</p>:null}
    {(expanded?ordered:ordered.slice(0,4)).map(record=><MediaCard key={record.id} record={record} characters={characters} act={act} lightweightEdit={lightweightEdit} openAIImage={openAIImage} onFocus={chatMedia?onFocus:undefined} chatMedia={chatMedia} voiceAuto={voiceAuto}/>)}
    {visible.length>4?<button type="button" className={button} onClick={()=>setExpanded(v=>!v)}>{expanded?"Show recent":"Show older creations"}</button>:null}
  </section>;
}
function StoryImageForm({act,local,cloud}:{act:(body:Record<string,unknown>)=>Promise<void>;local:boolean;cloud:boolean}) {
  const [prompt,setPrompt]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const [choice,setChoice]=useState("");
  const profile=cloud&&choice!=="z-image-turbo-3060"?"gpt-image-2.6-flare":"z-image-turbo-3060";
  const request=useRef<{signature:string;key:string}|null>(null),sending=useRef(false);
  async function create(){
    const text=prompt.trim();
    if(!text||sending.current)return;
    sending.current=true;setBusy(true);setError("");
    const signature=JSON.stringify([profile,text]);
    if(request.current?.signature!==signature)request.current={signature,key:newClientRequestId()};
    try{
      await act({action:"create",operation:"image",profile,prompt:text,requestKey:request.current.key});
      request.current=null;setPrompt("");
    }catch(cause){setError(cause instanceof Error?cause.message:"Could not submit the image.");}
    finally{sending.current=false;setBusy(false);}
  }
  return <details className="space-y-2 rounded-xl border border-white/15 p-3">
    <summary className="cursor-pointer text-sm">{cloud?"Create Story image":"Create lightweight image"}</summary>
    {cloud&&local?<label className="block text-sm">Image model<select className={input} value={profile} disabled={busy} onChange={event=>setChoice(event.target.value)}>
      <option value="gpt-image-2.6-flare">GPT Image 2.6 Flare · OpenAI · paid</option>
      <option value="z-image-turbo-3060">Z-Image Turbo · RTX 3060 · HD</option>
    </select></label>:null}
    <label className="block text-sm">{cloud?"Image prompt":"Z-Image Turbo · RTX 3060 · HD"}
      <textarea className={input} value={prompt} maxLength={4000} rows={2} disabled={busy} onChange={event=>setPrompt(event.target.value)}/>
    </label>
    <button type="button" className={button} disabled={busy||!prompt.trim()} onClick={()=>void create()}>{busy?"Sending…":"Create image"}</button>
    {error?<p role="alert" className="text-sm text-amber-200">{error}</p>:null}
  </details>;
}
function MediaCard({record,characters,act,lightweightEdit,openAIImage,onFocus,chatMedia,voiceAuto}:{record:Media;characters:Character[];act:(body:Record<string,unknown>)=>Promise<void>;lightweightEdit:boolean;openAIImage:boolean;onFocus?:(media:{id:string;name:string})=>void;chatMedia:boolean;voiceAuto:boolean}) {
  const [name,setName]=useState(""),[error,setError]=useState(""),[busy,setBusy]=useState(false);
  const [action,setAction]=useState<"edit"|"video"|"voice"|null>(null),[prompt,setPrompt]=useState(""),[text,setText]=useState("");
  const [selectedCharacter,setSelectedCharacter]=useState<string|null>(null);
  const suggestedCharacter=record.characterTarget?.id||(record.characterImageId?`image:${record.characterImageId}`:record.characterId||"");
  const characterId=selectedCharacter??suggestedCharacter;
  const targetName=characters.find(c=>c.id===characterId)?.name||record.characterTarget?.name||record.characterImageName||record.command.name;
  const voiceSaved=record.characterVoiceSaved&&characterId===record.characterTarget?.id;
  const saveVoice=()=>void run(characterId.startsWith("image:")?{action:"save-character-voice",candidate}:{action:"save-voice",characterId,candidate});
  const [editProfile,setEditProfile]=useState("");
  const [voiceEngine,setVoiceEngine]=useState("");
  const [videoMode,setVideoMode]=useState("first-frame"),[videoSeconds,setVideoSeconds]=useState(5);
  const [audition,setAudition]=useState(0);
  const retryKey=useRef("");
  const lock=useRef(false),request=useRef<{key:string;signature:string}|null>(null);
  const image=["image","edit"].includes(record.command.operation),ready=record.status==="ready"&&!!record.url;
  const candidate=record.voiceCandidate??audition;
  const previewUrl=record.voiceCandidates?record.url+"&candidate="+candidate:record.url;
  async function run(body:Record<string,unknown>) {
    if(lock.current)return;lock.current=true;setBusy(true);setError("");
    try{await act({id:record.id,...body});if(body.action==="save-character-voice"||body.action==="save-voice"&&body.characterId)setSelectedCharacter(null);if(body.action==="create"){setAction(null);setPrompt("");setText("");request.current=null;}}
    catch(cause){setError(cause instanceof Error?cause.message:"Could not complete this action.");}
    finally{lock.current=false;setBusy(false);}
  }
  function create() {
    const profile = action === "edit" ? editProfile || (openAIImage ? "gpt-image-2.6-flare" : undefined) : undefined;
    const signature=JSON.stringify([action,prompt,text,profile,voiceEngine,videoMode,videoSeconds]);
    if(!request.current||request.current.signature!==signature)request.current={key:newClientRequestId(),signature};
    void run({action:"create",operation:action,sourceId:record.id,prompt,text,profile,videoMode:action==="video"?videoMode:undefined,durationSeconds:action==="video"?videoSeconds:undefined,voiceEngine:action==="voice"?voiceEngine:undefined,voiceMode:action==="voice"&&/\b(?:accent|new voice|different voice)\b/i.test(prompt)?"design":undefined,requestKey:request.current.key});
  }
  return <article id={`story-creation-${record.id}`} className="scroll-mt-36 min-w-0 space-y-3 rounded-2xl border border-white/15 p-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <strong className="break-words">{record.command.name||"Story creation"}</strong>
      <span className="text-xs text-white/60">{record.engine}</span>
      <button type="button" className={button} disabled={busy} aria-label={`Remove ${record.command.name||"creation"} from chat`}
        onClick={()=>void run({action:"remove-from-chat"})}>Remove</button>
    </div>
    {record.status==="needs_name"?<div className="space-y-2"><label className="block text-sm">Character name<input className={input} value={name} maxLength={100} onChange={e=>setName(e.target.value)} placeholder="What is their name?"/></label><button type="button" className={button} disabled={busy||!name.trim()} onClick={()=>void run({action:"name",name})}>Name & Create</button><p className="text-xs text-white/60">You can save this character without a voice.</p></div>:null}
    {!ready&&record.status!=="needs_name"?<p role="status" className="text-sm">{record.cancelRequested&&record.status==="running"?"Cancellation requested. Waiting for the provider to finish safely.":(record.stage||({queued:record.engine.startsWith("GPT Image")?"Queued for OpenAI…":"Waiting for a free GPU…",submitting:"Sending your request…",running:"Queued or creating. You can leave and come back.",failed:"Generation failed.",unknown:"Checking an unconfirmed request. No automatic retry.",canceled:"Canceled."} as Record<string,string>)[record.status]||record.status)}</p>:null}
    {ready&&image?<StoryImagePreview src={record.url!} alt={record.command.name||"Generated story image"} className="mx-auto max-h-[480px] w-auto max-w-full rounded-xl"/>:null}
    {ready&&record.command.operation==="video"?<StoryMediaPreview kind="video" src={record.url!} title={record.command.name||"Story video"} className="max-h-[480px] w-full rounded-xl"/>:null}
    {record.imageNotice?<p className="text-xs text-white/65">{record.imageNotice}</p>:null}
    {image&&record.imageSize?<p className="text-xs text-white/65">HD · {record.imageSize.width} × {record.imageSize.height}</p>:null}
    {record.voiceNotice?<p className="text-xs text-white/65">{record.voiceNotice}</p>:null}
    {ready&&Boolean(record.voiceCandidates)&&!record.voiceId?<label className="block text-sm">Voice audition
      <select className={input} value={candidate} disabled={busy} onChange={e=>setAudition(Number(e.target.value))}>
        {Array.from({length:record.voiceCandidates!},(_,index)=><option key={index} value={index}>Audition {index+1}</option>)}
      </select>
    </label>:null}
    {ready&&record.voiceAuditionText&&record.voiceAuditionText!==record.command.text?<details className="text-xs text-white/65">
      <summary>Audition script · short lines repeat for voice design</summary>
      <p className="whitespace-pre-wrap">{record.voiceAuditionText}</p>
    </details>:null}
    {ready&&["voice","music","effects"].includes(record.command.operation)?<StoryMediaPreview key={previewUrl} kind="audio" src={previewUrl!} title={record.command.name||"Story audio"} className="w-full"/>:null}
    {ready&&record.command.operation==="video"?<button type="button" className={button} disabled={busy} onClick={()=>{if(lock.current)return;lock.current=true;setBusy(true);setError("");void fetch("/api/story-creator/media/production",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({projectId:record.projectId,id:record.id})}).then(async response=>{const data=await response.json();if(!response.ok)throw Error(data.error||"Could not open Production.");window.location.assign(data.url);}).catch(cause=>setError(cause.message)).finally(()=>{lock.current=false;setBusy(false);});}}>Send to Production</button>:null}
    {ready?<div className="flex flex-wrap gap-2"><a className={button} href={`${previewUrl}&download=1`}>Download</a>
      {onFocus?<button type="button" className={button} onClick={()=>onFocus({id:record.id,name:record.command.name||"this creation"})}>Use in chat</button>:null}
      {image?<><button type="button" className={button} disabled={busy} onClick={()=>setAction("edit")}>Edit</button><button type="button" className={button} disabled={busy} onClick={()=>setAction("video")}>Animate</button></>:null}
      {record.command.subject==="character"&&(image||record.command.operation==="voice"&&(!chatMedia||record.voiceId))?<button type="button" className={button} disabled={busy} onClick={()=>setAction("voice")}>{record.command.operation==="voice"?"New dialogue":"Give a voice"}</button>:null}
      {image&&record.command.subject==="character"?<>
        <button type="button" className={button} disabled={busy||(!!record.characterId&&(!record.approvedVoiceMediaId||record.characterVoiceSaved))} onClick={()=>void run({action:"save-character",voiceMediaId:record.approvedVoiceMediaId||undefined})}>{record.characterVoiceSaved?"Character & Voice Saved":record.approvedVoiceMediaId?(record.characterId?`Save Voice to ${record.command.name}`:"Save Character & Voice"):record.characterId?"Saved to Characters":"Save to Characters"}</button>
        {record.characterId?<a className={button} href={`/app?tab=characters&storyRefModCharacter=${encodeURIComponent(record.characterId)}`}>Create Character RefMod</a>:null}
        {!record.characterId&&record.approvedVoiceMediaId?<button type="button" className={button} disabled={busy} onClick={()=>void run({action:"save-character"})}>Save Image Only</button>:null}
      </>:null}
    </div>:null}
    {ready&&record.command.operation==="voice"?<div className="space-y-2">
      {record.characterVoiceSaved&&record.characterTarget?<p role="status" className="text-sm text-emerald-200">Voice saved with {record.characterTarget.name}. Play it from Characters.</p>:null}
      <div className="flex flex-wrap items-end gap-2"><label className="min-w-0 flex-1 text-sm">Save voice with
        <select value={characterId} disabled={busy} onChange={e=>setSelectedCharacter(e.target.value)} className={input}>
          <option value="">Voice Library only</option>
          {record.characterImageId&&!record.characterTarget?<option value={`image:${record.characterImageId}`}>{record.characterImageName} · save character and voice</option>:null}
          {characters.map(c=><option key={c.id} value={c.id}>{c.name}{c.hasVoice?" · saved voice":""}</option>)}
        </select></label>
        <button type="button" className={button} disabled={busy||!!voiceSaved} onClick={saveVoice}>{voiceSaved?"Character & Voice Saved":characterId.startsWith("image:")?"Save Character & Voice":characterId?`Save Voice to ${targetName}`:record.voiceId?"Saved to Voice Library":chatMedia?"Use This Voice":"Save Voice"}</button>
      </div>
    </div>:null}
    {action?<div className="space-y-2 rounded-xl bg-white/5 p-3">
      <label className="block text-sm">{action==="edit"?"What should change?":action==="video"?"What happens in the video?":"Describe the voice or delivery"}<textarea className={input} rows={2} value={prompt} maxLength={4000} onChange={e=>setPrompt(e.target.value)}/></label>
      {action==="edit"&&(lightweightEdit||openAIImage)?<label className="block text-sm">Edit model
        <select className={input} value={editProfile} disabled={busy} onChange={e=>setEditProfile(e.target.value)}>
          <option value="">Automatic · API first</option>
          {lightweightEdit&&<option value="flux2-klein-edit-3060">FLUX.2 Klein 4B · RTX 3060</option>}
          {openAIImage&&<option value="gpt-image-2.6-flare">GPT Image 2.6 Flare · OpenAI · paid</option>}
        </select>
      </label>:null}
      {action==="video"?<div className="flex flex-wrap gap-2"><label className="text-sm">Image use<select className={input} value={videoMode} disabled={busy} onChange={e=>setVideoMode(e.target.value)}><option value="first-frame">Start from this image</option><option value="reference">Use as a reference</option></select></label><label className="text-sm">Duration<select className={input} value={videoSeconds} disabled={busy} onChange={e=>setVideoSeconds(Number(e.target.value))}><option value={5}>5 seconds</option><option value={10}>10 seconds</option></select></label></div>:null}
      {action==="voice"&&voiceAuto?<label className="block text-sm">Voice engine
        <select className={input} value={voiceEngine} disabled={busy} onChange={e=>setVoiceEngine(e.target.value)}>
          <option value="">Automatic · ElevenLabs / RTX 3060</option>
          <option value="qwen3">Manual · Qwen3-TTS</option>
        </select>
      </label>:null}
      {action==="voice"?<label className="block text-sm">Dialogue<textarea className={input} rows={2} value={text} maxLength={1200} onChange={e=>setText(e.target.value)}/></label>:null}
      <div className="flex gap-2"><button type="button" className={button} disabled={busy||!prompt.trim()||(action==="voice"&&!text.trim())} onClick={create}>{busy?"Sending…":"Create"}</button><button type="button" className={button} disabled={busy} onClick={()=>setAction(null)}>Close</button></div>
      {action==="voice"?<p className="text-xs text-white/60">Uses the saved voice when available. Only use voices you have permission to reuse.</p>:null}
    </div>:null}
    {["queued","running","needs_name"].includes(record.status)&&!record.cancelRequested?<button type="button" className={button} disabled={busy} onClick={()=>void run({action:"cancel"})}>Cancel</button>:null}
    {ready&&record.durationSeconds?<p className="text-xs text-white/60">{record.durationSeconds.toFixed(2)} seconds{record.license?` · ${record.license}`:""}</p>:null}
    {chatMedia&&record.status==="failed"?<button type="button" className={button} disabled={busy}
      onClick={()=>{retryKey.current ||= newClientRequestId();void run({action:"retry",requestKey:retryKey.current});}}>Retry</button>:null}
    {record.error||error?<p role="alert" className="break-words text-sm text-amber-200">{error||record.error}</p>:null}
  </article>;
}
