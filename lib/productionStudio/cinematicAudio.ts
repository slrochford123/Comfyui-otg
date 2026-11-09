import {productionStudioAudioEnabled} from "./availability";
import fs from "node:fs";
import path from "node:path";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import type {StudioStore} from "./store";
import {StudioError} from "./store";
import type {Job,Project} from "./model";
import {assetDirectory,assertAssetIntact,snapshotFile} from "./media";
import {directionBrief,readDirection} from "./shotDirection";
import {readAcoustics} from "./acoustics";
import {audioFinishSettings} from "./audioFinishSettings";
import {createPlannerResponse} from "./plannerResponse";
import {openAIModels} from "@/lib/openai/provider";
const exec=promisify(execFile);
const cfgPath=()=>process.env.OTG_AUDIO_ENGINE_CONFIG||"/home/shawn-rochford/AI/runtime/test/unified-audio/engines.json";
export async function cinematicAudioFinish(s:StudioStore,owner:string,job:Job,canceled:()=>boolean){
 if(!productionStudioAudioEnabled())throw new StudioError("Cinematic Audio is unavailable on this server.",404);
 const project=job.input.snapshot as Project,shotId=String(job.input.shotId),source=await assertAssetIntact(s,owner,project.id,String(job.input.assetId));
 const work=path.join(assetDirectory(s,project.id),job.id+"-audio");fs.mkdirSync(work,{recursive:true,mode:0o700});
 // Never substitute today's direction for a saved performance's direction.
 const submitted=(source.asset.metadata.submission as {brief?:unknown}|undefined)?.brief;
 const brief=readDirection(submitted||project.shots[shotId]?.direction?.approvedBrief||directionBrief(project,shotId));
 let settings=audioFinishSettings(job.input.audioSettings);
 const update=(message:string)=>s.updateJob(owner,job.id,{message});
 if(job.input.adjustment){
  const r=await createPlannerResponse({ownerKey:owner,projectId:project.storyProjectId||undefined,useCase:"story-helper",model:openAIModels().story,maxOutputTokens:900,instructions:"Translate this cinematic audio request into actual bounded DSP settings. Return settings only. Use a sources entry with the exact identity for requests affecting only one speaker; do not change shared roomAmount or gains for a speaker-specific request. sources entries retain unspecified values; roomProfile direction follows room transitions, or choose a supported specific room. pan is -0.35 to 0.35, gainDb -18 to 3, roomAmount 0–0.7. Retain all unspecified current values. No dialogue replacement, regeneration, speed or timing changes. roomAmount is 0–0.7, telephone band edges 150–600 and 2400–5000 Hz, phone gain -18 to 3 dB, dialogue gain -6 to 3 dB, loudness target -24 to -14 LUFS. Source effects require reliable transcript regions. If asked to isolate overlapping speakers, do not pretend this is possible; keep sourceEffects false.",input:JSON.stringify({request:job.input.adjustment,current:settings,acoustics:brief.acoustics}),responseSchema:{name:"cinematic_audio_settings",schema:{
   type:"object",additionalProperties:false,required:Object.keys(settings),properties:{
    ...Object.fromEntries(Object.entries(settings).filter(([k])=>k!=="sources").map(([k,v])=>[k,{type:typeof v==="boolean"?"boolean":"number"}])),
    sources:{type:"array",items:{type:"object",additionalProperties:false,required:["identity","roomAmount","gainDb","pan","roomProfile"],properties:{identity:{type:"string"},roomAmount:{type:"number"},gainDb:{type:"number"},pan:{type:"number"},roomProfile:{type:"string",enum:["direction","small-room","hallway","bathroom","large-room","exterior","dry"]}}}}
   }
  }}},canceled,update,"prompt");
  settings=audioFinishSettings(JSON.parse(r.text));
  if(settings.sources.some(a=>!brief.acoustics!.sources.some(s=>s.identity===a.identity)))throw new StudioError("The audio adjustment referred to an unknown source; current settings are preserved.");
 }
 s.updateJob(owner,job.id,{input:{...job.input,resolvedAudioSettings:settings,acousticDirection:brief.acoustics}});
 const cfg=JSON.parse(fs.readFileSync(cfgPath(),"utf8")),env={...process.env,CUDA_VISIBLE_DEVICES:"",HF_HUB_OFFLINE:"1",OMP_NUM_THREADS:"4",OPENBLAS_NUM_THREADS:"4",OTG_AUDIO_ENGINE_CONFIG:cfgPath()};
 const controller=new AbortController(),monitor=setInterval(()=>{if(canceled())controller.abort();},500);
 let speech:string|undefined;const speakerStems:Record<string,string>={};let stemAssetIds:Record<string,string>={};const warnings:string[]=[];
 try{
  const linked=source.asset.metadata.performanceStems as Record<string,string>|undefined;
  if(settings.sourceEffects&&linked){
   for(const identity of brief.acoustics!.sources.map(a=>a.identity)){
    if(!linked[identity])throw new StudioError("Independent performance stems are incomplete.");
    const entry=await assertAssetIntact(s,owner,project.id,linked[identity]);
    if(entry.asset.kind!=="audio"||entry.asset.metadata.performanceFor!==source.asset.id||entry.asset.metadata.speakerIdentity!==identity)throw new StudioError("The linked stem is not qualified for this performance.");
    speakerStems[identity]=entry.path;stemAssetIds[identity]=entry.asset.id;
   }
  }
  const cached=s.assets(owner,project.id).find(a=>a.metadata.cinematicStemFor===source.asset.id&&a.metadata.sourceSha256===source.asset.sha256&&a.metadata.stem==="speech");
  if(Object.keys(speakerStems).length){}
  else if(cached){speech=(await assertAssetIntact(s,owner,project.id,cached.id)).path;stemAssetIds={speech:cached.id};}
  else if(settings.sourceEffects&&cfg.verified?.['separate-bandit']?.cpu===true&&fs.existsSync(cfg.bandit?.checkpoint||"")){
   update("Separating speech/background on CPU · native mix preserved");
   const dir=path.join(work,"separation");fs.mkdirSync(dir,{mode:0o700});
   const file=path.join(dir,"request.json");fs.writeFileSync(file,JSON.stringify({id:job.id,operation:"separate",gpu:"cpu",source:source.path,params:{engine:"bandit"}}),{mode:0o600});
   try{
    await exec(cfg.python,[path.join(process.cwd(),"scripts/audio-editing-worker.py"),file],{env,timeout:240000,signal:controller.signal,maxBuffer:1_000_000});
    const result=JSON.parse(fs.readFileSync(path.join(dir,"result.json"),"utf8"));
    warnings.push(...result.warnings);
    for(const [stem,id]of Object.entries(result.stems)){
     const a=result.assets.find((a:{id:string})=>a.id===id),asset=await snapshotFile(s,owner,project.id,a.file,source.asset.name+" · "+stem,"audio",{cinematicStemFor:source.asset.id,sourceSha256:source.asset.sha256,stem,separation:"BandIt v2",license:a.license});
     stemAssetIds[stem]=asset.id;if(stem==="speech")speech=s.asset(owner,project.id,asset.id).path;
    }
   }catch(e){if(canceled())throw e;warnings.push("Separation unavailable; keeping native mix without source effects.");}
  }
  if(canceled())throw Error("Canceled");
  update("Finishing soundtrack on CPU · measuring speech, peaks and synchronization");
  const manifest=path.join(work,"request.json");
  const whisperModel=[process.env.OTG_CINEMATIC_WHISPER_MODEL,cfg.whisper?.model,cfg.tiger?.model?path.join(path.dirname(cfg.tiger.model),"faster-whisper-small"):undefined,cfg.bandit?.checkpoint?path.join(path.dirname(path.dirname(cfg.bandit.checkpoint)),"faster-whisper-small"):undefined,path.join(path.dirname(cfgPath()),"models/faster-whisper-small")].find((p):p is string=>typeof p==="string"&&fs.existsSync(path.join(p,"model.bin")));
  fs.writeFileSync(manifest,JSON.stringify({source:source.path,speech,speakerStems:Object.keys(speakerStems).length?speakerStems:undefined,brief,acoustics:readAcoustics(brief.acoustics,brief),settings,whisperModel,ffmpeg:cfg.ffmpeg||"ffmpeg"}),{mode:0o600});
  try{await exec(cfg.python,[path.join(process.cwd(),"scripts/cinematic-audio/finish.py"),manifest],{env,timeout:240000,signal:controller.signal,maxBuffer:1_000_000});}
  catch(e){if(canceled())throw Error("Canceled");fs.writeFileSync(path.join(work,"error.txt"),String((e as {stderr?:string}).stderr||e),{mode:0o600});throw new StudioError("Audio finish could not verify this source. The original is unchanged; inspect the saved job details.");}
  const report=JSON.parse(fs.readFileSync(path.join(work,"result.json"),"utf8"));report.warnings.push(...warnings);
  if(canceled())throw Error("Canceled");
  const variant=await snapshotFile(s,owner,project.id,path.join(work,"cinematic.mp4"),source.asset.name+" · Cinematic Audio","video",{...source.asset.metadata,cinematicFor:source.asset.id,sourceSha256:source.asset.sha256,cinematicJobId:job.id,cinematicAudio:report,cinematicStemIds:stemAssetIds,visualSourceAssetId:source.asset.id});
  // A clip may already have an upscale. Prepare its matching soundtrack before
  // acceptance, so selecting the source's finish cannot revert to native audio
  // when an assembly prefers the upscale. Both remain unaccepted candidates.
  const current=s.get(owner,project.id),shot=current.plan.acts.flatMap(a=>a.scenes.flatMap(c=>c.shots)).find(sh=>sh.id===shotId),shotSettings=current.shots[shotId];
  const take=shot?.takes.find(t=>t.id===shotSettings.approvedTakeId);
  if(take?.assetId===source.asset.id&&shotSettings.finalAssetId){
   const final=await assertAssetIntact(s,owner,project.id,shotSettings.finalAssetId);
   if(final.asset.metadata.sourceTakeId===take.id){
    const file=path.join(work,"cinematic-final.mp4");await remuxSoundtrack(final.path,s.asset(owner,project.id,variant.id).path,file);
    const companion=await snapshotFile(s,owner,project.id,file,final.asset.name+" · Cinematic Audio","video",{...final.asset.metadata,cinematicFor:final.asset.id,sourceSha256:final.asset.sha256,cinematicAudio:report,inheritedAudioAssetId:variant.id,visualSourceAssetId:final.asset.id});
    variant.metadata.cinematicFinalVariantId=companion.id;variant.metadata.cinematicFinalSourceId=final.asset.id;
    s.db.prepare("UPDATE assets SET json=? WHERE id=? AND owner=? AND project=?").run(JSON.stringify(variant),variant.id,owner,project.id);
   }
  }
  return variant;
 }finally{clearInterval(monitor);}
}

/** Copy an approved soundtrack onto an upscale; no timing or frame changes. */
export async function remuxSoundtrack(video:string,audio:string,dest:string){
 await exec("ffmpeg",["-v","error","-nostdin","-n","-i",video,"-i",audio,"-map","0:v:0","-map","1:a:0","-c","copy","-movflags","+faststart",dest],{timeout:120000});
}
