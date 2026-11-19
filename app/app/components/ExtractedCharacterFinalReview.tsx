'use client';
/* eslint-disable @next/next/no-img-element */
import React from 'react';
import {completeDevelopmentCard,developmentCardViews} from '@/lib/videoCharacters/contract';
import type {Workspace,Candidate} from '@/lib/videoCharacters/contract';
const button='min-h-11 rounded-lg border border-white/20 px-3 py-2 text-sm disabled:opacity-40';
export default function ExtractedCharacterFinalReview({workspace,character,media,busy,onAction}:{workspace:Workspace;character:Candidate;media:(file:string)=>string;busy:boolean;onAction:(action:string,fields?:Record<string,unknown>,rethrow?:boolean)=>Promise<void>}){
 const saved=workspace.savedCharacters?.[character.id],views=developmentCardViews(character).filter(v=>v?.file&&v.approvedAt),sheet=character.development?.sheet;
 const complete=async()=>{await onAction('complete-character',{character:character.id},true);window.location.assign('/app?tab=characters');};
 return <section className="min-w-0 space-y-3" aria-label="Final Review">
  <h3 className="font-semibold">Final Review</h3><p className="text-sm">Review your saved character. A voice, full Character Card, and visual RefMod are optional.</p>
  <img src={saved?.imageUrl||media(character.file)} alt={character.name+' main image'} className="mx-auto max-h-80 max-w-full object-contain"/>
  <button type="button" className={button} disabled={busy} onClick={()=>void onAction('stage',{stage:2})}>Edit character images</button>
  {views.length>0&&<div className="grid grid-cols-2 gap-2">{views.map(v=><figure key={v!.id} className="min-w-0"><img src={media(v!.file!)} alt={v!.angle} className="h-40 w-full object-contain"/><figcaption className="text-xs">{v!.angle} · approved</figcaption></figure>)}</div>}
  {sheet&&completeDevelopmentCard(character)?<div><p className="text-sm">Character Card · approved</p><a href={media(sheet.file)} target="_blank" rel="noreferrer"><img src={media(sheet.file)} alt="Five-view Character Card" className="w-full object-contain"/></a></div>:<p className="text-sm text-white/70">Character Card: not completed (optional).</p>}
  <div className="text-sm">Visual RefMod: {character.bundle?.state==='ready'&&character.bundle.visualOnly?<>Ready {character.bundle.file&&<a className="underline" href={media(character.bundle.file)}>Download</a>}</>:character.bundle?character.bundle.error||character.bundle.state:'not created (optional)'}</div>
  <div className="space-y-2"><p className="text-sm">Voice: {saved?.voiceName?saved.voiceName+(saved.voiceProvider?' · '+saved.voiceProvider:''):'not assigned (optional)'}</p>{saved?.voiceAudioUrl&&<audio controls preload="none" src={saved.voiceAudioUrl} className="w-full" aria-label="Saved character voice"/>}<button type="button" className={button} disabled={busy||!character.globalId} onClick={()=>void onAction('stage',{stage:3})}>{saved?.voiceAudioUrl?'Change voice':'Add Voice'}</button></div>
  {!saved&&<p className="text-sm text-amber-200">Save this character in Develop before completing.</p>}
  <button type="button" className={button} disabled={busy||!saved} onClick={()=>void complete().catch(()=>{/* Shared workspace action displays the error. */})}>Complete</button>
 </section>;
}
