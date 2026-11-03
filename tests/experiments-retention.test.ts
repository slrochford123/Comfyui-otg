import {afterEach,beforeEach,expect,it,vi} from "vitest";
import fs from "node:fs";import path from "node:path";import os from "node:os";import crypto from "node:crypto";
import {abandonAsset,createSession,finishAsset,getSession,labRoot,reserveAsset,updateSession,withLab} from "@/lib/experiments/store";
import {MAX_LAB_IMAGE_BYTES} from "@/lib/experiments/imageTypes";
import {appendH3References} from "@/lib/experiments/referenceLimits";
let root:string;
beforeEach(()=>{root=fs.mkdtempSync(path.join(os.tmpdir(),"h3-retention-test-"));vi.stubEnv("OTG_ENV","test");vi.stubEnv("OTG_EXPERIMENTS_ROOT",path.join(root,"lab"));vi.stubEnv("OTG_DATA_DIR",path.join(root,"data"));});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();fs.rmSync(root,{recursive:true,force:true});});
it("retains 100 sources/results in one H3 session without arbitrary count or GB quotas",()=>{
 const session=createSession("owner-a","prism-pika"),saved=[];
 for(let i=0;i<100;i++){
  const a=reserveAsset("owner-a",session.id,"saved-"+i+".mp4","video/mp4",i%2?"source":"generated"),bytes=Buffer.from("owned transport fixture "+i);
  fs.writeFileSync(a.file,bytes);finishAsset("owner-a",a.id,bytes.length,crypto.createHash("sha256").update(bytes).digest("hex"));saved.push(a);
 }
 expect(getSession("owner-a",session.id).assets).toHaveLength(100);
 // Metadata-only quota fixture: never allocate GiB files in a regression test.
 withLab(db=>db.prepare("UPDATE assets SET bytes=? WHERE id=?").run(20*1024**3,saved[0].id));
 expect(()=>reserveAsset("owner-a",session.id,"next.png","image/png","source")).not.toThrow();
 expect(()=>getSession("owner-b",session.id)).toThrow("not found");
 expect(fs.readFileSync(saved[99].file,"utf8")).toBe("owned transport fixture 99");
});
it("allows new H3 drafts after 200 old drafts without consuming the separate Testing allowance",()=>{
 const s=createSession("owner-a","prism-pika");withLab(db=>db.transaction(()=>{const insert=db.prepare("INSERT INTO sessions SELECT ?,owner,experiment,title,settings,notes,archived,revision,created,updated FROM sessions WHERE id=?");for(let i=0;i<200;i++)insert.run(crypto.randomUUID(),s.id);})());
 expect(()=>createSession("owner-a","eros-beta7")).not.toThrow();expect(()=>createSession("owner-a","pika-flex")).not.toThrow();
});
it("keeps quarantined Testing limits separate from uncapped H3 retention",()=>{
 const h3=createSession("owner-a","prism-pika"),a=reserveAsset("owner-a",h3.id,"existing.mp4","video/mp4","generated");finishAsset("owner-a",a.id,20*1024**3,"fixture");
 const testing=createSession("owner-a","pika-flex");for(let i=0;i<12;i++)reserveAsset("owner-a",testing.id,"a.wav","audio/wav","source");expect(()=>reserveAsset("owner-a",testing.id,"a.wav","audio/wav","source")).toThrow("12 assets");
});
it("accounts for outstanding image reservations and rolls back safely at the disk reserve",()=>{
 const s=createSession("owner-a","prism-pika");vi.spyOn(fs,"statfsSync").mockReturnValue({bavail:8*1024**3+700*1024**2,bsize:1} as ReturnType<typeof fs.statfsSync>);
 const first=reserveAsset("owner-a",s.id,"a.png","image/png","source",MAX_LAB_IMAGE_BYTES);
 expect(()=>reserveAsset("owner-a",s.id,"b.png","image/png","source",MAX_LAB_IMAGE_BYTES)).toThrow("free disk space");
 abandonAsset("owner-a",first.id);expect(()=>reserveAsset("owner-a",s.id,"b.png","image/png","source",MAX_LAB_IMAGE_BYTES)).not.toThrow();
});
it("keeps files saved while limiting only the references selected for one render",()=>{
 const assets=Array.from({length:30},(_,i)=>({id:crypto.randomUUID(),mime:i<20?"image/png":i<25?"video/mp4":"audio/wav",role:"source"}));
 const selected=appendH3References([],assets.map(a=>a.id),assets,"reference");expect(selected).toHaveLength(12);expect(selected.filter(id=>assets.find(a=>a.id===id)?.mime.startsWith("image/"))).toHaveLength(9);expect(assets).toHaveLength(30);
 expect(appendH3References([assets[0].id],[assets[1].id],assets,"image")).toEqual([assets[1].id]);
 const session=createSession("owner-a","prism-pika");expect(()=>updateSession("owner-a",session.id,{...session,settings:{...session.settings,selectedSources:assets.slice(0,13).map(a=>a.id)}})).toThrow("one render");
});
