import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {mediaGpuCandidates,parseMediaGpuChoice} from "@/lib/mediaGpuRouting";
import {setResourceLockStorePathForTests} from "@/lib/workers/resourceLocks";
import {acquireExternalMediaGpu,cancelQueuedMediaJob,closeMediaGpuQueueForTests,enqueueComfyMedia,enqueueMediaJob,getMediaQueueJob,preferMediaGpu,probeMediaGpu,tickMediaGpuQueue,queuedMediaJobs} from "@/lib/workers/mediaGpuQueue";
const mocks=vi.hoisted(()=>({submit:vi.fn(),voice:vi.fn(()=>false),audioExecute:vi.fn(),audioState:vi.fn(()=>"completed")}));
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
  vi.stubEnv("OTG_ENV","test");vi.stubEnv("OTG_MEDIA_GPU_ROUTING","1");vi.stubEnv("OTG_MEDIA_GPU_QUEUE_DB",path.join(directory,"queue.sqlite"));
  setResourceLockStorePathForTests(path.join(directory,"locks.sqlite"));
  busy=new Set();histories=new Map();mocks.voice.mockReturnValue(false);
  mocks.submit.mockReset().mockImplementation(async(args)=>Response.json({prompt_id:JSON.parse(String(args.init.body)).prompt_id}));
  mocks.audioExecute.mockReset().mockResolvedValue(undefined);mocks.audioState.mockReturnValue("completed");
  vi.stubGlobal("fetch",vi.fn(async(raw:string)=>{
    const url=String(raw);if(url.includes("/history/")){const id=url.split("/history/")[1];return Response.json(histories.has(id)?{[id]:histories.get(id)}:{});}
    return Response.json({queue_running:busy.has(new URL(url).origin)?[[0,"external",{},{}]]:[],queue_pending:[]});
  }));
});
afterEach(()=>{closeMediaGpuQueueForTests();setResourceLockStorePathForTests(null);vi.unstubAllGlobals();vi.unstubAllEnvs();fs.rmSync(directory,{recursive:true,force:true});});
describe("shared physical media routing",()=>{
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
    mocks.submit.mockRejectedValue(Error("network disconnected after POST"));
    const {prompt_id}=await(await enqueueComfyMedia(payload())).json();await enqueueComfyMedia(payload());
    await tickMediaGpuQueue();await flush();await tickMediaGpuQueue();
    expect(getMediaQueueJob(prompt_id)?.status).toBe("unknown");expect(mocks.submit).toHaveBeenCalledTimes(1);
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
