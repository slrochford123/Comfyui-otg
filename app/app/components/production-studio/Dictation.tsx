"use client";
import { useEffect,useRef,useState } from "react";
import { Button,inputClass } from "./Controls";
import { request } from "./useStudio";
import { useStoredDraft } from "./useStoredDraft";
// Local CPU transcription only. The transcript is a separate review buffer until added.
export default function Dictation({url,onAdd,onStart,disabled=false,scope=url}:{url:string;onAdd:(text:string)=>void;onStart?:()=>void;disabled?:boolean;scope?:string}){
  const [state,setState]=useState<"idle"|"permission"|"recording"|"transcribing"|"review">("idle"),[text,setText]=useStoredDraft(scope+":dictation-review",""),[error,setError]=useState(""),[seconds,setSeconds]=useState(0);
  const reviewing=state==="review"||(state==="idle"&&!!text);
  const recorder=useRef<MediaRecorder|null>(null),stream=useRef<MediaStream|null>(null),requestController=useRef<AbortController|null>(null),generation=useRef(0),chunks=useRef<Blob[]>([]),timer=useRef<ReturnType<typeof setInterval>|undefined>(undefined),alive=useRef(true);
  const cleanup=()=>{clearInterval(timer.current);stream.current?.getTracks().forEach(t=>t.stop());stream.current=null;};
  const cancel=()=>{generation.current++;requestController.current?.abort();if(recorder.current?.state==="recording")recorder.current.stop();cleanup();setText("");setState("idle");setError("");};
  useEffect(()=>{alive.current=true;const token=generation;const interrupt=()=>{if(document.hidden&&recorder.current?.state==="recording")recorder.current.stop();};document.addEventListener("visibilitychange",interrupt);return()=>{alive.current=false;token.current++;requestController.current?.abort();if(recorder.current?.state==="recording")recorder.current.stop();cleanup();document.removeEventListener("visibilitychange",interrupt);};},[]);
  const start=async()=>{
    setError("");if(!window.isSecureContext){setError("Open the secure HTTPS TEST address to allow microphone access.");return;}
    if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==="undefined"){setError("This browser cannot record audio. Open TEST in Android Chrome or type your message.");return;}
    const run=++generation.current;setState("permission");onStart?.();
    try{
      const mic=await navigator.mediaDevices.getUserMedia({audio:true});
      if(!alive.current||run!==generation.current){mic.getTracks().forEach(t=>t.stop());return;}
      stream.current=mic;chunks.current=[];setSeconds(0);
      const mime=["audio/webm;codecs=opus","audio/mp4","audio/ogg;codecs=opus"].find(v=>MediaRecorder.isTypeSupported(v));
      const rec=new MediaRecorder(mic,mime?{mimeType:mime}:undefined);recorder.current=rec;
      let bytes=0;
      rec.ondataavailable=e=>{if(e.data.size){bytes+=e.data.size;chunks.current.push(e.data);if(bytes>15*1024*1024&&rec.state==="recording")rec.stop();}};
      rec.onerror=()=>{if(run===generation.current){generation.current++;cleanup();setState("idle");setError("Recording was interrupted. Your typed text is safe; try again.");}};
      rec.onstop=async()=>{
        cleanup();if(!alive.current||run!==generation.current)return;
        const audio=new Blob(chunks.current,{type:rec.mimeType||"audio/webm"});
        if(!audio.size){setState("idle");setError("No audio was recorded. Check microphone access and try again.");return;}
        setState("transcribing");const controller=new AbortController();requestController.current=controller;
        try{const form=new FormData();form.set("audio",new File([audio],audio.type.includes("mp4")?"recording.m4a":"recording.webm",{type:audio.type}));const data=await request(url+"/transcribe",{method:"POST",body:form,signal:controller.signal});if(alive.current&&run===generation.current){setText(data.transcript);setState("review");}}
        catch(e){if(alive.current&&run===generation.current){setState("idle");setError(e instanceof Error?e.message:"Transcription failed; your message is unchanged.");}}
      };
      mic.getAudioTracks().forEach(track=>track.onended=()=>{if(rec.state==="recording")rec.stop();});
      rec.start(1000);setState("recording");const began=Date.now();timer.current=setInterval(()=>{const elapsed=Math.floor((Date.now()-began)/1000);setSeconds(elapsed);if(elapsed>=180&&rec.state==="recording")rec.stop();},500);
    }catch(e){cleanup();if(alive.current&&run===generation.current){setState("idle");setError((e as Error).name==="NotAllowedError"?"Microphone permission was denied. Allow microphone access in this site's settings, then retry. Your text is unchanged.":"The microphone is unavailable or busy. Close other recorders and try again.");}}
  };
  return <div className="space-y-2 text-sm" data-otg="production-dictation">
    <div className="flex flex-wrap items-center gap-2">{state==="idle"&&!reviewing?<Button aria-label="Record message" title="Speak to your filmmaker" disabled={disabled} onClick={()=>void start()}>🎙</Button>:state==="recording"?<><span role="status" className="text-red-300">● Recording · {seconds}s</span><Button onClick={()=>recorder.current?.stop()}>Stop</Button></>:!reviewing?<span role="status">{state==="permission"?"Allow microphone access…":"Transcribing on local CPU…"}</span>:null}{(state!=="idle"||reviewing)&&<Button onClick={cancel}>Cancel</Button>}</div>
    {reviewing&&<div className="space-y-2"><label className="block">Review your transcript<textarea aria-label="Review your transcript" className={inputClass} value={text} rows={3} onChange={e=>setText(e.target.value)}/></label><Button disabled={!text.trim()} onClick={()=>{onAdd(text.trim());setText("");setState("idle");}}>Add to Message</Button><p className="text-xs text-white/60">This adds to your typed text. Review the message before sending.</p></div>}
    {error&&<p role="alert" className="text-amber-200">{error}</p>}
  </div>;
}
