import { NextResponse } from "next/server";
import { nsfwRoute } from "@/lib/experiments/nsfwHttp";
import { boundedJson } from "@/lib/experiments/http";
import { assertNsfwSession } from "@/lib/experiments/apiHandlers";
import { validId } from "@/lib/experiments/store";
import { labFinalPrompt } from "@/lib/experiments/creative";
import { ensureQwenDurableJob, getQwenDurableJob } from "@/lib/workers/qwenDurableJobs";
import { kickQwenDurableScheduler } from "@/lib/workers/qwenDurableScheduler";
import { RequestError } from "@/lib/requestError";
import { QWEN_CLUSTER_MODEL } from "@/lib/workers/qwenClusterRouter";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export const POST=nsfwRoute(async(request,owner)=>{
  const data=await boundedJson(request);validId(data.requestId);validId(data.sessionId);
  const session=assertNsfwSession(owner,data.sessionId);
  if(!session.settings.prompt.trim())throw new RequestError("Write your scene first.",400);
  const instruction=["Write one concise MiniMax H3 scene prompt. Return only the prompt, not analysis. Preserve character identities, reference tags, dialogue and the user's intent. Do not invent unseen reference details or change duration, models or settings.",`Duration: exactly ${session.settings.seconds} seconds. Mode: ${session.settings.mode}. Orientation: ${session.settings.orientation}.`,labFinalPrompt(session.settings),"Selected references:",...session.assets.filter(a=>session.settings.selectedSources?.includes(a.id)).map((a,i)=>`${i+1}: ${a.mime.split('/')[0]} ${a.name}`)].join("\n");
  const model=process.env.PRODUCTION_V2_OLLAMA_MODEL||"qwen3.5:4b";
  const job=ensureQwenDurableJob({id:data.requestId,ownerKey:owner,requestKind:"h3-nsfw-prompt",path:"/api/chat",payload:{messages:[{role:"user",content:instruction}],think:false,stream:false,options:{temperature:.35,num_predict:650}},requiredContextTokens:8192,allowedNodes:["slr","shawn"],model,modelByNode:{slr:model,shawn:process.env.PRODUCTION_V2_OLLAMA_FALLBACK_MODEL||QWEN_CLUSTER_MODEL},keepAlive:0,leaseTtlSeconds:150,executionTimeoutMs:120000});
  kickQwenDurableScheduler();return NextResponse.json({id:job.id,status:job.status},{status:202});
});
export const GET=nsfwRoute(async(request,owner)=>{
  const id=request.nextUrl.searchParams.get("id")||"";validId(id);const job=getQwenDurableJob(id);
  if(!job||job.ownerKey!==owner||job.requestKind!=="h3-nsfw-prompt")throw new RequestError("Prompt suggestion not found.",404);
  kickQwenDurableScheduler();let prompt="";
  if(job.status==="completed"){try{const response=JSON.parse(job.responseBody||"{}");prompt=String(response.message?.content||response.response||"").trim().slice(0,8000);}catch{throw new RequestError("Prompt result could not be read.",502);}}
  return NextResponse.json({id,status:job.status,prompt,error:job.status==="failed"?"Prompt Builder could not complete. Your draft is unchanged.":null});
});
