import {afterEach,expect,it,vi} from "vitest";
import fs from "node:fs";
import {refVoiceRuntime} from "@/lib/h3SpecialModes/voiceDesignRuntime";
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();});
it("selects only the root-owned restricted Qwen production connection",()=>{
  vi.stubEnv("OTG_ENV","prod");vi.stubEnv("OTG_H3_CHARACTER_REFCARDS_ENABLED","1");vi.stubEnv("OTG_STORY_QWEN_REMOTE_CONFIG","/private/qwen.json");
  vi.spyOn(fs,"lstatSync").mockReturnValue({isFile:()=>true,isSymbolicLink:()=>false,uid:0,mode:0o100600} as fs.Stats);
  const read=vi.spyOn(fs,"readFileSync").mockReturnValue(JSON.stringify({transports:{rtx3090:{protocol:"slr-audio-v1",qualified:true,host:"shawn-rochford@100.75.162.64"}}}));
  expect(refVoiceRuntime("qwen3")?.remoteConfig).toBe("/private/qwen.json");
  for(const id of ["auk","cosy","h3"])expect(refVoiceRuntime(id)).toBeNull();
  read.mockReturnValue(JSON.stringify({transports:{rtx3090:{protocol:"shell",qualified:true,host:"another-host"}}}));
  expect(refVoiceRuntime("qwen3")).toBeNull();
});
it("rejects missing rollout, writable or linked production config",()=>{
  vi.stubEnv("OTG_ENV","prod");vi.stubEnv("OTG_H3_CHARACTER_REFCARDS_ENABLED","0");
  expect(refVoiceRuntime("qwen3")).toBeNull();
  vi.stubEnv("OTG_H3_CHARACTER_REFCARDS_ENABLED","1");vi.stubEnv("OTG_STORY_QWEN_REMOTE_CONFIG","relative.json");
  expect(refVoiceRuntime("qwen3")).toBeNull();
  vi.stubEnv("OTG_STORY_QWEN_REMOTE_CONFIG","/private/qwen.json");
  const stat=vi.spyOn(fs,"lstatSync");
  for(const value of [{uid:1000,mode:0o100600,link:false},{uid:0,mode:0o100644,link:false},{uid:0,mode:0o100600,link:true}]){
    stat.mockReturnValue({isFile:()=>true,isSymbolicLink:()=>value.link,...value} as fs.Stats);
    expect(refVoiceRuntime("qwen3")).toBeNull();
  }
});
