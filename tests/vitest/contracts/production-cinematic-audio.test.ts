import {afterAll,describe,expect,it,vi} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {cameraStory} from "../fixtures/production-camera-story";
import {createStudioStore} from "@/lib/productionStudio/store";
import {installStory} from "@/lib/productionStudio/storyPlanning";
import {allShots,DEFAULT_SHOT} from "@/lib/productionStudio/model";
import {deriveAcoustics,readAcoustics} from "@/lib/productionStudio/acoustics";
import {directionBrief,readDirection} from "@/lib/productionStudio/shotDirection";
import {compileVideoDirection} from "@/lib/productionStudio/videoPrompt";
import {audioFinishSettings,DEFAULT_AUDIO_FINISH,selectedAudioAsset} from "@/lib/productionStudio/audioFinishSettings";
import {approvedSequence} from "@/lib/productionStudio/shotDirector";
const root=fs.mkdtempSync(path.join(os.tmpdir(),"cinematic-audio-")),s=createStudioStore(root);
afterAll(()=>{s.db.close();fs.rmSync(root,{recursive:true,force:true});vi.unstubAllEnvs();});
function fixture(){
 let p=s.create("owner","Audio fixture");p=s.internalUpdate("owner",p.id,p=>{installStory(p,cameraStory());p.plan.status="approved";const sh=allShots(p)[0];sh.plannedDurationSeconds=6;sh.requestedDurationSeconds=10;sh.dialogue=[{speaker:"Mia",line:"Are you there?",delivery:"Conversational",startSeconds:.3,endSeconds:2},{speaker:"Ava",line:"Yes, I am.",delivery:"Calm",startSeconds:3,endSeconds:5}];p.shots[sh.id]={...DEFAULT_SHOT};});
 const id=allShots(p)[0].id,b=directionBrief(p,id);Object.assign(b,{startingState:"Ava is in the hallway with a speakerphone.",action:"Ava walks into the bathroom.",endState:"Ava stands by the sink.",location:"Hallway",onScreen:["Ava"],offScreen:[{name:"Mia",channel:"phone"}],dialogue:b.dialogue.map(d=>({...d,channel:d.speaker==="Mia"?"phone":"on-screen"}))});
 return {p,id,b};
}
describe("Cinematic audio ownership, prompts and non-destructive selection",()=>{
 it("persists source requirements with the direction, keeps speech out of ambience and phone-only Mia out of visuals",()=>{
  const {b}=fixture(),parsed=readDirection(b),a=parsed.acoustics!;
  expect(a.sources.find(s=>s.identity==="Mia")?.device).toBe("speakerphone");
  expect(a.sources.find(s=>s.identity==="Ava")?.device).toBe("none");
  const prompt=compileVideoDirection(parsed,"text-to-video",[],10);
  expect(prompt).toContain("physical cellphone");expect(prompt).toContain("early reflections");
  for(const d of b.dialogue)expect(prompt.split(d.line).length-1).toBe(1);
  const sound=prompt.split("overall_soundscape:")[1].split("non_diegetic_music:")[0];for(const d of b.dialogue)expect(sound).not.toContain(d.line);
  expect(prompt).toContain("Only these people are visible in this camera view: Ava");
 });
 it("validates physical source identity, device and restrained stereo position",()=>{
  const {b}=fixture(),a=deriveAcoustics(b);a.sources[0].identity="Invisible replacement";expect(()=>readAcoustics(a,b)).toThrow();
  const pan=deriveAcoustics(b);pan.sources[0].keyframes[0].pan=.9;expect(()=>readAcoustics(pan,b)).toThrow();
  const device=deriveAcoustics(b);device.sources.find(s=>s.identity==="Mia")!.device="none";expect(()=>readAcoustics(device,b)).toThrow();
  expect(()=>audioFinishSettings({...DEFAULT_AUDIO_FINISH,roomAmount:9})).toThrow();
 });
 it("selects only a matching video version, carries it into assembly, and restores original without changing the take",()=>{
  let {p,id}=fixture();const original={id:"native",projectId:p.id,name:"Native",kind:"video" as const,sha256:"native-hash",mime:"video/mp4",bytes:1,createdAt:new Date().toISOString(),metadata:{duration:6}};
  const enhanced={...original,id:"cinematic",sha256:"enhanced-hash",metadata:{...original.metadata,cinematicFor:"native",sourceSha256:"native-hash",visualSourceAssetId:"native"}};
  s.addAsset("owner",p.id,original,"/fixture/native");s.addAsset("owner",p.id,enhanced,"/fixture/enhanced");
  p=s.internalUpdate("owner",p.id,p=>{allShots(p)[0].takes=[{id:"take",version:1,status:"accepted",assetId:"native"} as never];p.shots[id].approvedTakeId="take";p.timeline.clips=[{id:"clip",shotId:id,assetId:"native",in:0,out:6,volume:1,transition:"cut",transitionSeconds:0}];});
  const before=structuredClone(p.plan);
  expect(()=>s.mutate("stranger",p.id,p.revision,{type:"audio.select",shotId:id,sourceId:"native",assetId:"cinematic"})).toThrow();
  p=s.mutate("owner",p.id,p.revision,{type:"audio.select",shotId:id,sourceId:"native",assetId:"cinematic"});
  expect(p.plan).toEqual(before);expect(p.timeline.clips[0].assetId).toBe("cinematic");expect(p.shots[id].approvedTakeId).toBe("take");
  expect(approvedSequence(p,s.assets("owner",p.id),[id]).clips[0].assetId).toBe("cinematic");
  p=s.mutate("owner",p.id,p.revision,{type:"audio.select",shotId:id,sourceId:"native",assetId:"native"});
  expect(selectedAudioAsset(p.shots[id],"native")).toBe("native");expect(p.timeline.clips[0].assetId).toBe("native");expect(s.assets("owner",p.id)).toHaveLength(2);
  const unrelated={...enhanced,id:"other",metadata:{...enhanced.metadata,cinematicFor:"another"}};s.addAsset("owner",p.id,unrelated,"/fixture/unrelated");
  expect(()=>s.mutate("owner",p.id,p.revision,{type:"audio.select",shotId:id,sourceId:"native",assetId:"other"})).toThrow(/another video/);
 });
 it("updates an already finished video's soundtrack together with the take and restores both non-destructively",()=>{
  let {p,id}=fixture();
  const base={projectId:p.id,name:"Fixture",kind:"video" as const,mime:"video/mp4",bytes:1,createdAt:new Date().toISOString()};
  const native={...base,id:"raw",sha256:"raw-hash",metadata:{duration:6}},final={...base,id:"final",sha256:"final-hash",metadata:{duration:6,sourceTakeId:"take"}};
  const enhanced={...base,id:"enhanced",sha256:"enhanced-hash",metadata:{duration:6,cinematicFor:"raw",sourceSha256:"raw-hash",visualSourceAssetId:"raw",cinematicFinalSourceId:"final",cinematicFinalVariantId:"final-cinematic"}};
  const companion={...base,id:"final-cinematic",sha256:"final-cinematic-hash",metadata:{duration:6,cinematicFor:"final",sourceSha256:"final-hash",visualSourceAssetId:"final",inheritedAudioAssetId:"enhanced"}};
  for(const a of [native,final,enhanced,companion])s.addAsset("owner",p.id,a,"/fixture/"+a.id);
  p=s.internalUpdate("owner",p.id,p=>{allShots(p)[0].takes=[{id:"take",version:1,status:"accepted",assetId:"raw"} as never];p.shots[id].approvedTakeId="take";p.shots[id].finalAssetId="final";p.timeline.clips=[{id:"finished-clip",shotId:id,assetId:"final",in:0,out:6,volume:1,transition:"cut",transitionSeconds:0}];});
  p=s.mutate("owner",p.id,p.revision,{type:"audio.select",shotId:id,sourceId:"raw",assetId:"enhanced"});
  expect(p.timeline.clips[0].assetId).toBe("final-cinematic");expect(p.shots[id].audioSelections?.raw).toBe("enhanced");expect(p.shots[id].finalAssetId).toBe("final");
  expect(approvedSequence(p,s.assets("owner",p.id),[id]).clips[0].assetId).toBe("final-cinematic");
  p=s.mutate("owner",p.id,p.revision,{type:"audio.select",shotId:id,sourceId:"raw",assetId:"raw"});
  expect(p.timeline.clips[0].assetId).toBe("final");expect(s.assets("owner",p.id)).toHaveLength(4);
 });
});
