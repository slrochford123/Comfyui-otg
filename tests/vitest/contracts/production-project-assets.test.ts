import {afterAll,beforeEach,describe,it,expect,vi} from "vitest";
import fs from "node:fs";import os from "node:os";import path from "node:path";
import {coffeeStory} from "../fixtures/production-coffee-story";
import {createStudioStore} from "@/lib/productionStudio/store";
import {manifestFromAnalysis} from "@/lib/productionStudio/createManifest";
import type {Asset,Operation,Project} from "@/lib/productionStudio/model";
const provider=vi.hoisted(()=>({create:vi.fn()}));
vi.mock("@/lib/openai/provider",()=>({openAIEnabled:()=>true,openAIModels:()=>({story:"qualified-model"}),createOpenAITextStream:async(input:unknown)=>{const text=await provider.create(input);return(async function*(){yield{type:"done",text,usage:{inputTokens:1,outputTokens:1,totalTokens:2}};})();}}));
import {runCreateAssistant} from "@/lib/productionStudio/createAssistant";
const root=fs.mkdtempSync(path.join(os.tmpdir(),"project-assets-")),s=createStudioStore(root);
afterAll(()=>{s.db.close();fs.rmSync(root,{recursive:true,force:true});});beforeEach(()=>provider.create.mockReset());
const inventory=()=>({items:[{kind:"character",name:"Maya",role:"main",description:"Blue coat",prompt:"Maya in a blue coat",sourceSegmentIds:["beat-1"],continuity:[],evidence:"Maya",optional:false,question:""},{kind:"environment",name:"Cafe",role:"location",description:"Morning cafe",prompt:"Empty cafe",sourceSegmentIds:["beat-1"],continuity:[],evidence:"Cafe interior",optional:false,question:""}]});
function seed(){return s.internalUpdate("alice",s.create("alice","Coffee").id,p=>{p.plan.storyPreview=coffeeStory();p.plan.status="approved";p.creation=manifestFromAnalysis(p,inventory());});}
const update=(p:Project,op:Operation)=>s.mutate("alice",p.id,p.revision,op);
const add=(id="manual-mother-natural-0001",name="Mother — natural")=>({type:"create.add",itemId:id,name,kind:"character",description:"Adult woman with dark hair and a green dress",speaking:true});
function media(p:Project,id:string,kind:Asset["kind"]="image",metadata:Record<string,unknown>={}){const file=path.join(root,id);fs.writeFileSync(file,id);s.addAsset("alice",p.id,{id,projectId:p.id,name:id,kind,mime:kind==="audio"?"audio/wav":"image/png",sha256:id,bytes:id.length,createdAt:"",metadata},file);}
describe("Owner-added and recoverably deleted project assets",()=>{
  it("adds distinct natural/ghostly characters, opens guided creation, preserves story, and never starts jobs",()=>{
    let p=seed();const story=structuredClone(p.plan),old=p.revision;p=update(p,add());p=update(p,add("manual-mother-ghostly-0001","Mother — ghostly"));
    expect(p.creation!.items.slice(-2).map(i=>i.name)).toEqual(["Mother — natural","Mother — ghostly"]);expect(p.creation!.activeItemId).toBe("manual-mother-ghostly-0001");expect(p.plan).toEqual(story);expect(s.revisionProject("alice",p.id,old).creation!.items).toHaveLength(2);expect(s.jobs("alice",p.id)).toEqual([]);
    expect(s.get("alice",p.id).creation).toEqual(p.creation);
    expect(()=>s.mutate("alice",p.id,old,add())).toThrow("changed elsewhere");expect(()=>s.get("bob",p.id)).toThrow("not found");
  });
  it("accepts missing details and a source image only as an unapproved candidate; validates type, references and duplicate names",()=>{
    let p=seed();media(p,"natural-image");p=update(p,{...add(),description:"",assetId:"natural-image"});const item=p.creation!.items.at(-1)!;
    expect(item).toMatchObject({origin:"manual",candidateIds:["natural-image"],step:"appearance",status:"todo"});expect(item.assetId).toBeUndefined();expect(item.missingDetails).toHaveLength(1);expect(p.bindings).toEqual([]);
    p=update(p,add());expect(p.creation!.items.filter(i=>i.origin==="manual")).toHaveLength(1);
    expect(()=>update(p,add("manual-another-mother-0001"))).toThrow("distinct name");expect(()=>update(p,{...add("manual-other-asset-00000001","Another reference"),kind:"bad"})).toThrow("asset type");expect(()=>update(p,{...add("manual-other-asset-00000001","Another reference"),sourceSegmentIds:["missing"]})).toThrow("approved story");expect(()=>update(p,{...add("manual-other-asset-00000001","Another reference"),assetId:"other-owner-asset"})).toThrow("not found");
  });
  it("deletes with confirmation, preserves all media and timelines, unpins only this item's bindings, and restores",()=>{
    let p=seed();p=update(p,add());const id=p.creation!.activeItemId!;media(p,"face");media(p,"voice","audio",{duration:3});media(p,"bundle","refmod",{libraryName:"mother"});
    for(const op of [{type:"create.appearance",assetId:"face"},{type:"create.voice",assetId:"voice"},{type:"create.refmod",assetId:"bundle"},{type:"create.save"}])p=update(p,{...op,itemId:id});
    const saved=structuredClone(p),assets=s.assets("alice",p.id);
    expect(()=>update(p,{type:"create.delete",itemId:id})).toThrow("Confirm");p=update(p,{type:"create.delete",itemId:id,confirmed:true});
    expect(p.creation!.items.some(i=>i.id===id)).toBe(false);expect(p.creation!.retiredItems[0]).toMatchObject({id,assetId:"face",voiceId:"voice",refModId:"bundle"});expect(p.creation!.retiredItems[0].removedAt).toBeTruthy();expect(p.bindings).toEqual([]);expect(p.timeline).toEqual(saved.timeline);expect(p.plan).toEqual(saved.plan);
    expect(s.assets("alice",p.id)).toEqual(assets);expect(fs.readFileSync(s.asset("alice",p.id,"face").path,"utf8")).toBe("face");
    expect(s.revisionProject("alice",p.id,saved.revision).creation!.items).toEqual(saved.creation!.items);
    p=update(p,{type:"create.restore",itemId:id});expect(p.creation!.items.at(-1)).toEqual(saved.creation!.items.at(-1));expect(p.bindings).toEqual(saved.bindings);expect(p.creation!.retiredItems).toEqual([]);
  });
  it("does not remove a shared asset binding or recreate deleted story requirements during reanalysis",()=>{
    let p=seed();p=update(p,add());media(p,"shared-face");const mother=p.creation!.activeItemId!,maya=p.creation!.items.find(i=>i.name==="Maya")!.id;
    for(const id of [mother,maya])for(const op of [{type:"create.appearance",assetId:"shared-face"},{type:"create.voice"},{type:"create.save"}])p=update(p,{...op,itemId:id});
    const bindings=structuredClone(p.bindings);p=update(p,{type:"create.delete",itemId:maya,confirmed:true});expect(p.bindings).toEqual(bindings);
    p=s.internalUpdate("alice",p.id,p=>{p.plan.storyPreview!.version++;p.creation=manifestFromAnalysis(p,inventory());});
    expect(p.creation!.items.some(i=>i.id===maya)).toBe(false);expect(p.creation!.items.some(i=>i.id===mother)).toBe(true);expect(p.creation!.retiredItems.some(i=>i.id===maya&&i.removedAt)).toBe(true);
    p=update(p,{type:"create.delete",itemId:mother,confirmed:true});expect(p.bindings).toEqual([]);p=s.internalUpdate("alice",p.id,p=>{p.creation=manifestFromAnalysis(p,inventory());});expect(p.creation!.retiredItems.filter(i=>i.removedAt)).toHaveLength(2);
    p=update(p,{type:"create.restore",itemId:maya});expect(p.bindings.map(b=>b.assetId)).toEqual(["shared-face"]);p=update(p,{type:"create.restore",itemId:mother});expect(p.bindings).toHaveLength(1);
  });
  it("blocks deletion while jobs are queued and prevents stale dispatch after deletion",()=>{
    let p=seed();p=update(p,add());const id=p.creation!.activeItemId!,j=s.enqueue("alice",p.id,"asset-assistant",{requirementId:id},"asset-assistant-0001");
    expect(()=>update(p,{type:"create.delete",itemId:id,confirmed:true})).toThrow("active request");
    s.updateJob("alice",j.id,{status:"canceled"});p=update(p,{type:"create.delete",itemId:id,confirmed:true});
    expect(()=>s.enqueue("alice",p.id,"asset-image",{requirementId:id},"asset-image-0002")).toThrow("removed");
  });
  it("AI helps a manual addition through a reviewable proposal and preserves the approved story",async()=>{
    let p=seed();p=update(p,{...add(),description:""});const id=p.creation!.activeItemId!,story=structuredClone(p.plan);
    provider.create.mockResolvedValue(JSON.stringify({message:"Suggested a natural appearance for review.",name:"Mother — natural",prompt:"One adult woman with dark hair and a green dress",voiceDirection:"Warm calm voice",action:"revise",targetItemId:""}));
    await runCreateAssistant(s,"alice",p,id,"Suggest her natural appearance",()=>false,()=>{});p=s.get("alice",p.id);
    expect(provider.create.mock.calls[0][0].instructions).toContain("OWNER-ADDED ASSETS");expect(p.creation!.items.at(-1)!.description).toBe("");
    p=update(p,{type:"create.proposal",messageId:p.assistant.at(-1)!.id,accept:true});expect(p.creation!.items.at(-1)!.description).toContain("green dress");expect(p.plan).toEqual(story);expect(p.bindings).toEqual([]);expect(s.jobs("alice",p.id)).toEqual([]);
  });
});
