"use client";
import {useEffect,useRef,useState} from "react";

type Voice={voiceId:string;name:string;refAudioUrl?:string};
export default function SavedCharacterVoicePicker({characterId,name,hasVoice,onSaved}:{characterId:string;name:string;hasVoice:boolean;onSaved:()=>void}) {
  const [open,setOpen]=useState(false),[voices,setVoices]=useState<Voice[]>([]),[selected,setSelected]=useState("");
  const [loading,setLoading]=useState(false),[saving,setSaving]=useState(false),[error,setError]=useState("");
  const controller=useRef<AbortController|null>(null),lock=useRef(false);
  useEffect(()=>()=>controller.current?.abort(),[]);
  async function show(){
    if(open){setOpen(false);return;}
    setOpen(true);setLoading(true);setError("");controller.current?.abort();
    const request=new AbortController();controller.current=request;
    try{
      const response=await fetch("/api/voices/library",{cache:"no-store",credentials:"include",signal:request.signal});
      const data=await response.json();if(!response.ok||!data.ok)throw Error(data.error||"Could not load saved voices.");
      if(!request.signal.aborted)setVoices(data.voices||[]);
    }catch(cause){if(!request.signal.aborted)setError(cause instanceof Error?cause.message:"Could not load saved voices.");}
    finally{if(!request.signal.aborted)setLoading(false);}
  }
  async function attach(){
    if(!selected||lock.current)return;
    lock.current=true;setSaving(true);setError("");
    try{
      const response=await fetch("/api/characters",{method:"POST",credentials:"include",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"attach_saved_voice",id:characterId,voiceId:selected})});
      const data=await response.json();if(!response.ok||!data.ok)throw Error(data.error||"Could not attach this voice.");
      setOpen(false);onSaved();
    }catch(cause){setError(cause instanceof Error?cause.message:"Could not attach this voice.");}
    finally{lock.current=false;setSaving(false);}
  }
  const preview=voices.find(v=>v.voiceId===selected)?.refAudioUrl;
  return <div className="space-y-2">
    <button type="button" aria-expanded={open} disabled={saving} onClick={()=>void show()} className="min-h-11 rounded-xl border border-white/20 px-3 py-2 text-sm text-white disabled:opacity-40">{open?"Close voice selection":hasVoice?"Change Voice":"Attach Voice"}</button>
    {open?<div className="space-y-2 rounded-xl border border-white/10 p-3">
      {loading?<p role="status" className="text-sm text-white/60">Loading saved voices…</p>:<>
        <label className="block text-sm text-white">Saved voice for {name}<select value={selected} disabled={saving} onChange={event=>setSelected(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-white/20 bg-slate-950 p-2 text-white"><option value="">Choose a voice</option>{voices.map(v=><option key={v.voiceId} value={v.voiceId}>{v.name}</option>)}</select></label>
        {!voices.length?<p className="text-sm text-white/60">Create and save a voice in Story Creator first. This character can stay image-only.</p>:null}
        {preview?<audio key={preview} aria-label={`Preview selected voice for ${name}`} src={preview} controls preload="none" className="w-full"/>:null}
        <button type="button" disabled={saving||!selected} onClick={()=>void attach()} className="min-h-11 rounded-xl border border-violet-300/40 px-3 py-2 text-sm text-violet-100 disabled:opacity-40">{saving?"Saving…":hasVoice?"Replace Character Voice":"Save Voice to Character"}</button>
      </>}
      {error?<p role="alert" className="text-sm text-amber-200">{error}</p>:null}
    </div>:null}
  </div>;
}
