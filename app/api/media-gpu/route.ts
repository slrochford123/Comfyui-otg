import { NextRequest, NextResponse } from "next/server";
import { requireSessionUser } from "@/lib/sessionUser";
import { MEDIA_GPUS, mediaGpuLabel } from "@/lib/mediaGpuRouting";
import { mediaQueueEnabled, queuedMediaJobs, probeMediaGpu, getMediaQueueJob, type AudioMediaPayload } from "@/lib/workers/mediaGpuQueue";
import { readPromptRequestMeta } from "@/lib/promptRequestMeta";
import { cancelComfyPrompt } from "@/lib/comfySafeCancel";
import { cancelJob } from "@/lib/audioEditing/jobs";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const json=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{"Cache-Control":"private, no-store"}});
function owns(owner:string,job:NonNullable<ReturnType<typeof getMediaQueueJob>>) {
  return job.kind==="audio" ? (job.payload as AudioMediaPayload).owner===owner : readPromptRequestMeta(owner,job.id)?.ownerKey===owner;
}
export async function GET(request:NextRequest) {
  try {
    const user=await requireSessionUser(request);
    if(!mediaQueueEnabled())return json({enabled:false});
    const jobs=queuedMediaJobs();
    const devices=await Promise.all(MEDIA_GPUS.map(async gpu=>({gpu,label:mediaGpuLabel(gpu),...await probeMediaGpu(gpu),
      queued:jobs.filter(job=>job.gpu===gpu&&job.status==="queued").length})));
    return json({enabled:true,devices,jobs:jobs.filter(job=>owns(user.ownerKey,job)).map(job=>({id:job.id,gpu:job.gpu,kind:job.kind,status:job.status,error:job.error}))});
  }catch{return json({enabled:false,error:"Sign in to view your GPU queue."},401);}
}
export async function POST(request:NextRequest) {
  try {
    const user=await requireSessionUser(request);
    if(!mediaQueueEnabled())return json({error:"Media routing is not enabled on this TEST release."},404);
    const body=await request.json();
    if(body.action!=="cancel"||typeof body.id!=="string")return json({error:"Choose a queued media job to cancel."},400);
    const job=getMediaQueueJob(body.id);
    if(!job||!owns(user.ownerKey,job))return json({error:"Job not found."},404);
    const result=job.kind==="audio"?cancelJob(user.ownerKey,(job.payload as AudioMediaPayload).sessionId,job.id)
      :await cancelComfyPrompt((job.payload as {baseUrl:string}).baseUrl,job.id);
    return json({ok:true,result});
  }catch{return json({error:"Cancellation is not confirmed. Refresh the original job; no unrelated work was interrupted."},409);}
}
