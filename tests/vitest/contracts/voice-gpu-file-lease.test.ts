import {afterAll,beforeAll,describe,expect,it,vi} from "vitest";
import fs from "node:fs";import os from "node:os";import path from "node:path";
import {acquireVoiceGpuFileLease,voiceGpuFileBusy} from "@/lib/workers/voiceGpuFileLease";
let root="";
beforeAll(()=>{root=fs.mkdtempSync(path.join(os.tmpdir(),"qa-voice-flock-"));vi.stubEnv("OTG_VOICE_GPU_LOCK_FILE",path.join(root,"qa.lock"));});
afterAll(()=>{vi.unstubAllEnvs();fs.rmSync(root,{recursive:true,force:true});});
describe("Auxiliary audio interoperates with the real Python flock domain",()=>{
  it("holds the OS lock until its own helper is released and rejects another claimant",async()=>{
    expect(voiceGpuFileBusy()).toBe(false);const release=await acquireVoiceGpuFileLease();
    try{expect(voiceGpuFileBusy()).toBe(true);await expect(acquireVoiceGpuFileLease()).rejects.toThrow("busy");}finally{release();release();}
    for(let i=0;i<30&&voiceGpuFileBusy();i++)await new Promise(r=>setTimeout(r,10));
    expect(voiceGpuFileBusy()).toBe(false);
  });
});
