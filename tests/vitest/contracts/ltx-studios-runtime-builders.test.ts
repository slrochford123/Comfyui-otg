import {describe,it,expect} from "vitest";
import {buildLtxStudioWorkflow,LTX_STUDIO_RUNTIME} from "@/lib/ltxStudiosRuntime";
const base={mediaFilename:"qa-input.png",sourceWidth:720,sourceHeight:1280,longerSide:512,durationSeconds:2,fps:24,seed:42,outputPrefix:"QA/LTX",instruction:"A QA subject moves naturally.",negativePrompt:"blurry"};
describe("Qualified LTX 2.5 tool-specific architectures",()=>{
 it("repeats the Ingredients reference sheet into the official IC guide",()=>{
  const b=buildLtxStudioWorkflow({...base,tool:"ingredients"});
  expect(b.graph["1"].class_type).toBe("LoadImage");expect(b.graph["26"].inputs.amount).toBe(49);
  expect(b.graph["13"].inputs.image).toEqual(["26",0]);expect(b.graph["7"].inputs.lora_name).toBe(LTX_STUDIO_RUNTIME.ingredients.lora);
  expect(b.graph["8"].inputs.text).toBe(base.instruction);expect(b.workflowId).toBe("ltx-2.5-ingredients");
  expect(b.graph["24"].inputs.audio).toEqual(["27",0]);expect(b.graph["27"].class_type).toBe("LTXVAudioVAEDecode");
 });
 it("preserves bounded video conditioning for Colorization with its distinct IC-LoRA",()=>{
  const b=buildLtxStudioWorkflow({...base,tool:"colorization",mediaFilename:"qa-gray.mp4",sourceHasAudio:true});
  expect(b.graph["1"].class_type).toBe("VHS_LoadVideo");expect(b.graph["1"].inputs.frame_load_cap).toBe(b.frames);
  expect(b.graph["7"].inputs.lora_name).toBe(LTX_STUDIO_RUNTIME.colorization.lora);expect(b.graph["8"].inputs.text).toBe(base.instruction);
  expect(b.graph["24"].inputs.audio).toEqual(["1",2]);
 });
 it("does not ask VHS to decode nonexistent audio in silent videos",()=>{
  const b=buildLtxStudioWorkflow({...base,tool:"colorization",mediaFilename:"silent.mp4",sourceHasAudio:false});
  expect(b.graph["24"].inputs.audio).toBeUndefined();
 });
 it("separates motion conditioning from playback rather than just loading a speed LoRA",()=>{
  const b=buildLtxStudioWorkflow({...base,tool:"slow-motion-control",speed:0.2});
  expect(b.graph["7"].class_type).toBe("LoraLoaderModelOnly");expect(b.graph["13"].class_type).toBe("LTXVImgToVideo");
  expect(b.graph["10"].inputs.frame_rate).toBe(120);expect(b.graph["14"].inputs.frame_rate).toBe(24);expect(b.graph["24"].inputs.fps).toBe(24);
  expect(b.graph["7"].inputs.lora_name).toBe(LTX_STUDIO_RUNTIME["slow-motion-control"].lora);
 });
 it("rejects invalid motion speeds and playback rates",()=>{
  expect(()=>buildLtxStudioWorkflow({...base,tool:"slow-motion-control",speed:0})).toThrow("speed");
  expect(()=>buildLtxStudioWorkflow({...base,tool:"slow-motion-control",fps:30})).toThrow("24fps");
 });
 it("does not change the physically proven empty-text Alpha path",()=>{
  const b=buildLtxStudioWorkflow({...base,tool:"alpha-gen"});expect(b.graph["8"].inputs.text).toBe("");expect(b.graph["7"].inputs.lora_name).toBe(LTX_STUDIO_RUNTIME["alpha-gen"].lora);
 });
 it.each(["clean-plate","day-to-night","water-simulation","decompression","deblur","restore","refine-details"] as const)("wires the exact official %s adapter, bounded source and requested instruction",tool=>{
  const b=buildLtxStudioWorkflow({...base,tool,mediaFilename:"qa.mp4"});
  expect(b.graph["7"].inputs.lora_name).toBe(LTX_STUDIO_RUNTIME[tool].lora);
  expect(b.graph["7"].inputs.strength_model).toBe(LTX_STUDIO_RUNTIME[tool].strength);
  expect(b.graph["13"].inputs.image).toEqual([tool==="refine-details"?"12":"1",0]);expect(b.graph["8"].inputs.text).toBe(base.instruction);
  expect(b.graph["1"].inputs.frame_load_cap).toBe(b.frames);
 });
 it("uses standard I2V conditioning for Cinemagraph without the speed override",()=>{
  const b=buildLtxStudioWorkflow({...base,tool:"cinemagraph"});
  expect(b.graph["7"].class_type).toBe("LoraLoaderModelOnly");expect(b.graph["10"].inputs.frame_rate).toBe(24);
  expect(b.graph["13"].class_type).toBe("LTXVImgToVideo");
 });
 it("uses fixed HDR scene embeddings, ACES working space, float32 decode and real HDR export",()=>{
  const b=buildLtxStudioWorkflow({...base,tool:"sdr-to-hdr",instruction:"",sourceHasAudio:false});
  expect(b.graph["6"].class_type).toBe("LTXVLoadConditioning");expect(b.graph["8"]).toBeUndefined();
  expect(b.graph["12"].inputs.color_space).toBe("srgb_gamma");expect(b.graph["23"].inputs.vae).toEqual(["29",0]);
  expect(b.graph["4"].inputs.vae_name).toBe("TEST-LTX-Closure/hdr-video-vae-bf16.safetensors");
  expect(b.graph["28"].class_type).toBe("TESTLTXHDRExport");expect(b.graph["28"].inputs.audio).toBeUndefined();
  expect(b.graph["24"].inputs.images).toEqual(["28",0]);
 });
 it("requires a separate look image and preserves frame roles on both Layout stages",()=>{
  expect(()=>buildLtxStudioWorkflow({...base,tool:"layout-to-render"})).toThrow("look image");
  const b=buildLtxStudioWorkflow({...base,tool:"layout-to-render",lookFilename:"look.png"});
  expect(b.graph["13"].inputs.frame_idx).toBe(0);expect(b.graph["30"].inputs.frame_idx).toBe(-1);
  expect(b.graph["35"].inputs.frame_idx).toBe(0);expect(b.graph["36"].inputs.frame_idx).toBe(-1);
  expect(b.graph["32"].class_type).toBe("LTXVLatentUpsampler");expect(b.graph["40"].inputs.sigmas).toBe("0.909375, 0.725, 0.421875, 0.0");
  expect(b.graph["23"].inputs.samples).toEqual(["43",2]);expect(b.width%64).toBe(0);expect(b.height%64).toBe(0);
  expect(b.graph["15"]).toBeUndefined();
 });
 it("bounds Restore to the official 97-frame window",()=>{
  expect(()=>buildLtxStudioWorkflow({...base,tool:"restore",durationSeconds:6})).toThrow("97 frames");
 });
 it("refines with the trained tile scale and shared per-step fusion instead of an untiled AV pass",()=>{
  const b=buildLtxStudioWorkflow({...base,tool:"refine-details",longerSide:1024});
  expect(b.graph["20"].class_type).toBe("LTXVTiledFusionSampler");
  expect(b.graph["12"].inputs.upscale_method).toBe("lanczos");expect(b.graph["1"].inputs.custom_width).toBe(0);
  expect(b.graph["20"].inputs).toMatchObject({tile_width:576,tile_height:1024,overlap_frac:0.5,blend_var:0.05,grid_cycle:1,seed:42});
  expect(b.graph["20"].inputs.latents).toEqual(["13",2]);expect(b.graph["23"].inputs.samples).toEqual(["20",0]);
  expect(b.graph["22"]).toBeUndefined();
  expect(b.graph["15"]).toBeUndefined();
 });
});
