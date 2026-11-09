import {afterAll,describe,it,expect} from "vitest";
import fs from "node:fs";import os from "node:os";import path from "node:path";
import {createStudioStore} from "@/lib/productionStudio/store";
import {allShots,DEFAULT_SHOT,type Asset} from "@/lib/productionStudio/model";
import {cameraStory} from "../fixtures/production-camera-story";
import {installStory,planningKey} from "@/lib/productionStudio/storyPlanning";
import {readStoryPreview} from "@/lib/productionStudio/storyPreview";
import {nativeShotSeconds,assertShotSafe} from "@/lib/productionStudio/shotPolicy";
import {filmRuntime,filmContext} from "@/lib/productionStudio/filmStructure";
import {storyboardPrompt,continuitySource,approvedSequence} from "@/lib/productionStudio/shotDirector";
const root=fs.mkdtempSync(path.join(os.tmpdir(),"filmmaking-")),s=createStudioStore(root);
afterAll(()=>{s.db.close();fs.rmSync(root,{recursive:true,force:true});});
function seed(){const p=s.create("owner","Coffee shop");return s.internalUpdate("owner",p.id,p=>installStory(p,cameraStory()));}
function mutate(p:ReturnType<typeof seed>,op:Record<string,unknown>&{type:string}){return s.mutate("owner",p.id,p.revision,op);}
describe("Professional shots and long-form planning",()=>{
 it("keeps target optional and produces 16 distinct camera shots across two scenes totaling 60 seconds",()=>{const p=seed();expect(p.brief.durationOptional).toBe(true);expect(allShots(p)).toHaveLength(16);expect(p.plan.acts[0].scenes).toHaveLength(2);expect(filmRuntime(p)).toBe(60);expect(allShots(p).slice(0,3).map(v=>v.plannedDurationSeconds)).toEqual([3,3,2]);expect(allShots(p).every(v=>assertShotSafe(v)<=10)).toBe(true);});
 it("rejects unsupported lengths at parsing, mutation, queue admission and queue recovery",()=>{let p=seed();const shot=allShots(p)[0];for(const n of [0,.5,10.1,15,NaN])expect(()=>nativeShotSeconds(n)).toThrow("1–10");expect(nativeShotSeconds(3)).toBe(5);expect(nativeShotSeconds(8)).toBe(10);expect(()=>mutate(p,{type:"shot.patch",shotId:shot.id,patch:{plannedDurationSeconds:11}})).toThrow();const bad=cameraStory();bad.segments[0].shots![0].durationSeconds=11;expect(()=>readStoryPreview(bad)).toThrow();shot.requestedDurationSeconds=15 as 10;for(const kind of ["preview","regenerate","finish","storyboard"] as const)expect(()=>s.enqueue("owner",p.id,kind,{snapshot:p,shotId:shot.id},kind+p.id)).toThrow();shot.requestedDurationSeconds=5;const j=s.enqueue("owner",p.id,"preview",{snapshot:p,shotId:shot.id},p.id);shot.requestedDurationSeconds=15 as 10;s.updateJob("owner",j.id,{input:{snapshot:p,shotId:shot.id}});expect(s.claim()).toBeNull();expect(s.job("owner",j.id).status).toBe("attention");});
 it("preserves shot IDs, take attempts and approved media on repeated approval and later revision",()=>{let p=seed();const id=allShots(p)[0].id;p=s.internalUpdate("owner",p.id,p=>{allShots(p)[0].takes=[{id:"kept",version:1,status:"accepted",assetId:"media",generationJobId:"job",productionId:p.id,productionSceneId:null,previewUrl:null,createdAt:1}];p.shots[id]={...DEFAULT_SHOT,approvedTakeId:"kept",storyboardId:"image",storyboardApproved:true};});p=mutate(p,{type:"story.approve"});expect(allShots(p)[0].id).toBe(id);expect(allShots(p)[0].takes[0].id).toBe("kept");const next=cameraStory();next.segments[0].shots![0].action="Maya sets down her cup";p=s.internalUpdate("owner",p.id,p=>installStory(p,next));expect(allShots(p)[0].takes[0].id).toBe("kept");expect(p.shots[id].storyboardApproved).toBe(false);expect(s.jobs("owner",p.id)).toHaveLength(0);});
 it("develops two sections independently, persists approved recaps and revisits without discarding media",()=>{
  let p=seed();const original=allShots(p).map(x=>x.id);
  const outline={synopsis:"Coffee shop episode",rationale:"Two working sequences",unresolvedQuestions:["What happens after the rescue?"],acts:[{id:"act1",title:"Act One",summary:"The first half",segments:[{id:"section1",title:"Arrival",summary:"Cafe encounter",estimatedSeconds:60},{id:"section2",title:"Aftermath",summary:"Consequences",estimatedSeconds:60}]}]};
  p=s.internalUpdate("owner",p.id,p=>p.assistant.push({id:"outline",role:"assistant",text:"Two sections",createdAt:"now",outlineSuggestion:outline,basedOnPlanKey:planningKey(p)}));
  p=mutate(p,{type:"film.outline.accept",messageId:"outline"});p=mutate(p,{type:"film.segment.select",segmentId:"section1"});p=s.internalUpdate("owner",p.id,p=>installStory(p,cameraStory()));p=mutate(p,{type:"story.approve"});const ids=p.film!.segments.section1.sceneIds,shots=allShots(p).filter(x=>x.id.startsWith("section1--")).map(x=>x.id);expect(shots).toHaveLength(16);
  p=mutate(p,{type:"film.segment.select",segmentId:"section2"});expect(p.plan.storyPreview?.segments).toEqual([]);expect(filmContext(p).approvedRecaps[0].synopsis).toContain("courage");p=s.internalUpdate("owner",p.id,p=>installStory(p,cameraStory()));p=mutate(p,{type:"story.approve"});expect(filmRuntime(p)).toBe(120);expect(p.film!.segments.section1.sceneIds).toEqual(ids);
  p=mutate(p,{type:"film.segment.select",segmentId:"section1"});p=mutate(p,{type:"story.approve"});expect(allShots(p).filter(x=>x.id.startsWith("section1--")).map(x=>x.id)).toEqual(shots);expect(original.every(id=>allShots(p).some(x=>x.id===id))).toBe(true);expect(p.film!.segments.section2.approved).toBe(true);expect(s.revisions("owner",p.id).length).toBeGreaterThan(5);
 });
 it("builds shot-specific prompts and can return to nonadjacent framing with pinned identity context",()=>{const p=seed(),shots=allShots(p);p.shots[shots[4].id]={...DEFAULT_SHOT,continuitySourceShotId:shots[0].id,continuity:"new-angle",continuityNotes:"Cup in right hand; blue coat"};expect(continuitySource(p,shots[4].id)?.shot.id).toBe(shots[0].id);const prompt=storyboardPrompt(p,shots[4].id);expect(prompt).toContain("Maya turns toward");expect(prompt).toContain("Maya holds her cup");expect(prompt).toContain("blue coat");expect(prompt).toContain("new angle");expect(prompt).not.toBe(storyboardPrompt(p,shots[0].id));p.shots[shots[0].id]={...DEFAULT_SHOT,continuitySourceShotId:shots[4].id};expect(()=>continuitySource(p,shots[0].id)).toThrow("earlier");});
 it("makes source-linked trimmed milestone assemblies with transition overlap, leaving originals and timeline untouched",()=>{
  let p=seed();const shots=allShots(p).slice(0,3),assets:Asset[]=[];
  for(const shot of shots){const id=`asset-${shot.id}`,take={id:`take-${shot.id}`,version:1,status:"accepted" as const,assetId:id,generationJobId:null,productionId:p.id,productionSceneId:null,previewUrl:null,createdAt:1};shot.takes.push(take);p.shots[shot.id]={...DEFAULT_SHOT,approvedTakeId:take.id};assets.push({id,projectId:p.id,name:id,kind:"video",sha256:"fixture",mime:"video/mp4",bytes:1,createdAt:"now",metadata:{duration:5,trimOut:shot.plannedDurationSeconds}});}
  const timeline=approvedSequence(p,assets,shots.map(s=>s.id));expect(timeline.clips.map(c=>c.out)).toEqual([3,3,2]);p.timeline=timeline;p.timeline.clips[1].transition="dissolve";p.timeline.clips[1].transitionSeconds=.5;
  const milestone=approvedSequence(p,assets,shots.map(s=>s.id),5);expect(milestone.clips).toHaveLength(2);expect(milestone.clips[1].out).toBe(2.5);expect(p.timeline.clips).toHaveLength(3);expect(shots[0].takes[0].assetId).toBe(assets[0].id);
 });
 it("supports a duration beyond the previous planning cap without auto-generation",()=>{let p=seed();p=mutate(p,{type:"brief",patch:{targetSeconds:100000}});expect(p.brief.targetSeconds).toBe(100000);expect(p.brief.durationOptional).toBe(false);expect(s.jobs("owner",p.id)).toHaveLength(0);});
 it("retains unexpanded scene time when revising covered shots",()=>{
  let p=seed();const story=cameraStory();story.coveragePending=true;delete story.segments[5].shots;
  p=s.internalUpdate("owner",p.id,p=>installStory(p,story));
  const id=allShots(p)[0].id;p=mutate(p,{type:"shot.patch",shotId:id,patch:{plannedDurationSeconds:4}});
  expect(p.plan.acts[0].scenes[1].durationTargetSeconds).toBe(16);
  expect(p.plan.storyPreview!.targetSeconds).toBe(61);expect(p.plan.targetDurationSeconds).toBe(61);
 });
});
