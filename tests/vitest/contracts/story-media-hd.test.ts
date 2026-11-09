import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {storyImageSize} from "@/lib/storyCreator/imageSize";
const providers=vi.hoisted(()=>({image:vi.fn(),voice:vi.fn(),localImage:vi.fn(),localVoice:vi.fn(),cloudEnabled:vi.fn(()=>true)}));
vi.mock("@/lib/storyCreator/mediaOpenAI",()=>({storyOpenAIImageProfile:"gpt-image-2.6-flare",storyOpenAIImagesEnabled:providers.cloudEnabled,
  renderStoryOpenAIImage:providers.image,storyOpenAIImageTimeoutMs:150000}));
vi.mock("@/lib/storyCreator/mediaVoiceProviders",async original=>({...await original<object>(),renderStoryElevenLabs:providers.voice}));
vi.mock("@/lib/storyCreator/media3060",async original=>({...await original<object>(),submitStory3060Image:providers.localImage}));
vi.mock("@/lib/storyCreator/mediaVoice3060",async original=>({...await original<object>(),submitStory3060Voice:providers.localVoice}));
let root:string;
beforeEach(()=>{
  root=fs.mkdtempSync(path.join(os.tmpdir(),"story-hd-"));vi.resetModules();vi.clearAllMocks();providers.cloudEnabled.mockReturnValue(true);
  for(const [key,value] of Object.entries({OTG_ENV:"test",OTG_DATA_ROOT:root,OTG_DATA_DIR:root,OTG_LOCAL_AI_3060:"1",
    OTG_STORY_CHAT_MEDIA:"1",OTG_STORY_IMAGE_3060:"1",OTG_STORY_EDIT_3060:"1",OTG_STORY_SPEECH_3060:"1",OTG_STORY_ELEVENLABS:"1"}))vi.stubEnv(key,value);
});
afterEach(()=>{vi.unstubAllEnvs();fs.rmSync(root,{recursive:true,force:true});});
async function setup(operation="image"){
  const store=await import("@/lib/storyCreator/store"),media=await import("@/lib/storyCreator/mediaStore"),execution=await import("@/lib/storyCreator/mediaExecution");
  const project=store.createStoryCreatorProject({ownerKey:"alice",title:"HD fix "+crypto.randomUUID()});
  const content=operation==="voice"?'Create a voice that says "Hello, friend.".':"Create an image of a ruined temple.";
  const message=store.addStoryCreatorMessage({ownerKey:"alice",projectId:project.id,role:"user",content});
  const {record}=execution.requestStoryMedia({ownerKey:"alice",projectId:project.id,sourceMessageId:message.id,openAIImageAccountId:"account",
    arguments:{operation,subject:"scene",name:"Temple",sourceId:"",prompt:content,text:operation==="voice"?"Hello, friend.":"",evidence:content,...(operation==="voice"?{voiceMode:"design"}:{})}});
  return {record,media,execution,project};
}
it.each([[1,1,960,960],[16,9,1280,720],[9,16,720,1280],[2,1,1440,720]])("renders %s:%s at HD dimensions",(w,h,width,height)=>{
  expect(storyImageSize(w,h)).toEqual({width,height});
});
it("rejects unbounded image canvases",()=>expect(()=>storyImageSize(10000,1)).toThrow(/framing/));
it("uses the API by default, publishes actual dimensions, and retains API routing for edits",async()=>{
  const s=await setup();expect(s.record.profile).toBe("gpt-image-2.6-flare");
  providers.image.mockResolvedValue(await sharp({create:{width:960,height:960,channels:3,background:"blue"}}).png().toBuffer());
  await s.execution.executeStoryMedia(s.record,"");
  const done=s.media.getStoryMedia("alice",s.project.id,s.record.id);
  expect(done).toMatchObject({status:"ready",imageSize:{width:960,height:960}});
  const edit=s.execution.requestStoryMediaFromCard("alice",s.project.id,{requestKey:"edit-hd-1234567890",operation:"edit",sourceId:done.id,prompt:"Make the sky red."},"account").record;
  expect(edit.profile).toBe("gpt-image-2.6-flare");
});
it("uses the local image fallback once for provider unavailability and respects policy refusals",async()=>{
  const s=await setup();providers.image.mockRejectedValue(Object.assign(Error("API unavailable"),{fallbackAllowed:true}));
  await s.execution.executeStoryMedia(s.record,"");await s.execution.executeStoryMedia(s.record,"");
  expect(providers.image).toHaveBeenCalledTimes(1);expect(providers.localImage).toHaveBeenCalledTimes(1);
  expect(providers.localImage.mock.calls[0][0]).toMatchObject({id:s.record.id,status:"submitting",profile:"z-image-turbo-3060"});
  const other=await setup();providers.image.mockRejectedValue(Object.assign(Error("Policy refusal"),{fallbackAllowed:false}));
  await other.execution.executeStoryMedia(other.record,"");
  expect(other.media.getStoryMedia("alice",other.project.id,other.record.id).status).toBe("failed");
  expect(providers.localImage).toHaveBeenCalledTimes(1);
});
it("uses the local profile directly when the account has no API capability",async()=>{
  providers.cloudEnabled.mockReturnValue(false);
  expect((await setup()).record.profile).toBe("z-image-turbo-3060");
});
it("keeps ElevenLabs primary and falls back to the 3060 voice path",async()=>{
  const s=await setup("voice");expect(s.record.profile).toBe("story-voice-auto");providers.voice.mockResolvedValue({reason:"ElevenLabs unavailable."});
  await s.execution.executeStoryMedia(s.record,"");await s.execution.executeStoryMedia(s.record,"");
  expect(providers.voice).toHaveBeenCalledTimes(1);expect(providers.localVoice).toHaveBeenCalledTimes(1);
  expect(providers.localVoice.mock.calls[0][0]).toMatchObject({id:s.record.id,status:"submitting",profile:"qwen3-tts-3060"});
});
it("cancels before the local fallback when cancellation arrives during the API call",async()=>{
  const s=await setup();providers.image.mockImplementation(async()=>{
    const current=s.media.getStoryMedia("alice",s.project.id,s.record.id);s.media.updateStoryMedia(current,{cancelRequested:true});
    throw Object.assign(Error("API timeout"),{fallbackAllowed:true});
  });
  await s.execution.executeStoryMedia(s.record,"");expect(providers.localImage).not.toHaveBeenCalled();
  expect(s.media.getStoryMedia("alice",s.project.id,s.record.id).status).toBe("canceled");
});
