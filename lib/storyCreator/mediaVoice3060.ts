import fs from "node:fs/promises";
import path from "node:path";
import { randomInt } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { check3060Gate, LOCAL_COMFY, localJson } from "@/lib/workers/local3060";
import { enqueueComfyMedia } from "@/lib/workers/mediaGpuQueue";
import { resolveFfmpegPath, resolveFfprobePath } from "@/lib/ffmpeg";
import { story3060SpeechEnabled } from "./audioProduction";
import { getStoryMedia, updateStoryMedia, type StoryMediaRecord } from "./mediaStore";
import { storyMediaRoot } from "./mediaExecution";
import { retrieveRemoteComfyMedia } from "./remoteComfyMedia";

const exec = promisify(execFile);
export const story3060VoiceProfile = "qwen3-tts-3060" as const;
const folder="story-3060-voice";
const inputFolder="story-3060-audio";

export async function submitStory3060Voice(record:StoryMediaRecord, source:{voice?:string;refText?:string}) {
  if(!story3060SpeechEnabled()||record.command.operation!=="voice")throw Error("Qwen3 speech is unavailable on the RTX 3060.");
  await check3060Gate();
  let reference="";
  if(source.voice){
    const root=storyMediaRoot(record),normalized=path.join(root,"reference.wav");
    await fs.mkdir(root,{recursive:true,mode:0o700});
    await exec(resolveFfmpegPath(),["-nostdin","-v","error","-i",source.voice,"-map","0:a:0","-t","30","-ar","24000","-ac","1","-c:a","pcm_s16le",normalized],{timeout:15000,maxBuffer:8192});
    const form=new FormData(),name=record.id+".wav";
    form.set("image",new Blob([new Uint8Array(await fs.readFile(normalized))],{type:"audio/wav"}),name);
    form.set("subfolder",inputFolder);form.set("type","input");form.set("overwrite","true");
    const upload=await localJson(LOCAL_COMFY+"/upload/image",{method:"POST",body:form});
    if(upload.name!==name||upload.subfolder!==inputFolder||upload.type!=="input")throw Error("The speech worker did not accept the bound voice reference.");
    reference=inputFolder+"/"+name;
  }
  const instruction=[record.command.language==="English"?"Speak in English.":"",record.command.prompt].filter(Boolean).join(" ");
  if(!reference&&instruction.length>1200)throw Error("Shorten the voice direction to 1,200 characters.");
  const prompt={
    "1":{class_type:"SLRQwen3Voice3060",inputs:{text:record.command.text,
      instruction:reference?"":instruction,
      reference,reference_text:source.refText||"",seed:randomInt(0,2**31)}},
    "111":{class_type:"SaveAudio",inputs:{audio:["1",0],filename_prefix:folder+"/"+record.id}},
  };
  await enqueueComfyMedia({baseUrl:LOCAL_COMFY,workerId:folder,body:{prompt,client_id:folder+"-"+record.id},
    producer:{kind:folder,id:record.id,ownerKey:record.ownerKey,projectId:record.projectId}},id=>{
    const current=getStoryMedia(record.ownerKey,record.projectId,record.id);
    if(current.status!=="submitting")throw Error("The original speech request changed before dispatch.");
    updateStoryMedia(current,{status:"running",stage:"Waiting for RTX 3060",backendJob:{promptId:id,gpu:"rtx3060",engine:story3060VoiceProfile}});
  });
}

export async function readStory3060Voice(record:StoryMediaRecord,root:string,receipt:any) {
  const files=receipt?.outputs?.["111"]?.audio;
  const file=Array.isArray(files)&&files.length===1?files[0]:null;
  if(file?.type!=="output"||file.subfolder!==folder||!String(file.filename).startsWith(record.id+"_")||path.extname(file.filename)!==".flac")
    return {error:"The original speech job returned no owned audio output."};
  const dest=path.join(root,"result.wav");
  const output=await retrieveRemoteComfyMedia({baseUrl:LOCAL_COMFY,trustedBaseUrls:[LOCAL_COMFY],file,storageRoot:root,
    destinationPath:path.join(root,"speech.flac"),kind:"audio",maxBytes:40*1024**2});
  try {
    await exec(resolveFfmpegPath(),["-nostdin","-v","error","-y","-i",output.filePath,"-map","0:a:0","-c:a","pcm_s16le",dest],{timeout:15000,maxBuffer:8192});
    const {stdout}=await exec(resolveFfprobePath(),["-v","error","-select_streams","a:0","-show_entries",
      "stream=sample_rate,channels:format=duration","-of","json",dest],{timeout:6000,maxBuffer:8192});
    const data=JSON.parse(stdout), stream=data.streams?.[0], duration=Number(data.format?.duration);
    if(Number(stream?.sample_rate)!==24000||stream?.channels!==1||!Number.isFinite(duration)||duration<.2||duration>120)
      return {error:"The speech output did not match the qualified audio format."};
    return {filePath:dest,duration};
  } catch {
    return {error:"The speech output could not be decoded as playable audio."};
  }
}
