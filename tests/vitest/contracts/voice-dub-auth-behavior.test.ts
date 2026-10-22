import {afterAll,beforeAll,describe,it,expect,vi} from "vitest";
import {NextRequest} from "next/server";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const state=vi.hoisted(()=>({authenticated:false}));
vi.mock("@/lib/sessionUser",()=>({requireSessionUser:async()=>{if(!state.authenticated)throw Error("Missing session");return {ownerKey:"qa-dub-owner"};}}));
vi.mock("@/app/api/file/route",()=>({GET:async()=>Response.json({error:"Not found"},{status:404})}));
let root="";
beforeAll(()=>{root=fs.mkdtempSync(path.join(os.tmpdir(),"qa-dub-guard-"));vi.stubEnv("OTG_VOICES_ROOT",root);fs.writeFileSync(path.join(root,"reference.wav"),"RIFF");});
afterAll(()=>{vi.unstubAllEnvs();fs.rmSync(root,{recursive:true,force:true});});
describe("Voice dubbing authentication and input ownership",()=>{
 it("denies unauthenticated requests before form parsing or GPU work",async()=>{
   const {POST}=await import("@/app/api/voice/dub/route");
   const response=await POST(new NextRequest("http://localhost/api/voice/dub",{method:"POST"}));
   expect(response.status).toBe(401);
 });
 it("rejects an unowned audio reference before invoking FFmpeg or a model",async()=>{
   state.authenticated=true;
   const form=new FormData();form.set("performance_audio",new File(["QA"],"performance.wav"));form.set("voice_path",path.join(root,"reference.wav"));form.set("engine","seed-vc");
   const {POST}=await import("@/app/api/voice/dub/route");
   const response=await POST(new NextRequest("http://localhost/api/voice/dub",{method:"POST",body:form}));
   expect(response.status).toBe(404);expect(await response.text()).not.toContain(root);
 });
});
