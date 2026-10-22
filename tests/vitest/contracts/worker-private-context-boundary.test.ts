import {afterEach,describe,it,expect,vi} from "vitest";
import {randomUUID} from "node:crypto";
import {NextRequest} from "next/server";
vi.mock("@/lib/ownerKey",()=>({getOwnerContext:vi.fn(async()=>{throw Error("Worker must not borrow a browser session");})}));
vi.mock("@/lib/jobs/voicePipelineJobs",()=>({claimRemoteVoicePipelineWorkerJob:vi.fn(()=>null)}));
afterEach(()=>vi.unstubAllEnvs());
describe("Credentialed worker claims remain separate from private browser identity",()=>{
 it("allows a valid ephemeral worker credential with an explicit owner",async()=>{
  const token=randomUUID();vi.stubEnv("OTG_WORKER_TOKEN",token);vi.stubEnv("OTG_WORKER_PREVIOUS_TOKEN_FILE","");
  const {POST}=await import("@/app/api/characters/voice-pipeline/worker/claim/route");
  const r=await POST(new NextRequest("http://localhost/api/characters/voice-pipeline/worker/claim",{method:"POST",headers:{authorization:"Bearer "+token,"x-otg-owner-key":"qa_private","content-type":"application/json"},body:JSON.stringify({workerId:"qa-worker",action:"generate_training_dataset"})}));
  expect(r.status).toBe(200);const {claimRemoteVoicePipelineWorkerJob}=await import("@/lib/jobs/voicePipelineJobs");expect(claimRemoteVoicePipelineWorkerJob).toHaveBeenCalledWith("qa_private","qa-worker","generate_training_dataset");
 });
 it("does not authorize a caller merely because it supplies an owner header",async()=>{
  vi.stubEnv("OTG_WORKER_TOKEN",randomUUID());vi.stubEnv("OTG_WORKER_PREVIOUS_TOKEN_FILE","");
  const {POST}=await import("@/app/api/characters/voice-pipeline/worker/claim/route");const r=await POST(new NextRequest("http://localhost/api/characters/voice-pipeline/worker/claim",{method:"POST",headers:{"x-otg-owner-key":"qa_private"}}));expect(r.status).toBe(401);
 });
});
