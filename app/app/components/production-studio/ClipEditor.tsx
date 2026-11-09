"use client";
import {useState} from "react";
import {clipEditTimeline} from "@/lib/productionStudio/workflow";
import type {Operation} from "@/lib/productionStudio/model";
import type {useStudio} from "./useStudio";
import ClipNavigation,{activeClip} from "./ClipNavigation";
import {Button,Field,inputClass,mediaUrl} from "./Controls";
import AudioMixer from "./AudioMixer";
import WorkflowAssistant from "./WorkflowAssistant";
import Dictation from "./Dictation";
import {useTalkback} from "./Talkback";
import StageJobs from "./StageJobs";
type S=ReturnType<typeof useStudio>;
export default function ClipEditor({s,run,onFinish}:{s:S;run:(f:()=>Promise<unknown>)=>void;onFinish:()=>void}){
 const p=s.project!,{clips,clip}=activeClip(s),[mode,setMode]=useState<'audio'|'effects'|'video'|null>(null),[original,setOriginal]=useState(false),narrator=useTalkback();
 if(!clip)return <p>Approve a video clip in Action before editing.</p>;
 let timeline;try{timeline=clipEditTimeline(p,clip.id);}catch{return <div className="space-y-3"><ClipNavigation s={s} workspace="Edit" run={run}/><p>Clip {clips.indexOf(clip)+1} needs an approved take in Action. Existing movie edits remain saved.</p></div>;}
 const edit=p.clipEdits?.[clip.id],source=timeline.clips[0],originalSource=clip.takes.find(t=>t.id===p.shots[clip.id]?.approvedTakeId)?.assetId,request=(op:Operation)=>op.type.startsWith('timeline.')?{...op,type:op.type==='timeline.set'?'clip.edit.timeline':op.type.replace('timeline.','clip.edit.'),shotId:clip.id}:op;
 const scoped:S={...s,project:{...p,timeline,history:edit?.history||[],future:edit?.future||[]},scopeKey:s.scopeKey+':clip-edit:'+clip.id,change:op=>s.change(request(op)),commit:op=>s.commit(request(op)),job:payload=>s.job({...payload,...(['audio-preview','export'].includes(String(payload.kind))?{editClipId:clip.id}:{}),shotId:clip.id})};
 const open=(m:typeof mode)=>run(async()=>{if(!edit)await s.commit({type:'clip.edit.open',shotId:clip.id});setMode(m);});
 const prompt=edit?.videoPrompt||'',busy=s.jobs.some(j=>j.kind==='video-edit'&&j.input.shotId===clip.id&&['queued','running','canceling','attention'].includes(j.status));
 const rendered=s.jobs.find(j=>j.kind==='export'&&j.input.editClipId===clip.id&&j.status==='completed'&&j.outputAssetId&&JSON.stringify((j.input.snapshot as typeof p)?.timeline)===JSON.stringify(timeline));
 const originalAsset=s.assets.find(a=>a.id===originalSource),previewId=original&&originalSource?originalSource:rendered?.outputAssetId||source.assetId,previewStart=original?Number(originalAsset?.metadata.trimIn)||0:rendered?0:source.in,previewEnd=previewStart+(source.out-source.in);
 return <div className="space-y-4" aria-label="Edit workspace"><ClipNavigation s={s} workspace="Edit" run={run}/><h3 className="font-semibold text-lg">Clip {clips.indexOf(clip)+1} — Edit</h3>
  <video aria-label="Approved clip editing preview" key={previewId+String(original)+previewStart+previewEnd} controls playsInline preload="metadata" className="w-full max-h-96 rounded-xl" src={mediaUrl(p.id,previewId)+`#t=${previewStart},${previewEnd}`} onLoadedMetadata={e=>{e.currentTarget.currentTime=previewStart;}} onTimeUpdate={e=>{const v=e.currentTarget;if(v.currentTime>=previewEnd){v.pause();v.currentTime=previewStart;}}} onSeeking={e=>{const v=e.currentTarget;if(v.currentTime<previewStart||v.currentTime>previewEnd)v.currentTime=previewStart;}}/>
  <p className="text-xs text-white/60">{(source.out-source.in).toFixed(2)}s approved range · {original?'original sound':rendered?'rendered clip mix':'source sound; render to hear saved mix changes with the video'} · original source preserved</p>
  <Button disabled={!s.saved||s.jobs.some(j=>j.kind==='export'&&j.input.editClipId===clip.id&&['queued','running'].includes(j.status))} onClick={()=>run(()=>s.job({kind:'export',shotId:clip.id,editClipId:clip.id,settings:{aspect:p.brief.aspect,resolution:720,fps:24,format:'mp4',filename:p.name+' clip preview'}}))}>Preview Clip Changes</Button>
  <StageJobs s={s} kinds={['export']} clipId={clip.id} run={run}/>
  {edit?.sourceTakeId&&edit.sourceTakeId!==p.shots[clip.id]?.approvedTakeId&&edit.reviewedAgainstTakeId!==p.shots[clip.id]?.approvedTakeId&&<div role="status" className="rounded-xl border border-amber-300/30 p-3 space-y-2"><p>A different take is now approved. These edits still refer to the earlier source; neither was overwritten.</p><Button disabled={!s.saved} onClick={()=>run(()=>s.commit({type:'clip.edit.rebase',shotId:clip.id}))}>Use Newly Approved Take</Button><Button disabled={!s.saved} onClick={()=>run(()=>s.commit({type:'clip.edit.keepSource',shotId:clip.id}))}>Keep Current Edited Source</Button></div>}
  <div className="grid grid-cols-3 gap-2"><Button aria-pressed={mode==='audio'} onClick={()=>open('audio')}>Audio Mixer</Button><Button aria-pressed={mode==='effects'} onClick={()=>open('effects')}>Sound Effects</Button><Button aria-pressed={mode==='video'} onClick={()=>open('video')}>Edit Video</Button></div>
  {(mode==='audio'||mode==='effects')&&<AudioMixer key={clip.id+mode} s={scoped} run={run} initialTrack={mode==='effects'?'sfx':'dialogue'}/>}
  {mode==='video'&&<div className="rounded-xl border border-white/10 p-3 space-y-3"><p className="text-sm">Describe a visual correction. The existing qualified H3 video-edit service conditions on the source video. This is generative: appearance, motion, lip-sync or details may change. Original frames and soundtrack stay recoverable.</p><p className="text-xs">Qualified native service · 2–10 seconds · ~0.2 MP preview · original audio reused. Availability is checked against the installed model and workflow before submission.</p><Field label="What should change in this video?"><textarea className={inputClass} rows={3} value={prompt} onChange={e=>s.change({type:'clip.edit.prompt',shotId:clip.id,prompt:e.target.value})}/></Field><Dictation url={s.url} scope={s.scopeKey+':video-edit:'+clip.id} onStart={narrator.stop} onAdd={text=>s.change({type:'clip.edit.prompt',shotId:clip.id,prompt:[prompt,text].filter(Boolean).join('\n')})}/><Button disabled={!s.saved||busy||!prompt.trim()||source.out-source.in<2} onClick={()=>{if(confirm('Generate a visual correction from this video? Performance and identity may change. Audio and the original clip stay saved; review before applying.'))run(()=>s.job({kind:'video-edit',shotId:clip.id,message:prompt}));}}>Generate Video Edit</Button>
   <StageJobs s={s} kinds={['video-edit']} clipId={clip.id} run={run}/>
   {s.jobs.filter(j=>j.kind==='video-edit'&&j.input.shotId===clip.id&&j.status==='completed'&&j.outputAssetId).map(j=><Button key={j.id} disabled={!s.saved||source.assetId===j.outputAssetId} onClick={()=>run(()=>s.commit({type:'clip.edit.timeline',shotId:clip.id,timeline:{...timeline,clips:[{...source,assetId:j.outputAssetId!,in:0,out:source.out-source.in,audioMode:'original'}],audio:timeline.audio.map(a=>a.parentClipId===source.id?{...a,muted:true}:a)}}))}>Use Edited Video · {j.createdAt.slice(11,16)}</Button>)}
  </div>}
  <div className="flex flex-wrap gap-2"><Button disabled={!s.saved} onClick={()=>run(s.flush)}>Save Changes</Button><Button disabled={!s.saved||!edit?.history.length} onClick={()=>run(()=>s.commit({type:'clip.edit.undo',shotId:clip.id}))}>Undo</Button><Button disabled={!s.saved||!edit?.future.length} onClick={()=>run(()=>s.commit({type:'clip.edit.redo',shotId:clip.id}))}>Redo</Button><Button aria-pressed={original} onClick={()=>setOriginal(v=>!v)}>{original?'View Edited Clip':'Compare with Original'}</Button><Button onClick={onFinish}>Continue to Finish</Button></div>
  <WorkflowAssistant s={s} workspace="Edit" clipId={clip.id} run={run}/>
 </div>;
}
