import {afterAll,beforeEach,describe,it,expect,vi} from "vitest";
import fs from "node:fs";import os from "node:os";import path from "node:path";
import {NextRequest} from "next/server";
import {coffeeStory} from "../fixtures/production-coffee-story";
const auth=vi.hoisted(()=>({owner:"alice",signedIn:true}));
const cpu=vi.hoisted(()=>({call:vi.fn()}));
vi.mock("@/lib/sessionUser",()=>({requireSessionUser:async()=>{if(!auth.signedIn)throw Object.assign(new Error("Sign in"),{status:401});return{ownerKey:auth.owner};}}));
vi.mock("@/lib/storyCreator/cpuClient",()=>({callStoryCpu:cpu.call}));
vi.mock("@/lib/storyCreator/speech",()=>({storySpeechCapabilities:()=>({engines:{paradee:true},transcription:true,maxChars:12000})}));
vi.mock("next/server",async original=>({...await original<typeof import("next/server")>(),after:()=>{}}));
const root=fs.mkdtempSync(path.join(os.tmpdir(),"guided-access-"));
vi.stubEnv("OTG_DATA_ROOT",root);vi.stubEnv("OTG_DATA_DIR",root);vi.stubEnv("OTG_ENV","test");
const {studio}=await import("@/lib/productionStudio/server"),transcribe=await import("@/app/api/production-studio/projects/[id]/transcribe/route"),narration=await import("@/app/api/production-studio/projects/[id]/narration/route"),creation=await import("@/app/api/production-studio/projects/[id]/creation/route");
const {prepareNarration,enqueueNarration,narrationAudio,cancelNarration,getNarration}=await import("@/lib/productionStudio/narration"),{snapshotFile}=await import("@/lib/productionStudio/media"),{validateCreateAssets}=await import("@/lib/productionStudio/createActions");
let p=studio().create("alice","Private story");p=studio().internalUpdate("alice",p.id,p=>{p.plan.storyPreview=coffeeStory();});
const context={params:Promise.resolve({id:p.id})};
function req(value:unknown={},origin="http://studio.test"){return new NextRequest("http://studio.test/api",{method:"POST",headers:{host:"studio.test",origin,"Content-Type":"application/json"},body:JSON.stringify(value)});}
beforeEach(()=>{auth.owner="alice";auth.signedIn=true;vi.stubEnv("OTG_ENV","test");cpu.call.mockReset();});
afterAll(()=>{studio().db.close();vi.unstubAllEnvs();fs.rmSync(root,{recursive:true,force:true});});
describe("Guided creation private services",()=>{
  it("protects every new route against unauthenticated, cross-origin, PROD and other-owner requests",async()=>{
    for(const route of [transcribe,narration,creation]){
      auth.signedIn=false;expect((await route.POST(req(),context)).status).toBe(401);auth.signedIn=true;
      expect((await route.POST(req({},"https://elsewhere.invalid"),context)).status).toBe(403);
      vi.stubEnv("OTG_ENV","prod");expect((await route.POST(req(),context)).status).toBe(404);vi.stubEnv("OTG_ENV","test");
      auth.owner="bob";expect((await route.POST(req(),context)).status).toBe(404);auth.owner="alice";
    }expect(cpu.call).not.toHaveBeenCalled();
  });
  it("uses qualified local transcription only and returns editable text without changing the story",async()=>{
    cpu.call.mockResolvedValue({ok:true,text:"Make it night."});const form=new FormData();form.set("audio",new File([new Uint8Array([1,2,3])],"voice.webm",{type:"audio/webm"}));
    const before=studio().get("alice",p.id);const result=await transcribe.POST(new NextRequest("http://studio.test/api",{method:"POST",headers:{host:"studio.test",origin:"http://studio.test"},body:form}),context);
    expect(result.status).toBe(200);expect((await result.json()).transcript).toBe("Make it night.");expect(cpu.call.mock.calls[0][0]).toBe("/transcribe");expect(studio().get("alice",p.id)).toEqual(before);expect(studio().jobs("alice",p.id)).toEqual([]);
  });
  it("caches narration by exact scene text and invalidates only revised segments",async()=>{
    const wav=Buffer.alloc(48);wav.write("RIFF");wav.write("WAVE",8);cpu.call.mockImplementation(async endpoint=>endpoint==="/health"?{ok:true,busy:false}:{ok:true,audio:wav.toString("base64"),durationSeconds:1});
    const first=prepareNarration(studio(),"alice",p.id,"beat-1");await enqueueNarration(studio(),"alice",p.id,first.job.key);expect(fs.existsSync(narrationAudio(studio(),"alice",p.id,first.job.key))).toBe(true);expect(prepareNarration(studio(),"alice",p.id,"beat-1").created).toBe(false);
    const second=prepareNarration(studio(),"alice",p.id,"beat-2");studio().internalUpdate("alice",p.id,p=>{p.plan.storyPreview!.segments[0].narrative="A revised scene.";});expect(prepareNarration(studio(),"alice",p.id,"beat-1").job.key).not.toBe(first.job.key);expect(prepareNarration(studio(),"alice",p.id,"beat-2").job.key).toBe(second.job.key);expect(()=>narrationAudio(studio(),"bob",p.id,first.job.key)).toThrow();
  });
  it("rejects changed media and malformed RefMod bundles before approval",async()=>{
    const file=path.join(root,"fake.safetensors");fs.writeFileSync(file,Buffer.alloc(30));const a=await snapshotFile(studio(),"alice",p.id,file,"Invalid bundle","refmod",{libraryName:"invalid"});await expect(validateCreateAssets(studio(),"alice",p.id,{assetId:a.id})).rejects.toThrow("incomplete");const local=studio().asset("alice",p.id,a.id).path;fs.appendFileSync(local,"modified");await expect(validateCreateAssets(studio(),"alice",p.id,{assetId:a.id})).rejects.toThrow();
  });
  it("persists all four per-production narrator choices without changing character voices; CAS rejects stale saves",()=>{
    let project=studio().internalUpdate("alice",p.id,p=>{p.characterVoices={heroine:"approved-qwen3-voice"};});
    for(const voice of ["af_heart","am_puck","bf_isabella","bm_fable"]){const revision=project.revision;project=studio().mutate("alice",p.id,revision,{type:"narrator.voice",voice});expect(studio().get("alice",p.id).narratorVoice).toBe(voice);expect(project.characterVoices).toEqual({heroine:"approved-qwen3-voice"});expect(()=>studio().mutate("alice",p.id,revision,{type:"narrator.voice",voice})).toThrow("changed elsewhere");}
    expect(()=>studio().mutate("alice",p.id,project.revision,{type:"narrator.voice",voice:"untrusted-path"})).toThrow("four narrator voices");expect(studio().jobs("alice",p.id)).toEqual([]);
  });
  it("assistant and scene cache keys include the selected Paradee voice, not character voice settings",()=>{
    studio().internalUpdate("alice",p.id,p=>{p.assistant.push({id:"reply",role:"assistant",text:"Your revised story is ready.",createdAt:new Date().toISOString()},{id:"user",role:"user",text:"Please revise.",createdAt:new Date().toISOString()});});
    const keys=["af_heart","am_puck","bf_isabella","bm_fable"].map(voice=>{const r=prepareNarration(studio(),"alice",p.id,{messageId:"reply",voice});expect(r.job.engine).toBe("paradee");expect(r.job.voice).toBe(voice);return r.job.key;});expect(new Set(keys).size).toBe(4);
    expect(()=>prepareNarration(studio(),"alice",p.id,{messageId:"user"})).toThrow("no longer available");expect(()=>prepareNarration(studio(),"alice",p.id,{messageId:"reply",expectedText:"Old reply."})).toThrow("changed");expect(()=>prepareNarration(studio(),"alice",p.id,{segmentId:"beat-1",expectedText:"Old story."})).toThrow("changed");expect(cpu.call).not.toHaveBeenCalled();
  });
  it("cancellation makes queued work inert and permits an explicit new request",async()=>{
    cpu.call.mockResolvedValue({ok:true});const one=prepareNarration(studio(),"alice",p.id,{messageId:"reply",voice:"am_puck"});await cancelNarration(studio(),"alice",p.id,one.job.key);await enqueueNarration(studio(),"alice",p.id,one.job.key);expect(cpu.call.mock.calls.map(c=>c[0])).toEqual(["/cancel"]);expect(getNarration(studio(),"alice",p.id,one.job.key).status).toBe("canceled");const next=prepareNarration(studio(),"alice",p.id,{messageId:"reply",voice:"am_puck"});expect(next.created).toBe(true);expect(next.job.jobId).not.toBe(one.job.jobId);
  });
});
