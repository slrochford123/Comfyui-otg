import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {afterAll,describe,expect,it,vi} from "vitest";

const {root}=vi.hoisted(()=>({root:require("node:fs").mkdtempSync(require("node:path").join(require("node:os").tmpdir(),"slr-audio-store-test-"))}));
vi.mock("@/lib/paths",()=>({OTG_DATA_ROOT:root}));
import {assertId,assetFile,containedFile,createSession,publicSession,readSession,sessionRoot,updateSession,reserveSessionStart} from "@/lib/audioEditing/store";
afterAll(()=>fs.rmSync(root,{recursive:true,force:true}));
describe("Audio session isolation",()=>{
  it("reserves before asynchronous admission and releases only its own token",()=>{
    const session=createSession("owner-lock");const release=reserveSessionStart("owner-lock",session.id);
    expect(()=>reserveSessionStart("owner-lock",session.id)).toThrow("starting an operation");
    release();const next=reserveSessionStart("owner-lock",session.id);release();
    expect(()=>reserveSessionStart("owner-lock",session.id)).toThrow("starting an operation");next();
  });
  it("recovers a reservation left by an exited process without stealing a live lock",()=>{
    const session=createSession("owner-lock");
    fs.writeFileSync(path.join(sessionRoot("owner-lock",session.id),"admission.lock"),JSON.stringify({pid:999999999,startToken:"expired",token:"old"}));
    const release=reserveSessionStart("owner-lock",session.id);release();
  });
  it("creates and persists only the authenticated owner's session",()=>{
    const session=createSession("owner-a");
    expect(readSession("owner-a",session.id).id).toBe(session.id);
    expect(()=>readSession("owner-b",session.id)).toThrow("this account");
  });
  it("rejects traversal, arbitrary paths and invalid IDs",()=>{
    for(const id of ["../other","/etc/passwd","","x"])expect(()=>assertId(id)).toThrow();
  });
  it("rejects a symlink escaping the session root",()=>{
    const session=createSession("owner-a");const dir=sessionRoot("owner-a",session.id);
    const outside=path.join(root,"outside.wav");fs.writeFileSync(outside,"test");
    const link=path.join(dir,"escape.wav");fs.symlinkSync(outside,link);
    expect(()=>containedFile(dir,link)).toThrow("outside");
  });
  it("rejects another tab overwriting a more recent edit",()=>{
    const session=createSession("owner-a");
    updateSession("owner-a",session.id,{title:"Saved"},session.revision);
    expect(()=>updateSession("owner-a",session.id,{title:"Stale"},session.revision)).toThrow("another tab");
  });
  it("public session does not expose raw server paths",()=>{
    const session=createSession("owner-a");session.assets=[{id:"a".repeat(32),name:"test",kind:"audio",file:"/private/source.wav",duration:5,origin:"test"}];
    expect(JSON.stringify(publicSession(session))).not.toContain("/private/");
    expect(()=>assetFile("owner-a",session,"b".repeat(32))).toThrow("not found");
  });
});
