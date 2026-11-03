import {beforeEach,afterEach,it,expect,vi} from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {randomUUID} from "node:crypto";
import sharp from "sharp";
import {execFileSync} from "node:child_process";
const fixture=vi.hoisted(()=>({jobs:new Map<string,any>(),submissions:[] as any[],count:4}));
vi.mock("@/lib/workers/mediaGpuQueue",()=>({mediaQueueEnabled:()=>true,preferMediaGpu:async(g:string[])=>g[0]||null,getMediaQueueJob:(id:string)=>fixture.jobs.get(id)||null,enqueueMediaJob:(input:any)=>{if(fixture.jobs.has(input.id))throw Error("Duplicate queue ID");const job={...input,status:"queued"};fixture.jobs.set(job.id,job);fixture.submissions.push(job);return job;}}));
vi.mock("@/lib/images/nativeImageBackend",()=>({nativeImageBackendUrls:()=>({rtx3090:"http://100.75.162.64:8189",rtx5060ti:"http://100.98.212.116:8188"}),chooseNativeImageBackend:async(_m:string,g:string)=>({baseUrl:g==="rtx5060ti"?"http://100.98.212.116:8188":"http://100.75.162.64:8189",label:g==="rtx5060ti"?g:"rtx3090"})}));
vi.mock("@/lib/production/h3Comfy",()=>({uploadH3InputToBaseUrl:async(a:any)=>a.uploadName+".png"}));
vi.mock("@/lib/experiments/images",()=>({prepareLabImage:async(file:string)=>{const target=file+".reference.png";await sharp(file).png().toFile(target);return{file:target};}}));
vi.mock("@/lib/images/nativeImageJobs",async()=>{
  const p=await import("@/lib/paths");
  return {nativeImageJobFile:(owner:string,id:string)=>path.join(p.OTG_DATA_ROOT,"native-image-jobs",owner,id+".json"),writeNativeImageJob:async(file:string,job:any)=>fs.writeFile(file,JSON.stringify(job)),reconcileNativeImageJob:async(owner:string,id:string)=>{
    const file=path.join(p.OTG_DATA_ROOT,"native-image-jobs",owner,id+".json"),job=JSON.parse(await fs.readFile(file,"utf8")),q=fixture.jobs.get(id);
    if(q.status==="completed"){const imagePath=path.join(p.OTG_DATA_ROOT,id+".png");await sharp({create:{width:32,height:48,channels:3,background:"purple"}}).png().toFile(imagePath);return{...job,status:"completed",imagePath};}
    return {...job,status:q.status,error:q.error};
  }};
});
let root:string,mod:typeof import("@/lib/h3SpecialModes/characterRefCard");
beforeEach(async()=>{
  vi.resetModules();root=await fs.mkdtemp(path.join(os.tmpdir(),"character-refcard-unit-"));vi.stubEnv("OTG_DATA_DIR",root);vi.stubEnv("OTG_ENV","test");fixture.jobs.clear();fixture.submissions.length=0;fixture.count=4;
  vi.stubGlobal("fetch",vi.fn(async(url:string)=>{
    if(url.endsWith("/system_stats"))return Response.json({devices:[{name:url.includes("100.98")?"RTX 5060 Ti":"RTX 3090"}]});
    if(url.endsWith("/object_info"))return Response.json({MiniMaxH3RefModMasterExtract:{},MiniMaxH3RefModBundleSave:{},MiniMaxH3RefModInspect:{},PreviewAny:{},LoadAudio:{},MiniMaxH3RefModFolderLoader:{},MiniMaxH3RefModExtract:{},MiniMaxH3RefModSave:{},VAELoader:{input:{required:{vae_name:[["minimax_h3_video_vae_fp16.safetensors","minimax_h3_audio_vae_fp32.safetensors"]]}}}});
    if(url.includes("/history/")){const id=url.split("/").pop()!;return Response.json({[id]:{status:{completed:true},outputs:{8:{text:[JSON.stringify({total_tokens:4096,refs:[{kind:"video",shape:[1,24,fixture.count,32,32],tokens:4000},{kind:"audio",shape:[1,32,2,48],tokens:96}]})]}}}});}
    if(url.endsWith("/refmods/library")){const q=fixture.submissions.find(j=>j.payload.workerId==="h3-refmods-card-encode");const graph=q.payload.body.prompt;return Response.json([{name:graph[4].inputs.subfolder+"/"+graph[3].inputs.name,tokens:4096,kind:graph[4].class_type==="MiniMaxH3RefModBundleSave"?"bundle":"video",shape:[fixture.count,64,64]}]);}
    throw Error("Unexpected network call "+url);
  }));
  mod=await import("@/lib/h3SpecialModes/characterRefCard");
});
afterEach(async()=>{mod.closeCharacterRefCardsForTests();vi.unstubAllGlobals();vi.unstubAllEnvs();await fs.rm(root,{recursive:true,force:true});});
async function card(mode="single",gpu="auto"){
  const created=await mod.createCharacterRefCard("alice",randomUUID());
  return mod.editCharacterRefCard("alice",created.id,{action:"settings",revision:created.revision,name:"Bunny",description:"One pink ear and one white ear",mode,gpu,characterId:""});
}
async function add(c:any,role:"original"|"view"="original",replace?:string){return mod.uploadCharacterRefAsset("alice",c.id,randomUUID(),await sharp({create:{width:32,height:48,channels:3,background:"pink"}}).png().toBuffer(),"bunny.png",role,replace);}
async function act(c:any,action:string,extra:Record<string,unknown>={}){return mod.editCharacterRefCard("alice",c.id,{action,revision:c.revision,...extra});}
it("saves a verified character-and-voice bundle with the immutable original voice linked to its character",async()=>{
  let c=await card("upload");for(let i=0;i<4;i++)c=await add(c,"view");
  const recording=path.join(root,"sample.wav");execFileSync("ffmpeg",["-v","error","-f","lavfi","-i","sine=frequency=440:duration=3","-c:a","pcm_s16le",recording]);
  c=await mod.attachCharacterRefVoice("alice",c.id,c.revision,{path:recording,name:"Bunny voice"});c=await act(c,"encode");c=await mod.advanceCharacterRefCard("alice",c.id);
  expect(fixture.submissions).toHaveLength(1);expect(fixture.submissions[0].payload.body.prompt[4].class_type).toBe("MiniMaxH3RefModBundleSave");
  fixture.submissions[0].status="completed";c=await mod.advanceCharacterRefCard("alice",c.id);expect(c.state).toBe("completed");
  const {readH3RefModSidecar}=await import("@/lib/h3SpecialModes/refModCreation"),{loadCharacter}=await import("@/lib/characters/store");
  const saved=readH3RefModSidecar(c.libraryName!)!;expect(saved.members?.map(m=>m.kind)).toEqual(["video","audio"]);expect(saved.voice?.sha256).toBe(c.voice?.sha256);expect(saved.sourceAssets).toHaveLength(5);expect(loadCharacter("alice",c.characterId)?.referenceAudioPath).toBe(c.voice?.path);
  c=await mod.attachCharacterRefVoice("alice",c.id,c.revision,null);expect(c.state).toBe("review");expect(readH3RefModSidecar(saved.libraryName)?.voice?.sha256).toBe(saved.voice?.sha256);
});
it("has four separate anchored prompts, preserving asymmetry rather than making a collage",async()=>{
  const {CHARACTER_REF_VIEWS,characterRefViewPrompt}=await import("@/lib/h3SpecialModes/characterRefCardContract");expect(CHARACTER_REF_VIEWS).toHaveLength(4);expect(new Set(CHARACTER_REF_VIEWS.map(v=>characterRefViewPrompt(v.id,"pink ear"))).size).toBe(4);
  for(const v of CHARACTER_REF_VIEWS){const prompt=characterRefViewPrompt(v.id,"pink ear");expect(prompt).toContain("not a grid");expect(prompt).toContain("do not mirror");expect(prompt).toContain("pink ear");}
});
it("persists owner-scoped drafts, idempotent creates and stale edit protection",async()=>{
  const c=await card();expect((await mod.createCharacterRefCard("alice",c.id)).revision).toBe(c.revision);expect((await mod.latestCharacterRefCard("alice"))?.name).toBe("Bunny");expect(await mod.latestCharacterRefCard("bob")).toBeNull();
  await expect(mod.readCharacterRefCard("bob",c.id)).rejects.toMatchObject({status:404});await expect(mod.editCharacterRefCard("alice",c.id,{action:"remove",revision:0})).rejects.toMatchObject({status:409});
  expect(JSON.stringify(mod.characterRefCardPublic(c))).not.toMatch(/ownerKey|original\.media|nativeId|\/tmp\//);
});
it("requires a name and source, and never silently overwrites an existing view set",async()=>{
  let c=await card();await expect(act(c,"generate")).rejects.toMatchObject({status:400});c=await add(c);c=await act(c,"generate");expect(c.views).toHaveLength(4);await expect(act(c,"generate")).rejects.toMatchObject({status:409});
});
it.each(["rtx3090","rtx5060ti"])("keeps stable job IDs through polling/restart and routes every anchored view to %s",async(gpu)=>{
  let c=await add(await card("single",gpu));c=await act(c,"generate");const ids=c.views.map(v=>v.nativeId);
  for(let i=0;i<4;i++){
    c=await mod.advanceCharacterRefCard("alice",c.id);const q=fixture.jobs.get(ids[i]!);expect(q.gpu).toBe(gpu);expect(q.payload.body.prompt_id).toBe(ids[i]);expect(q.payload.body.prompt[453]?.inputs||JSON.stringify(q.payload.body.prompt)).toBeTruthy();
    await mod.advanceCharacterRefCard("alice",c.id);expect(fixture.submissions).toHaveLength(i+1);q.status="completed";c=await mod.advanceCharacterRefCard("alice",c.id);
  }
  expect(c.state).toBe("review");expect(c.views.every(v=>v.file&&v.state==="ready")).toBe(true);expect(c.views.map(v=>v.nativeId)).toEqual(ids);
  for(const q of fixture.submissions)expect(JSON.stringify(q.payload.body.prompt)).toContain("otg_refcards/"+c.id+"/anchor-");
  expect(fixture.submissions).toHaveLength(4);
});
it("does not duplicate an ambiguous GPU submission; resume checks the original UUID",async()=>{
  let c=await act(await add(await card()),"generate");c=await mod.advanceCharacterRefCard("alice",c.id);const q=fixture.submissions[0];q.status="unknown";c=await mod.advanceCharacterRefCard("alice",c.id);expect(c.state).toBe("attention");await expect(act(c,"regenerate",{asset:c.views[0].id})).rejects.toMatchObject({status:409});c=await act(c,"resume");await mod.advanceCharacterRefCard("alice",c.id);expect(fixture.submissions).toHaveLength(1);
});
it("allows explicit per-view regeneration after a failed job, with a new random seed",async()=>{
  let c=await act(await add(await card()),"generate");c=await mod.advanceCharacterRefCard("alice",c.id);fixture.submissions[0].status="failed";c=await mod.advanceCharacterRefCard("alice",c.id);const old=c.views[0];c=await act(c,"regenerate",{asset:old.id});expect(c.views[0].nativeId).not.toBe(old.nativeId);expect(c.views[0].seed).not.toBe(old.seed);expect(c.views.slice(1).map(v=>v.nativeId)).toHaveLength(3);
});
it("uploads 4–8 separate views, supports replace/remove/reorder without deleting originals",async()=>{
  let c=await card("upload");for(let i=0;i<8;i++)c=await add(c,"view");await expect(add(c,"view")).rejects.toMatchObject({status:400});
  const old=c.views[0],ids=c.views.map(v=>v.id).reverse();c=await act(c,"reorder",{order:ids});expect(c.views.map(v=>v.id)).toEqual(ids);c=await add(c,"view",old.id);expect(c.views).toHaveLength(8);expect(await fs.readFile(old.original!)).toBeTruthy();c=await act(c,"remove",{asset:c.views[0].id});expect(c.views).toHaveLength(7);
  expect(fixture.submissions).toHaveLength(0);
});
it("copies owned staged files without buffering the whole original into the upload API",async()=>{
  const source=path.join(root,"staged.png"),bytes=await sharp({create:{width:64,height:96,channels:3,background:"blue"}}).png().toBuffer();await fs.writeFile(source,bytes);const c=await card();const saved=await mod.uploadCharacterRefAsset("alice",c.id,randomUUID(),{file:source},"staged.png","original");expect(await fs.readFile(saved.original!.original!)).toEqual(bytes);expect(saved.original!.original).not.toBe(source);
});
it("letterboxes a wide source for FIBO rather than cropping off its edges",async()=>{
  const source=path.join(root,"wide.png");await sharp({create:{width:1200,height:300,channels:3,background:"red"}}).png().toFile(source);const anchor=await mod.prepareCharacterRefFiboAnchor(source);const result=await sharp(anchor).raw().toBuffer({resolveWithObject:true});expect([result.info.width,result.info.height]).toEqual([768,1344]);const pixel=(x:number,y:number)=>[...result.data.subarray((y*768+x)*3,(y*768+x)*3+3)];expect(pixel(0,672)).toEqual([255,0,0]);expect(pixel(767,672)).toEqual([255,0,0]);expect(pixel(384,10)).not.toEqual([255,0,0]);expect((await sharp(source).metadata()).width).toBe(1200);
});
it("recovers uppercase account drafts after a coordinator restart",async()=>{
  let c=await mod.createCharacterRefCard("Alice",randomUUID());c=await mod.editCharacterRefCard("Alice",c.id,{action:"settings",revision:c.revision,name:"Uppercase",description:"",characterId:"",mode:"single",gpu:"rtx3090"});
  c=await mod.uploadCharacterRefAsset("Alice",c.id,randomUUID(),await sharp({create:{width:32,height:48,channels:3,background:"green"}}).png().toBuffer(),"green.png","original");c=await mod.editCharacterRefCard("Alice",c.id,{action:"generate",revision:c.revision});mod.closeCharacterRefCardsForTests();mod.bootstrapCharacterRefCards();await vi.waitFor(()=>expect(fixture.submissions).toHaveLength(1));expect((await mod.readCharacterRefCard("Alice",c.id)).views[0].nativeId).toBe(fixture.submissions[0].id);
});
it.each([4,8])("encodes all %i references using Full Reference without truncation and saves a voice-optional character",async(count)=>{
  let c=await card("upload");for(let i=0;i<count;i++)c=await add(c,"view");fixture.count=count;c=await act(c,"encode");c=await mod.advanceCharacterRefCard("alice",c.id);const q=fixture.submissions[0],graph=q.payload.body.prompt;
  expect(graph[2].inputs.max_items).toBe(count);expect(graph[3].inputs.mode).toBe("Full Reference");expect(graph[3].inputs.budget_policy).toBe("error");q.status="completed";c=await mod.advanceCharacterRefCard("alice",c.id);
  expect(c.state).toBe("completed");expect(c.characterId).toBe(c.id);expect(c.libraryName).toContain("characters/slr-test-cards/");const {loadCharacter}=await import("@/lib/characters/store");const character=loadCharacter("alice",c.characterId)!;expect(character.metadata?.refModViews).toHaveLength(count);expect(character.referenceAudioPath).toBeFalsy();expect(await sharp(c.previewPath).metadata()).toMatchObject({width:768,height:count/2*512});
});
it("rejects a truncated encoder result instead of falsely declaring success",async()=>{
  let c=await card("upload");for(let i=0;i<4;i++)c=await add(c,"view");c=await act(c,"encode");c=await mod.advanceCharacterRefCard("alice",c.id);fixture.count=1;fixture.submissions[0].status="completed";c=await mod.advanceCharacterRefCard("alice",c.id);expect(c.state).toBe("attention");expect(c.error).toContain("all approved");expect(c.characterId).toBe("");
});
it("preserves an existing character's image and voice when attaching a RefMod",async()=>{
  const {createCharacter,loadCharacter}=await import("@/lib/characters/store");const original=createCharacter("alice",{name:"Saved",imagePath:"saved.png",referenceAudioPath:"voice.wav"});let c=await card("upload");c=await act(c,"settings",{...c,name:"Saved",characterId:original.id});for(let i=0;i<4;i++)c=await add(c,"view");c=await act(c,"encode");c=await mod.advanceCharacterRefCard("alice",c.id);fixture.submissions[0].status="completed";c=await mod.advanceCharacterRefCard("alice",c.id);expect(c.characterId).toBe(original.id);expect(loadCharacter("alice",original.id)).toEqual(original);
});
it("denies cross-owner RefMods including backslash aliases, while preserving installed legacy models",async()=>{
  const {characterRefOwnerHash,canUseCharacterRefMod,assertOwnedCharacterRefMods}=await import("@/lib/h3SpecialModes/characterRefCardAccess");const name="characters/slr-test-cards/"+characterRefOwnerHash("alice")+"/card/mod";
  expect(canUseCharacterRefMod("alice",name)).toBe(true);expect(canUseCharacterRefMod("bob",name)).toBe(false);expect(canUseCharacterRefMod("bob",name.replaceAll("/","\\"))).toBe(false);expect(()=>assertOwnedCharacterRefMods("bob",[{name}])).toThrow("account");expect(canUseCharacterRefMod("bob","characters/installed")).toBe(true);
});
it("enforces the TEST-only gate on all mutations",async()=>{
  const c=await card();vi.stubEnv("OTG_ENV","prod");await expect(mod.createCharacterRefCard("alice",randomUUID())).rejects.toMatchObject({status:404});await expect(act(c,"encode")).rejects.toMatchObject({status:404});await expect(add(c)).rejects.toMatchObject({status:404});await expect(mod.advanceCharacterRefCard("alice",c.id)).rejects.toMatchObject({status:404});
});
