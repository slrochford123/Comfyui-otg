"use client";
import {useRef,useState} from "react";
import type {Asset} from "@/lib/productionStudio/model";
import {DEFAULT_AUDIO_FINISH,type AudioFinishSettings} from "@/lib/productionStudio/audioFinishSettings";
import {ROOM_PROFILES,type AcousticDirection} from "@/lib/productionStudio/acoustics";
import {Button,Field,inputClass,mediaUrl} from "./Controls";
import type {useStudio} from "./useStudio";
import ShotJob from "./ShotJob";
type S=ReturnType<typeof useStudio>;
type Report={settings:AudioFinishSettings;acoustics:AcousticDirection;scope:string;warnings:string[];regions:{identity:string;start:number;end:number}[];sampleRate:number;fps:number;avOffsetErrorSeconds:number;videoPacketsIdentical:boolean};
type Props={s:S;source:Asset;shotId:string;seconds:number;run:(f:()=>Promise<unknown>)=>void;collapsed?:boolean};
export default function CinematicAudio(props:Props){return props.collapsed?<details><summary className="cursor-pointer text-sm py-2">Advanced cinematic audio</summary><CinematicAudioForm {...props}/></details>:<CinematicAudioForm {...props}/>;}
function CinematicAudioForm({s,source,shotId,seconds,run}:Props){
 const selected=s.project!.shots[shotId]?.audioSelections?.[source.id]||source.id;
 const variants=s.assets.filter(a=>a.metadata.cinematicFor===source.id&&a.metadata.sourceSha256===source.sha256),[chosen,setChosen]=useState(""),variant=variants.find(a=>a.id===chosen)||variants.find(a=>a.id===selected)||variants.at(-1),report=variant?.metadata.cinematicAudio as Report|undefined;
 const [mode,setMode]=useState<"original"|"cinematic">("original"),[message,setMessage]=useState(""),[manual,setManual]=useState<AudioFinishSettings|null>(null),[adjust,setAdjust]=useState(false);
 const player=useRef<HTMLVideoElement>(null),seek=useRef<{time:number;playing:boolean}|null>(null),settings=manual||report?.settings||DEFAULT_AUDIO_FINISH;
 const busy=s.jobs.some(j=>j.kind==="audio-finish"&&["queued","running","canceling"].includes(j.status));
 const enhance=(adjustment?:string)=>run(async()=>{await s.job({kind:"audio-finish",shotId,assetId:source.id,audioSettings:settings,...(adjustment?{adjustment}:{})});setAdjust(false);setMessage("");});
 const switchTo=(m:"original"|"cinematic")=>{if(player.current)seek.current={time:player.current.currentTime,playing:!player.current.paused};setMode(m);};
 const patch=(value:Partial<AudioFinishSettings>)=>setManual({...settings,...value});
 return <div className="space-y-3 border-t border-white/10 pt-3">
  <Button disabled={!s.saved||busy} onClick={()=>enhance()}>Enhance Cinematic Audio</Button>
  <p className="text-xs text-white/60">Creates an optional soundtrack version on CPU. Video frames, dialogue timing and original audio stay saved.</p>
  <ShotJob s={s} shotId={shotId} kinds={["audio-finish"]} run={run} retry={()=>enhance()}/>
  {variant&&report&&<>
   {variants.length>1&&<Field label="Cinematic audio version"><select className={inputClass} value={variant.id} onChange={e=>{setChosen(e.target.value);setManual(null);switchTo("original");}}>{variants.map((v,i)=><option key={v.id} value={v.id}>Version {i+1}{selected===v.id?" · selected":""}</option>)}</select></Field>}
   <div className="flex flex-wrap gap-2" role="group" aria-label="Audio comparison"><Button aria-pressed={mode==="original"} onClick={()=>switchTo("original")}>Original Audio</Button><Button aria-pressed={mode==="cinematic"} onClick={()=>switchTo("cinematic")}>Cinematic Audio</Button></div>
   <video ref={player} aria-label={mode==="original"?"Original Audio comparison":"Cinematic Audio comparison"} controls playsInline preload="metadata" className="w-full max-h-96 rounded-xl" src={mediaUrl(s.project!.id,mode==="cinematic"?variant.id:source.id)} onLoadedMetadata={()=>{if(seek.current&&player.current){player.current.currentTime=Math.min(seek.current.time,seconds);if(seek.current.playing)void player.current.play().catch(()=>{});seek.current=null;}}} onTimeUpdate={()=>{if(player.current&&player.current.currentTime>=seconds){player.current.pause();player.current.currentTime=0;}}}/>
   <p className="text-sm">{report.scope}. {selected===variant.id?"This cinematic version is selected.":selected===source.id?"Original audio selected.":"Another cinematic version is selected."} Listen to both before choosing.</p>
   <div className="flex flex-wrap gap-2"><Button disabled={!s.saved||selected===variant.id} onClick={()=>run(()=>s.commit({type:"audio.select",shotId,sourceId:source.id,assetId:variant.id}))}>Use Cinematic Audio</Button><Button disabled={!s.saved||busy} onClick={()=>setAdjust(v=>!v)}>Adjust with AI</Button><Button disabled={!s.saved} onClick={()=>run(()=>s.commit({type:"audio.select",shotId,sourceId:source.id,assetId:source.id}))}>Keep Original</Button></div>
   {adjust&&<div className="space-y-2"><Field label="Audio adjustment"><textarea className={inputClass} value={message} maxLength={2000} onChange={e=>setMessage(e.target.value)} placeholder="Make Mia quieter through the cellphone, or reduce Ava's reverb."/></Field><Button disabled={!s.saved||busy||!message.trim()} onClick={()=>enhance(message)}>Apply Audio Adjustment</Button><p className="text-xs text-white/60">Uses the AI Director to adjust processing and creates another comparison. Your current audio selection stays unchanged.</p></div>}
   {!!report.warnings.length&&<p className="text-xs text-amber-200">{report.warnings.join(" ")}</p>}
  </>}
  <details className="space-y-2"><summary className="cursor-pointer py-2 text-sm">Advanced audio finish</summary>
   <label className="flex gap-2 text-sm"><input type="checkbox" checked={settings.sourceEffects} onChange={e=>patch({sourceEffects:e.target.checked})}/>Process separated speech only when exact dialogue regions match. Separation may leave bleed; otherwise retain the native mix.</label>
   {([['roomAmount','Room reflections',0,.7,.05],['phoneGainDb','Phone level · dB',-18,3,1],['phoneLowHz','Phone low cutoff · Hz',150,600,25],['phoneHighHz','Phone high cutoff · Hz',2400,5000,100],['targetLufs','Delivery target · LUFS',-24,-14,1]] as const).map(([key,label,min,max,step])=><Field key={key} label={label}><input className={inputClass} type="number" min={min} max={max} step={step} value={settings[key]} onChange={e=>patch({[key]:Number(e.target.value)})}/></Field>)}
   {report?.acoustics.sources.map(source=>{
    const value=settings.sources.find(v=>v.identity===source.identity)||{identity:source.identity,roomAmount:settings.roomAmount,gainDb:source.device==="none"?settings.dialogueGainDb:settings.phoneGainDb,pan:0,roomProfile:"direction" as const};
    const update=(p:Partial<typeof value>)=>patch({sources:[...settings.sources.filter(v=>v.identity!==source.identity),{...value,...p}]});
    return <details key={source.identity}><summary className="cursor-pointer py-2">{source.identity} · source effects</summary>
     <Field label={source.identity+" room profile"}><select className={inputClass} value={value.roomProfile} onChange={e=>update({roomProfile:e.target.value as typeof value.roomProfile})}><option value="direction">Follow approved direction and room transitions</option>{ROOM_PROFILES.map(p=><option key={p} value={p}>{p}</option>)}</select></Field>
     {([['roomAmount','reflections',0,.7,.05],['gainDb','level · dB',-18,3,1],['pan','stereo position',-.35,.35,.05]] as const).map(([key,label,min,max,step])=><Field key={key} label={source.identity+" "+label}><input className={inputClass} type="number" min={min} max={max} step={step} value={value[key]} onChange={e=>update({[key]:Number(e.target.value)})}/></Field>)}
    </details>;
   })}
   <Button disabled={!s.saved||busy} onClick={()=>enhance()}>Render Adjusted Comparison</Button>
   {report&&<pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs">{JSON.stringify(report,null,2)}</pre>}
  </details>
 </div>;
}
