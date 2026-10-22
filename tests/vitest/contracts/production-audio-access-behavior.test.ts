import {afterAll,beforeAll,beforeEach,describe,it,expect,vi} from "vitest";
import {NextRequest} from "next/server";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const state=vi.hoisted(()=>({authenticated:false,allowed:false}));
vi.mock("@/lib/sessionUser",()=>({requireSessionUser:async()=>{
  if(!state.authenticated)throw Error("Missing session");
  return {username:"qa_audio_owner",ownerKey:"qa_audio_owner"};
}}));
vi.mock("@/app/api/file/route",()=>({GET:vi.fn(async()=>new Response("QA",{status:state.allowed?206:404}))}));
let root="";
beforeAll(()=>{root=fs.mkdtempSync(path.join(os.tmpdir(),"qa-audio-access-"));vi.stubEnv("OTG_DATA_ROOT",root);vi.stubEnv("OTG_AUDIO_ANALYSIS_DIR",path.join(root,"analysis"));fs.writeFileSync(path.join(root,"foreign-qa.mp4"),"synthetic fixture");});
beforeEach(()=>{state.authenticated=false;state.allowed=false;});
afterAll(()=>{vi.unstubAllEnvs();fs.rmSync(root,{recursive:true,force:true});});
describe("Production audio requires a session and owner-readable input before processing",()=>{
  for(const route of ["analyze-clip","dub-preview"]){
    it(`${route}: rejects unauthenticated input before parsing it`,async()=>{
      const module=route==="analyze-clip"?await import("@/app/api/production/audio/analyze-clip/route"):await import("@/app/api/production/audio/dub-preview/route");
      const r=await module.POST(new NextRequest(`http://localhost/api/production/audio/${route}`,{method:"POST"}));
      expect(r.status).toBe(401);expect(await r.json()).toEqual({ok:false,error:"Unauthorized"});
    });
    it(`${route}: rejects a fictional other owner's file without invoking a model`,async()=>{
      state.authenticated=true;
      const module=route==="analyze-clip"?await import("@/app/api/production/audio/analyze-clip/route"):await import("@/app/api/production/audio/dub-preview/route");
      const r=await module.POST(new NextRequest(`http://localhost/api/production/audio/${route}`,{method:"POST",body:JSON.stringify({sourcePath:path.join(root,"foreign-qa.mp4"),voiceMappings:[{voiceId:"qa",voicePath:"qa-reference.wav"}]}),headers:{"content-type":"application/json"}}));
      expect(r.status).toBe(404);expect(await r.text()).not.toContain(root);
    });
    it(`${route}: never fetches an arbitrary source URL`,async()=>{
      state.authenticated=true;const fetcher=vi.spyOn(globalThis,"fetch");
      try{
        const module=route==="analyze-clip"?await import("@/app/api/production/audio/analyze-clip/route"):await import("@/app/api/production/audio/dub-preview/route");
        const r=await module.POST(new NextRequest(`http://localhost/api/production/audio/${route}`,{method:"POST",body:JSON.stringify({sourceUrl:"https://example.invalid/private.mp4",voiceMappings:[{voiceId:"qa",voicePath:"qa-reference.wav"}]}),headers:{"content-type":"application/json"}}));
        expect(r.status).toBe(404);expect(fetcher).not.toHaveBeenCalled();
      }finally{fetcher.mockRestore();}
    });
  }
  it("retains the shared realpath policy and cancels the probe response stream",async()=>{
    state.allowed=true;
    const {productionAudioMediaReadable}=await import("@/lib/productionAudioAccess");
    expect(await productionAudioMediaReadable(new NextRequest("http://localhost/api/test"),"/qa/owned.mp4")).toBe(true);
    const {GET}=await import("@/app/api/file/route");const request=vi.mocked(GET).mock.calls.at(-1)?.[0];
    expect(request?.headers.get("range")).toBe("bytes=0-0");expect(request?.nextUrl.searchParams.get("path")).toBe("/qa/owned.mp4");
  });
});
