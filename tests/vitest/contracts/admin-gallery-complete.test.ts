import {afterEach, describe, expect, it, vi} from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {listAdminGallery, resolveLocalAdminGalleryFile, fetchRemoteAdminGalleryFile, normalizeAdminGalleryRelPath} from "@/lib/adminGallerySources";
import {adminGalleryAttachment, adminGalleryMediaKind} from "@/lib/adminGalleryMedia";

const roots: string[] = [];
async function local() {const root=await fs.mkdtemp(path.join(os.tmpdir(),"admin-gallery-complete-"));roots.push(root);vi.stubEnv("OTG_ADMIN_GALLERY_3090_ROOT",root);vi.stubEnv("OTG_ADMIN_GALLERY_3090_URL","");return root;}
afterEach(async()=>{vi.useRealTimers();vi.unstubAllEnvs();vi.unstubAllGlobals();await Promise.all(roots.splice(0).map(p=>fs.rm(p,{recursive:true,force:true})));});

describe("all ComfyUI output files, complete stable paging",()=>{
  it("reaches every file beyond 1000 with one stable snapshot",async()=>{
    const root=await local();await fs.mkdir(path.join(root,"nested"));
    await Promise.all(Array.from({length:1205},(_,i)=>fs.writeFile(path.join(root,"nested",`${String(i).padStart(4,"0")}.mp4`),"x")));
    let page=await listAdminGallery({source:"comfy-3090",limit:100,sort:"name"});
    const ids=page.items.map(i=>i.id),snapshotId=page.snapshotId;
    await fs.writeFile(path.join(root,"newly-created.mp4"),"not part of the earlier snapshot");
    while(page.hasMore){page=await listAdminGallery({source:"comfy-3090",limit:100,sort:"name",offset:page.nextOffset,snapshotId});ids.push(...page.items.map(i=>i.id));}
    expect(ids).toHaveLength(1205);expect(new Set(ids).size).toBe(1205);expect(page.statuses[0].count).toBe(1205);
    expect((await listAdminGallery({source:"comfy-3090",limit:1})).statuses[0].count).toBe(1206);
  });
  it("includes nested audio, EXR, archives, metadata, dotfiles and extensionless files",async()=>{
    const root=await local();const names=["face.exr","song.flac","voice.mp3","workflow.json","outputs.zip","note.txt",".keep","no-extension","100% café 🐉.mp4"];
    await Promise.all(names.map(n=>fs.writeFile(path.join(root,n),"fixture")));
    const all=await listAdminGallery({source:"comfy-3090"});expect(all.items).toHaveLength(names.length);
    expect((await listAdminGallery({source:"comfy-3090",media:"audio"})).items).toHaveLength(2);
    expect((await listAdminGallery({source:"comfy-3090",media:"other"})).items).toHaveLength(5);
    for(const n of names)expect((await resolveLocalAdminGalleryFile("comfy-3090",n)).stat.size).toBe(7);
  });
  it("keeps absolute paths, traversal, directories and symlink escapes blocked",async()=>{
    const root=await local();await fs.symlink(os.tmpdir(),path.join(root,"outside"));
    for(const rel of ["../outside.mp4","/etc/passwd","C:\\secret.mp4","a/../b.mp4","outside"]){await expect(resolveLocalAdminGalleryFile("comfy-3090",rel)).rejects.toThrow();}
    expect(normalizeAdminGalleryRelPath("100% done.mp4")).toBe("100% done.mp4");
  });
  it("fetches all remote pages, not just the first 1000, and then serves snapshot pages without refetch",async()=>{
    vi.stubEnv("OTG_ADMIN_GALLERY_5060_URL","http://synthetic.invalid");vi.stubEnv("OTG_ADMIN_GALLERY_5060_TOKEN","synthetic");
    const files=Array.from({length:1205},(_,i)=>({rel:`${i}.mp4`,kind:"video",bytes:3,mtimeMs:1205-i}));
    const fetch=vi.fn(async(input:string)=>{const u=new URL(input);const offset=Number(u.searchParams.get("offset"));return Response.json({ok:true,queryVersion:3,count:files.length,items:files.slice(offset,offset+1000),hasMore:offset+1000<files.length});});vi.stubGlobal("fetch",fetch);
    const first=await listAdminGallery({source:"comfy-5060",limit:100});expect(fetch).toHaveBeenCalledTimes(2);expect(first.statuses[0].count).toBe(1205);
    const final=await listAdminGallery({source:"comfy-5060",offset:1200,limit:100,snapshotId:first.snapshotId});expect(final.items).toHaveLength(5);expect(final.hasMore).toBe(false);expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("reports an obsolete agent instead of claiming a truncated library is complete",async()=>{
    vi.stubEnv("OTG_ADMIN_GALLERY_5060_URL","http://synthetic.invalid");vi.stubEnv("OTG_ADMIN_GALLERY_5060_TOKEN","synthetic");vi.stubGlobal("fetch",vi.fn(async()=>Response.json({ok:true,items:[],hasMore:true,count:2000})));
    const p=await listAdminGallery({source:"comfy-5060"});expect(p.ok).toBe(false);expect(p.statuses[0].error).toContain("agent update required");
  });
  it("does not loop forever if an agent repeats a page",async()=>{
    vi.stubEnv("OTG_ADMIN_GALLERY_5060_URL","http://synthetic.invalid");vi.stubEnv("OTG_ADMIN_GALLERY_5060_TOKEN","synthetic");vi.stubGlobal("fetch",vi.fn(async()=>Response.json({ok:true,queryVersion:3,items:[{rel:"one.mp4",kind:"video"}],hasMore:true,count:2000})));
    const p=await listAdminGallery({source:"comfy-5060"});expect(p.ok).toBe(false);expect(p.statuses[0].error).toContain("repeated a page");
  });
  it("rejects expired or differently filtered snapshots",async()=>{
    await local();const first=await listAdminGallery({source:"comfy-3090"});
    await expect(listAdminGallery({source:"comfy-3090",snapshotId:first.snapshotId,media:"video"})).rejects.toThrow("expired or filters changed");
    await expect(listAdminGallery({source:"comfy-3090",snapshotId:"not-a-real-snapshot"})).rejects.toThrow("expired");
  });
  it("handles all known media kinds and emits Unicode-safe attachment headers",()=>{
    expect(adminGalleryMediaKind("face.EXR")).toBe("image");expect(adminGalleryMediaKind("a.flac")).toBe("audio");expect(adminGalleryMediaKind("file.zip")).toBe("other");
    const header=adminGalleryAttachment("100% café 🐉.mp4");expect(()=>new Headers({"Content-Disposition":header})).not.toThrow();expect(header).toContain("filename*=UTF-8''");expect(header).toContain("%25");
  });
  it("does not abort a healthy download after the former 120-second transfer cap",async()=>{
    vi.useFakeTimers();vi.stubEnv("OTG_ADMIN_GALLERY_5060_URL","http://synthetic.invalid");vi.stubEnv("OTG_ADMIN_GALLERY_5060_TOKEN","synthetic");
    let signal:AbortSignal;let writer:ReadableStreamDefaultController<Uint8Array>;
    const stream=new ReadableStream<Uint8Array>({start(c){writer=c;}});
    vi.stubGlobal("fetch",vi.fn(async(_url:string,init:RequestInit)=>{signal=init.signal as AbortSignal;return new Response(stream);}));
    const response=await fetchRemoteAdminGalleryFile("comfy-5060","long.mp4");
    await vi.advanceTimersByTimeAsync(180_000);expect(signal!.aborted).toBe(false);
    writer!.enqueue(new TextEncoder().encode("completed"));writer!.close();expect(await response.text()).toBe("completed");
  });
  it("preserves remote 416 and passes range validators upstream",async()=>{
    vi.stubEnv("OTG_ADMIN_GALLERY_5060_URL","http://synthetic.invalid");vi.stubEnv("OTG_ADMIN_GALLERY_5060_TOKEN","synthetic");
    const fetch=vi.fn(async()=>new Response(null,{status:416,headers:{"Content-Range":"bytes */17"}}));vi.stubGlobal("fetch",fetch);
    const response=await fetchRemoteAdminGalleryFile("comfy-5060","video.mp4",{range:"bytes=99-",ifRange:'"etag"'});
    expect(response.status).toBe(416);expect((fetch.mock.calls[0] as any)[1].headers["If-Range"]).toBe('"etag"');
  });
});
