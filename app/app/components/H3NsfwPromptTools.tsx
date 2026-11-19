"use client";
import React, { useEffect, useState } from "react";
import SpeechInputButton from "./SpeechInputButton";
import type { LabSettings } from "@/lib/experiments/catalog";
import { H3_STYLE_PRESETS } from "@/lib/h3StylePresets";
import { H3_CAMERA_FEEL_OPTIONS, H3_SHOT_FLOW_OPTIONS } from "@/lib/experiments/creative";
import type { NsfwUiState } from "@/lib/client/h3NsfwDraft";
import type { LabLora } from "@/lib/experiments/generation";
const button="min-h-11 rounded-xl border border-white/15 px-3 py-2 text-sm disabled:opacity-40";
const field="mt-1 w-full min-w-0 rounded-xl border border-white/15 bg-black/25 p-3 text-base";
type Props={dictationScope?:string;settings:LabSettings;model:string;ui:NsfwUiState;disabled:boolean;loras:LabLora[];onPatch:(v:Partial<LabSettings>)=>void;onUi:(v:Partial<NsfwUiState>)=>void;onPrompt:(v:string)=>boolean|void;onBuild:()=>void;directControls?:React.ReactNode};
export default function H3NsfwPromptTools({settings,model,ui,disabled,loras,onPatch,onUi,onPrompt,onBuild,directControls,dictationScope="h3"}:Props){
 const [micStatus,setMicStatus]=useState("");
 const [editing,setEditing]=useState(false);
 useEffect(()=>{setEditing(false);},[dictationScope]);
 const selected=settings.loras||[],compatible=loras.filter(lora => lora.models.includes(model));
 const toggle=(section:string,open:boolean)=>{if(ui.openSections.includes(section)===open)return;onUi({openSections:open?[...ui.openSections,section]:ui.openSections.filter(s=>s!==section)});};
 return <div className="space-y-3">
  <details className="rounded-xl border border-white/10 p-3" open={ui.openSections.includes("loras")} onToggle={e=>toggle("loras",e.currentTarget.open)}>
   <summary className="min-h-11 cursor-pointer py-2 font-medium">H3 LoRAs{selected.length?` · ${selected.length}`:""}</summary>
   <label className="block text-sm">Add LoRA<select aria-label="Add H3 LoRA" className={field} value="" disabled={disabled||!compatible.length} onChange={e=>{const l=compatible.find(l=>l.id===e.target.value);if(l)onPatch({loras:[...selected,{id:l.id,strength:l.defaultStrength}]});}}><option value="">{compatible.length?"Choose a compatible LoRA…":"No installed H3 LoRAs"}</option>{compatible.filter(l=>!selected.some(s=>s.id===l.id)).map(l=><option key={l.id} value={l.id}>{l.displayName}{!l.models.includes(model)?" · different tensor targets":""}</option>)}</select></label>
   {selected.map(s=>{const l=loras.find(l=>l.id===s.id);return <div key={s.id} className="mt-3 space-y-2 rounded-xl border border-white/10 p-3"><div className="flex items-center justify-between gap-2"><span className="text-sm">{l?.displayName||s.id}{!l?.models.includes(model)?" · unavailable for this model":""}</span><button className={button} disabled={disabled} aria-label={`Remove LoRA ${l?.displayName||s.id}`} onClick={()=>onPatch({loras:selected.filter(x=>x.id!==s.id)})}>Remove</button></div><label className="block text-sm">Strength · {s.strength}<input aria-label={`Strength ${l?.displayName||s.id}`} className="block min-h-11 w-full accent-violet-500" type="range" step={.05} min={l?.minStrength??0} max={l?.maxStrength??1} value={s.strength} disabled={disabled||!l?.models.includes(model)} onChange={e=>onPatch({loras:selected.map(x=>x.id===s.id?{...x,strength:Number(e.target.value)}:x)})}/></label>{!!l?.triggerWords.length&&<p className="text-xs text-white/60">Auto-added: {l.triggerWords.join(", ")}</p>}</div>;})}
   <p className="mt-2 text-xs text-white/50">Installed H3 LoRAs are listed here. Different tensor targets require a matching checkpoint. Selected adapters are passed to the workflow; combinations can change quality.</p>
  </details>
  <details className="rounded-xl border border-white/10 p-3" open={ui.openSections.includes("prompter")} onToggle={e=>toggle("prompter",e.currentTarget.open)}>
   <summary className="min-h-11 cursor-pointer py-2 font-medium">Choose the Look</summary>
   <div className="grid gap-3 sm:grid-cols-2">
    <label className="text-sm sm:col-span-2">Style<select aria-label="H3 visual style" className={field} disabled={disabled} value={settings.stylePresetId||"none"} onChange={e=>onPatch({stylePresetId:e.target.value})}>{H3_STYLE_PRESETS.map(s=><option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
    <label className="text-sm">Camera<select className={field} value={settings.cameraFeel||H3_CAMERA_FEEL_OPTIONS[0]} disabled={disabled} onChange={e=>onPatch({cameraFeel:e.target.value})}>{H3_CAMERA_FEEL_OPTIONS.map(s=><option key={s}>{s}</option>)}</select></label>
    <label className="text-sm">Shot flow<select className={field} value={settings.shotFlow||H3_SHOT_FLOW_OPTIONS[0]} disabled={disabled} onChange={e=>onPatch({shotFlow:e.target.value})}>{H3_SHOT_FLOW_OPTIONS.map(s=><option key={s}>{s}</option>)}</select></label>
   </div>

  </details>
  {directControls}
  <button className={`${button} bg-violet-600/40`} disabled={disabled||!settings.prompt.trim()||!!ui.builderId} onClick={onBuild}>{ui.builderId?"Directing…":"Direct Scene"}</button>
  {ui.suggestion&&<div className="space-y-2 rounded-xl border border-violet-400/40 p-3">
    {!editing && <p className="whitespace-pre-wrap text-sm">{ui.suggestion}</p>}
    {editing && <>
      <label className="text-sm">Prompt suggestion<textarea className={`${field} min-h-32`} aria-label="Prompt suggestion" value={ui.suggestion} maxLength={8000} onChange={e=>onUi({suggestion:e.target.value})}/></label>
      <SpeechInputButton key={dictationScope} label="Dictate prompt suggestion" endpoint="/api/local-dictation" className={button} disabled={disabled} onStatus={setMicStatus} onTranscript={text=>onUi({suggestion:[ui.suggestion,text].filter(Boolean).join("\n")})}/>
    </>}
    <div className="flex flex-wrap gap-2">
      <button className={`${button} bg-violet-600/40`} disabled={disabled||!!ui.builderId} onClick={()=>{
        if(onPrompt(ui.suggestion) !== false){onUi({suggestion:"",suggestionKey:undefined,directorReply:""});setEditing(false);}
      }}>Save</button>
      {!editing && <>
        <button className={button} disabled={disabled||!!ui.builderId} onClick={onBuild}>Retry</button>
        <button className={button} disabled={disabled||!!ui.builderId} onClick={()=>onUi({suggestion:"",suggestionKey:undefined,directorReply:""})}>Clear</button>
        <button className={button} disabled={disabled||!!ui.builderId} onClick={()=>setEditing(true)}>Edit</button>
      </>}
    </div>
  </div>}
  {ui.suggestion&&micStatus&&<p role="status" className="text-sm text-white/65">{micStatus}</p>}

 </div>;
}
