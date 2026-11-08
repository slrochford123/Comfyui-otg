import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {beforeEach,afterEach,it,expect,vi} from "vitest";
import {bindLocalStoryMediaEvidence,directLocalStoryMedia,explicitMediaRequest,parseStoryMediaCommand,requestsStoryOpenAIImage} from "@/lib/storyCreator/mediaContract";
const backend=vi.hoisted(()=>({image:vi.fn(),edit:vi.fn(),voice:vi.fn()}));
vi.mock("@/app/api/assets/create-image/route",()=>({POST:backend.image}));
vi.mock("@/app/api/images/native/route",()=>({POST:backend.edit}));
vi.mock("@/lib/storyCreator/mediaVoice",()=>({generateStoryVoice:backend.voice,storyVoiceActive:()=>false}));
let root="";
beforeEach(()=>{root=fs.mkdtempSync(path.join(os.tmpdir(),"story-media-"));vi.stubEnv("OTG_DATA_ROOT",root);vi.stubEnv("OTG_DATA_DIR",root);vi.stubEnv("OTG_ENV","test");vi.resetModules();vi.clearAllMocks();});
afterEach(()=>{vi.resetModules();vi.unstubAllEnvs();fs.rmSync(root,{recursive:true,force:true});});
it("keeps production Story audio explicitly enabled and separate from the editor's engines",async()=>{
  const storyConfig=path.join(root,"story.json"),editorConfig=path.join(root,"editor.json");
  fs.writeFileSync(storyConfig,JSON.stringify({python:process.execPath,musicEngine:"yue2",verified:{music:{rtx3090:true},effects:{rtx3090:true}}}));
  fs.writeFileSync(editorConfig,JSON.stringify({python:process.execPath,verified:{"separate-bandit":{cpu:true}}}));
  vi.stubEnv("OTG_ENV","prod");
  vi.stubEnv("OTG_PRIVATE_RESEARCH_MEDIA","1");
  vi.stubEnv("OTG_AUDIO_EDITING_ENABLED","1");
  vi.stubEnv("OTG_MEDIA_GPU_ROUTING","1");
  vi.stubEnv("OTG_MEDIA_ADMISSION_CONFIG",path.join(root,"admission.json"));
  vi.stubEnv("OTG_AUDIO_ENGINE_CONFIG",editorConfig);
  vi.stubEnv("OTG_STORY_AUDIO_ENGINE_CONFIG",storyConfig);
  vi.stubEnv("OTG_STORY_AUDIO_PROD","0");
  const {requireStoryAudioEngine}=await import("@/lib/storyCreator/mediaAudio");
  const {capabilities,engineConfigPath}=await import("@/lib/audioEditing/jobs");
  expect(()=>requireStoryAudioEngine("music")).toThrow("YuE2 is unavailable");
  vi.stubEnv("OTG_STORY_AUDIO_PROD","1");
  expect(requireStoryAudioEngine("music").musicEngine).toBe("yue2");
  expect(requireStoryAudioEngine("effects").engines.effects).toEqual({rtx3090:true});
  expect(capabilities().engines).toEqual({"separate-bandit":{cpu:true}});
  expect(engineConfigPath()).toBe(editorConfig);
  vi.stubEnv("OTG_MEDIA_GPU_ROUTING","0");
  expect(()=>requireStoryAudioEngine("effects")).toThrow("Sony Woosh is unavailable");
});
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

it("authorizes a natural dictated voice design with exact dialogue and rejects rewritten dialogue", () => {
  const request = "Give Helena a Russian accent and make her say “The treatment is working.”";
  const command = {operation:"voice",subject:"character",name:"Helena",prompt:"English with a moderate Russian accent",
    sourceId:"",text:"The treatment is working.",evidence:request,voiceMode:"design",language:"English"};
  expect(parseStoryMediaCommand(command,request,true)).toMatchObject({language:"English",voiceMode:"design",text:command.text});
  expect(() => parseStoryMediaCommand({...command,text:"Treatment works."},request,true)).toThrow("exact line");
  expect(explicitMediaRequest("What’s in this picture?",true)).toBe(true);
});

