import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {NextRequest} from "next/server";
const state=vi.hoisted(()=>({auth:{ok:true,status:200,email:"synthetic@example.invalid",username:"synthetic-admin"} as any}));
vi.mock("@/app/api/admin/_requireAdmin",()=>({requireAdmin:async()=>state.auth}));
import {GET,HEAD} from "@/app/api/admin/gallery-file/route";
let root:string;
beforeEach(async()=>{root=await fs.mkdtemp(path.join(os.tmpdir(),"gallery-delivery-"));vi.stubEnv("OTG_ADMIN_GALLERY_3090_ROOT",root);vi.stubEnv("OTG_ADMIN_GALLERY_3090_URL","");state.auth={ok:true};});
afterEach(async()=>{vi.unstubAllEnvs();await fs.rm(root,{recursive:true,force:true});});
const request=(rel:string,range?:string)=>new NextRequest("http://localhost/api/admin/gallery-file?"+new URLSearchParams({source:"comfy-3090",rel,download:"1"}),{headers:range?{Range:range}:{}});
describe("Admin Gallery authenticated original-file delivery",()=>{
  it("denies missing and non-admin sessions before reading a file",async()=>{for(const status of [401,403]){state.auth={ok:false,status,error:"Denied"};expect((await GET(request("file.mp4"))).status).toBe(status);}});
  it("streams the complete original and supports resumable byte ranges",async()=>{
    const bytes=Buffer.from("0123456789");await fs.writeFile(path.join(root,"file.mp4"),bytes);
    const full=await GET(request("file.mp4"));expect(full.status).toBe(200);expect(Buffer.from(await full.arrayBuffer())).toEqual(bytes);
    const partial=await GET(request("file.mp4","bytes=4-"));expect(partial.status).toBe(206);expect(partial.headers.get("Content-Range")).toBe("bytes 4-9/10");expect(await partial.text()).toBe("456789");
    const suffix=await GET(request("file.mp4","bytes=-2"));expect(await suffix.text()).toBe("89");
    const bad=await GET(request("file.mp4","bytes=99-"));expect(bad.status).toBe(416);
  });
  it("downloads Unicode, literal-percent, unknown-extension and empty files",async()=>{
    for(const name of ["100% café 🐉.mp4","workflow.json","empty"]){await fs.writeFile(path.join(root,name),"");const r=await GET(request(name));expect(r.status).toBe(200);expect(r.headers.get("Content-Length")).toBe("0");expect(r.headers.get("Content-Disposition")).toContain("attachment;");expect((await r.arrayBuffer()).byteLength).toBe(0);}
  });
  it("serves safe HEAD metadata and blocks root escape",async()=>{
    await fs.writeFile(path.join(root,"a.mp4"),"test");const r=await HEAD(request("a.mp4"));expect(r.status).toBe(200);expect(r.headers.get("ETag")).toBeTruthy();expect((await r.text())).toBe("");
    expect((await GET(request("../secret.mp4"))).status).toBe(404);
  });
});
