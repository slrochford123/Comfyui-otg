import {afterAll,beforeAll,describe,expect,it,vi} from "vitest";
import fs from "node:fs";import os from "node:os";import path from "node:path";
import {submitComfyPromptWithGpuLease} from "@/lib/workers/comfyPromptLease";
import {acquireVoiceGpuFileLease,voiceGpuFileBusy} from "@/lib/workers/voiceGpuFileLease";
import {setResourceLockStorePathForTests} from "@/lib/workers/resourceLocks";
let root="";
beforeAll(()=>{root=fs.mkdtempSync(path.join(os.tmpdir(),"qa-comfy-voice-admission-"));vi.stubEnv("OTG_VOICE_GPU_LOCK_FILE",path.join(root,"qa.lock"));setResourceLockStorePathForTests(path.join(root,"locks.sqlite"));});
afterAll(()=>{setResourceLockStorePathForTests(null);vi.unstubAllEnvs();fs.rmSync(root,{recursive:true,force:true});});
describe("Video admission respects an active Python-style voice lock",()=>{
 it("refuses before any queue cleanup or prompt request and recovers after release",async()=>{
  const release=await acquireVoiceGpuFileLease(),fetcher=vi.fn(async()=>Response.json({prompt_id:"qa-prompt"}));
  const args={baseUrl:"http://100.75.162.64:8189",workerId:"qa-only",ownerId:"qa-job",init:{method:"POST"},fetcher};
  try{expect((await submitComfyPromptWithGpuLease(args)).status).toBe(409);expect(fetcher).not.toHaveBeenCalled();}finally{release();}
  for(let i=0;i<30&&voiceGpuFileBusy();i++)await new Promise(r=>setTimeout(r,10));
  expect((await submitComfyPromptWithGpuLease(args)).status).toBe(200);expect(fetcher).toHaveBeenCalledTimes(1);
 });
});
