import {afterAll,describe,it,expect,vi} from "vitest";
import fs from "node:fs";import os from "node:os";import path from "node:path";
import {cameraStory} from "../fixtures/production-camera-story";
import {createStudioStore} from "@/lib/productionStudio/store";
import {installStory} from "@/lib/productionStudio/storyPlanning";
import {allShots,DEFAULT_SHOT} from "@/lib/productionStudio/model";
import {directionBrief,directionKey,directionProblems,directionApproved,saveDirection} from "@/lib/productionStudio/shotDirection";
import {timingOptions,moveDialogueProposal} from "@/lib/productionStudio/directionTiming";
import {takeReviewSeconds} from "@/lib/productionStudio/shotPolicy";
const root=fs.mkdtempSync(path.join(os.tmpdir(),"director-repair-")),s=createStudioStore(root);
afterAll(()=>{s.db.close();fs.rmSync(root,{recursive:true,force:true});});
function fixture(){
 let p=s.create("owner","whos there fixture");p=s.internalUpdate("owner",p.id,p=>{
  installStory(p,cameraStory());p.plan.status="approved";
  const [shot,next]=allShots(p);shot.plannedDurationSeconds=6;shot.requestedDurationSeconds=10;next.plannedDurationSeconds=4;next.requestedDurationSeconds=5;
  shot.description="Ava enters from the hallway while talking on her phone.";
  shot.dialogue=[{speaker:"Mia",line:"He liked your story and then asked Kayla to homecoming?",delivery:"Phone",startSeconds:.6,endSeconds:4.7},{speaker:"Ava",line:"Exactly. And now she's asking if I'm mad.",delivery:"Amused",startSeconds:5.1,endSeconds:6}];
  next.dialogue=[{...shot.dialogue[1],startSeconds:0,endSeconds:2.5},{speaker:"Mia",line:"You're definitely mad.",delivery:"Phone",startSeconds:3,endSeconds:4}];
  p.shots[shot.id]={...DEFAULT_SHOT,storyboardId:"existing-image",storyboardApproved:true,approvedTakeId:"existing-take"};
  const b=directionBrief(p,shot.id);Object.assign(b,{startingState:"Ava stands in the hallway.",action:shot.description,endState:"Ava reaches the vanity.",onScreen:["Ava"],offScreen:[{name:"Mia",channel:"phone"}],dialogue:shot.dialogue.map(d=>({...d,language:"English",channel:d.speaker==="Mia"?"phone":"on-screen"}))});saveDirection(p,shot.id,b);
  shot.takes.push({id:"existing-take",version:1,status:"accepted",assetId:"saved-video",generationJobId:"existing-job",productionId:p.id,productionSceneId:null,previewUrl:null,createdAt:1});
 });return {p,id:allShots(p)[0].id,nextId:allShots(p)[1].id};
}
describe("Director atomic timing corrections",()=>{
 it("reproduces 6s/0.9s failure and proposes 9s without changing any saved data or words",()=>{
  const {p,id}=fixture(),before=structuredClone(p),b=directionBrief(p,id),o=timingOptions(b);
  expect(directionProblems(p,id).join()).toContain("0.9s");expect(o.keep).toBeNull();expect(o.extend?.duration).toBe(9);expect(o.extend?.dialogue[1]).toMatchObject({startSeconds:5.1,endSeconds:8});expect(o.extend?.dialogue.map(d=>d.line)).toEqual(b.dialogue.map(d=>d.line));expect(s.get("owner",p.id)).toEqual(before);
 });
 it("atomically updates planned/native duration, dialogue, brief, totals and approval only with explicit duration consent",()=>{
  let {p,id}=fixture();const before=structuredClone(p),extend=timingOptions(directionBrief(p,id)).extend!;
  const op={type:"shot.direction.timing",shotId:id,basedOnKey:directionKey(p,id),choice:"extend"};
  expect(()=>s.mutate("owner",p.id,p.revision,op)).toThrow("Choose Extend");expect(s.get("owner",p.id)).toEqual(before);
  p=s.mutate("owner",p.id,p.revision,{...op,durationConsent:9});const shot=allShots(p)[0];
  expect(shot.plannedDurationSeconds).toBe(9);expect(shot.requestedDurationSeconds).toBe(10);expect(shot.dialogue[1].endSeconds).toBe(8);expect(directionBrief(p,id)).toEqual(extend);expect(directionProblems(p,id)).toEqual([]);
  expect(p.shots[id].storyboardId).toBe(before.shots[id].storyboardId);expect(shot.takes).toEqual(allShots(before)[0].takes);expect(p.shots[id].approvedTakeId).toBe("existing-take");expect(p.plan.storyPreview).toEqual(before.plan.storyPreview);
  p=s.mutate("owner",p.id,p.revision,{type:"shot.direction.approve",shotId:id});expect(directionApproved(p,id)).toBe(true);
 });
 it("never labels an invalid recommendation applied and rolls back every field",()=>{
  let {p,id}=fixture();p=s.internalUpdate("owner",p.id,p=>{p.assistant.push({id:"proposal",role:"assistant",text:"I recommend nine seconds",createdAt:new Date().toISOString(),directionSuggestion:{shotId:id,brief:directionBrief(p,id),basedOnKey:directionKey(p,id),changes:["Recommend nine seconds"],imageChange:""}});});
  const before=structuredClone(p);expect(()=>s.mutate("owner",p.id,p.revision,{type:"shot.direction.accept",messageId:"proposal"})).toThrow("0.9s");expect(s.get("owner",p.id)).toEqual(before);expect(s.get("owner",p.id).assistant.at(-1)?.decision).toBeUndefined();
 });
 it("applies a concrete AI 9s proposal, records Applied only after success, rejects stale acceptance",()=>{
  let {p,id}=fixture();p=s.internalUpdate("owner",p.id,p=>{p.assistant.push({id:"proposal",role:"assistant",text:"Propose nine seconds",createdAt:new Date().toISOString(),directionSuggestion:{shotId:id,brief:timingOptions(directionBrief(p,id)).extend!,basedOnKey:directionKey(p,id),changes:["9 seconds"],imageChange:"Use visual references or replace the opening image."}});});
  expect(()=>s.mutate("owner",p.id,p.revision,{type:"shot.direction.accept",messageId:"proposal"})).toThrow("Choose Extend");
  p=s.mutate("owner",p.id,p.revision,{type:"shot.direction.accept",messageId:"proposal",durationConsent:9});expect(p.assistant.at(-1)).toMatchObject({decision:"accepted",appliedDirection:{duration:9,revision:p.revision}});expect(directionBrief(p,id).duration).toBe(9);
  expect(()=>s.mutate("owner",p.id,p.revision-1,{type:"shot.direction.accept",messageId:"proposal",durationConsent:9})).toThrow("changed elsewhere");
 });
 it("moves the duplicated exact reply only with explicit two-shot consent, avoids duplication and keeps six seconds",()=>{
  let {p,id,nextId}=fixture();const preview=moveDialogueProposal(p,id),before=structuredClone(p);
  expect(preview.alreadyInNext).toBe(true);expect(preview.source.dialogue).toHaveLength(1);expect(preview.target.dialogue).toHaveLength(2);expect(preview.target.duration).toBe(5);
  const op={type:"shot.direction.timing",shotId:id,basedOnKey:directionKey(p,id),choice:"move",targetId:nextId,targetKey:preview.targetKey};
  expect(()=>s.mutate("owner",p.id,p.revision,op)).toThrow("Explicitly approve");expect(s.get("owner",p.id)).toEqual(before);
  p=s.mutate("owner",p.id,p.revision,{...op,approveBothShots:true});expect(allShots(p)[0].plannedDurationSeconds).toBe(6);expect(directionProblems(p,id)).toEqual([]);expect(allShots(p)[1].dialogue.filter(d=>d.line===preview.lines[0].line)).toHaveLength(1);expect(allShots(p)[1].plannedDurationSeconds).toBe(5);expect(directionApproved(p,nextId)).toBe(false);expect(allShots(p)[0].takes).toEqual(allShots(before)[0].takes);
 });
 it("rejects a move if the next shot changed since the preview",()=>{let {p,id,nextId}=fixture();const preview=moveDialogueProposal(p,id);p=s.mutate("owner",p.id,p.revision,{type:"shot.patch",shotId:nextId,patch:{description:"A different action"}});const before=structuredClone(p);expect(()=>s.mutate("owner",p.id,p.revision,{type:"shot.direction.timing",shotId:id,basedOnKey:directionKey(p,id),choice:"move",targetId:nextId,targetKey:preview.targetKey,approveBothShots:true})).toThrow("next shot changed");expect(s.get("owner",p.id)).toEqual(before);});
 it("rejects eleven seconds and retains source review length despite a different draft",()=>{const {p,id}=fixture(),b=directionBrief(p,id);expect(()=>s.mutate("owner",p.id,p.revision,{type:"shot.direction.approve",shotId:id,brief:{...b,duration:11},durationConsent:11})).toThrow("1–10");expect(takeReviewSeconds({plannedDuration:6},9)).toBe(6);expect(takeReviewSeconds({trimIn:0,trimOut:6},9)).toBe(6);});
});
