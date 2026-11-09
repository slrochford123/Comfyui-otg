import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
const mocks=vi.hoisted(()=>({key:vi.fn(()=>"test-key"),record:{} as any,fetch:vi.fn()}));
vi.mock("@/lib/storyCreator/mediaVoiceProviders",()=>({elevenLabsKey:mocks.key}));
vi.mock("@/lib/storyCreator/mediaStore",()=>({getStoryMedia:()=>mocks.record,updateStoryMedia:(_:unknown,patch:object)=>Object.assign(mocks.record,patch)}));
import {cloudAudioRequest,renderStoryCloudAudio} from "@/lib/storyCreator/mediaCloudAudio";
beforeEach(()=>{vi.clearAllMocks();mocks.key.mockReturnValue("test-key");mocks.record={id:"r",ownerKey:"owner",projectId:"p",status:"submitting",command:{operation:"music",prompt:"Quiet strings",durationSeconds:10}};vi.stubGlobal("fetch",mocks.fetch);});
it("submits explicit instrumental music length and sound-effect duration",()=>{expect(cloudAudioRequest(mocks.record)).toMatchObject({endpoint:"music",body:{music_length_ms:10000,force_instrumental:true}});mocks.record.command.operation="effects";expect(cloudAudioRequest(mocks.record)).toMatchObject({endpoint:"sound-generation",body:{duration_seconds:10}});});
it("rejects invalid durations before a paid request",async()=>{mocks.record.command.durationSeconds=900;await expect(renderStoryCloudAudio(mocks.record,"/unused")).rejects.toMatchObject({name:"RejectedStoryMedia"});expect(mocks.fetch).not.toHaveBeenCalled();});
it("falls back only after a definite unavailable response",async()=>{mocks.fetch.mockResolvedValue(new Response("",{status:429}));expect(await renderStoryCloudAudio(mocks.record,"/unused")).toBeNull();expect(mocks.fetch).toHaveBeenCalledTimes(1);expect(mocks.record.backendJob).toBeNull();});
it("does not duplicate a request after an ambiguous network failure",async()=>{mocks.fetch.mockRejectedValue(new Error("socket ended"));await expect(renderStoryCloudAudio(mocks.record,"/unused")).rejects.toMatchObject({name:"UnconfirmedStoryCloudAudio"});expect(mocks.fetch).toHaveBeenCalledTimes(1);expect(mocks.record.backendJob.engine).toBe("elevenlabs-audio");});
it("uses local fallback when no key is configured",async()=>{mocks.key.mockReturnValue("");expect(await renderStoryCloudAudio(mocks.record,"/unused")).toBeNull();expect(mocks.fetch).not.toHaveBeenCalled();});
it("never falls back on a rejected prompt",async()=>{mocks.fetch.mockResolvedValue(new Response("",{status:422}));await expect(renderStoryCloudAudio(mocks.record,"/unused")).rejects.toMatchObject({name:"RejectedStoryMedia"});});

afterEach(()=>vi.unstubAllGlobals());
it("keeps a longer confirmed music response and finishes the requested length without another paid call",async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"cloud-music-"));
 try{
  const fixture=path.join(root,"fixture.mp3");execFileSync("ffmpeg",["-v","error","-f","lavfi","-i","sine=frequency=220:sample_rate=44100","-t","6","-c:a","libmp3lame",fixture]);
  const bytes=fs.readFileSync(fixture);mocks.record.command.durationSeconds=3;mocks.fetch.mockResolvedValue(new Response(bytes,{headers:{"content-type":"audio/mpeg"}}));
  const file=await renderStoryCloudAudio(mocks.record,root);expect(mocks.fetch).toHaveBeenCalledTimes(1);expect(file).toBe(path.join(root,"eleven-music-trimmed.wav"));expect(mocks.record.durationSeconds).toBe(3);expect(mocks.record.backendJob.nativeDurationSeconds).toBeGreaterThan(6);expect(fs.readFileSync(path.join(root,"eleven-audio.mp3"))).toEqual(bytes);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
