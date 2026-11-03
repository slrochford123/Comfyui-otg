import fs from "node:fs/promises";
import {NextResponse} from "next/server";
import {withOwner,RequestError} from "@/lib/routeSecurity";
import {limitedJson} from "@/lib/limitedRequestBody";
import {assertCharacterRefVoiceEnabled} from "@/lib/h3SpecialModes/characterRefVoice";
import {attachCharacterRefVoice,characterRefCardPublic} from "@/lib/h3SpecialModes/characterRefCard";
import {characterVoiceEngines,voiceAuditionState,generateCharacterVoice,resolveVoiceAudition,cancelCharacterVoice} from "@/lib/h3SpecialModes/characterVoiceAudition";
export const runtime="nodejs",dynamic="force-dynamic";
export const GET=withOwner(async(req,owner)=>{
  assertCharacterRefVoiceEnabled();const card=req.nextUrl.searchParams.get("card")||"";
  const state=await voiceAuditionState(owner.ownerKey,card);
  if(req.nextUrl.searchParams.has("audio")){
    const source=await resolveVoiceAudition(owner.ownerKey,card,req.nextUrl.searchParams.get("audio")||"");
    const stat=await fs.lstat(source.path);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>64*1024*1024)throw new RequestError("Audio unavailable.",404);
    return new Response(new Uint8Array(await fs.readFile(source.path)),{headers:{"Content-Type":"audio/wav"}});
  }
  return NextResponse.json({ok:true,engines:characterVoiceEngines(),audition:state});
});
export const POST=withOwner(async(req,owner)=>{
  assertCharacterRefVoiceEnabled();const body=await limitedJson(req,4096),card=String(body.card||"");
  if(body.action==="approve"){
    const source=await resolveVoiceAudition(owner.ownerKey,card,String(body.job||""));
    const saved=await attachCharacterRefVoice(owner.ownerKey,card,body.revision,source);
    return NextResponse.json({ok:true,card:characterRefCardPublic(saved)});
  }
  if(body.action!=="generate"&&body.action!=="cancel")throw new RequestError("Choose a voice action.",400);
  return NextResponse.json({ok:true,audition:body.action==="cancel"?await cancelCharacterVoice(owner.ownerKey,card):await generateCharacterVoice(owner.ownerKey,card,body)});
});
