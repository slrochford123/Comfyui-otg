import {afterAll,beforeEach,describe,expect,it,vi} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import {coffeeStory} from "../fixtures/production-coffee-story";

const mocks=vi.hoisted(()=>({cookies:vi.fn(),admit:vi.fn(),release:vi.fn(),uncertain:vi.fn(),lease:vi.fn(),releaseLease:vi.fn(),memory:vi.fn(),process:vi.fn()}));
vi.mock("next/headers",()=>({cookies:mocks.cookies}));
vi.mock("@/lib/workers/mediaGpuQueue",()=>({acquireExternalMediaGpuChoice:mocks.admit}));
vi.mock("@/lib/workers/voiceGpuFileLease",()=>({acquireVoiceGpuFileLease:mocks.lease}));
vi.mock("@/lib/audioEditing/gpuMemory",()=>({prepareAudioGpuMemory:mocks.memory}));
vi.mock("node:child_process",async()=>{
  const actual=await vi.importActual<typeof import("node:child_process")>("node:child_process");
  return {...actual,spawn:(...args:unknown[])=>mocks.process(...args),execFileSync:(...args:Parameters<typeof actual.execFileSync>)=>args[0]==="nvidia-smi"?"GPU-fixture, NVIDIA GeForce RTX 3090\n":actual.execFileSync(...args)};
});
const root=fs.mkdtempSync(path.join(os.tmpdir(),"voice-context-"));
vi.stubEnv("OTG_ENV","test");vi.stubEnv("OTG_MEDIA_GPU_ROUTING","1");
vi.stubEnv("OTG_DATA_ROOT",root);vi.stubEnv("OTG_DATA_DIR",root);vi.stubEnv("OTG_STUDIO_WORKER_DISABLED","1");
vi.stubEnv("OTG_STORY_QWEN_REMOTE_CONFIG","");vi.stubEnv("OTG_STORY_QWEN_PYTHON",process.execPath);
for(const file of ["config.json","model.safetensors","speech_tokenizer/model.safetensors"]){fs.mkdirSync(path.dirname(root+"/model/"+file),{recursive:true});fs.writeFileSync(root+"/model/"+file,"fixture-only");}
vi.stubEnv("OTG_STORY_QWEN_DESIGN",root+"/model");vi.stubEnv("OTG_STORY_QWEN_BASE",root+"/model");
const {createStudioStore}=await import("@/lib/productionStudio/store");
const {enqueueStudioJob,executeStudioJob}=await import("@/lib/productionStudio/jobs");
const {manifestFromAnalysis}=await import("@/lib/productionStudio/createManifest");
const {getStoryMedia,updateStoryMedia}=await import("@/lib/storyCreator/mediaStore");
// Deliberately use the REAL adapter that previously read cookies in a worker.
const {generateStoryVoice,storyVoiceActive}=await import("@/lib/storyCreator/mediaVoice");
const s=createStudioStore(root+"/studio");
afterAll(()=>{s.db.close();vi.unstubAllEnvs();fs.rmSync(root,{recursive:true,force:true});});
beforeEach(()=>{
  const stories=root+"/story-creator/story-creator.sqlite";
  if(fs.existsSync(stories)){const d=new Database(stories);d.prepare("UPDATE story_projects SET status='archived'").run();d.close();}
  vi.clearAllMocks();mocks.cookies.mockImplementation(()=>{throw Error("`cookies` was called outside a request scope.");});
  vi.stubEnv("OTG_STORY_QWEN_5060_CONFIG","");
  mocks.admit.mockResolvedValue({gpu:"rtx3090",release:mocks.release,uncertain:mocks.uncertain});mocks.lease.mockResolvedValue(mocks.releaseLease);mocks.memory.mockResolvedValue(undefined);
  mocks.process.mockImplementation(async()=>{throw Error("Unexpected process");});
});
async function enqueue(choice?:"auto"|"rtx3090"|"rtx5060ti"){
  let p=s.create("owner","Ava voice regression");
  p=s.internalUpdate("owner",p.id,p=>{p.plan.storyPreview=JSON.parse(JSON.stringify(coffeeStory()).replaceAll("Maya","Ava"));p.plan.status="approved";p.creation=manifestFromAnalysis(p,{items:[{kind:"character",name:"Ava",role:"main",description:"Approved navy hoodie",prompt:"Ava in navy hoodie",sourceSegmentIds:["beat-1"],continuity:[],evidence:"Ava",optional:false,question:""}]});});
  const job=await enqueueStudioJob(s,"owner",p.id,{revision:p.revision,kind:"voice",requirementId:p.creation!.items[0].id,text:"Hello, this is Ava.",prompt:"Calm and clear",name:"Ava voice",approved:true,requestKey:"voice-"+p.id,voiceGpuChoice:"rtx5060ti"},"secret-cookie-not-persisted",choice?{voiceGpuChoice:choice}:undefined);
  return {job,p};
}
function record(job:Awaited<ReturnType<typeof enqueueStudioJob>>){const current=s.job("owner",job.id);return getStoryMedia("owner",String(current.input.storyId),current.backendId!.slice(6));}
async function successfulProcess(){
  const {EventEmitter}=await import("node:events"),{PassThrough}=await import("node:stream");
  mocks.process.mockImplementation(()=>{
    const child=Object.assign(new EventEmitter(),{stdin:new PassThrough()});let input="";
    child.stdin.on("data",(b:Buffer)=>{input+=b.toString();});
    child.stdin.on("finish",()=>{
      const request=JSON.parse(input),wav=Buffer.alloc(44+24000*2);
      wav.write("RIFF");wav.writeUInt32LE(wav.length-8,4);wav.write("WAVEfmt ",8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(24000,24);wav.writeUInt32LE(48000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write("data",36);wav.writeUInt32LE(wav.length-44,40);
      fs.writeFileSync(request.output,wav);child.emit("close",0);
    });return child;
  });
}
describe("Production Qwen3 durable request context",()=>{
  it.each(["auto","rtx3090",undefined] as const)("completes without request cookies for %s, preserves appearance and requires voice approval",async choice=>{
    await successfulProcess();const {job,p}=await enqueue(choice);const before=s.get("owner",p.id).creation;
    expect(job.input.voiceGpuChoice).toBe(choice||"auto");expect(JSON.stringify(job.input)).not.toContain("secret-cookie");
    await executeStudioJob(s,"owner",job);const done=s.job("owner",job.id);
    expect(done.status).toBe("completed");expect(mocks.cookies).not.toHaveBeenCalled();expect(mocks.admit).toHaveBeenCalledWith(["rtx3090"],"story-qwen3-tts",600_000,expect.any(AbortSignal));expect(mocks.memory).toHaveBeenCalledWith("rtx3090",6500,expect.any(Function));
    expect(mocks.process.mock.calls[0][2].env.CUDA_VISIBLE_DEVICES).toBe("GPU-fixture");expect(mocks.release).toHaveBeenCalledOnce();expect(mocks.releaseLease).toHaveBeenCalledOnce();
    expect(record(job).status).toBe("ready");expect(storyVoiceActive(record(job).id)).toBe(false);
    const asset=s.asset("owner",p.id,done.outputAssetId!).asset;expect(asset.metadata.duration).toBe(1);expect(asset.metadata.requirementId).toBe(p.creation!.items[0].id);
    expect(s.get("owner",p.id).creation).toEqual(before);expect(s.get("owner",p.id).bindings).toEqual([]);
  });
  it("retains explicit 5060 selection and reports incompatibility before GPU admission",async()=>{
    const {job}=await enqueue("rtx5060ti");await executeStudioJob(s,"owner",job);
    expect(s.job("owner",job.id).status).toBe("failed");expect(record(job).status).toBe("failed");expect(record(job).error).toContain("not yet qualified");expect(mocks.cookies).not.toHaveBeenCalled();expect(mocks.admit).not.toHaveBeenCalled();expect(mocks.process).not.toHaveBeenCalled();
  });
  it("marks linked media failed on confirmed execution failure and supports a separate explicit retry",async()=>{
    mocks.memory.mockRejectedValueOnce(Error("GPU preflight unavailable"));const {job,p}=await enqueue();await executeStudioJob(s,"owner",job);
    expect(record(job).status).toBe("failed");expect(record(job).error).toBe("GPU preflight unavailable");expect(s.job("owner",job.id).status).toBe("failed");expect(mocks.process).not.toHaveBeenCalled();
    await successfulProcess();const retry=await enqueueStudioJob(s,"owner",p.id,{revision:s.get("owner",p.id).revision,kind:"voice",requirementId:p.creation!.items[0].id,text:"Hello again",prompt:"Calm",name:"Ava voice",approved:true,requestKey:"retry-"+p.id},"");
    await executeStudioJob(s,"owner",retry);expect(s.job("owner",retry.id).status).toBe("completed");expect(record(job).status).toBe("failed");
  });
  it("does not dispatch a canceled queued job",async()=>{
    const {job}=await enqueue();s.updateJob("owner",job.id,{status:"canceled"});await executeStudioJob(s,"owner",job);
    expect(s.job("owner",job.id).status).toBe("canceled");expect(mocks.admit).not.toHaveBeenCalled();expect(mocks.process).not.toHaveBeenCalled();
  });
  it("preserves standalone Story Creator request preference behavior",async()=>{
    const {job}=await enqueue("rtx5060ti");await executeStudioJob(s,"owner",job);const r=updateStoryMedia(record(job),{status:"running"});
    mocks.cookies.mockResolvedValue({get:()=>({value:"rtx5060ti"})});
    await expect(generateStoryVoice(r,{})).rejects.toThrow("not yet qualified");expect(mocks.cookies).toHaveBeenCalledOnce();expect(mocks.admit).not.toHaveBeenCalled();
  });
});

function remoteRuntime(clone=true,host="slrochford123@100.98.212.116") {
  const file=root+"/remote.json";
  fs.writeFileSync(file,JSON.stringify({engine:"qwen3",verified:{speech:{rtx5060ti:true},"speech-base":{rtx5060ti:clone}},transports:{rtx5060ti:{protocol:"slr-audio-v1",qualified:true,host}}}));
  vi.stubEnv("OTG_STORY_QWEN_5060_CONFIG",file);
  mocks.admit.mockResolvedValue({gpu:"rtx5060ti",release:mocks.release,uncertain:mocks.uncertain});
  return file;
}
async function remoteProcess(unconfirmed=false) {
  const {EventEmitter}=await import("node:events"),{PassThrough}=await import("node:stream");
  mocks.process.mockImplementation((_python:string,args:string[])=>{
    const child=Object.assign(new EventEmitter(),{stdin:new PassThrough()});
    child.stdin.on("finish",()=>{
      const jobRoot=path.dirname(args[1]);
      if(unconfirmed){fs.writeFileSync(jobRoot+"/remote-execution.json",JSON.stringify({outcome:"pending"}));child.emit("close",2);return;}
      const wav=Buffer.alloc(48044);wav.write("RIFF");wav.writeUInt32LE(wav.length-8,4);wav.write("WAVEfmt ",8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(24000,24);wav.writeUInt32LE(48000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write("data",36);wav.writeUInt32LE(wav.length-44,40);
      fs.mkdirSync(jobRoot+"/remote-output",{recursive:true});fs.writeFileSync(jobRoot+"/remote-output/0.wav",wav);
      fs.writeFileSync(jobRoot+"/result.json",JSON.stringify({assets:[{file:jobRoot+"/remote-output/0.wav"}]}));child.emit("close",0);
    });return child;
  });
}
describe("Qualified Qwen3 dual GPU routing",()=>{
  it.each(["auto","rtx5060ti"] as const)("uses qualified 5060 transport for %s without request cookies or 3090 lock",async choice=>{
    const file=remoteRuntime();await remoteProcess();const {job,p}=await enqueue(choice);const appearance=s.get("owner",p.id).creation;
    await executeStudioJob(s,"owner",job);expect(s.job("owner",job.id).status,s.job("owner",job.id).message).toBe("completed");
    expect(mocks.admit).toHaveBeenCalledWith(choice==="auto"?["rtx3090","rtx5060ti"]:["rtx5060ti"],"story-qwen3-tts",600_000,expect.any(AbortSignal));
    expect(mocks.memory).toHaveBeenCalledWith("rtx5060ti",6500,expect.any(Function));expect(mocks.lease).not.toHaveBeenCalled();expect(mocks.cookies).not.toHaveBeenCalled();
    const args=mocks.process.mock.calls[0][1];expect(args[0]).toContain("restricted-remote");expect(mocks.process.mock.calls[0][2].env.OTG_AUDIO_ENGINE_CONFIG).toBe(file);
    const request=JSON.parse(fs.readFileSync(args[1],"utf8"));expect(request.gpu).toBe("rtx5060ti");expect(request.params.variant).toBe("flash");expect(record(job).backendJob?.gpu).toBe("rtx5060ti");expect(s.get("owner",p.id).creation).toEqual(appearance);
  });
  it("rejects a mismatched runtime host before admission",async()=>{
    remoteRuntime(true,"unapproved@host");const {job}=await enqueue("rtx5060ti");await executeStudioJob(s,"owner",job);
    expect(s.job("owner",job.id).status).toBe("failed");expect(mocks.admit).not.toHaveBeenCalled();expect(mocks.process).not.toHaveBeenCalled();
  });
  it("uses a saved reference and its exact transcript for cloning",async()=>{
    remoteRuntime();await remoteProcess();const {job}=await enqueue("rtx5060ti");await executeStudioJob(s,"owner",job);
    const ready=record(job),reference=ready.filePath!;const r=updateStoryMedia(ready,{status:"running"});mocks.process.mockClear();
    await generateStoryVoice(r,{voice:reference,refText:"Exact approved dialogue"},{gpuChoice:"rtx5060ti"});
    const request=JSON.parse(fs.readFileSync(mocks.process.mock.calls[0][1][1],"utf8"));expect(request.params.variant).toBe("base");expect(request.params.description).toBe("Exact approved dialogue");expect(fs.existsSync(request.source)).toBe(true);
  });
  it("does not use a design-only qualification for saved voice cloning",async()=>{
    remoteRuntime();await remoteProcess();const {job}=await enqueue("rtx5060ti");await executeStudioJob(s,"owner",job);const ready=record(job),r=updateStoryMedia(ready,{status:"running"});
    remoteRuntime(false);mocks.admit.mockClear();await expect(generateStoryVoice(r,{voice:ready.filePath!},{gpuChoice:"rtx5060ti"})).rejects.toThrow("operation is not qualified");expect(mocks.admit).not.toHaveBeenCalled();
  });
  it("retains uncertain remote execution instead of releasing or duplicating",async()=>{
    remoteRuntime();await remoteProcess(true);const {job}=await enqueue("rtx5060ti");await executeStudioJob(s,"owner",job);
    expect(record(job).status).toBe("unknown");expect(mocks.uncertain).toHaveBeenCalledOnce();expect(mocks.release).not.toHaveBeenCalled();expect(mocks.process).toHaveBeenCalledOnce();
  });
});
