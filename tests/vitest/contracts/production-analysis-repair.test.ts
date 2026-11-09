import {afterAll,beforeEach,describe,it,expect,vi} from "vitest";
import fs from "node:fs";import os from "node:os";import path from "node:path";
import {miaStory,miaInventory} from "../fixtures/production-mia-story";
import {manifestFromAnalysis} from "@/lib/productionStudio/createManifest";
import {needsCreativeDetails,analysisCompletion} from "@/lib/productionStudio/createTypes";
import {createStudioStore} from "@/lib/productionStudio/store";
const mocks=vi.hoisted(()=>({reply:vi.fn()}));
vi.mock("@/lib/openai/provider",()=>({openAIEnabled:()=>true,openAIModels:()=>({story:"mock"}),createOpenAITextStream:async(input:unknown)=>{const text=await mocks.reply(input);return(async function*(){yield{type:"done",text,usage:{inputTokens:1,outputTokens:1,totalTokens:2}};})();}}));
const root=fs.mkdtempSync(path.join(os.tmpdir(),"asset-analysis-repair-"));
vi.stubEnv("OTG_DATA_ROOT",root);vi.stubEnv("OTG_DATA_DIR",root);vi.stubEnv("OTG_STUDIO_WORKER_DISABLED","1");
const {runCreateAssistant}=await import("@/lib/productionStudio/createAssistant");
const {enqueueStudioJob,executeStudioJob}=await import("@/lib/productionStudio/jobs");
const s=createStudioStore(root+"/studio");
afterAll(()=>{s.db.close();vi.unstubAllEnvs();fs.rmSync(root,{recursive:true,force:true});});
beforeEach(()=>{mocks.reply.mockReset();mocks.reply.mockResolvedValue(JSON.stringify(miaInventory()));});
function seed(){let p=s.create("owner","Mia coffee test");return s.internalUpdate("owner",p.id,p=>{p.plan.storyPreview=miaStory();p.plan.status="approved";});}
async function enqueue(p:ReturnType<typeof seed>){return enqueueStudioJob(s,"owner",p.id,{revision:p.revision,kind:"asset-analysis",approved:true,requestKey:crypto.randomUUID()},"");}
describe("Mia asset analysis repair",()=>{
  it("completes with empty/null optional details, grounded role/scenes/voice, and no invented appearance",()=>{
    const p=seed(),raw=miaInventory(),m=manifestFromAnalysis(p,raw),mia=m.items.find(i=>i.name==="Mia")!;
    expect(m.items).toHaveLength(4);expect(mia).toMatchObject({description:"",prompt:"",speaking:true,role:"best friend, phone voice",sourceSegmentIds:["beat-1"],status:"todo"});
    expect(needsCreativeDetails(mia)).toBe(true);expect(analysisCompletion(m.items)).toBe("Completed — Needs Creative Details");
    const optional=raw.items[2] as Record<string,unknown>;delete optional.description;delete optional.prompt;delete optional.continuity;delete optional.question;
    expect(()=>manifestFromAnalysis(p,raw)).not.toThrow();
    optional.description=42;expect(()=>manifestFromAnalysis(p,raw)).toThrow("invalid field");
  });
  it("persists completion before UI progress and supports guided start, description, reload, and no paid duplicate",async()=>{
    let p=seed();const before=structuredClone(p.plan),job=await enqueue(p);
    await executeStudioJob(s,"owner",job);let completed=s.job("owner",job.id);
    expect(completed).toMatchObject({status:"completed",analysisResult:{state:"Completed — Needs Creative Details",sourceRevision:p.revision,itemCount:4}});
    p=s.get("owner",p.id);expect(p.plan).toEqual(before);p=s.mutate("owner",p.id,p.revision,{type:"create.start"});expect(p.creation!.items.find(i=>i.id===p.creation!.activeItemId)?.kind).toBe("environment");
    const mia=p.creation!.items.find(i=>i.name==="Mia")!;
    p=s.mutate("owner",p.id,p.revision,{type:"create.select",itemId:mia.id});p=s.mutate("owner",p.id,p.revision,{type:"create.patch",itemId:mia.id,patch:{prompt:"Short curly hair, green jacket"}});
    const reopened=createStudioStore(root+"/studio");expect(reopened.get("owner",p.id).creation!.items.find(i=>i.name==="Mia")).toMatchObject({prompt:"Short curly hair, green jacket",creativeDetailsResolved:true,missingDetails:[],question:""});reopened.db.close();
    await runCreateAssistant(s,"owner",p,undefined,"Again",()=>false,()=>{});expect(mocks.reply).toHaveBeenCalledTimes(1);expect(s.assets("owner",p.id)).toHaveLength(0);
  });
  it("keeps appearance proposals unapproved until explicitly accepted",async()=>{
    let p=seed();await runCreateAssistant(s,"owner",p,undefined,"Analyze",()=>false,()=>{});p=s.get("owner",p.id);const mia=p.creation!.items.find(i=>i.name==="Mia")!;
    mocks.reply.mockResolvedValue(JSON.stringify({message:"Suggested appearance, not established fact",name:"Mia",prompt:"Curly hair, green jacket",voiceDirection:"",action:"revise",targetItemId:""}));
    await runCreateAssistant(s,"owner",p,mia.id,"Suggest appearance",()=>false,()=>{});p=s.get("owner",p.id);expect(p.creation!.items.find(i=>i.id===mia.id)?.prompt).toBe("");
    p=s.mutate("owner",p.id,p.revision,{type:"create.proposal",messageId:p.assistant.at(-1)!.id,accept:true});expect(p.creation!.items.find(i=>i.id===mia.id)).toMatchObject({creativeDetailsResolved:true,question:"",prompt:"Curly hair, green jacket"});
  });
  it.each(["OpenAI API unavailable","Daily spending limit reached","Request was aborted."])("persists actual failure and retries safely: %s",async message=>{
    const p=seed(),before=structuredClone(p);mocks.reply.mockRejectedValueOnce(new Error(message));const job=await enqueue(p);await executeStudioJob(s,"owner",job);
    const failed=s.job("owner",job.id);expect(failed.status).toBe("failed");expect(failed.message).toContain(message.includes("aborted")?"connection failure":message);expect(s.get("owner",p.id)).toEqual(before);
    const retry=await enqueue(p);await executeStudioJob(s,"owner",retry);expect(s.job("owner",retry.id).status).toBe("completed");expect(s.get("owner",p.id).creation?.items).toHaveLength(4);
  });
  it("rejects incomplete/ungrounded responses without replacing prior results",async()=>{
    let p=seed();await runCreateAssistant(s,"owner",p,undefined,"Analyze",()=>false,()=>{});p=s.get("owner",p.id);
    p=s.internalUpdate("owner",p.id,p=>{p.brief.atmosphere="New mood";});const previous=structuredClone(p.creation);
    for(const response of ['{"items":',JSON.stringify({items:[{...miaInventory().items[0],evidence:"not in this story"}]})]){mocks.reply.mockResolvedValueOnce(response);const job=await enqueue(p);await executeStudioJob(s,"owner",job);expect(s.job("owner",job.id).status).toBe("failed");expect(s.get("owner",p.id).creation).toEqual(previous);}
  });
  it("cancels before and during response, retaining saved story and allowing retry",async()=>{
    const p=seed();let job=await enqueue(p);s.updateJob("owner",job.id,{status:"canceled"});await executeStudioJob(s,"owner",s.job("owner",job.id));expect(mocks.reply).not.toHaveBeenCalled();
    job=await enqueue(p);mocks.reply.mockImplementationOnce(async()=>{s.updateJob("owner",job.id,{status:"canceling"});return JSON.stringify(miaInventory());});await executeStudioJob(s,"owner",job);expect(s.job("owner",job.id).status).toBe("canceled");expect(s.get("owner",p.id).creation).toBeUndefined();
    const retry=await enqueue(p);await executeStudioJob(s,"owner",retry);expect(s.job("owner",retry.id).status).toBe("completed");
  });
  it("rejects a stale queued story before using AI, preserves approved media/candidates on reanalysis",async()=>{
    let p=seed();const job=await enqueue(p);p=s.internalUpdate("owner",p.id,p=>{p.brief.atmosphere="Night";});await executeStudioJob(s,"owner",job);expect(mocks.reply).not.toHaveBeenCalled();expect(s.job("owner",job.id).message).toContain("changed while");
    p=s.internalUpdate("owner",p.id,p=>{p.creation=manifestFromAnalysis(p,miaInventory());const mia=p.creation.items.find(i=>i.name==="Mia")!;Object.assign(mia,{assetId:"approved-image",voiceId:"approved-voice",refModId:"approved-bundle",candidateIds:["candidate-1","approved-image"],referenceIds:["approved-image"],approvedVersions:{"approved-image":"hash"},prompt:"Owner chosen outfit",description:"Owner chosen outfit",creativeDetailsResolved:true,missingDetails:[],question:"",status:"ready"});p.brief.atmosphere="Morning";});
    const old=structuredClone(p.creation!.items.find(i=>i.name==="Mia"));await runCreateAssistant(s,"owner",p,undefined,"Analyze",()=>false,()=>{});const mia=s.get("owner",p.id).creation!.items.find(i=>i.name==="Mia")!;
    expect(mia).toMatchObject({assetId:old!.assetId,voiceId:old!.voiceId,refModId:old!.refModId,candidateIds:old!.candidateIds,approvedVersions:old!.approvedVersions,prompt:"Owner chosen outfit"});
  });
  it("recovers committed analysis after restart without a second response",async()=>{
    const p=seed(),job=await enqueue(p);s.updateJob("owner",job.id,{status:"running"},1);
    s.internalUpdate("owner",p.id,p=>{p.creation=manifestFromAnalysis(p,miaInventory());});expect(s.claim()).toBeNull();expect(s.job("owner",job.id).status).toBe("completed");expect(mocks.reply).not.toHaveBeenCalled();
  });
});
