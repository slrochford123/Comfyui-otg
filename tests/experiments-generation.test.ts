import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import {EventEmitter} from "node:events";
import {createSession,updateSession,labRoot,reserveAsset,finishAsset,getSession} from "@/lib/experiments/store";
import {labCapabilities,submitLabJob,listLabJobs,cancelLabJob} from "@/lib/experiments/generation";
import {EXPERIMENTS} from "@/lib/experiments/catalog";
const spies=vi.hoisted(()=>({spawn:vi.fn()}));
vi.mock("node:child_process",()=>({spawn:(...args:unknown[])=>spies.spawn(...args)}));
let root:string;
beforeEach(()=>{
  root=fs.mkdtempSync(path.join(os.tmpdir(),"slr-h3-execution-test-"));
  vi.stubEnv("OTG_ENV","test");vi.stubEnv("OTG_EXPERIMENTS_ROOT",path.join(root,"lab"));vi.stubEnv("OTG_DATA_DIR",path.join(root,"data"));
  spies.spawn.mockReset();spies.spawn.mockImplementation(()=>{const child=Object.assign(new EventEmitter(),{pid:999999,unref:vi.fn()});queueMicrotask(()=>child.emit("spawn"));return child;});
});
afterEach(()=>{vi.unstubAllEnvs();fs.rmSync(root,{recursive:true,force:true});});
const digest=(data:Buffer|string)=>crypto.createHash("sha256").update(data).digest("hex");
function configured(modes=["text","image","reference","edit"]){
  const dir=labRoot(),runner=path.join(root,"test-only-runner.py");fs.writeFileSync(runner,"# fixture: child process is mocked, no GPU work\n");
  const hash=digest(fs.readFileSync(runner));
  fs.writeFileSync(path.join(dir,"runtime.json"),JSON.stringify({environment:"test",gpu:"rtx3090",runner,runnerSha256:hash,files:[{path:runner,sha256:hash},{path:runner,sha256:hash},{path:runner,sha256:hash}],models:{"prism-pika":{path:"/not-loaded",sha256:EXPERIMENTS.find(e=>e.id==="prism-pika")!.sha256,qualifiedModes:modes}}}),{mode:0o600});
}
function session(mode:"text"|"image"|"reference"|"edit"|"edit-image"="text"){
  const s=createSession("owner-a","prism-pika");return updateSession("owner-a",s.id,{...s,settings:{...s.settings,mode,prompt:"A fully clothed adult in a cafe.",seconds:2,gpu:"rtx3090"}});
}
function request(s:ReturnType<typeof session>,sources:string[]=[]){return {id:s.id,revision:s.revision,requestId:crypto.randomUUID(),sources};}
function source(s:ReturnType<typeof session>,mime="image/png"){
  const a=reserveAsset("owner-a",s.id,"source.png",mime,"source"),bytes=Buffer.from("owned fixture bytes, not inference evidence");
  fs.writeFileSync(a.file,bytes,{mode:0o600});finishAsset("owner-a",a.id,bytes.length,digest(bytes));return a;
}
describe("private H3 execution boundary",()=>{
  it("never silently resubmits a detached reference and preserves reference order",async()=>{
    configured();const s=session('reference'),a=source(s),b=source(s);
    const v=updateSession('owner-a',s.id,{...s,settings:{...s.settings,selectedSources:[b.id]}});
    await expect(submitLabJob('owner-a',request(v,[a.id,b.id]))).rejects.toThrow('References changed');
    expect(spies.spawn).not.toHaveBeenCalled();
    const job=await submitLabJob('owner-a',request(v,[b.id]));
    const saved=JSON.parse(fs.readFileSync(path.join(labRoot(),'jobs',job.id,'request.json'),'utf8'));
    expect(saved.sources.map((r:{assetId:string})=>r.assetId)).toEqual([b.id]);
    expect(getSession('owner-a',s.id).assets.filter(a=>a.role==='source')).toHaveLength(2);
  });
  it("keeps Testing runtime independent and rejects unqualified variants",async()=>{
    configured();
    const cfg=JSON.parse(fs.readFileSync(path.join(labRoot(),"runtime.json"),"utf8"));
    const s=createSession("owner-a","pika-baseline");
    const v=updateSession("owner-a",s.id,{...s,settings:{...s.settings,prompt:"Two adult friends greet each other.",variant:"base8"}});
    await expect(submitLabJob("owner-a",request(v))).rejects.toThrow("not been qualified");
    cfg.models={"pika-baseline":{qualifiedModes:["reference"],variants:{pika6:["reference"]},minSeconds:5}};
    fs.writeFileSync(path.join(labRoot(),"testing-runtime.json"),JSON.stringify(cfg),{mode:0o600});
    await expect(submitLabJob("owner-a",request(v))).rejects.toThrow("variant/mode");
    expect(labCapabilities().find(c=>c.model==="prism-pika")?.modes).toContain("text");
    expect(spies.spawn).not.toHaveBeenCalled();
  });
  it("Testing enforces its minimum duration and true visual references",async()=>{
    configured();const cfg=JSON.parse(fs.readFileSync(path.join(labRoot(),"runtime.json"),"utf8"));
    cfg.models={"pika-flex":{qualifiedModes:["reference"],variants:{pika6:["reference"]},minSeconds:5}};
    fs.writeFileSync(path.join(labRoot(),"testing-runtime.json"),JSON.stringify(cfg),{mode:0o600});
    const s=createSession("owner-a","pika-flex");let v=updateSession("owner-a",s.id,{...s,settings:{...s.settings,prompt:"A cafe.",seconds:2}});
    await expect(submitLabJob("owner-a",request(v))).rejects.toThrow("duration");
    v=updateSession("owner-a",v.id,{...v,settings:{...v.settings,seconds:5}});const audio=source(v,"audio/wav");
    await expect(submitLabJob("owner-a",request(v,[audio.id]))).rejects.toThrow("audio alone");
    const image=source(v);await submitLabJob("owner-a",request(v,[image.id]));
    expect(spies.spawn.mock.calls[0][1]).toContain(path.join(labRoot(),"testing-runtime.json"));
  });
  it("a broken Testing runtime never disables the independent H3 Admin workspace",()=>{
    configured();fs.writeFileSync(path.join(labRoot(),"testing-runtime.json"),"not valid json",{mode:0o600});
    const capabilities=labCapabilities();expect(capabilities.find(c=>c.model==="prism-pika")?.modes).toContain("text");
    expect(capabilities.find(c=>c.model==="pika-flex")?.modes).toEqual([]);
    expect(capabilities.find(c=>c.model==="pika-flex")?.reason).toContain("integrity validation");
  });
  it("Director publishes JSON and reuses only its own completed session plan",async()=>{
    configured();const cfg=JSON.parse(fs.readFileSync(path.join(labRoot(),"runtime.json"),"utf8"));
    cfg.models={"director-studio":{qualifiedModes:["text"],variants:{pika6:["text"]},minSeconds:2}};
    fs.writeFileSync(path.join(labRoot(),"testing-runtime.json"),JSON.stringify(cfg),{mode:0o600});
    const s=createSession("owner-a","director-studio"),v=updateSession("owner-a",s.id,{...s,settings:{...s.settings,prompt:"Plan a cafe greeting."}});
    const first=await submitLabJob("owner-a",request(v)),dir=path.join(labRoot(),"jobs",first.id);
    const plan={title:"Cafe",continuity:"Same friends",shots:[{title:"Wave",seconds:5,prompt:"Two adult friends wave",sound:"Cafe ambience"}]};
    const bytes=Buffer.from(JSON.stringify(plan));fs.writeFileSync(path.join(dir,"result.json"),bytes);
    fs.writeFileSync(path.join(dir,"status.json"),JSON.stringify({...first,state:"completed",cleanedUp:true,director:plan,outputBytes:bytes.length,outputSha256:digest(bytes)}));
    const completed=listLabJobs("owner-a",v.id)[0];expect(getSession("owner-a",v.id).assets.find(a=>a.id===completed.output)?.mime).toBe("application/json");
    const second=await submitLabJob("owner-a",request(v));const saved=JSON.parse(fs.readFileSync(path.join(labRoot(),"jobs",second.id,"request.json"),"utf8"));
    expect(saved.directorContext).toEqual(plan);expect(saved.parentJob).toBe(first.id);
    const other=createSession("owner-a","director-studio"),fresh=updateSession("owner-a",other.id,{...other,settings:{...other.settings,prompt:"A different story."}});
    const third=await submitLabJob("owner-a",request(fresh));expect(JSON.parse(fs.readFileSync(path.join(labRoot(),"jobs",third.id,"request.json"),"utf8")).directorContext).toBeUndefined();
  });
  it("fails closed when no runtime is configured",async()=>{const s=session();expect(labCapabilities().every(c=>!c.modes.length)).toBe(true);await expect(submitLabJob("owner-a",request(s))).rejects.toThrow("not been qualified");expect(spies.spawn).not.toHaveBeenCalled();});
  it("rejects unqualified mode, GPU, or changed runner",async()=>{
    configured(["text"]);const s=session("image");await expect(submitLabJob("owner-a",request(s))).rejects.toThrow("not passed");
    const v=updateSession("owner-a",s.id,{...s,settings:{...s.settings,mode:"text",gpu:"rtx5060ti"}});await expect(submitLabJob("owner-a",request(v))).rejects.toThrow("5060 Ti");
    fs.appendFileSync(path.join(root,"test-only-runner.py"),"changed");expect(labCapabilities().every(c=>!c.modes.length)).toBe(true);
    await expect(submitLabJob("owner-a",request(v))).rejects.toThrow("requalification");expect(spies.spawn).not.toHaveBeenCalled();
  });
  it("queues once with idempotency and uses a fixed private runner, not client paths",async()=>{
    configured();const s=session(),r=request(s);const job=await submitLabJob("owner-a",r);const again=await submitLabJob("owner-a",r);
    expect(again.id).toBe(job.id);expect(spies.spawn).toHaveBeenCalledTimes(1);
    const [binary,args,options]=spies.spawn.mock.calls[0];expect(binary).toBe("/usr/bin/python3");expect(args[0]).toBe(path.join(root,"test-only-runner.py"));expect(options.env).not.toHaveProperty("OPENAI_API_KEY");
    const saved=JSON.parse(fs.readFileSync(path.join(labRoot(),"jobs",job.id,"request.json"),"utf8"));expect(saved.settings.seed).toBe(s.settings.seed);expect(saved.sources).toEqual([]);
    await expect(submitLabJob("owner-b",r)).rejects.toThrow("not found");expect(()=>cancelLabJob("owner-b",job.id)).toThrow("not found");
  });
  it("requires correct references and never reads another session's media",async()=>{
    configured();const s=session("image"),other=session("reference"),a=source(s),b=source(other);
    await expect(submitLabJob("owner-a",request(s))).rejects.toThrow("Image: one first frame");await expect(submitLabJob("owner-a",request(s,[b.id]))).rejects.toThrow("this session");
    const job=await submitLabJob("owner-a",request(s,[a.id]));const copy=fs.readFileSync(path.join(labRoot(),"jobs",job.id,"sources/0.media"));expect(copy.equals(fs.readFileSync(a.file))).toBe(true);
  });
  it("rejects stale session writes and archives",async()=>{configured();const s=session();updateSession("owner-a",s.id,{...s,archived:true});await expect(submitLabJob("owner-a",request(s))).rejects.toThrow("Save/reload");});
  it("cancels only the owned private job through its marker",async()=>{
    configured();const s=session(),job=await submitLabJob("owner-a",request(s));expect(cancelLabJob("owner-a",job.id).requested).toBe(true);expect(fs.readFileSync(path.join(labRoot(),"jobs",job.id,"cancel"),"utf8")).toContain("cancel");expect(spies.spawn).toHaveBeenCalledTimes(1);
  });
  it("publishes only checksum-matching completed output after cleanup, without duplicates",async()=>{
    configured();const s=session(),job=await submitLabJob("owner-a",request(s)),dir=path.join(labRoot(),"jobs",job.id);
    // Transport fixture only; actual FFmpeg/inference qualification is a separate suite.
    const bytes=Buffer.from("immutable generated transport fixture");fs.writeFileSync(path.join(dir,"result.mp4"),bytes);
    const receipt={...job,state:"completed",cleanedUp:false,outputBytes:bytes.length,outputSha256:digest(bytes)};
    fs.writeFileSync(path.join(dir,"status.json"),JSON.stringify(receipt));expect(listLabJobs("owner-a",s.id)[0].output).toBeUndefined();
    fs.writeFileSync(path.join(dir,"status.json"),JSON.stringify({...receipt,cleanedUp:true}));const done=listLabJobs("owner-a",s.id)[0];expect(done.output).toBeTruthy();listLabJobs("owner-a",s.id);expect(getSession("owner-a",s.id).assets).toHaveLength(1);expect(getSession("owner-a",s.id).assets[0].role).toBe("generated");
  });
  it("does not turn a stale runner into a successful or resubmitted job",async()=>{
    configured();const s=session(),job=await submitLabJob("owner-a",request(s));fs.writeFileSync(path.join(labRoot(),"jobs",job.id,"status.json"),JSON.stringify({...job,created:1,heartbeat:1}));
    expect(listLabJobs("owner-a",s.id)[0].state).toBe("needs_attention");expect(spies.spawn).toHaveBeenCalledTimes(1);
  });
  it("publishes native image editing as a PNG and never substitutes a video result",async()=>{
    configured(["edit-image"]);const s=session("edit-image"),a=source(s);
    const job=await submitLabJob("owner-a",request(s,[a.id])),dir=path.join(labRoot(),"jobs",job.id);
    const bytes=Buffer.from("native-image transport fixture; inference is separately qualified");
    fs.writeFileSync(path.join(dir,"result.png"),bytes);
    fs.writeFileSync(path.join(dir,"status.json"),JSON.stringify({...job,state:"completed",cleanedUp:true,outputBytes:bytes.length,outputSha256:digest(bytes)}));
    const done=listLabJobs("owner-a",s.id)[0],output=getSession("owner-a",s.id).assets.find(item=>item.id===done.output);
    expect(output?.mime).toBe("image/png");expect(output?.name).toMatch(/\.png$/);expect(output?.role).toBe("generated");
    expect(fs.existsSync(path.join(dir,"result.mp4"))).toBe(false);
  });
  it("flags a stale completed-but-not-cleaned worker instead of publishing or releasing its reservation",async()=>{
    configured();const s=session(),job=await submitLabJob("owner-a",request(s));
    fs.writeFileSync(path.join(labRoot(),"jobs",job.id,"status.json"),JSON.stringify({...job,state:"completed",cleanedUp:false,created:1,heartbeat:1}));
    const status=listLabJobs("owner-a",s.id)[0];expect(status.state).toBe("needs_attention");expect(status.output).toBeUndefined();expect(spies.spawn).toHaveBeenCalledTimes(1);
  });
});
