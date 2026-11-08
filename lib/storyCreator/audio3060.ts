import fs from "node:fs/promises";
import path from "node:path";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {randomInt,randomUUID} from "node:crypto";
import {OTG_DATA_ROOT,safeSegment} from "@/lib/paths";
import {check3060Gate,LOCAL_COMFY,localJson} from "@/lib/workers/local3060";
import {cancelQueuedMediaJob,enqueueComfyMedia,getMediaQueueJob} from "@/lib/workers/mediaGpuQueue";
import {loadVoicesLibrary,resolveVoicesFile,upsertVoice,voicesSamplesDir} from "@/lib/voicesStudio";
import {retrieveRemoteComfyMedia} from "./remoteComfyMedia";
import {
  getStoryAudioAsset,isStory3060Audio,listStoryVoiceAssignments,recordStoryAudioResult,
  story3060MusicEnabled,story3060MusicProvider,story3060SpeechEnabled,story3060SpeechProvider,
} from "./audioProduction";
import type {StoryAudioAsset} from "./audioProductionTypes";
import aceTemplate from "./aceStep3060.json";

type Context={ownerKey:string;projectId:string;assetId:string};
const exec=promisify(execFile);
const workerId="story-3060-audio";
const audioRoot=(c:Context)=>path.join(OTG_DATA_ROOT,"story-creator","generated-audio",safeSegment(c.ownerKey),safeSegment(c.projectId),safeSegment(c.assetId));

async function authorizedVoice(context:Context,asset:StoryAudioAsset) {
  if(!asset.voiceAssignmentId)return {reference:"",referenceText:""};
  const assignment=listStoryVoiceAssignments(context).find(voice=>voice.id===asset.voiceAssignmentId);
  if(!assignment?.authorizedReference)throw Error("The saved voice reference is no longer authorized.");
  const voice=loadVoicesLibrary(context.ownerKey).voices.find(voice=>voice.voiceId===assignment.voiceId);
  if(!voice)throw Error("The saved voice no longer belongs to this account.");
  const root=audioRoot(context), normalized=path.join(root,"reference.wav");
  await fs.mkdir(root,{recursive:true,mode:0o700});
  await exec("/usr/bin/ffmpeg",["-nostdin","-v","error","-y","-i",resolveVoicesFile(voice.refAudioRel),
    "-map","0:a:0","-t","30","-ar","24000","-ac","1","-c:a","pcm_s16le",normalized],{timeout:15_000,maxBuffer:8192});
  const name=asset.id+".wav";
  const form=new FormData();
  form.set("image",new Blob([new Uint8Array(await fs.readFile(normalized))],{type:"audio/wav"}),name);
  form.set("subfolder","story-3060-audio");form.set("type","input");form.set("overwrite","true");
  const upload=await localJson(LOCAL_COMFY+"/upload/image",{method:"POST",body:form});
  if(upload.name!==name||upload.subfolder!=="story-3060-audio"||upload.type!=="input")throw Error("8190 did not confirm the bound voice reference.");
  return {reference:upload.subfolder+"/"+name,referenceText:String(voice.refText||"").trim().slice(0,1200)};
}

export async function enqueueStory3060Audio(context:Context,asset:StoryAudioAsset) {
  const speech=asset.providerContract.provider===story3060SpeechProvider;
  if(speech?!story3060SpeechEnabled():asset.providerContract.provider!==story3060MusicProvider||!story3060MusicEnabled())
    throw Error("This RTX 3060 audio provider is unavailable. No alternate provider was started.");
  await check3060Gate();
  const prefix="story-3060-audio/"+asset.id;
  const seed=randomInt(0,2147483648);
  let prompt:Record<string,unknown>;
  if(speech){
    const {reference,referenceText}=await authorizedVoice(context,asset);
    prompt={"1":{class_type:"SLRQwen3Voice3060",inputs:{text:asset.exactText,
      instruction:asset.delivery||asset.emotion||"Natural clear delivery.",reference,reference_text:referenceText,seed}},
    "111":{class_type:"SaveAudio",inputs:{audio:["1",0],filename_prefix:prefix}}};
  }else{
    const request=asset.providerContract.request;
    const duration=Number(request.durationSeconds);
    if(!Number.isFinite(duration)||duration<10||duration>30)throw Error("This RTX 3060 workflow supports 10–30 seconds.");
    const graph=structuredClone(aceTemplate);
    Object.assign(graph["94"].inputs,{tags:asset.prompt,lyrics:request.lyrics||"[Instrumental]",seed,bpm:request.bpm,duration});
    graph["98"].inputs.seconds=duration;graph["3"].inputs.seed=seed;graph["111"].inputs.filename_prefix=prefix;
    prompt=graph;
  }
  await enqueueComfyMedia({baseUrl:LOCAL_COMFY,workerId,body:{prompt,client_id:workerId+"-"+asset.id},
    producer:{kind:workerId,id:asset.id,ownerKey:context.ownerKey,projectId:context.projectId}},id=>{
    const bound=recordStoryAudioResult({...context,status:"running",externalJobId:id});
    if(bound.status!=="running"||bound.externalJobId!==id){
      cancelQueuedMediaJob(id,LOCAL_COMFY);
      throw Error("The audio request was canceled before dispatch.");
    }
  });
  return getStoryAudioAsset(context);
}

