import { NextRequest, NextResponse } from "next/server";
import { EXPERIMENTS, H3_LICENSE_URL, H3_LICENSE_NOTICE, canvas, labExperiment, isRetiredExperiment } from "@/lib/experiments/catalog";
import { createSession, getSession, listSessions, updateSession } from "@/lib/experiments/store";
import { boundedJson } from "@/lib/experiments/http";
import { RequestError } from "@/lib/requestError";
import { cancelLabJob, exportLabJob, labCapabilities, labLoras, listLabJobs, submitLabJob } from "@/lib/experiments/generation";

export function assertNsfwSession(owner:string,id:string) {const session=getSession(owner,id);if(labExperiment(session.experiment)?.kind!=="h3-admin")throw new RequestError("Session not found.",404);return session;}
function assertNsfwJob(owner:string,id:string) {const receipt=exportLabJob(owner,id);if(labExperiment(receipt.status.model)?.kind!=="h3-admin")throw new RequestError("Job not found.",404);return receipt;}
export async function experimentGet(request:NextRequest, owner:string, restricted=false) {
  const receipt = request.nextUrl.searchParams.get("receipt");
  if (receipt) return NextResponse.json(restricted?assertNsfwJob(owner,receipt):exportLabJob(owner,receipt),{headers:{"Content-Disposition":`attachment; filename="h3-private-receipt.json"`}});
  const jobSession = request.nextUrl.searchParams.get("jobs");
  if (jobSession) { if(restricted)assertNsfwSession(owner,jobSession);const jobs = listLabJobs(owner, jobSession); return NextResponse.json({ok:true,jobs,session:getSession(owner,jobSession)}); }
  const id = request.nextUrl.searchParams.get("export");
  if (id) {
    if(restricted)assertNsfwSession(owner,id);
    const session = getSession(owner, id), experiment = labExperiment(session.experiment)!;
    const draft = canvas(session.settings), scale = ["cinematic-upscale","sol-denomix"].includes(experiment.id) ? 2 : 1;
    const target = experiment.id === "director-studio" ? {format:"json",mediaGeneration:false}
      : {width:draft.width*scale,height:draft.height*scale,...(scale===2?{draft,scale}:{}),fps:session.settings.mode === "edit-image" ? null : 24,deliveredFrames:session.settings.mode === "edit-image" ? 1 : session.settings.seconds * 24,format:session.settings.mode === "edit-image" ? "png" : "mp4"};
    return NextResponse.json({ schemaVersion: 1, runnable: false, environment: process.env.OTG_ENV, exportedAt: new Date().toISOString(), experiment, session,
      target,
      warnings: ["Planning manifest only: not a ComfyUI graph, generation receipt or promotion authorization.", "Native temporal framing and each mode require exact-graph verification. No frame padding or speed changes.", "Uploaded comparison media is owner-supplied, not evidence of an in-app generation."], licenseSource: H3_LICENSE_URL, authorization: H3_LICENSE_NOTICE,
    }, { headers: { "Content-Disposition": `attachment; filename="experiment-${id}.json"` } });
  }
  const catalog=EXPERIMENTS.filter(e=>!restricted||e.kind==="h3-admin");
  const capabilities = labCapabilities().filter(c=>catalog.some(e=>e.id===c.model));
  return NextResponse.json({ ok: true, environment: process.env.OTG_ENV, executionEnabled: capabilities.some(c => c.modes.length), capabilities, loras:labLoras(), catalog, sessions: listSessions(owner).filter(s=>(!restricted||labExperiment(s.experiment)?.kind==="h3-admin")&&(catalog.some(e=>e.id===s.experiment)||isRetiredExperiment(s.experiment))) });
}
export async function experimentPost(request:NextRequest, owner:string, restricted=false) {
  const data = await boundedJson(request);
  if(restricted){
    if(data.action==="create"&&labExperiment(String(data.experiment))?.kind!=="h3-admin")throw new RequestError("Model not available.",403);
    if(["update","generate"].includes(String(data.action)))assertNsfwSession(owner,String(data.id));
    if(data.action==="cancel")assertNsfwJob(owner,String(data.jobId));
    if(data.settings&&typeof data.settings==="object"&&("steps" in data.settings||"checkpoint" in data.settings))throw new RequestError("Custom steps and checkpoints are not qualified for this workspace.",400);
  }
  if (data.action === "create" && typeof data.experiment === "string") return NextResponse.json({ ok: true, session: createSession(owner, data.experiment) }, { status: 201 });
  if (data.action === "update" && typeof data.id === "string") return NextResponse.json({ ok: true, session: updateSession(owner, data.id, data) });
  if (data.action === "generate") return NextResponse.json({ok:true,job:await submitLabJob(owner,data,restricted)},{status:202});
  if (data.action === "cancel") return NextResponse.json({ok:true,...cancelLabJob(owner,data.jobId)});
  if (data.action === "promote") throw new RequestError("Promotion requires separate owner approval. No production operation was attempted.", 409);
  throw new RequestError("Unknown experiment action.", 400);
}
