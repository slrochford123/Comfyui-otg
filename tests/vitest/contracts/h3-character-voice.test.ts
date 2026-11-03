import {beforeEach,afterEach,it,expect,vi} from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {execFileSync} from "node:child_process";
import {buildH3RefModCharacterVoiceWorkflow} from "@/lib/h3SpecialModes/refModCreationWorkflow";
import {checkH3SmartReferences,compileH3SmartReferencePrompt,type H3SmartReferenceCapabilities} from "@/lib/h3SmartReferences";
import {normalizeH3RefModSlots} from "@/lib/h3SpecialModes/refMods";
let root:string;
beforeEach(async()=>{vi.resetModules();root=await fs.mkdtemp(path.join(os.tmpdir(),"slr-character-voice-"));vi.stubEnv("OTG_DATA_DIR",root);vi.stubEnv("OTG_ENV","test");});
afterEach(async()=>{vi.unstubAllEnvs();await fs.rm(root,{recursive:true,force:true});});
const cap:H3SmartReferenceCapabilities={backend:"rtx3090",available:true,firstFrame:true,mixedReferences:true,reason:"",maxImages:9,maxVideos:3,maxAudios:3,maxTotalReferenceMedia:12,maxRefModSlots:8,firstFrameConsumesReferenceAllowance:false,referenceTokenBudget:null,tokenBudgetExplanation:"",refMods:[
  {name:"bunny",kind:"bundle",tokens:300,characterKey:"bunny",characterName:"Bunny",voiceId:"voice-bunny",members:[{kind:"video",tokens:200},{kind:"audio",tokens:100}]},
  {name:"fox",kind:"bundle",tokens:300,characterKey:"fox",characterName:"Fox",voiceId:"voice-fox",members:[{kind:"video",tokens:200},{kind:"audio",tokens:100}]},
]};
it("saves one reloaded AV bundle and emits a no-decode member verification receipt",()=>{
  const built=buildH3RefModCharacterVoiceWorkflow({folder:"owned/views",name:"version",subfolder:"characters/owner",kind:"character",sourceCount:4,audioFilename:"owned-voice/reference.wav"});
  expect(built.graph[3]).toMatchObject({class_type:"MiniMaxH3RefModMasterExtract",inputs:{save:false,budget_policy:"error",audio_budget_policy:"error",audio_concept_type:"voice",audio:["5",0]}});
  expect(built.graph[4]).toMatchObject({class_type:"MiniMaxH3RefModBundleSave",inputs:{name:"version",mods:["3",0]}});
  expect(built.graph[7].inputs).toMatchObject({mods:["4",0],preview:"off"});expect(built.graph[8].inputs.source).toEqual(["7",0]);
  expect(Object.values(built.graph).filter(n=>n.class_type.includes("Save"))).toHaveLength(1);
});
it("maps each character's audio with native per-modality counters and member-first copies",()=>{
  const slots=normalizeH3RefModSlots([{name:"bunny",copies:2},{name:"fox"}]);
  const checked=checkH3SmartReferences(cap,{useFirstFrame:false,refMods:slots},[{name:"background"}]);
  expect(checked.referenceMap.map(m=>m.tag)).toEqual(["<Picture 1>","<Video 1>","<Video 2>","<Audio 1>","<Audio 2>","<Video 3>","<Audio 3>"]);
  const prompt=compileH3SmartReferencePrompt('Bunny says "Hello". Fox says "Hi".',{useFirstFrame:false,referenceMap:checked.referenceMap});
  expect(prompt).toContain('<Subject 2> = "Bunny" uses <Video 1>, <Video 2>');
  expect(prompt).toContain("Only <Subject 2> uses <Audio 1>, <Audio 2>");expect(prompt).toContain("Only <Subject 3> uses <Audio 3>");
  expect(checked.refModTokens).toBe(900);
});
it.each([{components:"Visual",audioStrength:1},{components:"All",audioStrength:0},{components:"All",strength:0}])("honors disabled audio and zero strength without assigning phantom voices: %j",slot=>{
  const checked=checkH3SmartReferences(cap,{useFirstFrame:false,refMods:normalizeH3RefModSlots([{name:"bunny",...slot}])},[]);
  expect(checked.referenceMap.filter(m=>m.kind==="audio")).toHaveLength(0);
  expect(compileH3SmartReferencePrompt("Bunny walks",{useFirstFrame:false,referenceMap:checked.referenceMap})).not.toContain("uses <Audio");
});
it("rejects ambiguous bundle metadata and conflicting voice versions",()=>{
  const selection={useFirstFrame:false,refMods:normalizeH3RefModSlots([{name:"bunny"},{name:"fox"}])};
  expect(()=>checkH3SmartReferences({...cap,refMods:[{name:"bunny",kind:"bundle"}]},selection,[])).toThrow("unverified bundle");
  const checked=checkH3SmartReferences({...cap,refMods:cap.refMods.map(m=>({...m,characterKey:"same"}))},selection,[]);
  expect(()=>compileH3SmartReferencePrompt("Hello",{useFirstFrame:false,referenceMap:checked.referenceMap})).toThrow("Choose one saved voice");
});
it("pins a recording, persists it across card reloads and prevents stale edits or cross-account access",async()=>{
  const voice=await import("@/lib/h3SpecialModes/characterRefVoice"),cards=await import("@/lib/h3SpecialModes/characterRefCard");
  const recording=path.join(root,"tone.wav");execFileSync("ffmpeg",["-v","error","-f","lavfi","-i","sine=frequency=440:duration=3","-c:a","pcm_s16le",recording]);
  const card=await cards.createCharacterRefCard("alice",randomUUID());
  const saved=await cards.attachCharacterRefVoice("alice",card.id,card.revision,{path:recording,name:"Bunny"});
  expect(saved.voice?.path).not.toBe(recording);await fs.writeFile(recording,"replaced source");await voice.assertCharacterRefVoiceIntact(saved.voice!);
  expect((await cards.readCharacterRefCard("alice",card.id)).voice?.sha256).toBe(saved.voice?.sha256);
  expect(JSON.stringify(cards.characterRefCardPublic(saved))).not.toContain(root);
  await expect(cards.attachCharacterRefVoice("alice",card.id,card.revision,null)).rejects.toMatchObject({status:409});
  await expect(cards.attachCharacterRefVoice("bob",card.id,saved.revision,null)).rejects.toMatchObject({status:404});
  await expect(Promise.resolve().then(()=>voice.resolveCharacterRefVoice("bob","library:alice-voice"))).rejects.toMatchObject({status:404});
  const removed=await cards.attachCharacterRefVoice("alice",card.id,saved.revision,null);expect(removed.voice).toBeNull();expect(await fs.stat(saved.voice!.path)).toBeTruthy();
  await fs.writeFile(saved.voice!.path,"tampered");await expect(voice.assertCharacterRefVoiceIntact(saved.voice!)).rejects.toThrow("no substitute");
});
it("verifies all visual frames plus one audio member before claiming success",async()=>{
  const {verifyCharacterVoiceBundle}=await import("@/lib/h3SpecialModes/characterRefVoice");
  const receipt=(n:number)=>({outputs:{8:{text:[JSON.stringify({total_tokens:300,refs:[{kind:"video",shape:[1,24,n,32,32],tokens:200},{kind:"audio",shape:[1,32,2,50],tokens:100}]})]}}});
  expect(verifyCharacterVoiceBundle(receipt(4),4,300)).toHaveLength(2);expect(()=>verifyCharacterVoiceBundle(receipt(3),4,300)).toThrow("all approved");expect(()=>verifyCharacterVoiceBundle({},4,300)).toThrow("receipt");
});
it("requires the independent RefMod rollout flag in PROD, never the Testing tab",async()=>{vi.stubEnv("OTG_ENV","prod");vi.stubEnv("OTG_H3_CHARACTER_REFCARDS_ENABLED","0");const {assertCharacterRefVoiceEnabled}=await import("@/lib/h3SpecialModes/characterRefVoice");expect(()=>assertCharacterRefVoiceEnabled()).toThrow("not enabled");vi.stubEnv("OTG_H3_CHARACTER_REFCARDS_ENABLED","1");expect(()=>assertCharacterRefVoiceEnabled()).not.toThrow();});
