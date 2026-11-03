import {beforeEach,afterEach,it,expect,vi} from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {execFileSync} from "node:child_process";
const mocks=vi.hoisted(()=>({start:vi.fn(),reconcile:vi.fn(),cancel:vi.fn()}));
vi.mock("@/lib/audioEditing/jobs",()=>({capabilities:()=>({enabled:true,pythonReady:true,engines:{speech:{rtx3090:true}}}),startJob:mocks.start,reconcileJob:mocks.reconcile,cancelJob:mocks.cancel,sessionJobs:()=>[]}));
vi.mock("@/lib/workers/mediaGpuQueue",()=>({mediaQueueEnabled:()=>true,bootstrapMediaGpuQueue:()=>{},getMediaQueueJob:()=>null}));
vi.mock("@/lib/h3SpecialModes/voiceDesignRuntime",()=>({refVoiceRuntime:(engine:string)=>({engine})}));
let root:string;
beforeEach(async()=>{vi.resetModules();vi.clearAllMocks();root=await fs.mkdtemp(path.join(os.tmpdir(),"slr-refvoice-design-"));vi.stubEnv("OTG_DATA_DIR",root);vi.stubEnv("OTG_ENV","test");mocks.start.mockResolvedValue({id:randomUUID(),status:"queued"});mocks.reconcile.mockImplementation((_o,_s,id)=>({id,status:"queued",stage:"Waiting",progress:0}));});
afterEach(async()=>{vi.unstubAllEnvs();await fs.rm(root,{recursive:true,force:true});});
async function card(count=4){const cards=await import("@/lib/h3SpecialModes/characterRefCard");const c=await cards.createCharacterRefCard("alice",randomUUID());c.name="Bunny";c.views=Array.from({length:count},()=>({id:randomUUID(),label:"View",state:"ready"}));await fs.writeFile(path.join(root,"h3-character-refcards","alice",c.id,"card.json"),JSON.stringify(c));return c;}
const body={engine:"qwen3",description:"Gentle, warm and playful",text:"Hello there. It is good to meet you today."};
it("queues a named audition only after four images, without attaching it automatically",async()=>{
  const a=await import("@/lib/h3SpecialModes/characterVoiceAudition"),cards=await import("@/lib/h3SpecialModes/characterRefCard"),c=await card();
  const state=await a.generateCharacterVoice("alice",c.id,{...body,revision:c.revision});
  expect(state?.status).toBe("queued");expect(mocks.start).toHaveBeenCalledWith("alice",expect.any(String),"speech",undefined,expect.objectContaining({voiceDesignEngine:"qwen3",description:body.description,text:body.text}),"rtx3090");
  expect((await cards.readCharacterRefCard("alice",c.id)).voice).toBeUndefined();
  await expect(a.generateCharacterVoice("alice",c.id,{...body,revision:c.revision})).rejects.toThrow("still generating");expect(mocks.start).toHaveBeenCalledTimes(1);
  const incomplete=await card(3);await expect(a.generateCharacterVoice("alice",incomplete.id,{...body,revision:incomplete.revision})).rejects.toThrow("Finish the reference");
});
it("offers Qwen3 only and rejects removed providers, stale revisions and cross-account access",async()=>{
  const a=await import("@/lib/h3SpecialModes/characterVoiceAudition"),c=await card();
  await expect(a.generateCharacterVoice("alice",c.id,{...body,revision:c.revision,engine:"h3"})).rejects.toThrow("No substitute");
  expect(a.characterVoiceEngines().map(e=>e.id)).toEqual(["qwen3"]);
  for(const engine of ["cosy","auk","unknown"])
    await expect(a.generateCharacterVoice("alice",c.id,{...body,revision:c.revision,engine})).rejects.toThrow("Only Qwen3-TTS");
  await expect(a.generateCharacterVoice("alice",c.id,{...body,revision:999})).rejects.toMatchObject({status:409});
  await expect(a.voiceAuditionState("bob",c.id)).rejects.toMatchObject({status:404});expect(mocks.start).not.toHaveBeenCalled();
});
it("resolves only the completed current audition and snapshots it upon explicit approval",async()=>{
  const a=await import("@/lib/h3SpecialModes/characterVoiceAudition"),store=await import("@/lib/audioEditing/store"),cards=await import("@/lib/h3SpecialModes/characterRefCard"),c=await card();
  const state=(await a.generateCharacterVoice("alice",c.id,{...body,revision:c.revision}))!;
  await expect(a.resolveVoiceAudition("alice",c.id,state.job!)).rejects.toMatchObject({status:404});
  const wav=path.join(store.sessionRoot("alice",state.session),"sample.wav");execFileSync("ffmpeg",["-v","error","-f","lavfi","-i","sine=frequency=440:duration=3","-c:a","pcm_s16le",wav]);
  store.appendAssets("alice",state.session,[{id:randomUUID(),name:"Candidate",file:wav,kind:"audio",duration:3,origin:"test fixture"}]);mocks.reconcile.mockImplementation((_o,_s,id)=>({id,status:"completed",stage:"Ready",progress:100}));
  const source=await a.resolveVoiceAudition("alice",c.id,state.job!);expect((await cards.readCharacterRefCard("alice",c.id)).voice).toBeUndefined();
  const saved=await cards.attachCharacterRefVoice("alice",c.id,c.revision,source);expect(saved.voice?.sourceId).toBe("audition:"+state.job);expect(saved.voice?.path).not.toBe(wav);
  await expect(a.resolveVoiceAudition("alice",c.id,randomUUID())).rejects.toMatchObject({status:404});
  const next=await a.generateCharacterVoice("alice",c.id,{...body,revision:saved.revision});expect(next?.seed).not.toBe(state.seed);expect((await cards.readCharacterRefCard("alice",c.id)).voice?.id).toBe(saved.voice?.id);
});
it("retains errors without pretending a voice was generated and honors the production rollout flag",async()=>{
  const a=await import("@/lib/h3SpecialModes/characterVoiceAudition"),c=await card();mocks.start.mockRejectedValueOnce(Error("Queue unavailable"));
  await expect(a.generateCharacterVoice("alice",c.id,{...body,revision:c.revision})).rejects.toThrow("Queue unavailable");expect((await a.voiceAuditionState("alice",c.id))?.audioUrl).toBeNull();
  vi.stubEnv("OTG_ENV","prod");vi.stubEnv("OTG_H3_CHARACTER_REFCARDS_ENABLED","0");await expect(a.voiceAuditionState("alice",c.id)).rejects.toMatchObject({status:404});
  vi.stubEnv("OTG_H3_CHARACTER_REFCARDS_ENABLED","1");expect((await a.voiceAuditionState("alice",c.id))?.audioUrl).toBeNull();
});
it("deletes and restores only the caller's library selection, never originals or other accounts",async()=>{
  const trash=await import("@/lib/h3SpecialModes/refModTrash"),access=await import("@/lib/h3SpecialModes/characterRefCardAccess");
  const original=path.join(root,"original.png");await fs.writeFile(original,"keep");const name="characters/shared-bunny";
  trash.trashRefMod("alice",name,"Bunny");expect(access.canUseCharacterRefMod("alice",name)).toBe(false);expect(access.canUseCharacterRefMod("bob",name)).toBe(true);
  expect(()=>access.assertOwnedCharacterRefMods("alice",[{name}])).toThrow("not available");expect(trash.deletedRefMods("alice")).toHaveLength(1);expect(trash.deletedRefMods("bob")).toHaveLength(0);expect(await fs.readFile(original,"utf8")).toBe("keep");
  trash.restoreRefMod("alice",name);expect(access.canUseCharacterRefMod("alice",name)).toBe(true);expect(trash.deletedRefMods("alice")).toHaveLength(0);
  expect(()=>trash.trashRefMod("alice","../../outside","bad")).toThrow("Invalid");
  vi.stubEnv("OTG_ENV","prod");vi.stubEnv("OTG_H3_CHARACTER_REFCARDS_ENABLED","0");expect(()=>trash.trashRefMod("alice",name,"Bunny")).toThrow("Not found");
  vi.stubEnv("OTG_H3_CHARACTER_REFCARDS_ENABLED","1");trash.trashRefMod("alice",name,"Bunny");expect(trash.refModIsDeleted("alice",name)).toBe(true);trash.restoreRefMod("alice",name);
});
