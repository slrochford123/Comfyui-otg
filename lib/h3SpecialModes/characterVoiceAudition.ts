import fs from "node:fs";
import path from "node:path";
import {randomInt} from "node:crypto";
import {OTG_DATA_ROOT, safeSegment} from "@/lib/paths";
import {RequestError} from "@/lib/requestError";
import {atomicJson, createSession, readSession, assetFile} from "@/lib/audioEditing/store";
import {capabilities, startJob, reconcileJob, cancelJob, sessionJobs} from "@/lib/audioEditing/jobs";
import {mediaQueueEnabled, bootstrapMediaGpuQueue} from "@/lib/workers/mediaGpuQueue";
import {refVoiceRuntime} from "./voiceDesignRuntime";
import {assertCharacterRefVoiceEnabled} from "./characterRefVoice";
import {readCharacterRefCard, withCharacterRefCard, checkCharacterRefRevision} from "./characterRefCard";

type Audition={session:string; job?:string; engine:string; description:string; text:string; seed:number; error?:string};
const location=(owner:string,card:string)=>path.join(OTG_DATA_ROOT,"h3-character-refcards",safeSegment(owner),card,"voice-audition.json");
function read(owner:string,card:string):Audition|null{try{return JSON.parse(fs.readFileSync(location(owner,card),"utf8"));}catch{return null;}}
export function characterVoiceEngines(){
  const audio=capabilities();
  const queue=mediaQueueEnabled();
  const available=audio.enabled&&audio.pythonReady&&queue&&!!audio.engines.speech?.rtx3090;
  return [
    {id:"qwen3",name:"Qwen3-TTS",available:available&&!!refVoiceRuntime("qwen3"),detail:"Create a new voice from your description."},
  ];
}
export async function voiceAuditionState(owner:string,cardId:string){
  assertCharacterRefVoiceEnabled();await readCharacterRefCard(owner,cardId);bootstrapMediaGpuQueue();
  const item=read(owner,cardId);if(!item)return null;
  // Recover a job durably queued just before its pointer was saved. Never resubmit.
  if(!item.job&&!item.error){const jobs=sessionJobs(owner,item.session);if(jobs.length===1){item.job=jobs[0].id;atomicJson(location(owner,cardId),item);}}
  const job=item.job?reconcileJob(owner,item.session,item.job):null;
  const assets=job?.status==="completed"?readSession(owner,item.session).assets.filter(a=>a.kind==="audio"):[];
  const asset=assets.length===1?assets[0]:null;
  return {...item,status:job?.status||"failed",message:item.error||job?.stage||"The request was interrupted before generation. Try again.",progress:job?.progress||0,elapsedSeconds:job?.elapsedSeconds||0,
    audioUrl:asset?`/api/h3/special/refmods/character-card/voice?card=${cardId}&audio=${item.job}`:null};
}
export async function generateCharacterVoice(owner:string,cardId:string,body:Record<string,unknown>){
  assertCharacterRefVoiceEnabled();
  return withCharacterRefCard(owner,cardId,async()=>{
    const card=await readCharacterRefCard(owner,cardId);checkCharacterRefRevision(card,body.revision);
    if(["generating","encoding"].includes(card.state)||card.views.length<4||card.views.some(v=>v.state!=="ready"))throw new RequestError("Finish the reference images before adding a voice.",409);
    const engine=String(body.engine||""),description=String(body.description||"").trim(),text=String(body.text||"").trim();
    if(!description||description.length>1000||!text||text.length>180||text.split(/\s+/).length>30)throw new RequestError("Describe the voice (up to 1000 characters) and enter a short sample line (up to 180 characters / 30 words).",400);
    if(!characterVoiceEngines().some(e=>e.id===engine&&e.available))throw new RequestError("Only Qwen3-TTS is supported for Add Voice and its runtime must be available. No substitute was used.",409);
    const previous=await voiceAuditionState(owner,cardId);
    if(previous&&["running","queued"].includes(previous.status))throw new RequestError("The current voice is still generating. Wait or cancel first.",409);
    const session=createSession(owner);let seed=randomInt(1,2147483647);while(seed===previous?.seed)seed=randomInt(1,2147483647);
    const item:Audition={session:session.id,engine,description,text,seed};
    atomicJson(location(owner,cardId),item);
    try{
      const job=await startJob(owner,session.id,"speech",undefined,{text,description,seed,seconds:8,voiceDesignEngine:"qwen3"},"rtx3090");
      item.job=job.id;atomicJson(location(owner,cardId),item);
    }catch(error){item.error=error instanceof Error?error.message:"Voice generation could not start.";atomicJson(location(owner,cardId),item);throw new RequestError(item.error,409);}
    return voiceAuditionState(owner,cardId);
  });
}
export async function resolveVoiceAudition(owner:string,cardId:string,jobId:string){
  const state=await voiceAuditionState(owner,cardId);
  if(!state||state.job!==jobId||state.status!=="completed"||!state.audioUrl)throw new RequestError("That audition is not ready for this card.",404);
  const session=readSession(owner,state.session),asset=session.assets.find(a=>a.kind==="audio")!;
  return {path:assetFile(owner,session,asset.id),name:`${state.engine==="qwen3"?"Qwen3-TTS":state.engine==="cosy"?"CosyVoice":"AuK"} character voice`,sourceId:"audition:"+jobId};
}
export async function cancelCharacterVoice(owner:string,cardId:string){
  assertCharacterRefVoiceEnabled();await readCharacterRefCard(owner,cardId);
  const item=read(owner,cardId);if(item?.job)await cancelJob(owner,item.session,item.job);
  return voiceAuditionState(owner,cardId);
}