it("recovers paraphrased local evidence only for a matching explicit media instruction", () => {
  const command={operation:"image",subject:"character",name:"Helena",prompt:"Helena in a blazer",sourceId:"",text:"",evidence:"Make a portrait"};
  const request="Create a portrait image of Helena in a blazer.";
  expect(parseStoryMediaCommand(bindLocalStoryMediaEvidence(command,request),request,true)).toMatchObject({evidence:request});
  for(const unsafe of ["Create a story about a portrait.","Don't create a portrait of Helena."]) {
    expect(()=>parseStoryMediaCommand(bindLocalStoryMediaEvidence(command,unsafe),unsafe,true)).toThrow();
  }
  const voiceRequest="Give her a Russian accent and make her say the treatment is working";
  const voice={...command,operation:"voice",text:"The treatment is working.",voiceMode:"design"};
  expect(parseStoryMediaCommand(bindLocalStoryMediaEvidence(voice,voiceRequest),voiceRequest,true).text).toBe("the treatment is working");
});

it.each([
  ["Create a portrait image of Dr. Helena Voss, a fictional doctor.","image","Dr. Helena Voss",""],
  ["Edit this portrait. Change the blazer to dark blue.","edit","",""],
  ["Give her a Russian accent and make her say. The treatment is working.","voice","","The treatment is working."],
  ["her a Russian accent, and make her say, The treatment is working.","voice","","The treatment is working."],
  ["Have her speak another line in her saved voice. Make her say “We can begin.”","voice","","We can begin."],
  ["Generate a five-second sound effect of a heavy steel door slamming.","effects","",""],
  ["Generate 10 seconds of instrumental music with eerie piano.","music","",""],
  ["Create a five-second video showing her taking one slow step.","video","",""],
])("routes a clear local command: %s",(line,operation,name,text)=>{
  const command=directLocalStoryMedia(line);
  expect(parseStoryMediaCommand(command,line,true)).toMatchObject({operation,name,text,evidence:line});
});

it("keeps planning and incidental brand mentions outside media dispatch and paid image selection",()=>{
  expect(directLocalStoryMedia("Create a shot list for a five-second video.")).toBeUndefined();
  expect(directLocalStoryMedia("Make a playlist of cinematic music.")).toBeUndefined();
  expect(requestsStoryOpenAIImage("Create an image of OpenAI's headquarters.")).toBe(false);
  expect(requestsStoryOpenAIImage('Create a poster reading "Made with OpenAI".')).toBe(false);
  expect(requestsStoryOpenAIImage("Create an image with GPT Image 2.6 Flare.")).toBe(true);
});

it("uses the explicitly selected portrait and limits the requested video duration before dispatch", async () => {
  vi.stubEnv("OTG_STORY_CHAT_MEDIA","1");
  const s=await ready(),scope={ownerKey:"alice",projectId:s.project.id};
  const request="Show her doing a backflip in a twelve-second video.";
  const command=s.execution.resolveStoryChatCommand(scope,{operation:"video",subject:"character",name:"Buzzy",
    prompt:"The bunny does a backflip.",sourceId:"",text:"",evidence:request,durationSeconds:10},request,s.record.id);
  expect(command).toMatchObject({sourceId:s.record.id,durationSeconds:12});
  const message=s.store.addStoryCreatorMessage({...scope,role:"user",content:request});
  expect(()=>s.execution.requestStoryMedia({...scope,sourceMessageId:message.id,arguments:command})).toThrow("between 1 and 10");
});

it("keeps image retrieval separate from rendering and enforces project ownership",async()=>{
  vi.stubEnv("OTG_STORY_CHAT_MEDIA","1");
  const s=await ready();
  const scope={ownerKey:"alice",projectId:s.project.id},request="Show me what Buzzy looks like.";
  const command=s.execution.resolveStoryChatCommand(scope,{operation:"show",subject:"character",name:"Buzzy",
    prompt:"",sourceId:"",text:"",evidence:request},request);
  expect(s.execution.findStoryCreation(scope,command.sourceId)).toEqual({id:s.record.id,name:"Buzzy"});
  expect(()=>s.execution.validateStoryMediaFocus({...scope,ownerKey:"bob"},s.record.id)).toThrow();
  expect(backend.image).not.toHaveBeenCalled();
});

it("uses only grounded local source IDs and preserves an explicit selection",async()=>{
  const s=await ready(),scope={ownerKey:"alice",projectId:s.project.id};
  const request="Create an image of a lighthouse.";
  const fresh=s.execution.resolveStoryChatCommand(scope,{...s.command,subject:"scene",name:"Lighthouse",
    evidence:request,sourceId:"fresh-image"},request,undefined,true);
  expect(fresh.sourceId).toBe("");
  const edit="Edit this portrait.";
  const selected=s.execution.resolveStoryChatCommand(scope,{...s.command,operation:"edit",name:"Uncertain",
    evidence:edit,sourceId:"selected"},edit,s.record.id,true);
  expect(selected.sourceId).toBe(s.record.id);
});
