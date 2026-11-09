import {productionStudioAudioEnabled} from "./availability";
import fs from "node:fs/promises";
import path from "node:path";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import type {Job, Project, Asset, GainRegion} from "./model";
import {assetDirectory, assertAssetIntact, snapshotFile, probe} from "./media";
import {StudioError, type StudioStore} from "./store";
import {directionBrief} from "./shotDirection";
const exec=promisify(execFile);
export type AudioPreparation={version:1;sourceId:string;sourceSha256:string;nativeId:string;stems:Partial<Record<"speech"|"effects"|"music",string>>;regions:GainRegion[];warnings:string[];sampleRate:number;samples:number;sourceOffset:number;sync:{lagSamples:number|null;reconstructionErrorDb:number|null};engine:string};
export function preparedAudio(assets:Asset[],source:Asset,separate=false){
 return [...assets].reverse().find(a=>{const p=a.metadata.audioPreparation as AudioPreparation|undefined;return p?.sourceId===source.id&&p.sourceSha256===source.sha256&&(!separate||!!p.stems.speech);});
}
export async function prepareClipAudio(s:StudioStore,owner:string,job:Job,canceled:()=>boolean){
 if(!productionStudioAudioEnabled())throw new StudioError("Clip audio editing is unavailable on this server.",404);
 const p=job.input.snapshot as Project,entry=await assertAssetIntact(s,owner,p.id,String(job.input.assetId)),separate=job.input.separate===true;
 const cached=preparedAudio(s.assets(owner,p.id),entry.asset,separate);if(cached){await assertAssetIntact(s,owner,p.id,cached.id);return cached;}
 const work=path.join(assetDirectory(s,p.id),job.id+"-prepare");await fs.mkdir(work,{recursive:true,mode:0o700});
 const cfgFile=process.env.OTG_AUDIO_ENGINE_CONFIG||"/home/shawn-rochford/AI/runtime/test/unified-audio/engines.json",cfg=JSON.parse(await fs.readFile(cfgFile,"utf8"));
 const controller=new AbortController(),monitor=setInterval(()=>{if(canceled())controller.abort();},300);
 const env={...process.env,CUDA_VISIBLE_DEVICES:"",HF_HUB_OFFLINE:"1",TRANSFORMERS_OFFLINE:"1",OMP_NUM_THREADS:"2",OPENBLAS_NUM_THREADS:"2",OTG_AUDIO_ENGINE_CONFIG:cfgFile};
 const run=(command:string,args:string[],timeout=240000)=>exec(command,args,{env,signal:controller.signal,timeout,maxBuffer:2_000_000});
 try{
  const info=await probe(entry.path),a=info.streams.find(v=>v.codec_type==="audio"),v=info.streams.find(v=>v.codec_type==="video");
  if(!a)throw new StudioError("This clip has no readable audio stream. Add saved or uploaded audio instead.");
  const offset=Number(a.start_time||0)-Number(v?.start_time||0);if(Math.abs(offset)>1)throw new StudioError("This source has an unusual audio offset. Keep the original while its synchronization is reviewed.");
  s.updateJob(owner,job.id,{message:"Extracting original soundtrack on CPU · video unchanged",progress:10});
  const raw=path.join(work,"native.wav");
  const videoDuration=Number(v?.duration||a.duration||info.format.duration);
  if(!Number.isFinite(videoDuration)||videoDuration<=0)throw new StudioError("The source duration cannot be verified; original audio retained.");
  // AAC decoder padding is not additional story time. Preserve the source's
  // playable timebase, retaining any native offset separately for placement.
  const audioDuration=videoDuration-(v?offset:0);
  await run(cfg.ffmpeg||"ffmpeg",["-v","error","-nostdin","-y","-threads","2","-i",entry.path,"-map","0:a:0","-vn","-af","apad","-t",String(audioDuration),"-ar","48000","-ac","2","-c:a","pcm_f32le",raw]);
  const rawInfo=await probe(raw),duration=Number(rawInfo.format.duration);
  const original=await snapshotFile(s,owner,p.id,raw,entry.asset.name+" · Original soundtrack","audio",{nativeAudioFor:entry.asset.id,sourceSha256:entry.asset.sha256,sampleRate:48000,sourceOffset:offset,duration});
  const stems:AudioPreparation["stems"]={},stemPaths:Record<string,string>={},warnings=["Original video and native soundtrack remain unchanged. Separation is approximate; audition before accepting.","Effects and ambience share one estimated stem. Overlapping speakers or effects are not independently isolated."];
  if(separate){
   if(cfg.verified?.['separate-bandit']?.cpu!==true)throw new StudioError("The installed CPU cinematic separator is unavailable. Original soundtrack retained.");
   const reuse=s.assets(owner,p.id).filter(a=>a.metadata.cinematicStemFor===entry.asset.id&&a.metadata.sourceSha256===entry.asset.sha256);
   for(const stem of ["speech","effects","music"] as const){const a=reuse.find(a=>a.metadata.stem===stem);if(a){stems[stem]=a.id;stemPaths[stem]=(await assertAssetIntact(s,owner,p.id,a.id)).path;}}
   if(Object.keys(stems).length!==3){
    const dir=path.join(work,"separation");await fs.mkdir(dir,{mode:0o700});const request=path.join(dir,"request.json");
    await fs.writeFile(request,JSON.stringify({id:job.id,operation:"separate",gpu:"cpu",source:raw,params:{engine:"bandit"}}),{mode:0o600});
    s.updateJob(owner,job.id,{message:"Separating speech, effects and music · CPU only",progress:20});
    await run(cfg.python,[path.join(process.cwd(),"scripts/audio-editing-worker.py"),request]);
    const result=JSON.parse(await fs.readFile(path.join(dir,"result.json"),"utf8"));warnings.push(...result.warnings);
    for(const stem of ["speech","effects","music"] as const){const a=result.assets.find((a:{id:string})=>a.id===result.stems[stem]);if(!a)throw new StudioError("Separator returned incomplete stems; original retained.");
     const asset=await snapshotFile(s,owner,p.id,a.file,entry.asset.name+" · "+stem,"audio",{cinematicStemFor:entry.asset.id,sourceSha256:entry.asset.sha256,stem,separation:result.engine,license:a.license,sampleRate:48000,sourceOffset:offset,duration:a.duration});stems[stem]=asset.id;stemPaths[stem]=s.asset(owner,p.id,asset.id).path;
    }
   }
  }
  const submitted=(entry.asset.metadata.submission as {brief?:{dialogue?:unknown[]}}|undefined)?.brief;
  const brief=submitted|| (job.input.shotId?directionBrief(p,String(job.input.shotId)):undefined);
  const request=path.join(work,"analysis.json"),model=cfg.whisper?.model||path.join(path.dirname(path.dirname(cfg.bandit.checkpoint)),"faster-whisper-small");await fs.writeFile(request,JSON.stringify({source:raw,stems:stemPaths,dialogue:brief?.dialogue||[],model}),{mode:0o600});
  s.updateJob(owner,job.id,{message:"Checking sample alignment and measured speaking regions",progress:80});
  await run(cfg.python,[path.join(process.cwd(),"scripts/production-studio/analyze-audio.py"),request]);
  const analysis=JSON.parse(await fs.readFile(path.join(work,"analysis-result.json"),"utf8"));
  const preparation:AudioPreparation={version:1,sourceId:entry.asset.id,sourceSha256:entry.asset.sha256,nativeId:original.id,stems,regions:analysis.regions,warnings:[...warnings,...analysis.warnings],sampleRate:48000,samples:analysis.samples,sourceOffset:offset,sync:analysis.sync,engine:separate?"BandIt v2 English · CPU":"FFmpeg PCM extraction · CPU"};
  if(canceled())throw Error("Canceled");
  // Result is additive; the timeline never changes merely because analysis finishes.
  const result=await snapshotFile(s,owner,p.id,raw,entry.asset.name+" · Audio preparation","audio",{audioPreparation:preparation,peaks:analysis.peaks,duration:analysis.samples/48000});
  for(const [stem,peaks] of Object.entries(analysis.stemPeaks||{})){const id=stems[stem as keyof typeof stems];if(!id)continue;const a=s.asset(owner,p.id,id).asset;a.metadata.peaks=peaks;s.db.prepare("UPDATE assets SET json=? WHERE id=? AND owner=? AND project=?").run(JSON.stringify(a),id,owner,p.id);}
  return result;
 }finally{clearInterval(monitor);}
}
