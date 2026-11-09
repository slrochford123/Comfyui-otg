import path from "node:path";
import {NextRequest} from "next/server";
import {videoTrimSession} from "@/lib/h3VideoTrimSession";
import {registerVideoTrim,encodeVideoSelection} from "@/lib/h3VideoTrim";
import {POST as submitExistingVideoEdit} from "@/app/api/h3/video-edit/simple/route";
import {assertAssetIntact,assetDirectory} from "./media";
import {clipEditTimeline} from "./workflow";
import type {StudioStore} from "./store";
import type {Job,Project} from "./model";
export async function submitClipVideoEdit(s:StudioStore,owner:string,p:Project,job:Job,cookie:string){
  const request=new NextRequest("http://localhost:3001/api/h3/video-edit/simple",{method:"POST",headers:{cookie,origin:"http://localhost:3001","content-type":"application/json"}});
  const session=await videoTrimSession(request);if(session.owner!==owner)throw Error("The edit session does not own this production.");
  const clip=clipEditTimeline(p,String(job.input.shotId)).clips[0],duration=clip.out-clip.in;
  if(duration<2||duration>10)throw Error("The qualified video-edit service supports 2–10 seconds. Original footage is preserved.");
  const source=await assertAssetIntact(s,owner,p.id,clip.assetId),prepared=path.join(assetDirectory(s,p.id),`${job.id}-edit-input.mp4`);
  await encodeVideoSelection(source.path,prepared,clip.in,duration,new AbortController().signal);
  if(["canceled","canceling"].includes(s.jobs(owner,p.id).find(j=>j.id===job.id)?.status||""))throw Error("Canceled before video-edit submission. Original footage is preserved.");
  const upload=await registerVideoTrim(owner,session.session,prepared,"production-clip.mp4");
  const response=await submitExistingVideoEdit(new NextRequest(request.url,{method:"POST",headers:request.headers,body:JSON.stringify({sourceId:upload.id,prompt:job.input.message,quality:"0.2",requestId:job.id,backend:"rtx3090"})}));
  const result=await response.json();
  if(!response.ok||!result.job?.id)throw Error(result.error||"Video edit submission is unconfirmed; inspect the original request before retrying.");
  s.updateJob(owner,job.id,{backendId:result.job.id,message:"Video edit queued with the existing qualified H3 service"});
}
