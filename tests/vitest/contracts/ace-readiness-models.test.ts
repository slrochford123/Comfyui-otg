import {afterEach,describe,it,expect,vi} from "vitest";
import {ACE_MODELS,aceModelName,aceModelSettings,aceStepReadiness} from "@/lib/aceStepReadiness";
afterEach(()=>vi.restoreAllMocks());
describe("ACE-Step readiness and exact XL preset identity",()=>{
  it.each(Object.entries(ACE_MODELS))("routes %s to its distinct intended XL model",(preset,name)=>expect(aceModelName(preset)).toBe(name));
  it("rejects arbitrary, inherited or nonexistent presets rather than silently generating Turbo",()=>{
    for(const input of ["arbitrary-model","constructor","__proto__","toString"])expect(()=>aceModelName(input)).toThrow("supported");
  });
  it("uses the intended Turbo 8-step versus Base/SFT 50-step CFG recipes",()=>{
    expect(aceModelSettings("turbo")).toMatchObject({inferenceSteps:8,guidanceScale:1});
    for(const model of ["base","sft"])expect(aceModelSettings(model)).toMatchObject({inferenceSteps:50,guidanceScale:7});
  });
  it("does not equate reachability, an installed model or a stale loaded flag with initialized readiness",async()=>{
    vi.spyOn(globalThis,"fetch").mockImplementation(async url=>Response.json({data:String(url).endsWith("/health")?{models_initialized:false}:String(url).endsWith("/v1/stats")?{queue_size:0,jobs:{running:0,queued:0}}:{models:[{name:ACE_MODELS.turbo,is_loaded:true}]}}));
    const status=await aceStepReadiness("http://qa-provider");
    expect(status.reachable).toBe(true);expect(status.presets.turbo.installed).toBe(true);expect(status.presets.turbo.ready).toBe(false);expect(status.presets.base.installed).toBe(false);
  });
  it("reports Ready only for the exact initialized and registered model",async()=>{
    vi.spyOn(globalThis,"fetch").mockImplementation(async url=>Response.json({data:String(url).endsWith("/health")?{models_initialized:true}:String(url).endsWith("/v1/stats")?{queue_size:0,jobs:{running:0,queued:0}}:{models:[{name:ACE_MODELS.base,is_loaded:true},{name:ACE_MODELS.turbo,is_loaded:false}]}}));
    const status=await aceStepReadiness("http://qa-provider");expect(status.presets.base.ready).toBe(true);expect(status.presets.turbo.ready).toBe(false);
  });
  it("does not show Ready while a registered model is busy",async()=>{
    vi.spyOn(globalThis,"fetch").mockImplementation(async url=>Response.json({data:String(url).endsWith("/health")?{models_initialized:true}:String(url).endsWith("/v1/stats")?{queue_size:0,jobs:{running:1,queued:0}}:{models:[{name:ACE_MODELS.base,is_loaded:true}]}}));
    const status=await aceStepReadiness("http://qa-provider");expect(status.busy).toBe(true);expect(status.presets.base.ready).toBe(false);
  });
});
