"use client";
import type {Project} from "@/lib/productionStudio/model";
import type {CreateItem,AssetComposition} from "@/lib/productionStudio/createTypes";
import {buildProductionAssetPrompt} from "@/lib/productionStudio/assetPrompts";
import {Field,inputClass} from "./Controls";

export default function AssetPromptOptions({project,item,prompt,disabled,onChange}:{project:Project;item:CreateItem;prompt:string;disabled:boolean;onChange:(value:AssetComposition)=>void}){
  let compiled="",error="",omitted:string[]=[];
  try{const result=buildProductionAssetPrompt(project,item,prompt);compiled=result.prompt;omitted=result.omitted;}catch(e){error=e instanceof Error?e.message:"Check the asset description.";}
  return <div className="space-y-2 text-sm">
    {item.kind==="environment"&&<Field label="Environment occupancy"><select className={inputClass} disabled={disabled} value={item.composition?.environmentMode||"empty"} onChange={e=>onChange({...item.composition,environmentMode:e.target.value as AssetComposition["environmentMode"]})}><option value="empty">Empty Environment</option><option value="generic-extras">Environment with Generic Extras</option><option value="specified-people">Environment with Requested People</option></select></Field>}
    {item.kind==="environment"&&item.composition?.environmentMode==="specified-people"&&<Field label="Explicitly requested people"><textarea key={item.id+":people"} className={inputClass} rows={2} defaultValue={item.composition.people||""} disabled={disabled} maxLength={1000} placeholder="Describe only the people you want included" onBlur={e=>{if(e.target.value!==(item.composition?.people||""))onChange({...item.composition,people:e.target.value});}}/></Field>}
    <details><summary className="cursor-pointer">Reference framing & final generation prompt</summary><div className="space-y-2 mt-2">
      {item.kind==="character"&&<Field label="Character composition"><select className={inputClass} disabled={disabled} value={item.composition?.characterMode||"reference"} onChange={e=>onChange({characterMode:e.target.value as AssetComposition["characterMode"]})}><option value="reference">Full-body neutral reference</option><option value="environmental">Environmental character shot (explicit)</option></select></Field>}
      <p className="text-xs text-white/60">Framing is guided by the prompt, not guaranteed by the image model. Review every result before using it. No automatic visual scoring is performed.</p>
      {compiled&&<p className="whitespace-pre-wrap break-words text-xs" data-testid="asset-final-prompt">{compiled}</p>}
      {!!omitted.length&&<details><summary className="cursor-pointer text-xs">Story context excluded from this image ({omitted.length})</summary><ul className="text-xs list-disc pl-4">{omitted.map((line,i)=><li key={i}>{line}</li>)}</ul></details>}
      <details><summary className="cursor-pointer text-xs">Saved source description (preserved in project history)</summary><p className="text-xs whitespace-pre-wrap">{item.prompt}</p><p className="text-xs whitespace-pre-wrap">{item.description}</p></details>
    </div></details>
    {error&&<p role="alert" className="text-amber-200">{error}</p>}
  </div>;
}
