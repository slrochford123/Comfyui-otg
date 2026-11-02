"use client";
import type { LabSettings } from "@/lib/experiments/catalog";
import { H3_STYLE_PRESETS } from "@/lib/h3StylePresets";
import { H3_CAMERA_FEEL_OPTIONS, H3_SHOT_FLOW_OPTIONS } from "@/lib/experiments/creative";
import type { NsfwUiState } from "@/lib/client/h3NsfwDraft";
import type { LabLora } from "@/lib/experiments/generation";
const button="min-h-11 rounded-xl border border-white/15 px-3 py-2 text-sm disabled:opacity-40";
const field="mt-1 w-full min-w-0 rounded-xl border border-white/15 bg-black/25 p-3 text-base";
type Props={settings:LabSettings;model:string;ui:NsfwUiState;disabled:boolean;loras:LabLora[];onPatch:(v:Partial<LabSettings>)=>void;onUi:(v:Partial<NsfwUiState>)=>void;onPrompt:(v:string)=>void;onBuild:()=>void;onDirector:()=>void};
export default function H3NsfwPromptTools({settings,model,ui,disabled,loras,onPatch,onUi,onPrompt,onBuild,onDirector}:Props){
 const selected=settings.loras||[],compatible=loras.filter(l=>l.models.includes(model));
 const toggle=(section:string,open:boolean)=>{if(ui.openSections.includes(section)===open)return;onUi({openSections:open?[...ui.openSections,section]:ui.openSections.filter(s=>s!==section)});};
 return <div className="space-y-3">
  <details className="rounded-xl border border-white/10 p-3" open={ui.openSections.includes("prompter")} onToggle={e=>toggle("prompter",e.currentTarget.open)}>
   <summary className="min-h-11 cursor-pointer py-2 font-medium">H3 Prompter · Style & camera</summary>
   <div className="grid gap-3 sm:grid-cols-2">
    <label className="text-sm sm:col-span-2">Style<select aria-label="H3 visual style" className={field} disabled={disabled} value={settings.stylePresetId||"none"} onChange={e=>onPatch({stylePresetId:e.target.value})}>{H3_STYLE_PRESETS.map(s=><option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
    <label className="text-sm">Camera<select className={field} value={settings.cameraFeel||H3_CAMERA_FEEL_OPTIONS[0]} disabled={disabled} onChange={e=>onPatch({cameraFeel:e.target.value})}>{H3_CAMERA_FEEL_OPTIONS.map(s=><option key={s}>{s}</option>)}</select></label>
    <label className="text-sm">Shot flow<select className={field} value={settings.shotFlow||H3_SHOT_FLOW_OPTIONS[0]} disabled={disabled} onChange={e=>onPatch({shotFlow:e.target.value})}>{H3_SHOT_FLOW_OPTIONS.map(s=><option key={s}>{s}</option>)}</select></label>
   </div>
   <button className={`${button} mt-3 bg-violet-600/40`} disabled={disabled||!settings.prompt.trim()||!!ui.builderId} onClick={onBuild}>{ui.builderId?"Building prompt…":"Build H3 prompt"}</button>
  </details>
  <details className="rounded-xl border border-white/10 p-3" open={ui.openSections.includes("director")} onToggle={e=>toggle("director",e.currentTarget.open)}>
   <summary className="min-h-11 cursor-pointer py-2 font-medium">OpenAI Prompt Generator</summary>
   <label className="block text-sm">Your direction<textarea aria-label="OpenAI H3 direction" className={`${field} min-h-24`} maxLength={4000} disabled={disabled} value={ui.directorDraft} onChange={e=>onUi({directorDraft:e.target.value})} placeholder="Describe what you want to create or change…"/></label>
   <button className={`${button} mt-2 bg-violet-600/40`} disabled={disabled||(!ui.directorDraft.trim()&&!settings.prompt.trim())} onClick={onDirector}>Generate prompt</button>
   {ui.directorReply&&<p className="mt-2 text-sm text-white/65">{ui.directorReply}</p>}
   <p className="mt-2 text-xs text-white/50">Uses your configured OpenAI connection and normal API usage. References are described, not uploaded.</p>
  </details>
  {ui.suggestion&&<div className="space-y-2 rounded-xl border border-violet-400/40 p-3"><label className="text-sm">Prompt suggestion<textarea className={`${field} min-h-32`} aria-label="Prompt suggestion" value={ui.suggestion} maxLength={8000} onChange={e=>onUi({suggestion:e.target.value})}/></label><div className="flex flex-wrap gap-2"><button className={`${button} bg-violet-600/40`} disabled={disabled} onClick={()=>{onPrompt(ui.suggestion);onUi({suggestion:""});}}>Use prompt</button><button className={button} disabled={disabled} onClick={()=>onUi({suggestion:""})}>Dismiss suggestion</button></div></div>}
  <details className="rounded-xl border border-white/10 p-3" open={ui.openSections.includes("loras")} onToggle={e=>toggle("loras",e.currentTarget.open)}>
   <summary className="min-h-11 cursor-pointer py-2 font-medium">H3 LoRAs{selected.length?` · ${selected.length}`:""}</summary>
   <label className="block text-sm">Add LoRA<select aria-label="Add H3 LoRA" className={field} value="" disabled={disabled||selected.length>=6||!compatible.length} onChange={e=>{const l=compatible.find(l=>l.id===e.target.value);if(l)onPatch({loras:[...selected,{id:l.id,strength:l.defaultStrength}]});}}><option value="">{compatible.length?"Choose a compatible LoRA…":"No qualified LoRAs for this model"}</option>{compatible.filter(l=>!selected.some(s=>s.id===l.id)).map(l=><option key={l.id} value={l.id}>{l.displayName}</option>)}</select></label>
   {selected.map(s=>{const l=loras.find(l=>l.id===s.id);return <div key={s.id} className="mt-3 space-y-2 rounded-xl border border-white/10 p-3"><div className="flex items-center justify-between gap-2"><span className="text-sm">{l?.displayName||s.id}{!l?.models.includes(model)?" · unavailable for this model":""}</span><button className={button} disabled={disabled} aria-label={`Remove LoRA ${l?.displayName||s.id}`} onClick={()=>onPatch({loras:selected.filter(x=>x.id!==s.id)})}>Remove</button></div><label className="block text-sm">Strength · {s.strength}<input aria-label={`Strength ${l?.displayName||s.id}`} className="block min-h-11 w-full accent-violet-500" type="range" step={.05} min={l?.minStrength??0} max={l?.maxStrength??1} value={s.strength} disabled={disabled||!l?.models.includes(model)} onChange={e=>onPatch({loras:selected.map(x=>x.id===s.id?{...x,strength:Number(e.target.value)}:x)})}/></label>{!!l?.triggerWords.length&&<p className="text-xs text-white/60">Auto-added: {l.triggerWords.join(", ")}</p>}</div>;})}
   <p className="mt-2 text-xs text-white/50">Installed, shape-checked adapters only; combinations remain experimental. Acceleration and incompatible adapters are excluded.</p>
  </details>
 </div>;
}
