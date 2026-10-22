import {beforeEach,describe,it,expect,vi} from "vitest";
import {NextRequest} from "next/server";

const state=vi.hoisted(()=>({authenticated:false,lookups:[] as string[],ticks:[] as string[]}));
vi.mock("@/lib/sessionUser",()=>({requireSessionUser:async()=>{
  if(!state.authenticated)throw Object.assign(new Error("Unauthorized"),{status:401});
  return {ownerKey:"qa-requester"};
}}));
vi.mock("@/lib/jobs/workerAuth",()=>({hasValidWorkerToken:()=>false,requireWorkerToken:()=>({ok:false,status:401,error:"Unauthorized"})}));
vi.mock("@/lib/jobs/voicePipelineJobs",()=>({
  findVoicePipelineJobOwnerKey:()=>"qa-other-owner",
  getQueuedContractJob:(owner:string)=>{state.lookups.push(owner);return owner==="qa-other-owner"?{jobType:"character_voice_pipeline",status:"completed"}:null;},
  finalizeTrainingDatasetJob:vi.fn(),resumeVoicePipelineJob:vi.fn(),stopVoicePipelineJob:vi.fn(),terminateVoicePipelineJob:vi.fn(),ensureApplioTrainingJobForCompletedDataset:vi.fn(),
}));
vi.mock("@/lib/jobs/voicePipelineWorker",()=>({tickVoicePipelineWorker:async(owner:string)=>{state.ticks.push(owner);return {processed:0};}}));
const req=(method:string,body?:object)=>new NextRequest("http://localhost/api/characters/voice-pipeline/qa-other-job",{method,headers:{"content-type":"application/json","x-otg-owner-key":"qa-other-owner"},...(body?{body:JSON.stringify(body)}:{})});
const context={params:Promise.resolve({jobId:"qa-other-job"})};
beforeEach(()=>{state.authenticated=false;state.lookups=[];state.ticks=[];});
describe("Voice pipeline exact-owner security",()=>{
 it.each(["GET","PATCH"])("requires authentication for %s even when the supplied ID exists",async method=>{
  const route=await import("@/app/api/characters/voice-pipeline/[jobId]/route");
  const response=await route[method as "GET"|"PATCH"](req(method,method==="PATCH"?{action:"terminate"}:undefined),context);
  expect(response.status).toBe(401);expect(state.lookups).toEqual([]);
 });
 it.each(["GET","PATCH"])("never resolves %s to another job owner's stored identity",async method=>{
  state.authenticated=true;
  const route=await import("@/app/api/characters/voice-pipeline/[jobId]/route");
  const response=await route[method as "GET"|"PATCH"](req(method,method==="PATCH"?{action:"terminate"}:undefined),context);
  expect(response.status).toBe(404);expect(state.lookups).toEqual(["qa-requester"]);
 });
 it("never ticks a stored foreign owner as a fallback",async()=>{
  state.authenticated=true;const {POST}=await import("@/app/api/characters/voice-pipeline/tick/route");
  expect((await POST(req("POST",{jobId:"qa-other-job"}))).status).toBe(200);
  expect(state.ticks).toEqual(["qa-requester"]);
 });
 it.each(["claim","complete","fail"])("rejects owner headers without worker credentials on specialized %s",async action=>{
  const routes={claim:()=>import("@/app/api/characters/voice-pipeline/worker/claim/route"),complete:()=>import("@/app/api/characters/voice-pipeline/worker/complete/route"),fail:()=>import("@/app/api/characters/voice-pipeline/worker/fail/route")};
  const {POST}=await routes[action as keyof typeof routes]();
  expect((await POST(req("POST",{jobId:"qa-other-job"}))).status).toBe(401);
 });
});
