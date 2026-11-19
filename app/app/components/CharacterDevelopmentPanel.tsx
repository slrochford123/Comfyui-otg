"use client";
/* eslint-disable @next/next/no-img-element */
import React,{useEffect,useState} from 'react';
import {approvedDefaultModel,characterReferenceIds,completeDevelopmentCard,developmentCardViews,DEVELOPMENT_VIEWS} from '@/lib/videoCharacters/contract';
import type {Candidate,Workspace,View} from '@/lib/videoCharacters/contract';
const button='min-h-11 rounded-lg border border-white/20 px-3 py-2 text-sm disabled:opacity-40';
export default function CharacterDevelopmentPanel({workspace,character,busy,media,onAction}:{workspace:Workspace;character:Candidate;busy:boolean;media:(file:string)=>string;onAction:(action:string,fields?:Record<string,unknown>)=>Promise<void>}){
 const [edit,setEdit]=useState<{kind:'model'|'view';view:string}|null>(null),[correction,setCorrection]=useState(''),[look,setLook]=useState(character.look||'');
 useEffect(()=>{setEdit(null);setCorrection('');setLook(character.look||'');},[character.id]);
 const ids=characterReferenceIds(character,workspace.candidates),model=character.views.find(v=>v.id===character.development?.modelId),approved=approvedDefaultModel(character),views=developmentCardViews(character),cardReady=completeDevelopmentCard(character);
 const cardViews=views.slice(1).filter((v):v is View=>!!v),allApproved=views.length===5&&views.every(v=>v?.state==='ready'&&v.file&&v.approvedAt);
 const act=(action:string,fields:Record<string,unknown>={})=>onAction(action,{character:character.id,look,...fields});
 const picture=(v:View)=><figure className="min-w-0 space-y-2 rounded-xl border border-white/15 p-3" key={v.id}>
  {v.file?<a href={media(v.file)} target="_blank" rel="noreferrer"><img src={media(v.file)} alt={v.angle} className="mx-auto max-h-96 w-full object-contain"/></a>:<p role="status">{v.error?'Needs attention':v.state}</p>}
  <figcaption className="text-sm">{v.angle}{v.master?' · 1080p derivative':' · Qwen reconstruction'}{v.approvedAt?' · Approved':''}</figcaption>
  {v.error&&<p role="alert" className="text-sm text-amber-200">{v.error}</p>}
 </figure>;
 return <section aria-label="Develop extracted character" className="min-w-0 space-y-4">
  <p className="text-sm font-semibold">Extract → Create Model → Create Character Card → Create RefMod</p>
  <label className="block text-sm">Look or outfit (optional)<input className="mt-1 w-full rounded-lg border border-white/20 bg-black/30 p-2.5" value={look} maxLength={96} onChange={e=>setLook(e.target.value)}/></label>
  <div className="flex flex-wrap gap-2">
   <button className={button} disabled={busy||ids.length!==1} onClick={()=>void act('save-basic')}>Save Character</button>
   <button className={button+' bg-violet-700/50'} disabled={busy||ids.length<1||ids.length>4} onClick={()=>void act('create-model')}>Create Model</button>
   {character.globalId&&<button className={button} disabled={busy} onClick={()=>void onAction('stage',{stage:3})}>Add Voice</button>}
  </div>
  <p className="text-sm text-white/70">{ids.length===1?'Save this original picture as a basic character, or use it to reconstruct a default model.':'These source views describe one character. Create Model combines them into one default image; raw multi-image saving is disabled.'}</p>
  {character.globalId&&<p role="status" className="text-sm text-emerald-200">Saved in Characters. Future approved models update this same record.</p>}
  <p className="text-xs text-white/60">Create Model uses Qwen Image Edit 2.1 Turbo at the same quality settings. Auto prefers RTX 3090, then RTX 5060 Ti; a card’s views stay together in the chosen GPU queue. Review proposed details, especially when the source hides parts of the body.</p>
  {model&&<div className="space-y-3">
   <h3 className="font-semibold">{approved?'Approved default model':'Review default model'}</h3>
   <details open={!approved}><summary className="cursor-pointer py-2 text-sm">{approved?'View or correct approved default':'View proposed default model'}</summary>{picture(model)}
   <p className="text-sm text-white/70">Compare against the source views above. Check age, face, hair, clothing and full head-to-feet framing. Generative reconstruction can propose unseen details.</p>
   <div className="flex flex-wrap gap-2">
    <button className={button} disabled={busy} onClick={()=>void act('retry-model')}>Retry Model</button>
    <button className={button} disabled={busy||!model.file||model.state!=='ready'} onClick={()=>{setEdit({kind:'model',view:model.id});setCorrection('');}}>Edit Model</button>
    {!approved&&<button className={button} disabled={busy||!model.file||model.state!=='ready'} onClick={()=>void act('approve-model')}>Approve Model</button>}
   </div></details>
   {approved&&<button className={button} disabled={busy} onClick={()=>void act('save-model')}>{character.globalId?'Update Character':'Save Model Character'}</button>}
   {approved&&!cardViews.length&&<div className="space-y-2"><button className={button+' bg-violet-700/50'} disabled={busy} onClick={()=>void act('create-character-card')}>Create Character Card</button><p className="text-xs text-white/65">Requests four new views: face, left, right and back. Your approved default model is the front view.</p></div>}
   <details><summary className="cursor-pointer text-sm">1080p preparation and previous attempts</summary>
    <p className="my-2 text-xs text-white/65">Optional SeedVR2 preparation improves image resolution; it does not reconstruct missing anatomy. Review the derivative again before approval.</p>
    {!model.master&&<button className={button} disabled={busy||!model.file||model.state!=='ready'} onClick={()=>void act('upscale-development-view',{view:model.id})}>Prepare 1080p Model</button>}
    <div className="mt-2 grid grid-cols-2 gap-2">{[...character.views,...(character.priorViews||[])].filter(v=>v.developmentRole==='model'&&v.id!==model.id&&v.file).map(v=><a key={v.id} href={media(v.file!)} target="_blank" rel="noreferrer"><img src={media(v.file!)} alt="Previous model candidate" className="max-h-40 w-full object-contain"/></a>)}</div>
   </details>
  </div>}
  {approved&&cardViews.length>0&&<div className="space-y-3">
   <h3 className="font-semibold">Review the five-view Character Card</h3>
   <p className="text-sm text-white/70">The approved default supplies Front Full Body. Review every additional view independently.</p>
   <div className="grid gap-3 sm:grid-cols-2">{DEVELOPMENT_VIEWS.map(role=>{const v=cardViews.find(v=>v.developmentRole===role.id);return v&&<details key={role.id} open={!v.approvedAt} className="min-w-0 space-y-2 rounded-xl border border-white/15 p-2"><summary className="cursor-pointer py-2 text-sm">{role.label}{v.approvedAt?' · Approved':' · Review'}</summary>{picture(v)}<div className="flex flex-wrap gap-2">
    <button className={button} disabled={busy} onClick={()=>void act('retry-card-view',{view:v.id})}>Retry {role.label}</button>
    <button className={button} disabled={busy||!v.file||v.state!=='ready'} onClick={()=>{setEdit({kind:'view',view:v.id});setCorrection('');}}>Edit {role.label}</button>
    {!v.approvedAt&&<button className={button} disabled={busy||!v.file||v.state!=='ready'} onClick={()=>void act('approve-card-view',{view:v.id})}>Approve {role.label}</button>}
   </div>{!v.master&&<details><summary className="cursor-pointer text-xs">Optional 1080p preparation</summary><button className={button} disabled={busy||!v.file||v.state!=='ready'} onClick={()=>void act('upscale-development-view',{view:v.id})}>Prepare 1080p {role.label}</button></details>}</details>;})}</div>
   {!cardReady&&<><button className={button} disabled={busy||!allApproved} onClick={()=>void act('approve-character-card')}>Approve Character Card</button>{!allApproved&&<p className="text-xs text-white/65">Approve all five individual views before assembling and saving the sheet.</p>}</>}
  </div>}
  {edit&&<section aria-label="Correct character image" className="space-y-2 rounded-xl border border-violet-300/30 p-3">
   <label className="block text-sm">Correction instructions<textarea autoFocus className="mt-1 min-h-24 w-full rounded-lg border border-white/20 bg-black/30 p-2.5" maxLength={1000} value={correction} onChange={e=>setCorrection(e.target.value)} placeholder="Keep the original face and age. Change the shirt to blue."/></label>
   <button className={button} disabled={busy||!correction.trim()} onClick={()=>void act(edit.kind==='model'?'edit-model':'edit-card-view',{view:edit.view,correction}).then(()=>setEdit(null))}>Submit Correction</button>
   <button className={button+' ml-2'} disabled={busy} onClick={()=>setEdit(null)}>Cancel Edit</button>
   <p className="text-xs text-white/65">The previous candidate and source evidence are retained. Retry always returns to the original evidence or approved default.</p>
  </section>}
  {cardReady&&character.development?.sheet&&<div className="space-y-3"><h3 className="font-semibold">Approved Character Card</h3>
   <a href={media(character.development.sheet.file)} target="_blank" rel="noreferrer"><img src={media(character.development.sheet.file)} alt="Approved five-view Character Card" className="w-full rounded-lg"/></a>
   <button className={button} disabled={busy||!!character.bundle&&!['failed','canceled','attention'].includes(character.bundle.state)} onClick={()=>void act('create-visual-refmod')}>Create RefMod</button>
   <p className="text-xs text-white/65">Uses all five separate approved images, with no audio conditioning. The stitched sheet stays separate.</p>
   {character.bundle&&<p role="status" className="text-sm">Visual RefMod: {character.bundle.state}{character.bundle.error&&' · '+character.bundle.error}</p>}
  </div>}
  {!approved&&<p className="text-xs text-white/65">Create Character Card unlocks after the default model is approved. Create RefMod unlocks after all five views and their Character Card are approved.</p>}
 </section>;
}
