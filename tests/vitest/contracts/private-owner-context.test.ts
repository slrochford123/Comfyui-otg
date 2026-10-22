import {afterAll,beforeAll,beforeEach,describe,it,expect,vi} from "vitest";
import {NextRequest} from "next/server";
import fs from "node:fs";import os from "node:os";import path from "node:path";
const state=vi.hoisted(()=>({username:"qa_private",invalid:false}));
vi.mock("@/lib/auth/jwt",()=>({verifySession:async()=>{if(state.invalid)throw Error("Invalid session");return {username:state.username};}}));
vi.mock("@/lib/ownerAlias",()=>({resolveOwnerAlias:(x:string)=>x}));
vi.mock("@/lib/otgDevice",()=>({getDeviceIdFromRequest:async(req:NextRequest)=>req.headers.get("x-otg-device-id")||"qa_device",safeDeviceId:(x:string)=>x}));
let root="";
beforeAll(()=>{root=fs.mkdtempSync(path.join(os.tmpdir(),"qa-private-owner-"));vi.stubEnv("OTG_DATA_ROOT",root);vi.stubEnv("OTG_DATA_DIR",root);for(const owner of ["qa_private","qa_other"]){const p=path.join(root,"edit_video_jobs",owner,"job");fs.mkdirSync(p,{recursive:true});fs.writeFileSync(path.join(p,"qa.mp4"),"QA fixture");}});
beforeEach(()=>{state.username="qa_private";state.invalid=false;});
afterAll(()=>{vi.unstubAllEnvs();fs.rmSync(root,{recursive:true,force:true});});
async function request(authenticated:boolean,device="qa_private",owner="qa_private"){
 const {cookieName}=await import("@/lib/auth/cookies");return new NextRequest("http://localhost/api/file?path="+encodeURIComponent(path.join(root,"edit_video_jobs",owner,"job/qa.mp4")),{headers:{"x-otg-device-id":device,...(authenticated?{cookie:cookieName()+"=qa-session-placeholder"}:{})}});
}
describe("Private owner identity cannot come from a client device label",()=>{
 it("rejects anonymous caller-supplied owner/device headers",async()=>{
  const {getOwnerContext}=await import("@/lib/ownerKey");await expect(getOwnerContext(await request(false))).rejects.toMatchObject({status:401});
 });
 it("uses the signed username despite a conflicting device hint",async()=>{
  const {getOwnerContext}=await import("@/lib/ownerKey");expect(await getOwnerContext(await request(true,"qa_other"))).toMatchObject({ownerKey:"qa_private",scope:"user"});
 });
 it("does not fall back to device scope when a signed username is invalid",async()=>{
  state.username="invalid/username";const {getOwnerContext}=await import("@/lib/ownerKey");await expect(getOwnerContext(await request(true))).rejects.toMatchObject({status:401});
 });
 it("does not fall back after expired or invalid authentication",async()=>{
  state.invalid=true;const {getOwnerContext}=await import("@/lib/ownerKey");await expect(getOwnerContext(await request(true))).rejects.toMatchObject({status:401});
 });
 it("denies private file reads even with a matching spoofed device key",async()=>{
  const {GET}=await import("@/app/api/file/route");const r=await GET(await request(false));expect(r.status).toBe(401);expect(await r.text()).not.toContain(root);
 });
 it("keeps authenticated media usable and another synthetic owner's files inaccessible",async()=>{
  const {GET}=await import("@/app/api/file/route");const own=await GET(await request(true,"qa_other"));expect(own.status).toBe(200);await own.body?.cancel();
  const other=await GET(await request(true,"qa_other","qa_other"));expect(other.status).toBe(404);
 });
 it("denies unauthenticated legacy JSON mixing before parsing input or running FFmpeg",async()=>{
  const {POST}=await import("@/app/api/edit-video/audio-mix/route");const r=await POST(new NextRequest("http://localhost/api/edit-video/audio-mix",{method:"POST",headers:{"x-otg-device-id":"qa_private","content-type":"application/json"},body:"invalid-json"}));expect(r.status).toBe(401);
 });
 it("rejects another synthetic owner's legacy audio-mix paths",async()=>{
  const {POST}=await import("@/app/api/edit-video/audio-mix/route");const {cookieName}=await import("@/lib/auth/cookies");const foreign=path.join(root,"edit_video_jobs/qa_other/job/qa.mp4");
  const r=await POST(new NextRequest("http://localhost/api/edit-video/audio-mix",{method:"POST",headers:{cookie:cookieName()+"=qa-session-placeholder","content-type":"application/json"},body:JSON.stringify({video:foreign,music:foreign})}));expect(r.status).toBe(404);
 });
});
