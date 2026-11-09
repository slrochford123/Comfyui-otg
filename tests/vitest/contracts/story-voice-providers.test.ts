import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import type {StoryMediaRecord} from "@/lib/storyCreator/mediaStore";

let root:string;
beforeEach(()=>{
  root=fs.mkdtempSync(path.join(os.tmpdir(),"story-voice-"));
  const key=path.join(root,"key");
  fs.writeFileSync(key,"fixture_test_credential",{mode:0o600});
  vi.stubEnv("OTG_DATA_ROOT",root);
  vi.stubEnv("OTG_DATA_DIR",root);
  vi.stubEnv("OTG_ENV","test");
  vi.stubEnv("OTG_STORY_ELEVENLABS","1");
  vi.stubEnv("OTG_STORY_ELEVENLABS_KEY_FILE",key);
  vi.resetModules();
});
afterEach(()=>{
  vi.unstubAllEnvs();vi.unstubAllGlobals();
  fs.rmSync(root,{recursive:true,force:true});
});
const record=(id:string,ownerKey="alice")=>({id,ownerKey,command:{
  operation:"voice",text:"Welcome to your new life.",voiceMode:"design",prompt:"Mature woman speaking English with a Russian accent.",
}} as StoryMediaRecord);
it("limits cloud attempts across users and blocks replay",async()=>{
  const {reserveStoryVoiceRequest:reserve}=await import("@/lib/storyCreator/mediaStore");
  expect(reserve(record("a"),true)).toBe(true);
  expect(reserve(record("a"),true)).toBe(false);
  expect(["b","c","d"].map(id=>reserve(record(id),true))).toEqual([true,true,false]);
  expect(["e","f","g"].map(id=>reserve(record(id,"bob"),false))).toEqual([true,true,false]);
});
it("holds uncertain approvals and reuses a confirmed ID without a second slot",async()=>{
  const {claimStoryVoiceSlot:claim,settleStoryVoiceSlot:settle,reserveStoryVoiceRequest:reserve}=await import("@/lib/storyCreator/mediaStore");
  expect(claim(record("a"),1)).toBeNull();
  expect(()=>claim(record("a"),1)).toThrow(/not confirmed/);
  expect(()=>claim(record("a"),0)).toThrow(/different audition/);
  settle(record("a"),1,"fixtureVoiceId");
  expect(claim(record("a"),1)).toBe("fixtureVoiceId");
  expect(claim(record("b"),0)).toBeNull();
  expect(claim(record("c","bob"),0)).toBeNull();
  expect(()=>claim(record("d","bob"),0)).toThrow(/three/);
  expect(reserve(record("d","bob"),true)).toBe(false);
  expect(reserve(record("d","bob"),false)).toBe(true);
});
it("passes English speech and Russian-accent direction separately and keeps previews private",async()=>{
  const {renderStoryElevenLabs,storyLtxPreset}=await import("@/lib/storyCreator/mediaVoiceProviders");
  const {publicStoryMedia}=await import("@/lib/storyCreator/mediaStore");
  const source=record("a");
  const count=6000;
  const wav=Buffer.alloc(44+count*2);
  wav.write("RIFF");wav.writeUInt32LE(wav.length-8,4);wav.write("WAVEfmt ",8);
  wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);
  wav.writeUInt32LE(24000,24);wav.writeUInt32LE(48000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);
  wav.write("data",36);wav.writeUInt32LE(count*2,40);
  const fetch=vi.fn(async(_url:string,request:RequestInit)=>{
    const body=JSON.parse(String(request.body));
    expect(body.voice_description).toContain("Russian accent");
    expect(body.text.length).toBeGreaterThanOrEqual(100);
    expect(new Set(body.text.split("\n"))).toEqual(new Set([source.command.text]));
    return Response.json({previews:[{generated_voice_id:"preview_secret_1",audio_base_64:wav.toString("base64")}]});
  });
  vi.stubGlobal("fetch",fetch);
  const voice=await renderStoryElevenLabs(source,root);
  expect(voice).toHaveProperty("file");
  expect(await renderStoryElevenLabs(source,root)).toHaveProperty("reason");
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(storyLtxPreset(source.command.prompt).label).toBe("Russia");
  if(!("previews" in voice)||!voice.previews)throw Error("Expected previews");
  const output=publicStoryMedia({...source,status:"ready",filePath:voice.file,cloudVoice:{previews:voice.previews}});
  expect(output.voiceCandidates).toBe(1);
  expect(JSON.stringify(output)).not.toContain("preview_secret_1");
  expect(JSON.stringify(output)).not.toContain(root);
});
it("requires an approved cloud voice ID to use the exact-dialogue endpoint",async()=>{
  const {renderStoryElevenLabs}=await import("@/lib/storyCreator/mediaVoiceProviders");
  const source=record("reuse");
  source.command.voiceMode="reuse";
  const fetch=vi.fn(async(url:string,request:RequestInit)=>{
    expect(url).toMatch(/text-to-speech\/approved_voice_id\?/);
    expect(JSON.parse(String(request.body)).text).toBe(source.command.text);
    return new Response(null,{status:429});
  });
  vi.stubGlobal("fetch",fetch);
  expect(await renderStoryElevenLabs(source,root)).toHaveProperty("reason");
  expect(fetch).not.toHaveBeenCalled();
  await expect(renderStoryElevenLabs(source,root,"approved_voice_id")).rejects.toMatchObject({status:429});
  expect(fetch).toHaveBeenCalledTimes(1);
});
