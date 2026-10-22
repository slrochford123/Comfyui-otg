import {beforeAll,afterAll,describe,it,expect,vi} from "vitest";
import fs from "node:fs";import os from "node:os";import path from "node:path";
import {NextRequest} from "next/server";
import {hasValidWorkerToken} from "@/lib/jobs/workerAuth";
let root="";
beforeAll(()=>{root=fs.mkdtempSync(path.join(os.tmpdir(),"qa-worker-keyring-"));fs.writeFileSync(path.join(root,"previous"),"qa-previous-worker-credential-only",{mode:0o600});vi.stubEnv("OTG_WORKER_TOKEN","qa-current-worker-credential-only");vi.stubEnv("OTG_WORKER_PREVIOUS_TOKEN_FILE",path.join(root,"previous"));});
afterAll(()=>{vi.unstubAllEnvs();fs.rmSync(root,{recursive:true,force:true});});
const request=(token="")=>new NextRequest("http://localhost/api/worker/jobs/claim",{method:"POST",headers:token?{authorization:`Bearer ${token}`}:{}});
describe("Registered worker key rotation and owner-header denial",()=>{
 it("accepts configured current and previous registered worker credentials",()=>{
  expect(hasValidWorkerToken(request("qa-current-worker-credential-only"))).toBe(true);
  expect(hasValidWorkerToken(request("qa-previous-worker-credential-only"))).toBe(true);
  expect(hasValidWorkerToken(request("unknown"))).toBe(false);
 });
 it.each(["claim","checkpoint","complete","fail"])("denies unauthenticated %s before looking up an owner/job",async action=>{
   const callbacks={claim:()=>import("@/app/api/worker/jobs/claim/route"),checkpoint:()=>import("@/app/api/worker/jobs/checkpoint/route"),complete:()=>import("@/app/api/worker/jobs/complete/route"),fail:()=>import("@/app/api/worker/jobs/fail/route")};
   const route=await callbacks[action as keyof typeof callbacks]();
   const response=await route.POST(new NextRequest(`http://localhost/api/worker/jobs/${action}`,{method:"POST",headers:{"x-otg-owner-key":"another-qa-owner","content-type":"application/json"},body:JSON.stringify({jobType:"character_voice_pipeline",action:"generate_training_dataset",jobId:"imaginary-qa-job"})}));
   expect(response.status).toBe(401);expect(await response.text()).not.toContain("another-qa-owner");
 });
 it("denies unauthenticated artifact uploads before parsing files",async()=>{
  const {POST}=await import("@/app/api/worker/artifacts/upload/route");expect((await POST(request())).status).toBe(401);
 });
});