export async function publishStory3060Audio(producer:{ownerKey:string;projectId?:string;id:string},promptId:string,history:any){
  const context={ownerKey:producer.ownerKey,projectId:producer.projectId||"",assetId:producer.id};
  const asset=getStoryAudioAsset(context);
  if(!isStory3060Audio(asset.providerContract.provider)||asset.externalJobId!==promptId)throw Error("The output does not match the bound audio job.");
  if(asset.status!=="running")return;
  const files=history?.outputs?.["111"]?.audio;
  const file=Array.isArray(files)&&files.length===1?files[0]:null;
  if(file?.type!=="output"||file.subfolder!=="story-3060-audio"||!String(file.filename).startsWith(asset.id+"_")||path.extname(file.filename)!==".flac"){
    recordStoryAudioResult({...context,status:"failed",error:"The audio worker did not return the bound FLAC artifact."});return;
  }
  const root=audioRoot(context);
  const output=await retrieveRemoteComfyMedia({baseUrl:LOCAL_COMFY,trustedBaseUrls:[LOCAL_COMFY],file,storageRoot:root,
    destinationPath:path.join(root,"result.flac"),kind:"audio",maxBytes:40*1024**2});
  const {stdout}=await exec("/usr/bin/ffprobe",["-v","error","-select_streams","a:0","-show_entries",
    "stream=codec_name,sample_rate,channels:format=duration","-of","json",output.filePath],{timeout:6000,maxBuffer:8192});
  const info=JSON.parse(stdout), stream=info.streams?.[0], duration=Number(info.format?.duration);
  const speech=asset.providerContract.provider===story3060SpeechProvider;
  if(stream?.codec_name!=="flac"||!Number.isFinite(duration)||duration<0.2||
    (speech?Number(stream.sample_rate)!==24000||Number(stream.channels)!==1||duration>120
      :Number(stream.sample_rate)!==48000||Number(stream.channels)!==2||Math.abs(duration-Number(asset.providerContract.request.durationSeconds))>1)){
    recordStoryAudioResult({...context,status:"failed",error:"The audio worker result did not match its qualified format."});return;
  }
  recordStoryAudioResult({...context,status:"completed",outputPath:output.filePath,durationSeconds:duration,externalJobId:promptId});
}

export function refreshStory3060Audio(context:Context,asset:StoryAudioAsset) {
  if(!isStory3060Audio(asset.providerContract.provider)||asset.status!=="running")return;
  const job=asset.externalJobId?getMediaQueueJob(asset.externalJobId):null;
  if(job?.status==="failed")recordStoryAudioResult({...context,status:"failed",error:job.error||"The RTX 3060 audio job failed."});
  if(!job&&Date.now()-asset.updatedAt>120_000)
    recordStoryAudioResult({...context,status:"failed",error:"The audio request was interrupted before GPU dispatch. Prepare another version to retry."});
}

export function cancelStory3060Audio(context:Context){
  const asset=getStoryAudioAsset(context);
  if(!isStory3060Audio(asset.providerContract.provider)||!["queued","running"].includes(asset.status))throw Error("There is no cancellable RTX 3060 audio job.");
  const canceled=recordStoryAudioResult({...context,status:"canceled"});
  if(canceled.status==="canceled"&&asset.externalJobId)cancelQueuedMediaJob(asset.externalJobId,LOCAL_COMFY);
  return canceled;
}

export async function saveStory3060Voice(context:Context) {
  const asset=getStoryAudioAsset(context);
  const expected=path.join(audioRoot(context),"result.flac");
  if(asset.providerContract.provider!==story3060SpeechProvider||asset.voiceAssignmentId||
    !["completed","accepted"].includes(asset.status)||asset.outputPath!==expected)
    throw Error("Choose a completed voice design from this project.");
  const voiceId=`${safeSegment(context.ownerKey)}__story_${asset.id}`;
  const library=loadVoicesLibrary(context.ownerKey);
  const existing=library.voices.find(voice=>voice.voiceId===voiceId);
  if(existing)return existing;
  const dir=voicesSamplesDir(voiceId),temp=path.join(dir,randomUUID()+".wav");
  try {
    await exec("/usr/bin/ffmpeg",["-nostdin","-v","error","-i",expected,"-t","30","-ar","24000","-ac","1","-c:a","pcm_s16le",temp],
      {timeout:15000,maxBuffer:8192});
    await fs.rename(temp,path.join(dir,"ref.wav"));
    return upsertVoice(context.ownerKey,{voiceId,name:asset.speakerName||"Story voice",tags:["story-creator","qwen3"],
      type:"created",refText:asset.exactText,refAudioRel:`samples/${voiceId}/ref.wav`,
      createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
  } finally {await fs.rm(temp,{force:true});}
}
