import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {beforeEach,afterEach,it,expect,vi} from "vitest";
import {explicitMediaRequest,parseStoryMediaCommand} from "@/lib/storyCreator/mediaContract";
const backend=vi.hoisted(()=>({image:vi.fn(),edit:vi.fn(),voice:vi.fn()}));
vi.mock("@/app/api/assets/create-image/route",()=>({POST:backend.image}));
vi.mock("@/app/api/images/native/route",()=>({POST:backend.edit}));
vi.mock("@/lib/storyCreator/mediaVoice",()=>({generateStoryVoice:backend.voice,storyVoiceActive:()=>false}));
let root="";
beforeEach(()=>{root=fs.mkdtempSync(path.join(os.tmpdir(),"story-media-"));vi.stubEnv("OTG_DATA_ROOT",root);vi.stubEnv("OTG_DATA_DIR",root);vi.stubEnv("OTG_ENV","test");vi.resetModules();vi.clearAllMocks();});
afterEach(()=>{vi.resetModules();vi.unstubAllEnvs();fs.rmSync(root,{recursive:true,force:true});});
async function setup(content="Generate a character image of Buzzy, a white bunny with one pink ear.") {
  const store=await import("@/lib/storyCreator/store"), media=await import("@/lib/storyCreator/mediaStore"),execution=await import("@/lib/storyCreator/mediaExecution");
  const project=store.createStoryCreatorProject({ownerKey:"alice",title:"Buzzy"});
  const message=store.addStoryCreatorMessage({ownerKey:"alice",projectId:project.id,role:"user",content});
  const command={operation:"image",subject:"character",name:"Buzzy",prompt:content,sourceId:"",text:"",evidence:content};
  const request={ownerKey:"alice",projectId:project.id,sourceMessageId:message.id,arguments:command};
  return {store,media,execution,project,message,command,request};
}
async function ready() {
  const s=await setup();let {record}=s.execution.requestStoryMedia(s.request);
  const dir=s.execution.storyMediaRoot(record);fs.mkdirSync(dir,{recursive:true});const file=path.join(dir,"result.png");
  fs.writeFileSync(file,Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==","base64"));
  record=s.media.updateStoryMedia(record,{status:"ready",filePath:file});return {...s,record,file};
}
it.each(["Let's discuss the bunny.","Don't create an image.","What if we generate a castle?",'The character said "create an image".',"How can I generate a video?"])("does not authorize brainstorming: %s",text=>expect(explicitMediaRequest(text)).toBe(false));
it.each(["Create an image of Buzzy.","Please edit the lighting.","Animate Buzzy walking.",'Make Buzzy say "Hello".'])("accepts an explicit command: %s",text=>expect(explicitMediaRequest(text)).toBe(true));
it("rejects forged authorization, extra fields and arbitrary operation",async()=>{
  const s=await setup();expect(()=>parseStoryMediaCommand({...s.command,evidence:"Render a car"},s.message.content)).toThrow();
  expect(()=>parseStoryMediaCommand({...s.command,workflow:{}},s.message.content)).toThrow();
  expect(()=>parseStoryMediaCommand({...s.command,operation:"shell"},s.message.content)).toThrow();
});
it("requires a user name before any backend submission and resumes the same record",async()=>{
  const s=await setup("Generate an image of a bunny.");const {record}=s.execution.requestStoryMedia(s.request);
  expect(record.status).toBe("needs_name");await s.execution.executeStoryMedia(record,"");expect(backend.image).not.toHaveBeenCalled();
  const named=s.execution.nameStoryMedia(record,"Buzzy");expect(named.id).toBe(record.id);expect(named.status).toBe("queued");
  expect(s.execution.nameStoryMedia(record,"Wrong name").command.name).toBe("Buzzy");
});
it("submits Krea once with the exact requested name and survives request replay",async()=>{
  const s=await setup();backend.image.mockResolvedValue(Response.json({promptId:"original",comfyBaseUrl:"http://fixture",outputNodeId:"29"}));
  const {record}=s.execution.requestStoryMedia(s.request);await s.execution.executeStoryMedia(record,"session=fixture");await s.execution.executeStoryMedia(record,"session=fixture");
  expect(backend.image).toHaveBeenCalledTimes(1);expect(backend.image.mock.calls[0][0].nextUrl.hostname).toBe("100.75.162.64");expect(await backend.image.mock.calls[0][0].json()).toMatchObject({model:"krea-2",name:"Buzzy"});
  expect(s.execution.requestStoryMedia(s.request)).toMatchObject({created:false,record:{id:record.id,status:"running"}});
  expect(s.media.publicStoryMedia(s.media.getStoryMedia("alice",s.project.id,record.id))).not.toHaveProperty("backendJob");
});
it("never retries an ambiguous worker submission",async()=>{
  const s=await setup();backend.image.mockRejectedValue(Error("lost response"));const {record}=s.execution.requestStoryMedia(s.request);
  await s.execution.executeStoryMedia(record,"");await s.execution.executeStoryMedia(record,"");expect(backend.image).toHaveBeenCalledTimes(1);
  expect(s.media.getStoryMedia("alice",s.project.id,record.id).status).toBe("unknown");
});
it("reports an explicit worker refusal as failed without retrying",async()=>{
  const s=await setup();backend.image.mockResolvedValue(Response.json({ok:false,error:"Not configured"},{status:400}));
  const {record}=s.execution.requestStoryMedia(s.request);await s.execution.executeStoryMedia(record,"");await s.execution.executeStoryMedia(record,"");
  expect(backend.image).toHaveBeenCalledTimes(1);expect(s.media.getStoryMedia("alice",s.project.id,record.id).status).toBe("failed");
});
it("saves a character without voice and reuses the immutable saved image for later requests",async()=>{
  const s=await ready();const saved=s.execution.saveStoryCharacter(s.record);expect(saved.characterId).toBeTruthy();
  expect(s.execution.saveStoryCharacter(saved).characterId).toBe(saved.characterId);
  const {loadCharacter}=await import("@/lib/characters/store");const char=loadCharacter("alice",saved.characterId!)!;
  expect(char.name).toBe("Buzzy");expect(char.imagePath).toBe(s.file);expect(char.referenceAudioPath).toBeFalsy();
  const content="Generate an image of Buzzy in a meadow.";
  const message=s.store.addStoryCreatorMessage({ownerKey:"alice",projectId:s.project.id,role:"user",content});
  const next=s.execution.requestStoryMedia({...s.request,sourceMessageId:message.id,arguments:{...s.command,prompt:content,evidence:content}}).record;
  expect(next.command).toMatchObject({sourceId:saved.characterId,operation:"edit"});
  backend.edit.mockResolvedValue(Response.json({jobId:"edit-id",promptId:"edit-prompt",comfyBaseUrl:"http://fixture"}));
  await s.execution.executeStoryMedia(next,"");const form=await backend.edit.mock.calls[0][0].formData();expect(form.get("model")).toBe("fibo2-edit-turbo");expect(form.get("clientRequestId")).toBe(next.id);
  expect(Buffer.from(await form.get("image").arrayBuffer())).toEqual(fs.readFileSync(s.file));
});
it("isolates other accounts, projects and path traversal references",async()=>{
  const s=await ready();expect(()=>s.media.getStoryMedia("mallory",s.project.id,s.record.id)).toThrow();
  const project=s.store.createStoryCreatorProject({ownerKey:"alice",title:"Other"});expect(()=>s.media.getStoryMedia("alice",project.id,s.record.id)).toThrow();
  expect(()=>s.execution.requestStoryMedia({...s.request,arguments:{...s.command,sourceId:"../../etc/passwd"}})).toThrow();
  const outside=fs.mkdtempSync(path.join(os.tmpdir(),"story-outside-"));try{fs.writeFileSync(path.join(outside,"x"),"x");const link=path.join(path.dirname(s.file),"link.png");fs.symlinkSync(path.join(outside,"x"),link);expect(()=>s.execution.storyMediaFile({...s.record,filePath:link})).toThrow();}finally{fs.rmSync(outside,{recursive:true});}
});
it("replays a card action safely and does not change its source",async()=>{
  const s=await ready(),body={requestKey:"1234567890abcdef",operation:"edit",sourceId:s.record.id,prompt:"Make the sky blue."};
  const first=s.execution.requestStoryMediaFromCard("alice",s.project.id,body),second=s.execution.requestStoryMediaFromCard("alice",s.project.id,body);
  expect(first.created).toBe(true);expect(second.created).toBe(false);expect(first.record.id).toBe(second.record.id);expect(first.record.command.sourceId).toBe(s.record.id);
});
it("cancels before dispatch without touching a backend",async()=>{
  const s=await setup(),{record}=s.execution.requestStoryMedia(s.request);await s.execution.cancelStoryMedia(record);await s.execution.executeStoryMedia(record,"");expect(backend.image).not.toHaveBeenCalled();expect(s.media.getStoryMedia("alice",s.project.id,record.id).status).toBe("canceled");
});
it("saves a voice once, assigns it to the existing character, and uses it for new dialogue",async()=>{
  const s=await ready(),character=s.execution.saveStoryCharacter(s.record);
  const voice=s.execution.requestStoryMediaFromCard("alice",s.project.id,{requestKey:"voice1234567890abc",sourceId:s.record.id,operation:"voice",prompt:"Warm friendly voice",text:"Hello, friend."}).record;
  const dir=s.execution.storyMediaRoot(voice);fs.mkdirSync(dir,{recursive:true});const file=path.join(dir,"result.wav");fs.writeFileSync(file,"fixture WAV");
  const done=s.media.updateStoryMedia(voice,{status:"ready",filePath:file}),saved=s.execution.saveStoryVoice(done,character.characterId!);
  expect(s.execution.saveStoryVoice(done).voiceId).toBe(saved.voiceId);
  const {loadVoicesLibrary}=await import("@/lib/voicesStudio");expect(loadVoicesLibrary("alice").voices).toHaveLength(1);
  const next=s.execution.requestStoryMediaFromCard("alice",s.project.id,{requestKey:"voice2222222222abc",sourceId:s.record.id,operation:"voice",prompt:"Warm friendly voice",text:"A new day begins."}).record;
  backend.voice.mockRejectedValue(Error("fixture stop before inference"));await s.execution.executeStoryMedia(next,"");
  expect(backend.voice.mock.calls[0][1]).toMatchObject({refText:"Hello, friend.",characterId:character.characterId});
  expect(backend.voice.mock.calls[0][1].voice).toContain(saved.voiceId);
});
