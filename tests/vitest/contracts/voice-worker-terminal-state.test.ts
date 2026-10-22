import {afterAll,beforeAll,describe,it,expect} from "vitest";
import fs from "node:fs";import os from "node:os";import path from "node:path";
import {setVoicePipelineJobStorePathForTests,failRemoteWorkerJob,getQueuedContractJob} from "@/lib/jobs/voicePipelineJobs";
let root="";let store="";
beforeAll(()=>{root=fs.mkdtempSync(path.join(os.tmpdir(),"qa-voice-terminal-"));store=path.join(root,"jobs.json");setVoicePipelineJobStorePathForTests(store);});
afterAll(()=>{setVoicePipelineJobStorePathForTests(null);fs.rmSync(root,{recursive:true,force:true});});
describe("Worker failures cannot overwrite owner-terminal job states",()=>{
 it.each(["canceled","terminated","completed","ready_for_review"])("preserves %s against a late callback",status=>{
  const now=new Date().toISOString();
  fs.writeFileSync(store,JSON.stringify({version:1,jobs:[{jobId:"qa-job",ownerKey:"qa-owner",jobType:"character_voice_pipeline",action:"generate_training_dataset",status,createdAt:now,updatedAt:now,input:{},message:"Original terminal message"}]}));
  const result=failRemoteWorkerJob("qa-owner","qa-job","Late VRAM timeout");
  expect(result?.status).toBe(status);expect(result?.message).toBe("Original terminal message");
  expect(getQueuedContractJob("qa-owner","qa-job")?.status).toBe(status);
 });
});
