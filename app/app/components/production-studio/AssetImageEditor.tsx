"use client";
import {useId,useRef,useState} from "react";
import type {Asset} from "@/lib/productionStudio/model";
import type {CreateItem} from "@/lib/productionStudio/createTypes";
import {imageEditDetails} from "@/lib/productionStudio/assetImageEdit";
import {Button,Field,inputClass} from "./Controls";
import {useStoredDraft} from "./useStoredDraft";
import type {useStudio} from "./useStudio";
import AssetPreview from "./AssetPreview";
import CreatePicker from "./CreatePicker";

export default function AssetImageEditor({s,item,source,onReview}:{s:ReturnType<typeof useStudio>;item:CreateItem;source:Asset;onReview:(asset:Asset)=>void}){
  const [open,setOpen]=useState(false),[picker,setPicker]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const [draft,setDraft]=useStoredDraft(s.scopeKey+":image-edit:v1:"+item.id+":"+source.id,{references:[] as string[],instructions:""});
  const lock=useRef(false),panelId=useId(),ids=[source.id,...draft.references],references=ids.map(id=>s.assets.find(a=>a.id===id));
  const active=s.jobs.some(j=>j.input.requirementId===item.id&&["queued","running","canceling"].includes(j.status));
  const disabled=busy||active||!s.saved;
  const result=s.assets.filter(a=>a.metadata.requirementId===item.id&&imageEditDetails(a)?.references[0]?.id===source.id).at(-1);
  async function pick(a:Asset){
    if(ids.includes(a.id))throw Error("This image is already a reference. Choose the other character or another image.");
    if(ids.length>=4)throw Error("FIBO accepts four references total. Remove one before adding another.");
    if(!a.mime.startsWith("image/"))throw Error("Choose an image reference.");
    setDraft(d=>({...d,references:[...d.references,a.id]}));setPicker(false);
  }
  async function edit(){
    if(lock.current)return;
    if(!confirm(`Create an edited candidate with FIBO 2.0 Turbo using ${ids.length} image reference(s) and the shared GPU queue? Originals and approved selections will remain unchanged.`))return;
    lock.current=true;setBusy(true);setError("");
    try{await s.job({kind:"asset-image",requirementId:item.id,editMode:true,referenceIds:ids,prompt:draft.instructions});}
    catch(e){setError(e instanceof Error?e.message:"The edit could not start. Your instructions and sources are kept.");}
    finally{lock.current=false;setBusy(false);}
  }
  return <div className="space-y-3 rounded-xl border border-purple-400/20 p-3">
    <Button aria-expanded={open} aria-controls={panelId} onClick={()=>setOpen(v=>!v)}>Edit with FIBO Turbo</Button>
    {result&&<Button disabled={!s.saved||busy} onClick={()=>onReview(result)}>Review Edited Image</Button>}
    {open&&<div id={panelId} className="space-y-3">
      <p className="text-sm">Edit this image or combine characters into one photo. Reference 1 is the selected image; add the other character as Reference 2. Up to four images total.</p>
      {item.kind==="character"&&<p className="text-xs text-amber-200">For a shared photo, use a separate Prop / reference image item so each character keeps their own identity reference.</p>}
      <div className="grid grid-cols-2 gap-2" aria-label="FIBO image references">{ids.map((id,index)=><div key={id} className="min-w-0 rounded-lg border border-white/10 p-2 space-y-1"><p className="text-xs font-medium">Reference {index+1}{index===0?" · Source":""}</p>{references[index]?<><AssetPreview asset={references[index]!} compact/><p className="text-xs break-words">{references[index]!.name}</p></>:<p role="alert" className="text-xs">Reference unavailable. Remove it and choose again.</p>}{index>0&&<Button disabled={disabled} aria-label={`Remove Reference ${index+1}`} onClick={()=>setDraft(d=>({...d,references:d.references.filter(v=>v!==id)}))}>Remove</Button>}</div>)}</div>
      <Button disabled={disabled||ids.length>=4} aria-expanded={picker} onClick={()=>setPicker(v=>!v)}>+ Add Character / Image Reference</Button>
      {picker&&<CreatePicker s={s} kind="image-reference" onPick={pick}/>}
      <details><summary className="cursor-pointer text-sm">Upload another reference</summary><Field label="Upload FIBO reference"><input className={inputClass} type="file" accept="image/png,image/jpeg,image/webp" disabled={disabled||ids.length>=4} onChange={e=>{const file=e.target.files?.[0];e.target.value="";if(!file)return;setBusy(true);setError("");void(async()=>{try{const form=new FormData();form.set("file",file);const data=await s.request(s.url+"/assets",{method:"POST",body:form});await s.refresh();await pick(data.asset);}catch(e){setError(e instanceof Error?e.message:"Reference upload failed.");}finally{setBusy(false);}})();}}/></Field></details>
      <Field label="FIBO edit instructions"><textarea className={inputClass} rows={4} maxLength={6000} value={draft.instructions} disabled={disabled} onChange={e=>setDraft(d=>({...d,instructions:e.target.value}))} placeholder="Put the woman from Reference 1 and the girl from Reference 2 together in a framed family photograph. Preserve both faces."/></Field>
      {error&&<p role="alert" className="text-sm text-amber-200">{error}</p>}
      <p className="text-xs text-white/60">The edit becomes a new candidate for this asset. Your originals, character voices and RefMods are not replaced. Review and approve the result before using it.</p>
      <Button disabled={disabled||!draft.instructions.trim()||references.some(a=>!a)} onClick={()=>void edit()}>{busy?"Submitting edit…":"Generate Edited Candidate"}</Button>
      {active&&<p role="status" className="text-xs">An image or voice request is active for this item. Progress and cancellation are shown above.</p>}
    </div>}
  </div>;
}
