import { after,NextRequest } from "next/server";
import { authorize,body,studio,json,failure } from "@/lib/productionStudio/server";
import { getNarration,prepareNarration,enqueueNarration,cancelNarration,narrationAudio } from "@/lib/productionStudio/narration";
import { storySpeechCapabilities } from "@/lib/storyCreator/speech";
import { mediaFileResponse } from "@/lib/mediaResponse";
import { callStoryCpu } from "@/lib/storyCreator/cpuClient";
import { STORY_VOICES } from "@/lib/storyCreator/speechVoices";
export const runtime="nodejs";export const dynamic="force-dynamic";export const maxDuration=900;
type C={params:Promise<{id:string}>};
const publicJob=(job:ReturnType<typeof getNarration>)=>({key:job.key,status:job.status,error:job.error,duration:job.duration,engine:job.engine,voice:job.voice});
export async function GET(req:NextRequest,c:C){try{const u=await authorize(req),{id}=await c.params,s=studio();s.get(u.ownerKey,id);const key=req.nextUrl.searchParams.get("key");if(!key)return json({capabilities:storySpeechCapabilities()});if(req.nextUrl.searchParams.has("media"))return mediaFileResponse(req,narrationAudio(s,u.ownerKey,id,key),{fileName:"story-narration.wav"});return json({job:publicJob(getNarration(s,u.ownerKey,id,key))});}catch(e){return failure(e);}}
export async function POST(req:NextRequest,c:C){try{const u=await authorize(req,true),{id}=await c.params,b=await body(req),s=studio();s.get(u.ownerKey,id);if(b.action==="cancel")return json({job:publicJob(await cancelNarration(s,u.ownerKey,id,String(b.key)))});const target={shotId:b.shotId?String(b.shotId):undefined,segmentId:b.segmentId?String(b.segmentId):undefined,proposalId:b.proposalId?String(b.proposalId):undefined,messageId:b.messageId?String(b.messageId):undefined,voice:b.voice?String(b.voice):undefined,expectedText:typeof b.expectedText==="string"?b.expectedText:undefined};let result=prepareNarration(s,u.ownerKey,id,target);if(result.job.status==="attention"&&b.retry===true){const health=await callStoryCpu<{busy:boolean}>("/health");if(!health.busy)result=prepareNarration(s,u.ownerKey,id,{...target,retry:true});}if(result.created)after(()=>enqueueNarration(s,u.ownerKey,id,result.job.key));return json({job:publicJob(result.job),voices:STORY_VOICES.paradee},result.created?202:200);}catch(e){return failure(e);}}
