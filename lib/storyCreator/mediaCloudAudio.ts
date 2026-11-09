import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { resolveFfmpegPath, resolveFfprobePath } from "@/lib/ffmpeg";
import { elevenLabsKey } from "./mediaVoiceProviders";
import { getStoryMedia, updateStoryMedia, type StoryMediaRecord } from "./mediaStore";
const exec = promisify(execFile);
export function cloudAudioRequest(record: StoryMediaRecord) {
  const music=record.command.operation==="music";
  if(!music&&record.command.operation!=="effects")throw Error("Choose music or sound effects.");
  const seconds=record.command.durationSeconds||(music?30:5);
  if(!Number.isFinite(seconds)||seconds<(music?3:.5)||seconds>(music?120:30))
    throw Object.assign(Error(music?"Choose music from 3 to 120 seconds.":"Choose sound effects from 0.5 to 30 seconds."),{name:"RejectedStoryMedia"});
  return {endpoint:music?"music":"sound-generation",seconds,body:music
    ?{prompt:record.command.prompt.slice(0,4100),music_length_ms:Math.round(seconds*1000),force_instrumental:true,model_id:"music_v1"}
    :{text:record.command.prompt.slice(0,4100),duration_seconds:seconds,model_id:"eleven_text_to_sound_v2"}};
}
/** Keep the complete provider response; music may exceed its requested duration. */
export async function finishCloudAudioFile(file:string,operation:string,seconds:number){
  const read=async(p:string)=>{const {stdout}=await exec(resolveFfprobePath(),["-v","error","-show_entries","format=duration:stream=codec_type","-of","json",p],{timeout:10_000,maxBuffer:8192});const info=JSON.parse(stdout);return {audio:info.streams?.some((s:{codec_type:string})=>s.codec_type==="audio"),duration:Number(info.format?.duration)};};
  const native=await read(file);
  if(!native.audio||!Number.isFinite(native.duration)||native.duration<=0||native.duration<seconds-.25||native.duration>seconds+(operation==="music"?Math.max(10,seconds*.25):2))throw Error("The returned audio duration could not be verified.");
  if(operation!=="music"||native.duration<=seconds+.1)return {file,duration:native.duration,nativeDuration:native.duration};
  const trimmed=path.join(path.dirname(file),"eleven-music-trimmed.wav");
  await exec(resolveFfmpegPath(),["-v","error","-nostdin","-n","-i",file,"-map","0:a:0","-t",String(seconds),"-af",`afade=t=out:st=${Math.max(0,seconds-.1)}:d=0.1`,"-c:a","pcm_s16le",trimmed],{timeout:30_000,maxBuffer:8192});
  const final=await read(trimmed);if(!final.audio||Math.abs(final.duration-seconds)>.05)throw Error("The requested music length could not be verified.");
  return {file:trimmed,duration:final.duration,nativeDuration:native.duration};
}
/** The existing durable media claim owns this one paid submission. Ambiguous results never retry. */
export async function renderStoryCloudAudio(record:StoryMediaRecord,root:string):Promise<string|null>{
  const key=elevenLabsKey();if(!key)return null;
  const input=cloudAudioRequest(record);
  record=updateStoryMedia(record,{status:"running",backendJob:{engine:"elevenlabs-audio",pid:process.pid},stage:"Creating audio with ElevenLabs"});
  if(record.status!=="running"||record.cancelRequested)return null;
  try{
    const response=await fetch(`https://api.elevenlabs.io/v1/${input.endpoint}?output_format=mp3_44100_128`,{
      method:"POST",redirect:"error",cache:"no-store",signal:AbortSignal.timeout(300_000),
      headers:{"xi-api-key":key,"Content-Type":"application/json"},body:JSON.stringify(input.body)});
    if([401,402,403,404,429].includes(response.status)){
      await response.body?.cancel();
      const current=getStoryMedia(record.ownerKey,record.projectId,record.id);
      if(current.cancelRequested||current.status!=="running")return null;
      updateStoryMedia(current,{backendJob:null,stage:"ElevenLabs unavailable; preparing local audio fallback"});return null;
    }
    if(response.status===400||response.status===422){await response.body?.cancel();throw Object.assign(Error("ElevenLabs declined these audio parameters."),{name:"RejectedStoryMedia"});}
    if(!response.ok||!response.body)throw Error("ElevenLabs did not confirm an audio result.");
    if(!response.headers.get("content-type")?.startsWith("audio/"))throw Error("ElevenLabs returned an unexpected audio response.");
    const chunks:Uint8Array[]=[];let size=0;const reader=response.body.getReader();
    try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>32*1024**2)throw Error("Audio exceeded the download limit.");chunks.push(value);}}finally{await reader.cancel();}
    fs.mkdirSync(root,{recursive:true,mode:0o700});const file=path.join(root,"eleven-audio.mp3");
    fs.writeFileSync(file,Buffer.concat(chunks),{flag:"wx",mode:0o600});
    const finished=await finishCloudAudioFile(file,record.command.operation,input.seconds);
    const current=getStoryMedia(record.ownerKey,record.projectId,record.id);
    if(current.cancelRequested||current.status!=="running"){updateStoryMedia(current,{status:"canceled"});return null;}
    updateStoryMedia(current,{durationSeconds:finished.duration,backendJob:{...current.backendJob,nativeDurationSeconds:finished.nativeDuration},stage:undefined});return finished.file;
  }catch(error){if(error instanceof Error&&error.name==="RejectedStoryMedia")throw error;
    throw Object.assign(Error("The original ElevenLabs audio request could not be confirmed. No automatic retry or fallback was sent."),{name:"UnconfirmedStoryCloudAudio"});}
}
