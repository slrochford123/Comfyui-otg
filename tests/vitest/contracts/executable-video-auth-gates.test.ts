import {describe,it,expect,vi} from "vitest";
import {NextRequest} from "next/server";
vi.mock("@/lib/sessionUser",()=>({requireSessionUser:async()=>{throw Error("Missing session");}}));
describe("Executable video and topology authentication",()=>{
  it.each(["GET","POST"] as const)("rejects unauthenticated H3 %s",async method=>{
    const route=await import("@/app/api/h3/generation/route");const response=await route[method](new NextRequest("http://localhost/api/h3/generation",{method}));
    expect(response.status).toBe(401);expect(await response.text()).not.toContain("100.");
  });
  it.each(["GET","POST","DELETE"] as const)("rejects unauthenticated LTX %s",async method=>{
    const route=await import("@/app/api/edit-video/ltx-edit/route");const response=await route[method](new NextRequest("http://localhost/api/edit-video/ltx-edit",{method}));
    expect(response.status).toBe(401);
  });
  it("never discloses backend topology through an unauthenticated catalog",async()=>{
    const {GET}=await import("@/app/api/ltx-studios/catalog/route");const response=await GET(new NextRequest("http://localhost/api/ltx-studios/catalog"));
    expect(response.status).toBe(401);expect(await response.text()).toBe('{"ok":false,"error":"Unauthorized"}');
  });
  it("requires a session before parsing or saving an LTX result",async()=>{
    const {POST}=await import("@/app/api/edit-video/ltx-edit-save/route");
    const response=await POST(new NextRequest("http://localhost/api/edit-video/ltx-edit-save",{method:"POST",body:"not-json"}));
    expect(response.status).toBe(401);expect(await response.json()).toEqual({ok:false,error:"Unauthorized"});
  });
  it("denies unauthenticated processed media and HDR archive downloads",async()=>{
    const {GET}=await import("@/app/api/edit-video/file/route");
    const response=await GET(new NextRequest("http://localhost/api/edit-video/file?jobId=qa&name=acescg_exr.zip"));
    expect(response.status).toBe(401);
  });
});
