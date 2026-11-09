import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { authorize,studio,json,failure } from "@/lib/productionStudio/server";
import { StudioError } from "@/lib/productionStudio/store";
import { callStoryCpu } from "@/lib/storyCreator/cpuClient";
import { storySpeechCapabilities } from "@/lib/storyCreator/speech";
export const runtime="nodejs"; export const dynamic="force-dynamic"; export const maxDuration=180;
export async function POST(req:NextRequest,c:{params:Promise<{id:string}>}){
  try{
    const u=await authorize(req,true),{id}=await c.params;studio().get(u.ownerKey,id);
    if(!storySpeechCapabilities().transcription)throw new StudioError("Local dictation is unavailable. Your typed text is kept; no paid transcription was used.",503);
    if(Number(req.headers.get("content-length"))>17*1024*1024)throw new StudioError("Recording is too large. Use a shorter message.",413);
    const form=await req.formData(),audio=form.get("audio"),language=String(form.get("language")||"");
    if(!(audio instanceof File)||!audio.size||audio.size>16*1024*1024)throw new StudioError("Record a message up to 16 MB.");
    if(language&&!/^[a-z]{2,3}$/.test(language))throw new StudioError("Invalid transcription language.");
    const jobId=randomUUID(),cancel=()=>{void callStoryCpu("/cancel",{jobId},3000).catch(()=>{});};
    req.signal.addEventListener("abort",cancel,{once:true});
    try{
      if(req.signal.aborted)throw new StudioError("Transcription canceled.");
      const result=await callStoryCpu<{text:string}>("/transcribe",{jobId,audio:Buffer.from(await audio.arrayBuffer()).toString("base64"),language,vocabulary:String(form.get("vocabulary")||"").slice(0,1200)},170000);
      if(!result.text?.trim())throw new StudioError("No clear speech was detected. Your typed text is unchanged.",422);
      return json({ok:true,text:result.text,transcript:result.text,provider:"local-whisper"});
    }finally{req.signal.removeEventListener("abort",cancel);}
  }catch(e){return failure(e);}
}
