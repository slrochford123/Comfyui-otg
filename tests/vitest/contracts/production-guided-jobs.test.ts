import {afterAll,describe,it,expect,vi} from "vitest";
import fs from "node:fs";import os from "node:os";import path from "node:path";
import {coffeeStory} from "../fixtures/production-coffee-story";
const adapters=vi.hoisted(()=>({image:vi.fn(),voice:vi.fn(),edit:vi.fn(),create:vi.fn(),refresh:vi.fn()}));
vi.mock("@/lib/storyCreator/mediaExecution",()=>({executeStoryMedia:adapters.image,refreshStoryMedia:adapters.refresh,storyMediaFile:(r:{filePath:string})=>r.filePath,cancelStoryMedia:vi.fn()}));
vi.mock("@/app/api/assets/create-image/route",()=>({POST:adapters.create}));
vi.mock("@/lib/storyCreator/mediaVoice",()=>({generateStoryVoice:adapters.voice,storyVoiceActive:()=>false}));
vi.mock("@/app/api/images/native/route",()=>({POST:adapters.edit}));
const root=fs.mkdtempSync(path.join(os.tmpdir(),"guided-jobs-"));vi.stubEnv("OTG_DATA_ROOT",root);vi.stubEnv("OTG_DATA_DIR",root);vi.stubEnv("OTG_STUDIO_WORKER_DISABLED","1");
const {createStudioStore}=await import("@/lib/productionStudio/store"),{enqueueStudioJob,executeStudioJob}=await import("@/lib/productionStudio/jobs"),{manifestFromAnalysis}=await import("@/lib/productionStudio/createManifest"),{updateStoryMedia}=await import("@/lib/storyCreator/mediaStore"),{snapshotFile}=await import("@/lib/productionStudio/media");
const s=createStudioStore(root+"/studio"),image=root+"/image.png",voice=root+"/voice.wav";
await(await import("sharp")).default({create:{width:64,height:64,channels:3,background:"#7858ba"}}).png().toFile(image);
const wav=Buffer.alloc(44+24000*2*3);wav.write("RIFF");wav.writeUInt32LE(wav.length-8,4);wav.write("WAVEfmt ",8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(24000,24);wav.writeUInt32LE(48000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write("data",36);wav.writeUInt32LE(wav.length-44,40);fs.writeFileSync(voice,wav);
afterAll(()=>{s.db.close();vi.unstubAllEnvs();fs.rmSync(root,{recursive:true,force:true});});
function seed(){let p=s.create("owner","Coffee");p=s.internalUpdate("owner",p.id,p=>{p.plan.storyPreview=coffeeStory();p.plan.status="approved";p.creation=manifestFromAnalysis(p,{items:[{kind:"character",name:"Maya",role:"main",description:"Maya in blue coat",prompt:"Maya in blue coat",sourceSegmentIds:["beat-1"],continuity:[],evidence:"Maya",optional:false,question:""}]});});return p;}
describe("Guided asset jobs reuse qualified adapters",()=>{
  it("sends an explicit image request to the existing adapter and keeps its result as an unapproved candidate",async()=>{
    const p=seed();adapters.create.mockResolvedValue(Response.json({ok:true,id:"fixture-create-job"}));adapters.refresh.mockImplementation(async r=>updateStoryMedia(r,{status:"ready",filePath:image}));
    const job=await enqueueStudioJob(s,"owner",p.id,{revision:p.revision,kind:"asset-image",requirementId:p.creation!.items[0].id,prompt:"Maya in her blue coat",approved:true,requestKey:"image-request-00000001"},"test-cookie");
    await vi.waitFor(()=>expect(adapters.create).toHaveBeenCalled());await executeStudioJob(s,"owner",s.job("owner",job.id));const result=s.job("owner",job.id);let current=s.get("owner",p.id);expect(result.status).toBe("completed");expect(adapters.image).not.toHaveBeenCalled();const payload=await adapters.create.mock.calls[0][0].json();expect(payload.visualKind).toBe("production-main-character");expect(payload.prompt).toContain("Full-body");expect(payload.prompt).not.toMatch(/coffee|counter/i);expect(current.creation!.items[0].candidateIds).toContain(result.outputAssetId);expect(current.creation!.items[0].assetId).toBeUndefined();expect(current.bindings).toEqual([]);expect(s.assets("owner",p.id)[0].metadata.requirementId).toBe(p.creation!.items[0].id);expect(s.assets("owner",p.id)[0].metadata.visualCompliance).toBe("unreviewed");
    const id=current.creation!.items[0].id;
    for(const operation of [{type:"create.candidate-review",status:"suitable",assetId:result.outputAssetId},{type:"create.appearance",assetId:result.outputAssetId},{type:"create.voice"},{type:"create.refmod"}])current=s.mutate("owner",p.id,current.revision,{...operation,itemId:id});
    const {createAction}=await import("@/lib/productionStudio/createActions");const saved=await createAction(s,"owner",p.id,{revision:current.revision,action:"save-character",itemId:id});expect(saved.project!.creation!.items[0].status).toBe("ready");expect(saved.asset!.kind).toBe("character");expect(saved.asset!.id).not.toBe(result.outputAssetId);expect(saved.asset!.sha256).toBe(s.asset("owner",p.id,result.outputAssetId!).asset.sha256);
  });
  it("routes reference editing through the existing FIBO adapter without replacing a selected appearance",async()=>{
    const p=seed(),a=await snapshotFile(s,"owner",p.id,image,"Face","image");adapters.edit.mockResolvedValue(Response.json({ok:true,id:"fixture-gpu-job"}));
    const job=await enqueueStudioJob(s,"owner",p.id,{revision:p.revision,kind:"asset-image",requirementId:p.creation!.items[0].id,prompt:"Keep Maya, shorter hair",referenceId:a.id,approved:true,requestKey:"edit-request-00000001"},"test-cookie");
    await vi.waitFor(()=>expect(adapters.edit).toHaveBeenCalled());const request=adapters.edit.mock.calls[0][0],form=await request.formData();expect(form.get("model")).toBe("fibo2-edit-turbo");expect(form.get("image")).toBeInstanceOf(File);expect(String(form.get("prompt"))).toContain("full-body reference");expect(String(form.get("prompt"))).not.toContain("compose this shot");expect(s.job("owner",job.id).backendId).toMatch(/^story:/);expect(s.get("owner",p.id).creation!.items[0].assetId).toBeUndefined();
  });
  it("creates an audition through the existing Qwen3 adapter, pins the audio, and does not approve it automatically",async()=>{
    const p=seed();adapters.voice.mockResolvedValue(voice);const job=await enqueueStudioJob(s,"owner",p.id,{revision:p.revision,kind:"voice",requirementId:p.creation!.items[0].id,prompt:"Warm and calm",text:"A peaceful start.",name:"Maya voice",approved:true,requestKey:"voice-request-00000001"},"");
    await executeStudioJob(s,"owner",job);const result=s.job("owner",job.id);expect(result.status).toBe("completed");expect(adapters.voice).toHaveBeenCalled();const a=s.asset("owner",p.id,result.outputAssetId!).asset;expect(a.metadata.duration).toBe(3);expect(a.metadata.requirementId).toBe(p.creation!.items[0].id);expect(s.get("owner",p.id).creation!.items[0].voiceId).toBeUndefined();
  });
});
