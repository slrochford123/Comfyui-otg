"use client";
import {useState} from "react";
import {newClientRequestId} from "@/lib/client/requestId";
import {shotContext} from "@/lib/productionStudio/shotDirector";
import {plannedSeconds,takeReviewSeconds} from "@/lib/productionStudio/shotPolicy";
import {directionApproved} from "@/lib/productionStudio/shotDirection";
import {startingImageReady} from "@/lib/productionStudio/clipConfiguration";
import type {Asset} from "@/lib/productionStudio/model";
import type {useStudio} from "./useStudio";
import {Button,Field,Section,inputClass,mediaUrl} from "./Controls";
import CinematicAudio from "./CinematicAudio";
import {storyboardCurrent} from "@/lib/productionStudio/workflow";
import ShotJob from "./ShotJob";
type S=ReturnType<typeof useStudio>;
function reviewFor(s:S,asset:Asset|undefined,seconds:number){return asset&&s.assets.find(a=>a.metadata.reviewFor===asset.id&&a.metadata.sourceSha256===asset.sha256&&a.metadata.plannedDuration===seconds);}
function takeSeconds(asset:Asset|undefined,fallback:number){return takeReviewSeconds(asset?.metadata,fallback);}
export default function ShotVideo({s,shotId,run,generate,busy,editPrompt,context}:{s:S;shotId:string;run:(f:()=>Promise<unknown>)=>void;generate:(kind:string,extra?:Record<string,unknown>)=>void;busy:boolean;editPrompt:()=>void;context?:"Action"}){
 const p=s.project!,{shot,settings}=shotContext(p,shotId),[selected,setSelected]=useState<{id:string;latestId:string}|null>(null),[compare,setCompare]=useState(false);
 const takes=shot.takes.filter(t=>t.assetId),latest=takes.at(-1),take=(selected?.latestId===latest?.id&&takes.find(t=>t.id===selected?.id))||latest,asset=s.assets.find(a=>a.id===take?.assetId),final=s.assets.find(a=>a.id===settings.finalAssetId),seconds=plannedSeconds(shot);
 // Keep the current review through a failed/canceled attempt; select a newly completed take automatically.
 const selectTake=(id:string)=>setSelected({id,latestId:latest?.id||""});
 const retakeKind=s.jobs.find(j=>j.id===take?.generationJobId)?.kind==="regenerate"||asset?.metadata.quality==="hq"?"regenerate":"preview";
 const valid=directionApproved(p,shotId)&&(settings.orientation||p.brief.aspect)!=="square"&&startingImageReady(p,shotId)&&p.plan.status==="approved"&&(!context||storyboardCurrent(p,shotId)),reviewSeconds=takeSeconds(asset,seconds);
 return <Section title={context?"Generate & Review":"3 · Generate & Review"}>
  <p className="text-sm">{seconds}-second shot · {shot.generationApproach==="image-to-video"?"Starts from approved image":shot.generationApproach==="reference-to-video"?"Visual references":"Text generation"} · {settings.model}</p>
  {!valid&&<p role="status" className="text-sm text-amber-200">Review and approve the current direction in Step 2 before another generation. Existing takes remain available below.</p>}
  {(!!context||!takes.length)&&<div className="flex flex-wrap gap-2"><Button disabled={!s.saved||busy||!valid} onClick={()=>generate("preview")}>{context?"Generate Preview":"Generate Video"}</Button>{!takes.length&&<Button disabled={!s.saved} onClick={editPrompt}>{context?"Reprompt":"Ask AI to Change It"}</Button>}</div>}
  <p className="text-xs text-white/60">{takes.length&&retakeKind==="regenerate"?"High-quality retake":"New Scene Hunter take"} · 3090 preferred, compatible 5060 Ti fallback; otherwise queued. Nothing generates until you ask.</p>
  <ShotJob s={s} shotId={shotId} kinds={["preview","regenerate"]} run={run} retry={generate}/>
  {!!takes.length&&<div className="space-y-3 border-t border-white/10 pt-3">
   <h4 className="font-semibold">Your Video — Clip {shot.shotNumber}</h4>
   <Field label="Take under review"><select className={inputClass} value={take?.id||""} onChange={e=>selectTake(e.target.value)}>{takes.map(t=><option key={t.id} value={t.id}>Take {t.version}{settings.approvedTakeId===t.id?" · approved":""}</option>)}</select></Field>
   {asset&&take&&<ReviewVideo key={asset.id} asset={asset} s={s} shotId={shotId} run={run} seconds={reviewSeconds} label={"Play Video · Take "+take.version}/>}
   <div className="flex flex-wrap gap-2"><Button disabled={!s.saved||!take||!reviewFor(s,asset,reviewSeconds)||settings.approvedTakeId===take.id} onClick={()=>run(()=>s.commit({type:"take.approve",shotId,takeId:take!.id}))}>{settings.approvedTakeId===take?.id?"Take Approved ✓":"Use This Take"}</Button><Button disabled={!s.saved} onClick={editPrompt}>{context?'Reprompt':'Change with AI'}</Button>{takes.length>1&&<Button aria-expanded={compare} onClick={()=>setCompare(v=>!v)}>{compare?"Hide Comparison":"Compare Takes"}</Button>}</div>
   {asset&&settings.approvedTakeId===take?.id&&<Button onClick={()=>run(async()=>{if(!p.timeline.clips.some(c=>c.assetId===asset.id))await s.commit({type:'timeline.set',timeline:{...p.timeline,clips:[...p.timeline.clips,{id:newClientRequestId(),assetId:asset.id,shotId,in:Number(asset.metadata.trimIn)||0,out:Number(asset.metadata.trimOut)||reviewSeconds,volume:1,transition:'cut',transitionSeconds:0}]}});window.dispatchEvent(new CustomEvent('production-edit-audio',{detail:{projectId:p.id,assetId:asset.id,shotId}}));})}>Edit Clip Audio</Button>}
   {asset&&<CinematicAudio collapsed={!!context} key={asset.id+"-audio"} s={s} source={asset} shotId={shotId} seconds={reviewSeconds} run={run}/>}
   <Button disabled={!s.saved||busy||!take} onClick={()=>{setCompare(false);generate(retakeKind,{retakeTakeId:take!.id});}}>{context?"Retake":"Retake Same Prompt"}</Button>
   <p className="text-xs text-white/60">Repeat this take&apos;s saved prompt, references and settings, or change the clip with the Director. Earlier takes and their approvals stay saved.</p>
   {compare&&<div className="grid gap-3 sm:grid-cols-2">{takes.filter(t=>t.id!==take?.id).map(t=>{const a=s.assets.find(a=>a.id===t.assetId);return a?<div key={t.id}><p>Take {t.version}</p><ReviewVideo asset={a} s={s} shotId={shotId} run={run} seconds={takeSeconds(a,seconds)} label={"Compare Take "+t.version}/><Button onClick={()=>{selectTake(t.id);setCompare(false);}}>Review This Take</Button></div>:null;})}</div>}
  </div>}
  {!!settings.approvedTakeId&&<div className="space-y-3 border-t border-white/10 pt-3">
   <h4 className="font-semibold">Finish to 1 MP</h4><p className="text-sm">Upscale the approved performance with RTX VSR. Original source, timing and audio stay preserved. This is not a new H3 performance.</p>
   <Button disabled={!s.saved||busy} onClick={()=>generate("finish")}>{final?.metadata.finishingVerified?"Finish Again":"Upscale Approved Take"}</Button>
   <ShotJob s={s} shotId={shotId} kinds={["finish"]} run={run} retry={generate}/>
   {final&&<><p className="text-sm">{final.metadata.finishingVerified?"Verified finish · "+final.metadata.width+" × "+final.metadata.height+" · "+Number(final.metadata.megapixels).toFixed(2)+" MP":"Earlier finished source retained; current finishing validation not yet run."}</p><ReviewVideo key={final.id} asset={final} s={s} shotId={shotId} run={run} seconds={seconds} label="Finished approved video"/><CinematicAudio collapsed={!!context} key={final.id+"-audio"} s={s} source={final} shotId={shotId} seconds={seconds} run={run}/></>}
  </div>}
 </Section>;
}
export function ShotVideoSettings({s,shotId,busy,generate}:{s:S;shotId:string;busy:boolean;generate:(kind:string)=>void}){
 const p=s.project!,{shot,settings}=shotContext(p,shotId),valid=directionApproved(p,shotId)&&p.plan.status==="approved"&&settings.storyboardApproved;
 const patch=(patch:Record<string,unknown>)=>s.change({type:"shot.settings",shotId,patch});
 return <div className="space-y-3">
  {shot.generationApproach==="reference-to-video"&&<label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={settings.useStoryboardFirstFrame??!!settings.firstImageId} disabled={busy} onChange={e=>patch({useStoryboardFirstFrame:e.target.checked})}/>Also anchor the approved image as frame zero. Submission is blocked unless the worker qualifies references plus native first-frame conditioning.</label>}
    <Field label="H3 workflow"><select className={inputClass} disabled={busy} value={settings.model} onChange={e=>patch({model:e.target.value})}><option value="standard">Standard · Native</option><option value="singularity">Singularity v2 · Native</option><option value="singularity-v1.3">Singularity v1.3 · Native</option><option value="fasth3">Fast H3 · no saved RefMod bundles</option></select></Field>
    <Field label="Seed · blank is random"><input className={inputClass} type="number" min={0} max={4294967295} disabled={busy} value={settings.seed??""} onChange={e=>patch({seed:e.target.value===""?null:Number(e.target.value)})}/></Field>
    {shot.generationApproach!=="text-to-video"&&<Field label="Optional last frame"><select className={inputClass} disabled={busy} value={settings.lastImageId||""} onChange={e=>patch({lastImageId:e.target.value})}><option value="">None</option>{s.assets.filter(a=>a.mime.startsWith("image/")&&p.bindings.some(b=>b.assetId===a.id&&b.approved)).map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>}
    {shot.generationApproach==="reference-to-video"&&<fieldset><legend className="text-sm">Approved identity & scene references</legend>{s.assets.filter(a=>["character","image"].includes(a.kind)&&p.bindings.some(b=>b.assetId===a.id&&b.approved)).map(a=><label key={a.id} className="flex gap-2 items-center py-2 text-sm"><input type="checkbox" disabled={busy} checked={settings.referenceIds.includes(a.id)} onChange={e=>patch({referenceIds:e.target.checked?[...settings.referenceIds,a.id]:settings.referenceIds.filter(id=>id!==a.id)})}/>{a.name}</label>)}</fieldset>}
    <Button disabled={!s.saved||busy||!valid} onClick={()=>generate("regenerate")}>Regenerate in High Quality</Button><p className="text-xs text-white/60">Creates another native ~1 MP performance. Motion and appearance may change. This is not upscaling.</p>

 </div>;
}
export function ExistingTake({s,shotId,run}:{s:S;shotId:string;run:(f:()=>Promise<unknown>)=>void}){
 const {shot}=shotContext(s.project!,shotId),take=shot.takes.filter(t=>t.assetId).at(-1),asset=s.assets.find(a=>a.id===take?.assetId);
 if(!take||!asset)return null;
 const submission=asset.metadata.submission as {brief?:{action?:string}}|undefined;
 const job=s.jobs.find(j=>j.id===take.generationJobId),snapshot=job?.input.snapshot as S["project"],original=snapshot?.plan.acts.flatMap(a=>a.scenes.flatMap(c=>c.shots)).find(s=>s.id===shotId);
 return <div className="space-y-2"><h4 className="font-semibold">Existing video · Take {take.version}</h4><ReviewVideo asset={asset} s={s} shotId={shotId} seconds={takeSeconds(asset,plannedSeconds(shot))} label="Existing video for retake" run={run}/><p className="text-sm">Original direction: {submission?.brief?.action||snapshot?.shots[shotId]?.direction?.brief.action||original?.description||"This older take has no structured direction record. Its exact submitted inputs remain available below the player."}</p></div>;
}
function ReviewVideo({asset,s,shotId,seconds,label,run}:{asset:Asset;s:S;shotId:string;seconds:number;label:string;run:(f:()=>Promise<unknown>)=>void}){
 const [failed,setFailed]=useState(false),review=reviewFor(s,asset,seconds),jobs=s.jobs.filter(j=>j.kind==="review"&&j.input.assetId===asset.id).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)),job=jobs[0],busy=!!job&&["running","queued","canceling"].includes(job.status);
 const prepare=()=>run(()=>s.job({kind:"review",shotId,assetId:asset.id}));
 return <div className="space-y-2">
  {review?<>{failed?<p role="alert">Playback unavailable. <Button onClick={()=>setFailed(false)}>Retry Playback</Button></p>:<video aria-label={label} key={review.id} controls playsInline preload="metadata" className="w-full max-h-96 rounded-xl" src={mediaUrl(s.project!.id,review.id)} onError={()=>setFailed(true)}/>}<p className="text-xs text-white/60">{Number(review.metadata.duration).toFixed(2)}s review · video and audio trimmed together · original retained</p></>:<div role="status"><p className="text-sm">{busy?"Preparing the "+seconds+"-second review on CPU…":job?.status==="failed"?job.message:"The full native source is saved. Prepare its planned-duration review before approving."}</p><Button disabled={!s.saved||busy} onClick={prepare}>{job?.status==="failed"?"Retry Review Trim":"Prepare "+seconds+"-Second Review"}</Button>{busy&&<Button onClick={()=>run(async()=>{await s.request(s.url+"/jobs",{method:"PATCH",body:JSON.stringify({jobId:job.id})});await s.refresh();})}>Cancel Review Trim</Button>}</div>}
  <details><summary className="cursor-pointer text-xs py-2">Native source & submitted inputs</summary><p className="text-xs">{Number(asset.metadata.duration||0).toFixed(3)} seconds · unmodified source</p><a className="text-xs underline" href={mediaUrl(s.project!.id,asset.id)+"?download=1"}>Download original source</a><pre className="whitespace-pre-wrap break-words text-xs max-h-80 overflow-auto">{JSON.stringify(asset.metadata.submission||{prompt:asset.metadata.exactSubmittedPrompt||"Earlier take: inspect the original H3 job record.",job:asset.metadata.h3JobId},null,2)}</pre></details>
 </div>;
}
