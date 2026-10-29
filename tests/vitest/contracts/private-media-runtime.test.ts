import {afterEach,describe,expect,it,vi} from "vitest";
import {execFileSync} from "node:child_process";
import {privateMediaEnvironmentEnabled,privateMediaFeatureEnabled} from "@/lib/privateMediaRuntime";
afterEach(()=>vi.unstubAllEnvs());
describe("explicit private research deployment without changing production identity",()=>{
  it("preserves TEST behavior",()=>{vi.stubEnv("OTG_ENV","test");vi.stubEnv("OTG_MEDIA_GPU_ROUTING","1");expect(privateMediaFeatureEnabled("OTG_MEDIA_GPU_ROUTING")).toBe(true);});
  it("leaves an existing production installation unchanged by default",()=>{vi.stubEnv("OTG_ENV","prod");vi.stubEnv("OTG_PRIVATE_RESEARCH_MEDIA","");vi.stubEnv("OTG_MEDIA_GPU_ROUTING","1");expect(privateMediaEnvironmentEnabled()).toBe(false);});
  it("enables approved production features explicitly while keeping OTG_ENV prod",()=>{vi.stubEnv("OTG_ENV","prod");vi.stubEnv("OTG_PRIVATE_RESEARCH_MEDIA","1");vi.stubEnv("OTG_MEDIA_GPU_ROUTING","1");vi.stubEnv("OTG_AUDIO_EDITING_ENABLED","1");expect(privateMediaFeatureEnabled("OTG_MEDIA_GPU_ROUTING")).toBe(true);expect(privateMediaFeatureEnabled("OTG_AUDIO_EDITING_ENABLED")).toBe(true);expect(process.env.OTG_ENV).toBe("prod");});
  it("retains per-feature kill switches",()=>{vi.stubEnv("OTG_ENV","prod");vi.stubEnv("OTG_PRIVATE_RESEARCH_MEDIA","1");vi.stubEnv("OTG_AUDIO_EDITING_ENABLED","0");expect(privateMediaFeatureEnabled("OTG_AUDIO_EDITING_ENABLED")).toBe(false);});
  it("verifies persistent physical fencing and concurrent contenders without GPU work",()=>{expect(()=>execFileSync("python3",["tests/media_admission_test.py"],{timeout:30000,stdio:"pipe"})).not.toThrow();});
  it("preserves production policy and refuses live, unknown or unreleased jobs",()=>{expect(()=>execFileSync("python3",["tests/private_media_activation_test.py"],{timeout:30000,stdio:"pipe"})).not.toThrow();});
});
