import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {mediaGpuCandidates,parseMediaGpuChoice} from "@/lib/mediaGpuRouting";
import {setResourceLockStorePathForTests} from "@/lib/workers/resourceLocks";
import {acquireExternalMediaGpu,cancelQueuedMediaJob,closeMediaGpuQueueForTests,enqueueComfyMedia,enqueueMediaJob,getMediaQueueJob,preferMediaGpu,probeMediaGpu,tickMediaGpuQueue,queuedMediaJobs} from "@/lib/workers/mediaGpuQueue";
const mocks=vi.hoisted(()=>({submit:vi.fn(),voice:vi.fn(()=>false),audioExecute:vi.fn(),audioState:vi.fn(()=>"completed"),instance:vi.fn(),root:""}));
vi.mock("@/lib/workers/comfyWorkerInstance",async original=>({...await original<typeof import("@/lib/workers/comfyWorkerInstance")>(),inspectComfyWorkerInstance:mocks.instance}));
vi.mock("@/lib/paths",async original=>({...await original<typeof import("@/lib/paths")>(),get OTG_DATA_ROOT(){return mocks.root;}}));
vi.mock("@/lib/workers/voiceGpuFileLease",()=>({voiceGpuFileBusy:mocks.voice}));
vi.mock("@/lib/workers/comfyPromptLease",()=>({submitComfyPromptWithGpuLease:mocks.submit}));
vi.mock("@/lib/audioEditing/jobs",()=>({executeQueuedAudioJob:mocks.audioExecute,queuedAudioJobState:mocks.audioState}));
let directory:string;
let busy=new Set<string>();
let histories=new Map<string,unknown>();
const base3090="http://100.75.162.64:8189",base5060="http://100.98.212.116:8188";
const payload=(baseUrl=base3090)=>({baseUrl,workerId:"media-qa",body:{prompt:{"1":{class_type:"EmptyImage",inputs:{}}},client_id:"qa"}});
const flush=()=>new Promise(resolve=>setTimeout(resolve,10));
beforeEach(()=>{
  directory=fs.mkdtempSync(path.join(os.tmpdir(),"media-queue-qa-"));
  mocks.root=directory;
  vi.stubEnv("OTG_ENV","test");vi.stubEnv("OTG_MEDIA_GPU_ROUTING","1");vi.stubEnv("OTG_MEDIA_GPU_QUEUE_DB",path.join(directory,"queue.sqlite"));
  setResourceLockStorePathForTests(path.join(directory,"locks.sqlite"));
  busy=new Set();histories=new Map();mocks.voice.mockReturnValue(false);
  mocks.instance.mockReset().mockResolvedValue(null);
  mocks.submit.mockReset().mockImplementation(async(args)=>{await args.beforeSubmit?.();return Response.json({prompt_id:JSON.parse(String(args.init.body)).prompt_id});});
  mocks.audioExecute.mockReset().mockResolvedValue(undefined);mocks.audioState.mockReturnValue("completed");
  vi.stubGlobal("fetch",vi.fn(async(raw:string)=>{
    const url=String(raw);if(url.includes("/history/")){const id=url.split("/history/")[1];return Response.json(histories.has(id)?{[id]:histories.get(id)}:{});}
    return Response.json({queue_running:busy.has(new URL(url).origin)?[[0,"external",{},{}]]:[],queue_pending:[]});
  }));
});
afterEach(()=>{closeMediaGpuQueueForTests();setResourceLockStorePathForTests(null);vi.unstubAllGlobals();vi.unstubAllEnvs();fs.rmSync(directory,{recursive:true,force:true});});
describe("shared physical media routing",()=>{
  const worker={host:"shawn",unit:"otg-comfyui-h3.service",pid:123,startTicks:"100",bootId:"a".repeat(36)};
  it("releases a confirmed dead worker reservation and permits the next job without retrying the old one",async()=>{
    mocks.instance.mockResolvedValue({instance:worker,previousStopped:false});
    const first=await(await enqueueComfyMedia(payload())).json();await enqueueComfyMedia(payload());
    await tickMediaGpuQueue();await flush();expect(getMediaQueueJob(first.prompt_id)?.workerConfirmed).toBe(1);
    mocks.instance.mockResolvedValue({instance:{...worker,pid:124,startTicks:"200"},previousStopped:true});
    await tickMediaGpuQueue();await flush();
    expect(getMediaQueueJob(first.prompt_id)).toMatchObject({status:"failed",lease:null,error:expect.stringMatching(/original ComfyUI worker stopped/)});
    expect(mocks.submit).toHaveBeenCalledTimes(2);
  });
  it.each(["same-process","old-process-still-alive","no-proof","unreadable-probe","busy-sibling"])("retains missing-history ownership with %s",async mode=>{
    mocks.instance.mockResolvedValue({instance:worker,previousStopped:false});
    const first=await(await enqueueComfyMedia(payload())).json();await enqueueComfyMedia(payload());await tickMediaGpuQueue();await flush();
    if(mode==="unreadable-probe")mocks.instance.mockRejectedValue(Error("unreachable"));
    else mocks.instance.mockResolvedValue(mode==="no-proof"?null:{instance:mode==="same-process"?worker:{...worker,pid:124},previousStopped:mode==="busy-sibling"});
    if(mode==="busy-sibling")busy.add("http://100.75.162.64:8188");
    await tickMediaGpuQueue();await flush();expect(getMediaQueueJob(first.prompt_id)?.status).toBe("unknown");expect(mocks.submit).toHaveBeenCalledTimes(1);
  });
  it("does not mistake a restart during uncertain submission for proof of failed execution",async()=>{
    mocks.instance.mockResolvedValue({instance:worker,previousStopped:false});
    mocks.submit.mockImplementation(async args=>{await args.beforeSubmit();throw Error("lost POST");});
    const first=await(await enqueueComfyMedia(payload())).json();await enqueueComfyMedia(payload());await tickMediaGpuQueue();await flush();
    mocks.instance.mockResolvedValue({instance:{...worker,pid:124},previousStopped:true});await tickMediaGpuQueue();
    expect(getMediaQueueJob(first.prompt_id)?.status).toBe("unknown");expect(mocks.submit).toHaveBeenCalledTimes(1);
  });
  it("serializes independent TEST and PROD queue databases through the installed shared authority",async()=>{
    const authority=path.join(directory,"authority");fs.mkdirSync(authority);
    fs.copyFileSync("scripts/media-gpu-admission.py",path.join(authority,"media-gpu-admission.py"));
    const cfg=path.join(directory,"admission.json");fs.writeFileSync(cfg,JSON.stringify({mode:"local",script:path.join(authority,"media-gpu-admission.py")}));
    vi.stubEnv("OTG_MEDIA_ADMISSION_CONFIG",cfg);
    const queueA=path.join(directory,"a.sqlite"),queueB=path.join(directory,"b.sqlite");
    const select=(name:"a"|"b")=>{closeMediaGpuQueueForTests();vi.stubEnv("OTG_MEDIA_GPU_QUEUE_DB",name==="a"?queueA:queueB);setResourceLockStorePathForTests(path.join(directory,name+"-locks.sqlite"));};
    select("a");const first=await(await enqueueComfyMedia(payload())).json();await tickMediaGpuQueue();
    for(let i=0;i<30&&mocks.submit.mock.calls.length<1;i++)await flush();
    expect(mocks.submit).toHaveBeenCalledTimes(1);
    select("b");const second=await(await enqueueComfyMedia(payload())).json();await tickMediaGpuQueue();
    expect(getMediaQueueJob(second.prompt_id)?.status).toBe("queued");expect(mocks.submit).toHaveBeenCalledTimes(1);
    select("a");histories.set(first.prompt_id,{status:{completed:true,status_str:"success"}});
    await tickMediaGpuQueue();await tickMediaGpuQueue();
    select("b");await tickMediaGpuQueue();for(let i=0;i<30&&mocks.submit.mock.calls.length<2;i++)await flush();
    expect(mocks.submit).toHaveBeenCalledTimes(2);
    expect(getMediaQueueJob(second.prompt_id)?.admissionToken).toBeGreaterThan(1);
  });
  it("retains an unconfirmed remote audio reservation rather than dispatching another job",async()=>{
    mocks.audioExecute.mockRejectedValue(Error("Remote SSH disconnected"));mocks.audioState.mockReturnValue("unknown");
    const job=enqueueMediaJob({gpu:"rtx3090",kind:"audio",payload:{owner:"qa",sessionId:"session",jobId:"job"}});
    await enqueueComfyMedia(payload());await tickMediaGpuQueue();await flush();await tickMediaGpuQueue();
    expect(getMediaQueueJob(job.id)?.status).toBe("unknown");
    expect(mocks.submit).not.toHaveBeenCalled();expect(mocks.audioExecute).toHaveBeenCalledTimes(1);
  });
  it("normalizes only public GPU choices, never worker URLs",()=>{
    expect(parseMediaGpuChoice("5060ti")).toBe("rtx5060ti");expect(parseMediaGpuChoice("http://evil")).toBe("auto");
    expect(mediaGpuCandidates("rtx5060ti",["rtx3090"])).toEqual([]);
  });
  it("prefers an idle 3090 and then the 5060 when either 3090 port is occupied",async()=>{
    expect(await preferMediaGpu(["rtx3090","rtx5060ti"])).toBe("rtx3090");
    busy.add("http://100.75.162.64:8188");expect(await preferMediaGpu(["rtx3090","rtx5060ti"])).toBe("rtx5060ti");
  });
  it("queues on the priority card when both compatible GPUs are occupied",async()=>{
    busy.add("http://100.75.162.64:8188");busy.add(base5060);
    expect(await preferMediaGpu(["rtx3090","rtx5060ti"])).toBe("rtx3090");
  });
  it("persists an application acceptance before a worker receives anything",async()=>{
    const accepted=vi.fn();const response=await enqueueComfyMedia(payload(),accepted);const body=await response.json();
    expect(response.status).toBe(202);expect(accepted).toHaveBeenCalledWith(body.prompt_id);
    expect(getMediaQueueJob(body.prompt_id)?.status).toBe("queued");expect(mocks.submit).not.toHaveBeenCalled();
  });
  it("serializes jobs across both Comfy services on the same physical GPU",async()=>{
    const a=await(await enqueueComfyMedia(payload())).json();const b=await(await enqueueComfyMedia(payload("http://100.75.162.64:8188"))).json();
    await tickMediaGpuQueue();await flush();expect(mocks.submit).toHaveBeenCalledTimes(1);
    await tickMediaGpuQueue();expect(mocks.submit).toHaveBeenCalledTimes(1);
    histories.set(a.prompt_id,{status:{completed:true,status_str:"success"}});
    await tickMediaGpuQueue();await flush();expect(mocks.submit).toHaveBeenCalledTimes(2);expect(getMediaQueueJob(b.prompt_id)?.status).toBe("running");
  });
  it("allows one job on each separate card",async()=>{
    await enqueueComfyMedia(payload());await enqueueComfyMedia(payload(base5060));await tickMediaGpuQueue();await flush();
    expect(mocks.submit).toHaveBeenCalledTimes(2);
  });
  it("queues a legacy audio service ahead of a new Comfy render and holds the card until release",async()=>{
    const granted=acquireExternalMediaGpu("rtx3090","legacy-voice-qa");
    await enqueueComfyMedia(payload());await tickMediaGpuQueue();
    const release=await granted;expect(mocks.submit).not.toHaveBeenCalled();
    await tickMediaGpuQueue();expect(mocks.submit).not.toHaveBeenCalled();
    release();await tickMediaGpuQueue();await flush();expect(mocks.submit).toHaveBeenCalledTimes(1);
  });
  it("cancels a waiting job without calling any worker",async()=>{
    const {prompt_id}=await(await enqueueComfyMedia(payload())).json();
    expect(cancelQueuedMediaJob(prompt_id,base5060)).toBe(false);expect(cancelQueuedMediaJob(prompt_id,base3090)).toBe(true);
    await tickMediaGpuQueue();expect(mocks.submit).not.toHaveBeenCalled();expect(getMediaQueueJob(prompt_id)?.status).toBe("canceled");
  });
  it("retains unknown submission ownership and never duplicates it",async()=>{
    mocks.submit.mockImplementation(async args=>{await args.beforeSubmit?.();throw Error("network disconnected after POST");});
    const {prompt_id}=await(await enqueueComfyMedia(payload())).json();await enqueueComfyMedia(payload());
    await tickMediaGpuQueue();await flush();await tickMediaGpuQueue();
    expect(getMediaQueueJob(prompt_id)?.status).toBe("unknown");expect(mocks.submit).toHaveBeenCalledTimes(1);
    expect(getMediaQueueJob(prompt_id)?.error).toMatch(/Submission outcome is unknown/);
  });
  it.each(["throw","503"])("releases a definitely unsubmitted preflight failure (%s)",async failure=>{
    if(failure==="throw")mocks.submit.mockRejectedValueOnce(Error("Preflight could not load"));
    else mocks.submit.mockResolvedValueOnce(Response.json({error:"Preflight unavailable"},{status:503}));
    const {prompt_id}=await(await enqueueComfyMedia(payload())).json();await enqueueComfyMedia(payload());
    await tickMediaGpuQueue();await flush();expect(getMediaQueueJob(prompt_id)?.status).toBe("failed");
    await tickMediaGpuQueue();await flush();expect(mocks.submit).toHaveBeenCalledTimes(2);
  });
  it("retains ownership after a 503 response from the actual POST",async()=>{
    mocks.submit.mockImplementation(async args=>{await args.beforeSubmit?.();return Response.json({error:"inconclusive"},{status:503});});
    const {prompt_id}=await(await enqueueComfyMedia(payload())).json();await enqueueComfyMedia(payload());await tickMediaGpuQueue();await flush();await tickMediaGpuQueue();
    expect(getMediaQueueJob(prompt_id)?.status).toBe("unknown");expect(mocks.submit).toHaveBeenCalledTimes(1);
  });
  it.each(["failed","missing","wrong-client","fails-during-admission"])("does not render a parent that is %s",async mode=>{
    const producer={kind:"direct" as const,ownerKey:"alice",id:"h3-direct-parent"};
    const file=path.join(directory,"h3-direct/alice/jobs/h3-direct-parent.json");fs.mkdirSync(path.dirname(file),{recursive:true});
    const parent={id:producer.id,ownerKey:"alice",clientId:"qa",backend:"rtx3090",status:mode==="failed"?"failed":"running"};
    if(mode!=="missing")fs.writeFileSync(file,JSON.stringify({...parent,clientId:mode==="wrong-client"?"another-client":"qa"}));
    if(mode==="fails-during-admission")mocks.submit.mockImplementation(async args=>{fs.writeFileSync(file,JSON.stringify({...parent,status:"failed"}));await args.beforeSubmit();throw Error("POST must not occur");});
    const {prompt_id}=await(await enqueueComfyMedia({...payload(),producer})).json();await tickMediaGpuQueue();await flush();
    const current=getMediaQueueJob(prompt_id)!;
    expect(current.status).toBe(mode==="failed"?"canceled":mode==="fails-during-admission"?"failed":"queued");
    expect(current.lease).toBeNull();expect(mocks.submit).toHaveBeenCalledTimes(mode==="fails-during-admission"?1:0);
  });
  it("dispatches an active parent bound to the same owner, client and GPU",async()=>{
    const producer={kind:"direct" as const,ownerKey:"alice",id:"h3-direct-parent"},file=path.join(directory,"h3-direct/alice/jobs/h3-direct-parent.json");
    fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify({id:producer.id,ownerKey:"alice",clientId:"qa",backend:"rtx3090",status:"submitted"}));
    const {prompt_id}=await(await enqueueComfyMedia({...payload(),producer})).json();await tickMediaGpuQueue();await flush();
    expect(getMediaQueueJob(prompt_id)?.status).toBe("running");expect(mocks.submit).toHaveBeenCalledTimes(1);
  });
  it("recovers persisted waiting work after the dispatcher restarts",async()=>{
    const {prompt_id}=await(await enqueueComfyMedia(payload())).json();closeMediaGpuQueueForTests();
    await tickMediaGpuQueue();await flush();expect(getMediaQueueJob(prompt_id)?.status).toBe("running");expect(mocks.submit).toHaveBeenCalledTimes(1);
  });
  it("does not steal a voice reservation or use an unreadable worker",async()=>{
    mocks.voice.mockReturnValue(true);expect((await probeMediaGpu("rtx3090")).ready).toBe(false);
    vi.stubGlobal("fetch",vi.fn(async()=>Response.json({oops:true})));
    expect((await probeMediaGpu("rtx5060ti")).ready).toBe(false);
  });
  it("releases only a definitely rejected job, allowing the next queued job",async()=>{
    mocks.submit.mockResolvedValueOnce(Response.json({error:"invalid graph"},{status:400}));
    const {prompt_id}=await(await enqueueComfyMedia(payload())).json();await enqueueComfyMedia(payload());
    await tickMediaGpuQueue();await flush();expect(getMediaQueueJob(prompt_id)?.status).toBe("failed");
    await tickMediaGpuQueue();await flush();expect(mocks.submit).toHaveBeenCalledTimes(2);
  });
  it("rejects credential-bearing or path-bearing worker URLs",async()=>{
    await expect(enqueueComfyMedia(payload("http://user:secret@100.75.162.64:8188"))).rejects.toThrow("private worker origins");
    await expect(enqueueComfyMedia(payload("http://100.75.162.64:8188/arbitrary"))).rejects.toThrow("private worker origins");
    expect(queuedMediaJobs()).toEqual([]);
  });
});
