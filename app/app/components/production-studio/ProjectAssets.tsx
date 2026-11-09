"use client";
import {useId,useRef,useState} from "react";
import {newClientRequestId} from "@/lib/client/requestId";
import {isAudioRequirement,requirementKinds,type CreateItem,type RequirementKind} from "@/lib/productionStudio/createTypes";
import {Button,Field,inputClass} from "./Controls";
import {useStoredDraft} from "./useStoredDraft";
import type {useStudio} from "./useStudio";
type S=ReturnType<typeof useStudio>;
const labels:Record<RequirementKind,string>={character:"Character",environment:"Environment / background",prop:"Prop / reference image",wardrobe:"Wardrobe / accessory",background:"Background group",music:"Music",sfx:"Sound effect",ambience:"Ambience"};
const empty={id:"",name:"",description:"",kind:"character" as RequirementKind,speaking:false,assetId:""};

export function AddProjectAsset({s}:{s:S}){
  const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[file,setFile]=useState<File|null>(null),[error,setError]=useState("");
  const [draft,setDraft]=useStoredDraft(s.scopeKey+":add-asset:v1",empty);
  const lock=useRef(false),formId=useId(),audio=isAudioRequirement(draft.kind);
  async function add(ai:boolean){
    if(lock.current)return;
    if(ai&&!confirm("Add this item and ask the filmmaker for details using your AI allowance? Suggestions need your approval. No media is generated."))return;
    lock.current=true;setBusy(true);setError("");let added=false;
    try{
      const id=draft.id||"manual-"+newClientRequestId();let assetId=draft.assetId;
      setDraft(v=>({...v,id}));
      if(file&&!assetId){const form=new FormData();form.set("file",file);const data=await s.request(s.url+"/assets",{method:"POST",body:form});assetId=data.asset.id;setDraft(v=>({...v,assetId}));await s.refresh();}
      await s.commit({type:"create.add",itemId:id,kind:draft.kind,name:draft.name,description:draft.description,speaking:draft.speaking,assetId:assetId||undefined});
      added=true;setDraft(empty);setFile(null);
      if(ai)await s.job({kind:"asset-assistant",requirementId:id,message:`Help fill in the reusable ${labels[draft.kind]} details for my new project item, ${draft.name}. My description: ${draft.description||"Not established yet; suggest options for approval."} Keep this separate from other characters or variants. Do not change the approved story or generate media.`});
    }catch(e){const message=e instanceof Error?e.message:"Could not add this asset. Your draft is kept.";if(added)s.setError(`The asset was added. AI help could not start: ${message} You can retry with Ask Filmmaker below.`);else setError(message);}
    finally{lock.current=false;setBusy(false);}
  }
  return <div className="border-t border-white/10 pt-3 space-y-3">
    <Button aria-expanded={open} aria-controls={formId} onClick={()=>setOpen(v=>!v)}>+ Add Asset / Image</Button>
    {open&&<div id={formId} className="rounded-xl border border-purple-400/30 p-3 space-y-3">
      <p className="text-sm">Add something else your movie needs. Keep variants separate, for example Mother — natural and Mother — ghostly.</p>
      <Field label="Asset name"><input className={inputClass} maxLength={200} value={draft.name} disabled={busy} onChange={e=>setDraft(v=>({...v,name:e.target.value}))}/></Field>
      <Field label="Asset type"><select className={inputClass} value={draft.kind} disabled={busy||!!draft.assetId} onChange={e=>{setDraft(v=>({...v,kind:e.target.value as RequirementKind}));setFile(null);}}>{requirementKinds.map(k=><option key={k} value={k}>{labels[k]}</option>)}</select></Field>
      <Field label="Asset description"><textarea className={inputClass} rows={3} maxLength={12000} value={draft.description} disabled={busy} placeholder="Describe the asset yourself, or ask AI to help with the details." onChange={e=>setDraft(v=>({...v,description:e.target.value}))}/></Field>
      {draft.kind==="character"&&<label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.speaking} disabled={busy} onChange={e=>setDraft(v=>({...v,speaking:e.target.checked}))}/>This character needs a voice</label>}
      <Field label={audio?"Attach audio (optional)":"Attach image (optional)"}><input key={draft.kind} className={inputClass} type="file" accept={audio?"audio/*":"image/png,image/jpeg,image/webp"} disabled={busy||!!draft.assetId} onChange={e=>setFile(e.target.files?.[0]||null)}/></Field>
      {draft.assetId&&<p className="text-xs">Previously uploaded file kept for this draft.</p>}
      <p className="text-xs text-white/60">You can also upload, choose an existing asset, or create an image in the next step. Uploaded files still need your approval. No generation starts automatically.</p>
      {error&&<p role="alert" className="text-sm text-amber-200">{error}</p>}
      <div className="flex flex-wrap gap-2"><Button disabled={busy||!s.saved||!draft.name.trim()} onClick={()=>void add(false)}>{busy?"Adding…":"Add to Project"}</Button><Button disabled={busy||!s.saved||!draft.name.trim()} onClick={()=>void add(true)}>Add & Ask AI for Details</Button><Button disabled={busy} onClick={()=>setOpen(false)}>Close</Button></div>
    </div>}
  </div>;
}

export function DeleteProjectAsset({s,item}:{s:S;item:CreateItem}){
  const [busy,setBusy]=useState(false);
  const active=s.jobs.some(j=>["queued","running","canceling"].includes(j.status)&&(j.kind==="asset-analysis"||j.input.requirementId===item.id));
  async function remove(){
    if(!confirm(`Delete ${item.name} from this project's active asset list? Images, voices, RefMods and existing shot/timeline references will be kept. You can restore it under Deleted Items. This is not Skip.`))return;
    setBusy(true);try{await s.commit({type:"create.delete",itemId:item.id,confirmed:true});}catch(e){s.setError(e instanceof Error?e.message:"Could not delete the project item.");}finally{setBusy(false);}
  }
  return <Button disabled={busy||!s.saved||active} aria-label={`Delete ${item.name} from Project`} title={active?"Wait for or cancel the active request first":"Delete from active list; keep media and recovery"} onClick={()=>void remove()}>Delete</Button>;
}

export function DeletedProjectAssets({s}:{s:S}){
  const items=s.project?.creation?.retiredItems.filter(i=>i.removedAt)||[];
  return items.length?<details className="rounded-xl border border-white/10 p-3"><summary className="cursor-pointer text-sm">Deleted Items ({items.length})</summary><p className="text-xs text-white/60 my-2">Removed from your active list. Original media, candidates, voices and RefMods remain recoverable. Existing shots are unchanged.</p>{items.map(i=><div key={i.id} className="flex items-center gap-2 py-2"><span className="min-w-0 flex-1 break-words text-sm">{i.name} · {labels[i.kind]}</span><Button disabled={!s.saved} aria-label={`Restore ${i.name}`} onClick={()=>void s.commit({type:"create.restore",itemId:i.id}).catch(e=>s.setError(e.message))}>Restore</Button></div>)}</details>:null;
}
