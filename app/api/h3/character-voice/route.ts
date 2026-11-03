import {NextResponse} from "next/server";
import {withOwner, RequestError} from "@/lib/routeSecurity";
import {getH3RefModsJob} from "@/lib/h3SpecialModes/refModsJobs";
import {getH3DirectJob} from "@/lib/h3DirectJobs";
import {readH3RefModSidecar} from "@/lib/h3SpecialModes/refModCreation";
import {assertCharacterRefVoiceEnabled, assertCharacterRefVoiceIntact} from "@/lib/h3SpecialModes/characterRefVoice";
import {productionAudioMediaReadable} from "@/lib/productionAudioAccess";

export const runtime="nodejs";
export const dynamic="force-dynamic";
/** Read-only handoff: no speech analysis or GPU inference until the user asks. */
export const GET=withOwner(async(req,owner)=>{
  assertCharacterRefVoiceEnabled();
  const id=req.nextUrl.searchParams.get("jobId")||"";
  if(!/^h3-(?:refmods-|direct-)[a-f0-9-]{36}$/.test(id))throw new RequestError("No character voice handoff for this workflow.",404);
  const job=id.startsWith("h3-refmods-")?await getH3RefModsJob(owner.ownerKey,id):await getH3DirectJob(owner.ownerKey,id);
  if(!job||job.ownerKey!==owner.ownerKey||job.status!=="completed"||!job.outputPath)throw new RequestError("Completed H3 video not found for this account.",404);
  const slots=job.input.smartReferences?.refMods||("refMods" in job.input?job.input.refMods:[])||[];
  const models:Array<{id:string;name:string;engine:"seed-vc";path:string;samplePath:string;displayPath:string;usable:boolean}>=[];
  for(const slot of slots){
    if(slot.strength<=0||slot.components==="Visual"||slot.audioStrength<=0)continue;
    const saved=readH3RefModSidecar(slot.name);
    if(saved?.ownerKey!==owner.ownerKey||!saved.voice)continue;
    await assertCharacterRefVoiceIntact(saved.voice);
    if(!models.some(m=>m.id==="refmod:"+saved.voice!.id))models.push({id:"refmod:"+saved.voice.id,name:saved.name+" · saved RefMod voice",engine:"seed-vc",path:saved.voice.path,samplePath:saved.voice.path,displayPath:"Saved character recording",usable:true});
  }
  if(models.length&&!await productionAudioMediaReadable(req,job.outputPath))throw new RequestError("The saved video is unavailable for voice correction.",403);
  return NextResponse.json({ok:true,models,source:models.length?{path:job.outputPath,name:"character-voice-"+id+".mp4",url:"/api/file?path="+encodeURIComponent(job.outputPath)}:null},{headers:{"Cache-Control":"private, no-store"}});
});
