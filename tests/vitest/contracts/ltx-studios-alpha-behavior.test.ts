import {describe,it,expect,vi} from "vitest";
import {inspectH3LtxAlphaCompatibility,H3_LTX_ALPHA_MODEL_ASSETS,H3_LTX_ALPHA_LORA_NAME} from "@/lib/h3SpecialModes/ltxAlphaMotion";
import {buildLtxStudiosAlpha} from "@/lib/ltxStudiosAlpha";
const input={videoFilename:"qa.mp4",sourceWidth:608,sourceHeight:352,longerSide:512,durationSeconds:2,fps:24,seed:123,outputPrefix:"TEST/alpha"};
describe("LTX Studios Alpha runtime graph",()=>{
 it("uses the exact Alpha Gen model, empty conditioning and bounded source frames",()=>{const r=buildLtxStudiosAlpha(input);expect(r.frames).toBe(41);expect(r.graph["7"].inputs.lora_name).toBe("ltx-2.5-22b-ic-lora-alpha-gen-0.9.safetensors");expect(r.graph["8"].inputs.text).toBe("");expect(r.graph["9"].inputs.text).toBe("");expect(r.graph["1"].inputs.frame_load_cap).toBe(41);expect(r.graph["13"].inputs.image).toEqual(["1",0]);});
 it("preserves portrait orientation and the 145-frame ceiling",()=>{const r=buildLtxStudiosAlpha({...input,sourceWidth:352,sourceHeight:608,durationSeconds:30});expect(r.height).toBeGreaterThan(r.width);expect(r.frames).toBe(145);});
 it("rejects unavailable source dimensions",()=>expect(()=>buildLtxStudiosAlpha({...input,sourceWidth:0})).toThrow("dimensions"));
 it("recognizes installed assets in the current COMBO options schema",async()=>{
  vi.stubGlobal("fetch",vi.fn(async(url:string)=>{const node=url.split("/").pop()!;const fields=node==="UNETLoader"?{unet_name:["COMBO",{options:[H3_LTX_ALPHA_MODEL_ASSETS.diffusionModel]}]}:node==="VAELoader"?{vae_name:["COMBO",{options:[H3_LTX_ALPHA_MODEL_ASSETS.videoVae,H3_LTX_ALPHA_MODEL_ASSETS.audioVae]}]}:node==="CLIPLoader"?{clip_name:["COMBO",{options:[H3_LTX_ALPHA_MODEL_ASSETS.textEncoder]}]}:node==="LTXICLoRALoaderModelOnly"?{lora_name:["COMBO",{options:[H3_LTX_ALPHA_LORA_NAME]}]}:{};return Response.json({[node]:{input:{required:fields}}});}));
  try{expect((await inspectH3LtxAlphaCompatibility("http://qa-worker")).compatible).toBe(true);}finally{vi.unstubAllGlobals();}
 });
});
