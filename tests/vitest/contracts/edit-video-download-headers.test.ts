import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {afterEach,beforeEach,describe,it,expect,vi} from "vitest";
import {NextRequest} from "next/server";
const state=vi.hoisted(()=>({root:"",owner:"qa"}));
vi.mock("@/lib/sessionUser",()=>({requireSessionUser:async()=>({id:"qa",username:"qa"})}));
vi.mock("@/lib/ownerKey",()=>({getOwnerContext:async()=>({ownerKey:state.owner}),SessionInvalidError:class extends Error{}}));
vi.mock("@/lib/paths",async importOriginal=>({...await importOriginal<any>(),get OTG_DATA_ROOT(){return state.root;}}));
beforeEach(()=>{state.root=fs.mkdtempSync(path.join(os.tmpdir(),"slr-download-"));state.owner="qa";fs.mkdirSync(path.join(state.root,"edit_video_jobs/qa/job"),{recursive:true});fs.writeFileSync(path.join(state.root,"edit_video_jobs/qa/job/preview.mp4"),"video-fixture");fs.writeFileSync(path.join(state.root,"edit_video_jobs/qa/job/acescg_exr.zip"),"PK-zip-fixture");});
afterEach(()=>fs.rmSync(state.root,{recursive:true,force:true}));
describe("Owner-scoped processed media download headers",()=>{
 it("uses valid quoted filename and weak ETag without literal escape slashes",async()=>{
  const {GET}=await import("@/app/api/edit-video/file/route");const r=await GET(new NextRequest("http://localhost/api/edit-video/file?jobId=job&name=preview.mp4&download=1"));
  expect(r.status).toBe(200);expect(r.headers.get("content-disposition")).toBe('attachment; filename="preview.mp4"');
  expect(r.headers.get("etag")).toMatch(/^W\/"[^"\\]+"$/);expect(await r.text()).toBe("video-fixture");
 });
 it("serves an EXR archive as ZIP with an exact ranged response",async()=>{
  const {GET}=await import("@/app/api/edit-video/file/route");const r=await GET(new NextRequest("http://localhost/api/edit-video/file?jobId=job&name=acescg_exr.zip&download=1",{headers:{range:"bytes=0-1"}}));
  expect(r.status).toBe(206);expect(r.headers.get("content-type")).toBe("application/zip");expect(r.headers.get("content-range")).toBe("bytes 0-1/14");expect(await r.text()).toBe("PK");
 });
 it("does not serve a fictional other owner's output",async()=>{
  state.owner="other-qa";const {GET}=await import("@/app/api/edit-video/file/route");const r=await GET(new NextRequest("http://localhost/api/edit-video/file?jobId=job&name=preview.mp4"));
  expect(r.status).toBe(404);
 });
});
