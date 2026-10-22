import {afterAll,afterEach,beforeAll,describe,it,expect,vi} from "vitest";
import {NextRequest} from "next/server";
import fs from "node:fs";import os from "node:os";import path from "node:path";
const state=vi.hoisted(()=>({authenticated:false}));
vi.mock("@/lib/sessionUser",()=>({requireSessionUser:async()=>{if(!state.authenticated)throw Error("No session");return {username:"qa_ace",ownerKey:"qa_ace"};}}));
vi.mock("@/app/api/file/route",()=>({GET:async()=>Response.json({error:"Not found"},{status:404})}));
let root="";
beforeAll(()=>{root=fs.mkdtempSync(path.join(os.tmpdir(),"qa-ace-security-"));fs.writeFileSync(path.join(root,"foreign-qa.wav"),"RIFF fixture");});
afterEach(()=>{state.authenticated=false;vi.restoreAllMocks();});
afterAll(()=>fs.rmSync(root,{recursive:true,force:true}));
describe("Active ACE music API security",()=>{
  it.each(["GET","POST"] as const)("%s requires authentication before request parsing or provider probes",async method=>{
    const fetcher=vi.spyOn(globalThis,"fetch");const route=await import("@/app/api/edit-video/ace-music/route");
    const r=await route[method](new NextRequest("http://localhost/api/edit-video/ace-music",{method}));expect(r.status).toBe(401);expect(fetcher).not.toHaveBeenCalled();
  });
  it("refuses a fictional foreign reference before initializing a GPU model",async()=>{
    state.authenticated=true;const fetcher=vi.spyOn(globalThis,"fetch");const {POST}=await import("@/app/api/edit-video/ace-music/route");
    const r=await POST(new NextRequest("http://localhost/api/edit-video/ace-music",{method:"POST",body:JSON.stringify({prompt:"QA music",referenceAudioPath:path.join(root,"foreign-qa.wav")}),headers:{"content-type":"application/json"}}));
    expect(r.status).toBe(404);expect(fetcher).not.toHaveBeenCalled();expect(await r.text()).not.toContain(root);
  });
  it("never forwards a session cookie to an arbitrary URL",async()=>{
    state.authenticated=true;const fetcher=vi.spyOn(globalThis,"fetch");const {POST}=await import("@/app/api/edit-video/ace-music/route");
    const r=await POST(new NextRequest("http://localhost/api/edit-video/ace-music",{method:"POST",body:JSON.stringify({prompt:"QA music",referenceAudioUrl:"https://example.invalid/private.wav"}),headers:{"content-type":"application/json"}}));
    expect(r.status).toBe(404);expect(fetcher).not.toHaveBeenCalled();
  });
});
