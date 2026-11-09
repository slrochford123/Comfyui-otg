"use client";
import { useCallback,useEffect,useRef,useState } from "react";
import type { StoryPreview } from "@/lib/productionStudio/storyPreview";
import type { Project } from "@/lib/productionStudio/model";
import { request } from "./useStudio";
export function useNarration(url:string,story:StoryPreview|undefined,proposalId?:string,voice="af_heart",messages:Project["assistant"]=[]){
  const [status,setStatus]=useState<"idle"|"playing"|"paused"|"loading"|"ready">("idle"),[activeId,setActiveId]=useState(""),[messageId,setMessageId]=useState(""),[error,setError]=useState(""),[duration,setDuration]=useState(0),[hasAudio,setHasAudio]=useState(false);
  const generation=useRef(0),audio=useRef<HTMLAudioElement|null>(null),cpuKey=useRef(""),abort=useRef<AbortController|null>(null),settle=useRef<(()=>void)|null>(null);
  const bindAudio=useCallback((node:HTMLAudioElement|null)=>{audio.current=node;},[]);
  const stop=useCallback(()=>{
    generation.current++;abort.current?.abort();settle.current?.();settle.current=null;
    const a=audio.current;if(a){a.onended=null;a.onerror=null;a.onplay=null;a.onpause=null;a.onloadedmetadata=null;a.pause();a.removeAttribute("src");a.load();}
    if(cpuKey.current){void request(url+"/narration",{method:"POST",body:JSON.stringify({action:"cancel",key:cpuKey.current})}).catch(()=>{});cpuKey.current="";}
    setStatus("idle");setActiveId("");setMessageId("");setHasAudio(false);setDuration(0);
  },[url]);
  const identity=JSON.stringify(story?.segments.map(s=>[s.id,s.title,s.narrative]));
  const replyText=messageId?messages.find(m=>m.id===messageId)?.text:undefined;
  // eslint-disable-next-line react-hooks/set-state-in-effect -- Stop external playback when its saved content or narrator changes.
  useEffect(()=>{stop();return stop;},[stop,identity,proposalId,voice]);
  const replySnapshot=useRef<string|undefined>(undefined);
  useEffect(()=>{if(messageId&&replyText!==replySnapshot.current)stop();},[replyText,messageId,stop]);
  const play=async(id?:string,replyId?:string,shot?:{shotId:string;expectedText:string})=>{
    stop();setError("");const run=generation.current,current=()=>run===generation.current;
    const message=replyId?messages.find(m=>m.id===replyId&&m.role==="assistant"):undefined;
    const passages=shot?[shot]:message?[{messageId:message.id,expectedText:message.text}]:story?(id?story.segments.filter(s=>s.id===id):story.segments).map(s=>({segmentId:s.id,proposalId,expectedText:`${s.title}. ${s.narrative}`})):[];
    if(!passages.length){setError("Choose an available story scene or filmmaker reply.");return;}
    if(message){replySnapshot.current=message.text;setMessageId(message.id);}
    try{
      for(const passage of passages){
        if(!current())return;setActiveId("shotId" in passage?passage.shotId:"segmentId" in passage?passage.segmentId||"":"");setStatus("loading");setHasAudio(false);setDuration(0);
        const controller=new AbortController();abort.current=controller;
        let data=await request(url+"/narration",{method:"POST",body:JSON.stringify({...passage,voice,retry:true}),signal:controller.signal});
        if(!current()){void request(url+"/narration",{method:"POST",body:JSON.stringify({action:"cancel",key:data.job.key})}).catch(()=>{});return;}
        cpuKey.current=data.job.key;
        const deadline=Date.now()+780000;
        while(["queued","running"].includes(data.job.status)){
          await new Promise(r=>setTimeout(r,500));if(!current())return;
          if(Date.now()>deadline)throw new Error("Narration is taking too long. Tap the speaker to retry when the CPU service is available.");
          data=await request(url+"/narration?key="+data.job.key,{signal:controller.signal});
        }
        if(data.job.status!=="completed")throw new Error(data.job.error||"Paradee narration is unavailable. Tap the speaker to retry.");
        cpuKey.current="";if(!current())return;
        await new Promise<void>((resolve,reject)=>{
          const a=audio.current;if(!a){reject(new Error("Audio player unavailable. Reload Production and retry."));return;}
          const finish=()=>{if(settle.current===finish)settle.current=null;resolve();};settle.current=finish;
          a.onended=finish;a.onerror=()=>{if(current())reject(new Error("Narration audio could not load. Check your connection and tap the speaker to retry."));else finish();};
          a.onloadedmetadata=()=>{if(current()){if(Number.isFinite(a.duration)&&a.duration>0){setDuration(a.duration);setHasAudio(true);}else reject(new Error("Narration has no readable duration. Retry playback."));}};
          a.onplay=()=>{if(current())setStatus("playing");};a.onpause=()=>{if(current()&&!a.ended)setStatus("paused");};
          a.preload="metadata";a.src=url+"/narration?media=1&key="+data.job.key;a.load();
          void a.play().catch(()=>{if(current())setStatus("ready");});
        });
      }
      if(current()){setStatus("idle");setActiveId("");setMessageId("");}
    }catch(e){if(current()){stop();setError(e instanceof Error?e.message:"Narration unavailable.");}}
  };
  const togglePause=()=>{const a=audio.current;if(!a||status==="loading")return;if(status==="playing"){a.pause();setStatus("paused");}else void a.play().then(()=>setStatus("playing")).catch(()=>{setStatus("ready");setError("Tap Play on the audio player to allow playback in this browser.");});};
  return{status,activeId,messageId,error,duration,hasAudio,bindAudio,play,playMessage:(id:string)=>play(undefined,id),playShot:(shotId:string,expectedText:string)=>play(undefined,undefined,{shotId,expectedText}),stop,togglePause};
}
