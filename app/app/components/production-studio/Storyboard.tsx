"use client";
import {useEffect,useState} from "react";
import {workingClips,storyboardCurrent,storyboardProblems} from "@/lib/productionStudio/workflow";
import {directionBrief} from "@/lib/productionStudio/shotDirection";
import {cameraShots} from "@/lib/productionStudio/clipPlan";
import {plannedSeconds} from "@/lib/productionStudio/shotPolicy";
import {DEFAULT_SHOT} from "@/lib/productionStudio/model";
import {shotNarration} from "@/lib/productionStudio/shotPreparation";
import type {useStudio} from "./useStudio";
import {Button,Field,Section,inputClass} from "./Controls";
import ClipNavigation,{activeClip} from "./ClipNavigation";
import ShotStoryboard from "./ShotStoryboard";
import ShotDirection from "./ShotDirection";
import ShotPromptEditor from "./ShotPromptEditor";
import ShotContinuity from "./ShotContinuity";
import AssetPreview from "./AssetPreview";
import CreatePicker from "./CreatePicker";
import {useTalkback} from "./Talkback";
type S=ReturnType<typeof useStudio>;
export default function Storyboard({s,run,onContinue}:{s:S;run:(f:()=>Promise<unknown>)=>void;onContinue:()=>void}){
 const p=s.project!,{clips,clip}=activeClip(s),[overview,setOverview]=useState(false),[prompt,setPrompt]=useState(false),[frame,setFrame]=useState(false),[add,setAdd]=useState(false),[description,setDescription]=useState(''),[duration,setDuration]=useState(5),[saved,setSaved]=useState('');
 if(!clip||!p.plan.storyPreview&&!clips.some(c=>c.description.trim()))return <p>Develop a story in Plan, then prepare its Cast & World assets.</p>;
 const settings=p.shots[clip.id]||DEFAULT_SHOT,brief=directionBrief(p,clip.id),busy=s.jobs.some(j=>j.input.shotId===clip.id&&['queued','running','canceling','attention'].includes(j.status)),i=clips.indexOf(clip),problems=storyboardProblems(p,clip.id);
 const generate=()=>{if(confirm('Generate this clip’s storyboard image with the selected references? Earlier images stay saved.'))run(()=>s.job({kind:'storyboard',shotId:clip.id,confirmReferenceWarnings:true}));};
 return <div className="space-y-4" aria-label="Storyboard workspace">
  <ClipNavigation s={s} workspace="Storyboard" run={run}/><div className="flex flex-wrap justify-between gap-2"><h3 className="font-semibold">Clip {i+1} · {plannedSeconds(clip)} seconds</h3><Button aria-expanded={overview} onClick={()=>setOverview(v=>!v)}>Review Storyboard</Button></div>
  {p.plan.status!=='approved'&&<div className="rounded-xl border border-amber-300/30 p-3 space-y-2"><p>The clip structure changed. Review the new order before approval; existing media are safe.</p><Button disabled={!s.saved} onClick={()=>run(()=>s.commit({type:'shots.approve'}))}>Approve Updated Clip Structure</Button></div>}
  {overview?<StoryboardOverview s={s} run={run} onContinue={onContinue} onEdit={()=>setOverview(false)}/>:<>
   <Section title="1 · Plan"><p className="text-sm whitespace-pre-wrap">{clip.description||brief.action}</p><details><summary className="cursor-pointer py-2">Camera, cast, lighting & continuity</summary><p>{brief.framing} · {brief.camera}</p><p>{brief.location} · {brief.lighting}</p><p>On screen: {brief.onScreen.join(', ')||'No people'}.</p><p>{brief.continuity.join(' ')}</p><ShotContinuity s={s} shotId={clip.id} run={run}/></details></Section>
   <ShotStoryboard key={clip.id} s={s} run={run} shotId={clip.id} generate={generate} busy={busy} editPrompt={()=>setPrompt(v=>!v)}/>
   {prompt&&<ShotPromptEditor s={s} run={run} shotId={clip.id} target="storyboard" setTarget={()=>{}} busy={busy} imageOnly/>}
   <details className="rounded-xl border border-white/10 p-3"><summary className="cursor-pointer">Optional frames for camera cuts · {settings?.storyboardFrames?.length||0}</summary><p className="text-xs py-2">One primary image is enough. These extra visual planning frames do not create separate H3 jobs or silently become first frames.</p>{settings?.storyboardFrames?.map((f,n)=>{const a=s.assets.find(a=>a.id===f.assetId);return <div key={n} className="py-2 space-y-2">{a&&<AssetPreview asset={a} compact/>}<Field label={`Frame ${n+1} time · seconds`}><input className={inputClass} type="number" min={0} max={brief.duration} step={.1} value={f.seconds} onChange={e=>s.change({type:'shot.settings',shotId:clip.id,patch:{storyboardFrames:settings.storyboardFrames!.map((v,i)=>i===n?{...v,seconds:Number(e.target.value)}:v)}})}/></Field><Field label={`Frame ${n+1} description`}><input className={inputClass} value={f.caption} onChange={e=>s.change({type:'shot.settings',shotId:clip.id,patch:{storyboardFrames:settings.storyboardFrames!.map((v,i)=>i===n?{...v,caption:e.target.value}:v)}})}/></Field><Button onClick={()=>s.change({type:'shot.settings',shotId:clip.id,patch:{storyboardFrames:settings.storyboardFrames!.filter((_,i)=>i!==n)}})}>Remove Planning Frame</Button></div>;})}<Button onClick={()=>setFrame(v=>!v)}>Add Planning Frame</Button>{frame&&<CreatePicker s={s} kind="image-reference" onPick={async a=>{await s.commit({type:'shot.settings',shotId:clip.id,patch:{storyboardFrames:[...settings.storyboardFrames||[],{assetId:a.id,seconds:cameraShots(brief)[1]?.startSeconds||0,caption:'Additional camera composition'}]}});setFrame(false);}}/>}</details>
   <ShotDirection key={clip.id+'sequence'} context="Storyboard" s={s} run={run} shotId={clip.id} busy={busy} onApproved={async()=>{await s.commit({type:'storyboard.approve',shotId:clip.id});setSaved('Image and sequence saved as an approved storyboard version.');}} onImage={()=>setPrompt(true)}/>
   <div className="flex flex-wrap gap-2"><Button disabled={!s.saved||busy} onClick={()=>run(async()=>{await s.flush();setSaved('Clip draft saved. Approve its sequence when you are ready; no media was generated.');})}>Save Clip</Button><Button aria-expanded={add} disabled={!s.saved} onClick={()=>setAdd(v=>!v)}>Add Clip</Button></div>
   {saved&&<p role="status" className="text-emerald-200 text-sm">{saved}</p>}{!!problems.length&&<p className="text-sm text-amber-200">To approve this clip: {problems.join(' ')}</p>}
   <details><summary className="cursor-pointer py-2">Clip order & recovery</summary><div className="flex flex-wrap gap-2"><Button disabled={!s.saved||!i} onClick={()=>run(()=>s.commit({type:'shot.move',shotId:clip.id,direction:-1}))}>Move Earlier</Button><Button disabled={!s.saved||i===clips.length-1} onClick={()=>run(()=>s.commit({type:'shot.move',shotId:clip.id,direction:1}))}>Move Later</Button><Button disabled={!s.saved} onClick={()=>{if(confirm('Remove this clip from the plan? Its media and previous versions remain recoverable.'))run(()=>s.commit({type:'shot.remove',shotId:clip.id}));}}>Remove Clip from Sequence</Button></div></details>
   {add&&<Section title="Insert a clip after this one"><Field label="New clip action"><textarea className={inputClass} value={description} onChange={e=>setDescription(e.target.value)}/></Field><Field label="New clip duration · 1–10 seconds"><input className={inputClass} type="number" min={1} max={10} value={duration} onChange={e=>setDuration(Number(e.target.value))}/></Field><Button disabled={!s.saved||!description.trim()} onClick={()=>run(async()=>{await s.commit({type:'clip.insert',shotId:clip.id,description,duration});setAdd(false);setDescription('');})}>Insert Clip</Button></Section>}
  </>}
 </div>;
}
function StoryboardOverview({s,run,onContinue,onEdit}:{s:S;run:(f:()=>Promise<unknown>)=>void;onContinue:()=>void;onEdit:()=>void}){
 const p=s.project!,clips=workingClips(p),narrator=useTalkback(),[playing,setPlaying]=useState(false),[index,setIndex]=useState(0),[spoken,setSpoken]=useState(false),clip=clips[index],total=clips.reduce((n,c)=>n+plannedSeconds(c),0);
 const stop=narrator.stop,clipId=clip?.id,hold=clip?plannedSeconds(clip):0;
 useEffect(()=>{if(!playing||!clipId)return;const timer=setTimeout(()=>{if(index===clips.length-1){setPlaying(false);stop();}else setIndex(i=>i+1);},hold*1000);return()=>clearTimeout(timer);},[playing,clipId,hold,index,clips.length,stop]);
 const playShot=narrator.playShot,narration=clip?shotNarration(p,clip.id):'';
 useEffect(()=>{if(playing&&spoken&&clipId)void playShot(clipId,narration);return()=>stop();},[playing,spoken,clipId,narration,playShot,stop]);
 return <Section title="Complete Storyboard"><p>{clips.length} clips · {total.toFixed(1)} seconds in this working section. Swipe to review.</p>
  <div className="flex gap-3 overflow-x-auto snap-x snap-mandatory pb-3" aria-label="Storyboard cards">{clips.map((c,i)=>{const a=s.assets.find(a=>a.id===p.shots[c.id]?.storyboardId);return <article key={c.id} className="w-64 shrink-0 snap-start rounded-xl border border-white/10 p-3 space-y-2">{a?<AssetPreview asset={a}/>:<p>Image not yet selected</p>}<h4>Clip {i+1} · {plannedSeconds(c)}s</h4><p className="text-sm line-clamp-3">{directionBrief(p,c.id).action}</p><p className="text-xs">{storyboardCurrent(p,c.id)?'Approved':'Needs review'}</p><details><summary>Sequence details</summary>{cameraShots(directionBrief(p,c.id)).map(v=><p key={v.id}>{v.startSeconds}–{v.endSeconds}s · {v.action}</p>)}</details><Button disabled={!s.saved} onClick={()=>run(async()=>{await s.commit({type:'workflow.navigate',workspace:'Storyboard',clipId:c.id});onEdit();})}>Edit Clip {i+1}</Button></article>;})}</div>
  <div className="flex flex-wrap gap-2"><Button onClick={()=>{narrator.stop();setIndex(0);setPlaying(v=>!v);}}>{playing?'Stop Animatic':'Play Timed Animatic'}</Button><label className="flex gap-2 items-center"><input type="checkbox" checked={spoken} onChange={e=>setSpoken(e.target.checked)}/>Narrate clip descriptions</label></div>
  {playing&&clip&&<div aria-live="polite"><p>Clip {index+1} · {plannedSeconds(clip)} seconds</p>{s.assets.find(a=>a.id===p.shots[clip.id]?.storyboardId)&&<AssetPreview asset={s.assets.find(a=>a.id===p.shots[clip.id]?.storyboardId)!}/>}</div>}
  <p className="text-xs">Storyboard playback is a timed visual review, not generated video. Narration uses the CPU and may be shorter or longer than a visual hold.</p>
  <Button disabled={!s.saved||clips.some(c=>storyboardProblems(p,c.id).length>0)} onClick={()=>run(async()=>{await s.commit({type:'storyboard.approve'});narrator.stop();onContinue();})}>Continue to Action</Button>
  {!!p.storyboards?.length&&<p className="text-xs">{p.storyboards.length} approved storyboard versions retained in recovery.</p>}
 </Section>;
}
