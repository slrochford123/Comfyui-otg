"use client";
import {useState} from "react";
import type {useStudio} from "./useStudio";
import {prepareShotImage} from "@/lib/productionStudio/shotPreparation";
import {shotContext} from "@/lib/productionStudio/shotDirector";
import {Button,Section} from "./Controls";
import AssetPreview from "./AssetPreview";
import CreatePicker from "./CreatePicker";
import ShotJob from "./ShotJob";
type S=ReturnType<typeof useStudio>;
export default function ShotStoryboard({s,shotId,run,generate,busy,editPrompt}:{s:S;shotId:string;run:(f:()=>Promise<unknown>)=>void;generate:(kind:string)=>void;busy:boolean;editPrompt:()=>void}){
 const p=s.project!,{settings}=shotContext(p,shotId),prepared=prepareShotImage(p,shotId,s.assets),[picker,setPicker]=useState(false),[editing,setEditing]=useState(false),[existing,setExisting]=useState(false);
 const image=s.assets.find(a=>a.id===settings.storyboardId),candidates=[...new Set([...(settings.storyboardCandidates||[]),...s.jobs.filter(j=>j.kind==="storyboard"&&j.input.shotId===shotId&&j.outputAssetId).map(j=>j.outputAssetId!)])];
 const patch=(patch:Record<string,unknown>)=>s.change({type:"shot.settings",shotId,patch});
 if(settings.storyboardApproved&&image&&!editing)return <Section title="2 · Storyboard Image"><AssetPreview asset={image}/><p className="text-sm">Approved visual concept. First-frame conditioning is selected separately in Action.</p><Button onClick={()=>setEditing(true)}>Change Starting Image</Button></Section>;
 return <Section title="2 · Storyboard Image">
  <Button disabled={busy} onClick={()=>setExisting(v=>!v)}>Select Existing Image</Button>
  {existing&&<CreatePicker s={s} kind="image-reference" onPick={async a=>{await s.commit({type:"shot.settings",shotId,patch:{storyboardId:a.id,storyboardApproved:false}});setExisting(false);}}/>}
  <div className="flex flex-wrap gap-2" role="group" aria-label="Starting image method">{([["auto","Create with AI"],["references","Select References"],["text","Create from Text"]] as const).map(([mode,label])=><Button key={mode} aria-pressed={prepared.mode===mode} disabled={busy} onClick={()=>patch({storyboardMode:mode,...(mode==="references"&&!settings.storyboardReferenceIds?{storyboardReferenceIds:prepared.referenceIds}:{})})}>{label}</Button>)}</div>
  <p className="text-xs text-white/60">{prepared.mode==="text"?"Krea 2 Turbo · text-only image. No identity images will be used.":"Qwen Image Edit 2.1 Turbo · composes this shot from pinned images. Preparing inputs does not generate anything."}</p>
  {prepared.mode!=="text"&&<details className="space-y-2"><summary className="cursor-pointer py-2">References · {prepared.references.length} selected (up to 16)</summary>
   <div className="flex gap-2 overflow-x-auto pb-2">{prepared.references.map((a,i)=><div key={a.id} className="shrink-0 w-28 text-xs space-y-1"><AssetPreview asset={a} compact/><p className="break-words">{i+1}. {a.name}</p>{prepared.mode==="references"&&<Button aria-label={`Remove ${a.name} reference`} disabled={busy} onClick={()=>patch({storyboardReferenceIds:prepared.referenceIds.filter(id=>id!==a.id)})}>Remove</Button>}</div>)}</div>
   {prepared.mode==="references"&&<><Button disabled={busy} onClick={()=>setPicker(v=>!v)}>{picker?"Close Reference Library":"Add Reference"}</Button>{picker&&<CreatePicker s={s} kind="image-reference" onPick={async a=>{
    if(prepared.referenceIds.includes(a.id))return;
    if(prepared.referenceIds.length>=16)throw Error("Qwen supports 16 images. Remove a reference before adding another.");
    if(!p.bindings.some(b=>b.assetId===a.id&&b.approved)&&!Object.values(p.shots).some(v=>v.storyboardId===a.id&&v.storyboardApproved)){
     if(!confirm(`Approve the pinned copy of ${a.name} as a reference for this production? The library original is not changed.`))return;
     await s.commit({type:"asset.bind",assetId:a.id,role:"Shot visual reference",approved:true});
    }
    await s.commit({type:"shot.settings",shotId,patch:{storyboardReferenceIds:[...prepared.referenceIds,a.id]}});await s.refresh();
   }}/>}</>}
  </details>}
  {prepared.errors.map(e=><p key={e} className="text-sm text-amber-200">{e}</p>)}{prepared.warnings.map(e=><p key={e} className="text-sm text-amber-200">{e}</p>)}
  <Button onClick={editPrompt}>Edit Image Prompt / Ask Director</Button>
  {image&&<div className="space-y-2" aria-label="Current starting image"><AssetPreview key={image.id} asset={image}/><p className="text-sm">{settings.storyboardApproved?"Approved starting image":"Candidate — review before approval"}</p></div>}
  <div className="flex flex-wrap gap-2"><Button disabled={!s.saved||busy||!!prepared.errors.length} onClick={()=>generate("storyboard")}>{image?"Try Another Image":"Generate Starting Image"}</Button>{image&&<Button disabled={!s.saved||busy||settings.storyboardApproved} onClick={()=>run(()=>s.commit({type:"shot.settings",shotId,patch:{storyboardApproved:true}}))}>{settings.storyboardApproved?"Image Approved ✓":"Use This Image"}</Button>}<Button disabled={busy} onClick={()=>{patch({storyboardMode:"references",storyboardReferenceIds:prepared.referenceIds});setPicker(true);}}>Change References</Button></div>
  <label className="block text-sm py-2">Upload Starting Image<input className="block max-w-full mt-2" type="file" accept="image/*" disabled={!s.saved||busy} onChange={e=>{const file=e.target.files?.[0];e.target.value="";if(file)run(async()=>{const form=new FormData();form.set("file",file);const {asset}=await s.request(s.url+"/assets",{method:"POST",body:form});await s.commit({type:"shot.settings",shotId,patch:{storyboardId:asset.id,storyboardApproved:false}});await s.refresh();});}}/></label>
  {!!candidates.length&&<details><summary className="cursor-pointer py-2">Previous image candidates · {candidates.length}</summary><div className="flex gap-3 overflow-x-auto py-2">{candidates.map(id=>{const a=s.assets.find(v=>v.id===id);return a?<div key={id} className="w-36 shrink-0 space-y-2"><AssetPreview asset={a} compact/><p className="text-xs break-words">{a.name}</p><Button disabled={!s.saved||busy||id===image?.id} onClick={()=>run(()=>s.commit({type:"shot.settings",shotId,patch:{storyboardId:id,storyboardApproved:false}}))}>Review Image</Button><details><summary className="text-xs">Source references</summary><p className="text-xs">{((a.metadata.storyboardPreparation as {references?:{name:string}[]}|undefined)?.references||[]).map(r=>r.name).join(", ")||"Uploaded or earlier image; original retained."}</p></details></div>:null;})}</div></details>}
  <ShotJob s={s} shotId={shotId} kinds={["storyboard"]} run={run} retry={generate}/>
 </Section>;
}
