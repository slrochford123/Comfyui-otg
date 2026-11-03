"use client";
import React from "react";
import dynamic from "next/dynamic";
import type {VoiceModel} from "./EditVideoVoiceDubbingPanel";
const VoicePanel=dynamic(()=>import("./EditVideoVoiceDubbingPanel"));
type Handoff={models:VoiceModel[];source:{path:string;name:string;url:string}};
export default function H3CharacterVoiceCorrection({jobId}:{jobId:string}){
  const [handoff,setHandoff]=React.useState<Handoff|null>(null),[open,setOpen]=React.useState(false),[error,setError]=React.useState("");
  React.useEffect(()=>{
    const controller=new AbortController();setHandoff(null);setOpen(false);setError("");
    void fetch("/api/h3/character-voice?jobId="+encodeURIComponent(jobId),{credentials:"include",cache:"no-store",signal:controller.signal}).then(async r=>{
      if(r.status===404)return;
      const data=await r.json();if(!r.ok)throw Error(data.error||"Saved voices could not be loaded.");
      if(data.models?.length)setHandoff(data);
    }).catch(e=>{if(!controller.signal.aborted)setError(e.message);});
    return()=>controller.abort();
  },[jobId]);
  if(!handoff)return error?<p role="alert" className="mt-3 text-sm text-amber-200">{error}</p>:null;
  return <div className="mt-4 space-y-3" data-otg="h3-character-voice-correction">
    <p className="text-sm text-white/70">Saved voices: {handoff.models.map(m=>m.name).join(", ")}. Listen to the result; H3 voice matching is experimental.</p>
    <button type="button" className="min-h-11 rounded-xl border border-violet-400/40 px-4 py-2 font-bold" aria-expanded={open} onClick={()=>setOpen(!open)}>{open?"Hide voice correction":"Match saved character voices"}</button>
    {open?<><p className="text-sm text-white/70">Analyze speech, then confirm who speaks each lane. Multiple speakers are never assigned by guesswork. Conversion keeps the source video frames; review voice and background audio before keeping the result.</p><VoicePanel key={jobId} initialSource={handoff.source} characterVoiceTargets={handoff.models}/></>:null}
  </div>;
}
