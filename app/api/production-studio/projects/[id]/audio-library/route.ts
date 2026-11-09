import {NextRequest} from "next/server";
import {authorize,studio,json,failure,body} from "@/lib/productionStudio/server";
import {audioLibrary} from "@/lib/audioEditing/library";
import {snapshotFile,probe} from "@/lib/productionStudio/media";
import {StudioError} from "@/lib/productionStudio/store";
import {createSession,readSession,assetFile} from "@/lib/audioEditing/store";
import {sessionJobs,startJob,capabilities,cancelJob,assertAudioTestEnabled} from "@/lib/audioEditing/jobs";
export const runtime="nodejs";
export const dynamic="force-dynamic";
type C={params:Promise<{id:string}>};
export async function GET(req:NextRequest,c:C){try{const u=await authorize(req),{id}=await c.params,p=studio().get(u.ownerKey,id),session=p.audioStudioSessionId;const jobs=session?sessionJobs(u.ownerKey,session):[];return json({items:audioLibrary(u.ownerKey).map(({file:_,...a})=>a),jobs,generated:session?readSession(u.ownerKey,session).assets.map(({file:_,...a})=>a):[],capabilities:capabilities()});}catch(e){return failure(e);}}
export async function POST(req:NextRequest,c:C){try{
 const u=await authorize(req,true),{id}=await c.params,b=await body(req),s=studio(),p=s.get(u.ownerKey,id);
 if(b.action==='cancel'){
  if(!p.audioStudioSessionId)throw new StudioError('No production audio job.');return json({job:cancelJob(u.ownerKey,p.audioStudioSessionId,String(b.jobId))});
 }
 if(b.action==="generate"){
  assertAudioTestEnabled();
  if(b.approved!==true)throw new StudioError("Confirm generation first.");
  if(!["music","effects"].includes(String(b.operation)))throw new StudioError("Choose music or effects.");
  const prompt=String(b.prompt||"").trim();if(!prompt||prompt.length>2000)throw new StudioError("Describe the audio in 1–2000 characters.");
  const seconds=Number(b.seconds),max=b.operation==='music'?capabilities().musicMaxSeconds||120:600;if(!Number.isFinite(seconds)||seconds<.1||seconds>max||b.operation==="music"&&seconds<10)throw new StudioError(`This service supports music from 10 to ${max} seconds, or effects from 0.1 to 600 seconds. Longer soundtracks can be imported or assembled without video regeneration.`);
  let session=p.audioStudioSessionId;
  if(!session){session=createSession(u.ownerKey).id;s.internalUpdate(u.ownerKey,id,p=>{p.audioStudioSessionId=session;});}
  const job=await startJob(u.ownerKey,session,b.operation as "music"|"effects",undefined,{prompt,seconds,seed:42,mode:"manual"},"auto");
  return json({job},202);
 }
 if(b.action==="collect"){
  if(!p.audioStudioSessionId)throw new StudioError("No audio generation session.");
  sessionJobs(u.ownerKey,p.audioStudioSessionId);
  const session=readSession(u.ownerKey,p.audioStudioSessionId),a=session.assets.find(a=>a.id===b.assetId&&a.kind==="audio");if(!a)throw new StudioError("Generated audio is not ready.");
  const cached=s.assets(u.ownerKey,id).find(v=>v.metadata.audioStudioAssetId===a.id);if(cached)return json({asset:cached});
  return json({asset:await snapshotFile(s,u.ownerKey,id,assetFile(u.ownerKey,session,a.id),a.name,"audio",{audioStudioAssetId:a.id,license:a.license,track:a.suggestedLane,origin:a.origin,duration:a.duration})},201);
 }
 const item=audioLibrary(u.ownerKey).find(a=>a.id===b.libraryId);if(!item)throw new StudioError("Saved audio is unavailable.",404);
 const metadata=await probe(item.file);const asset=await snapshotFile(s,u.ownerKey,id,item.file,item.name,"audio",{libraryId:item.id,origin:item.origin,license:item.license,track:item.suggestedLane,duration:Number(metadata.format.duration)});return json({asset},201);
 }catch(e){return failure(e);}}
