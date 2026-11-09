import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { coffeeStory } from "../fixtures/production-coffee-story";
import { cameraStory } from "../fixtures/production-camera-story";
import { assertStoryComplete, readStoryPreview, storyDuration, timedSegments, previewFromPlan } from "@/lib/productionStudio/storyPreview";
import { createStudioStore } from "@/lib/productionStudio/store";
import { allShots } from "@/lib/productionStudio/model";
import { normalizeStoryProductionPlan } from "@/lib/storyCreator/productionPlan";
const mocks = vi.hoisted(() => ({ create: vi.fn(), saved: vi.fn(), current: vi.fn(() => null) }));
vi.mock("@/lib/openai/provider", () => ({ createOpenAIText: mocks.create, createOpenAITextStream: async (args: unknown) => {
  const result = await mocks.create(args);
  return (async function* () { yield { type: "done", text: result.text, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } }; })();
}, openAIEnabled: () => true, openAIModels: () => ({ story: "existing-configured-model" }) }));
vi.mock("@/lib/storyCreator/store", () => ({ createStoryCreatorProject: () => ({id:"linked-story"}), getStoryProductionPlan: mocks.current, listStoryCreatorProjects: () => [], saveStoryProductionPlan: mocks.saved }));
import { runAssistant, publishStoryPlan } from "@/lib/productionStudio/planning";
const root = fs.mkdtempSync(path.join(os.tmpdir(), "studio-story-")), store = createStudioStore(root);
afterAll(() => { store.db.close(); fs.rmSync(root, {recursive:true,force:true}); });
beforeEach(() => { mocks.create.mockReset(); mocks.saved.mockReset(); mocks.current.mockReturnValue(null); });
function seed() {
  let p = store.create("alice", "Coffee shop");
  p = store.mutate("alice", p.id, p.revision, {type:"brief",patch:{description:"A brave woman stops a cafe robbery",clipName:"Coffee shop short",targetSeconds:60}});
  return p;
}
async function propose(p: ReturnType<typeof seed>, story = coffeeStory(), message = "Plan a 60-second coffee shop film") {
  mocks.create.mockResolvedValue({text:JSON.stringify({message:"A complete timed story, ready for your review.",story:cameraStory(story)})});
  await runAssistant(store,"alice",p.id,p,message,true);
  return store.get("alice",p.id);
}
function accept(p: ReturnType<typeof seed>) { return store.mutate("alice",p.id,p.revision,{type:"story.accept",messageId:p.assistant.at(-1)!.id}); }
describe("Production Plan single-source story and approvals", () => {
  it("keeps the saved story and conversation untouched when the provider aborts", async () => {
    const p = seed(); mocks.create.mockRejectedValue(new Error("Request was aborted."));
    await expect(runAssistant(store,"alice",p.id,p,"Plan",true)).rejects.toThrow("before a complete story arrived");
    expect(store.get("alice",p.id)).toEqual(p);
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });
  it("validates exact 60-second variable timing and derives contiguous ranges", () => {
    const s = readStoryPreview(coffeeStory(),true), ranges = timedSegments(s);
    expect(storyDuration(s)).toBe(60); expect(ranges.map(r=>[r.start,r.end])).toEqual([[0,8],[8,15],[15,19],[19,32],[32,44],[44,60]]);
    const bad = coffeeStory(); bad.segments[0].durationSeconds++; expect(()=>assertStoryComplete(bad)).toThrow("61 seconds");
    bad.segments[0].durationSeconds=2; expect(()=>readStoryPreview(bad)).toThrow("Dialogue timing");
  });
  it("generates narrative and details in one schema-backed operation, never auto-applies or generates media", async () => {
    const initial=seed(), p=await propose(initial);
    expect(p.plan).toEqual(initial.plan); expect(p.assistant.at(-1)!.storySuggestion!.segments[0].lighting).toContain("morning");
    expect(mocks.create).toHaveBeenCalledTimes(1); expect(mocks.create.mock.calls[0][0]).toMatchObject({model:"existing-configured-model",responseSchema:{name:"production_timed_story"},maxRetries:0});
    const draft=accept(p); expect(draft.plan.status).toBe("draft"); expect(draft.plan.storyPreview!.segments[0].narrative).toBe(coffeeStory().segments[0].narrative);
    const approved=store.mutate("alice",draft.id,draft.revision,{type:"story.approve"});
    expect(approved.plan.status).toBe("approved"); expect(store.jobs("alice",approved.id)).toEqual([]);
    expect(approved.plan.acts[0].scenes).toHaveLength(2); // Five beats share one physical scene.
    expect(allShots(approved).every(s=>[5,10].includes(s.requestedDurationSeconds))).toBe(true);
    expect(allShots(approved).reduce((n,s)=>n+s.plannedDurationSeconds!,0)).toBe(60);
    expect(approved.plan.acts[0].scenes[0].dialogue[0]).toMatchObject({speaker:"Maya",startSeconds:1,endSeconds:4});
    expect(approved.plan.acts[0].scenes[0].characters).toContain("Maya");
  });
  it("conversational night revisions update narrative, lighting, continuity and derived data after acceptance", async () => {
    let p=accept(await propose(seed())); p=store.mutate("alice",p.id,p.revision,{type:"story.approve"}); const before=p.plan;
    const next=await propose(p,coffeeStory(true),"Change this to nighttime"); expect(next.plan).toEqual(before);
    expect(JSON.parse(mocks.create.mock.calls.at(-1)![0].input).conversation.length).toBeGreaterThan(0);
    const saved=accept(next); expect(saved.plan.status).toBe("draft"); expect(saved.planningReview).toContain("Review");
    expect(saved.plan.storyPreview!.segments.every(s=>s.timeOfDay==="Night" && s.narrative.includes("night") && s.lighting.includes("lamps") && s.continuity[1].includes("nighttime"))).toBe(true);
    expect(saved.plan.acts[0].scenes[0]).toMatchObject({timeOfDay:"Night",lighting:"Warm practical lamps and cool streetlight"});
    expect(store.revisionProject("alice",p.id,p.revision).plan).toEqual(before);
  });
  it("rejects incomplete/unsynchronized AI plans without mutating the current story", async () => {
    const p=accept(await propose(seed())); const bad=coffeeStory(); bad.segments[0].timeOfDay="Night";
    mocks.create.mockResolvedValue({text:JSON.stringify({message:"Night",story:bad})});
    await expect(runAssistant(store,"alice",p.id,p,"Night",true)).rejects.toThrow("inconsistent"); expect(store.get("alice",p.id).plan).toEqual(p.plan);
    mocks.create.mockResolvedValue({text:'{"acts":[]}'}); await expect(runAssistant(store,"alice",p.id,p,"Plan",true)).rejects.toThrow("incomplete");
  });
  it("guards stale proposals, rejected changes and cross-owner history", async () => {
    let p=await propose(seed()); const original=p.plan;
    p=store.mutate("alice",p.id,p.revision,{type:"brief",patch:{atmosphere:"Noir"}});
    expect(()=>accept(p)).toThrow("story changed");
    p=store.mutate("alice",p.id,p.revision,{type:"story.reject",messageId:p.assistant.at(-1)!.id}); expect(p.plan).toEqual(original);
    expect(()=>store.revisionProject("bob",p.id,1)).toThrow("not found");
  });
  it("manual scene saving is atomic and approval blocks partial timing", () => {
    let p=seed(); const segment=coffeeStory().segments[0];
    expect(()=>store.mutate("alice",p.id,p.revision,{type:"story.segment.save",segment})).toThrow("Review");
    p=store.mutate("alice",p.id,p.revision,{type:"story.segment.save",segment,reviewed:true});
    expect(p.plan.storyPreview!.segments).toHaveLength(1); expect(p.plan.acts[0].scenes[0].action).toBe(segment.narrative);
    expect(()=>store.mutate("alice",p.id,p.revision,{type:"story.approve"})).toThrow("totals 8");
    const id=p.plan.storyPreview!.segments[0].id;
    p=store.mutate("alice",p.id,p.revision,{type:"story.segment.save",segment:{...segment,narrative:"Edited together",durationSeconds:60},reviewed:true});
    expect(p.plan.storyPreview!.segments).toHaveLength(1); expect(p.plan.storyPreview!.segments[0].id).toBe(id);
    p=store.mutate("alice",p.id,p.revision,{type:"story.approve"}); expect(p.plan.status).toBe("approved"); expect(store.jobs("alice",p.id)).toEqual([]);
  });
  it("preserves approved takes and exact narrative across recovery without reverting cast or timeline", async () => {
    let p=accept(await propose(seed())); p=store.mutate("alice",p.id,p.revision,{type:"story.approve"}); const revision=p.revision;
    const shotId=allShots(p)[0].id;
    p=store.internalUpdate("alice",p.id,q=>{allShots(q)[0].takes=[{id:"take",version:1,status:"accepted",assetId:"asset",generationJobId:null,productionId:q.id,productionSceneId:null,previewUrl:null,createdAt:1}];q.characterVoices={maya:"pinned-voice"};q.timeline.titles.push({id:"caption",text:"Keep edit",start:0,end:1,position:"bottom"});});
    p=accept(await propose(p,coffeeStory(true),"Night"));
    p=store.mutate("alice",p.id,p.revision,{type:"story.restore",revision});
    expect(p.characterVoices).toEqual({maya:"pinned-voice"}); expect(p.timeline.titles[0].text).toBe("Keep edit");
    expect(allShots(p).find(s=>s.id===shotId)!.takes[0].id).toBe("take");
    expect(p.plan.storyPreview!.segments[0].narrative).toBe(coffeeStory().segments[0].narrative);
  });
  it("retains narrative, audio and beat-to-shot timing through Story Creator normalization", async () => {
    let p=accept(await propose(seed())); expect(()=>publishStoryPlan(store,"alice",p.id,null)).toThrow("Approve");
    p=store.mutate("alice",p.id,p.revision,{type:"story.approve"});
    mocks.saved.mockImplementation(({plan})=>({version:1,plan:normalizeStoryProductionPlan(plan,"linked-story")}));
    publishStoryPlan(store,"alice",p.id,null,p.revision);
    const plan=mocks.saved.mock.results[0].value.plan;
    expect(previewFromPlan(plan)).toEqual(p.plan.storyPreview); expect(plan.acts[0].scenes[0].music).toContain("piano");
    expect(allShots({plan})[0].plannedDurationSeconds).toBe(3);
  });
  it("imports a canonical story without trusting divergent derived metadata or losing retired takes", async () => {
    let p=accept(await propose(seed()));
    const oldId=allShots(p)[0].id;
    p=store.internalUpdate("alice",p.id,q=>{allShots(q)[0].takes=[{id:"approved-old",version:1,status:"accepted",assetId:"asset",generationJobId:null,productionId:q.id,productionSceneId:null,previewUrl:null,createdAt:1}];});
    const incoming=structuredClone(p.plan);incoming.storyPreview=coffeeStory(true);
    incoming.storyPreview.segments[0].id="replacement-beat";
    p=store.mutate("alice",p.id,p.revision,{type:"plan.replace",plan:incoming});
    expect(p.plan.acts[0].scenes[0].lighting).toContain("lamps");
    expect(p.retiredPlanShots!.find(s=>s.id===oldId)!.takes[0].id).toBe("approved-old");
    expect(p.plan.status).toBe("draft");expect(store.jobs("alice",p.id)).toEqual([]);
  });
  it("projects legacy saved details without inventing placeholders", async () => {
    const p=accept(await propose(seed())), plan=structuredClone(p.plan);delete plan.storyPreview;
    const preview=previewFromPlan(plan)!;
    expect(preview.segments[0].lighting).toContain("morning");
    expect(preview.segments[0].music).toContain("piano");
    expect(preview.segments[0].soundEffects).toContain("Door bell");
  });
  it("rejects stale scene drafts even when the client has refreshed the project revision", async () => {
    let p=accept(await propose(seed()));const baseSegment=structuredClone(p.plan.storyPreview!.segments[0]);
    p=store.mutate("alice",p.id,p.revision,{type:"story.segment.save",segment:{...baseSegment,narrative:"Another device changed this scene."},baseSegment,reviewed:true});
    expect(()=>store.mutate("alice",p.id,p.revision,{type:"story.segment.save",segment:{...baseSegment,narrative:"My offline draft"},baseSegment,reviewed:true})).toThrow("changed elsewhere");
    const latest=p.plan.storyPreview!.segments[0];
    p=store.mutate("alice",p.id,p.revision,{type:"story.segment.save",segment:{...baseSegment,narrative:"My reviewed draft"},baseSegment:latest,reviewed:true});
    expect(p.plan.storyPreview!.segments[0].narrative).toBe("My reviewed draft");
  });
});
