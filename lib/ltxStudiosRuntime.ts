import {buildLtxStudiosAlpha} from "@/lib/ltxStudiosAlpha";
import {inspectH3LtxAlphaCompatibility} from "@/lib/h3SpecialModes/ltxAlphaMotion";

export const LTX_STUDIO_RUNTIME = {
 "alpha-gen":{name:"Alpha Gen",image:false,revision:"alpha-gen-v1-bounded-guide",lora:"ltx-2.5-22b-ic-lora-alpha-gen-0.9.safetensors",strength:1},
 ingredients:{name:"Ingredients",image:true,revision:"ingredients-v1-reference-sheet",lora:"TEST-LTX-Closure/ltx-2.5-22b-ic-lora-ingredients-0.9.safetensors",strength:1.3},
 colorization:{name:"Colorization",image:false,revision:"colorization-v1-video-guide",lora:"TEST-LTX-Closure/ltx-2.5-22b-ic-lora-colorization-0.9.safetensors",strength:1},
 "slow-motion-control":{name:"Slow Motion Control",image:true,revision:"slow-motion-v1-dual-fps",lora:"TEST-LTX-Closure/ltx-2.5-22b-lora-slow-motion-control-1.0.safetensors",strength:1},
 cinemagraph:{name:"Cinemagraph",image:true,revision:"cinemagraph-v1-i2v",lora:"TEST-LTX-Closure/ltx-2.5-22b-lora-cinemagraph-0.9.safetensors",strength:1},
 "clean-plate":{name:"Clean Plate",image:false,revision:"clean-plate-v1-video-guide",lora:"TEST-LTX-Closure/ltx-2.5-22b-ic-lora-clean-plate-1.0.safetensors",strength:1},
 "day-to-night":{name:"Day-to-Night",image:false,revision:"day-to-night-v1-video-guide",lora:"TEST-LTX-Closure/ltx-2.5-22b-ic-lora-day-to-night-0.9.safetensors",strength:1},
 "water-simulation":{name:"Water Simulation",image:false,revision:"water-v1-video-guide",lora:"TEST-LTX-Closure/ltx-2.5-22b-ic-lora-water-simulation-0.9.safetensors",strength:1.2},
 decompression:{name:"Decompression",image:false,revision:"decompression-v1-video-guide",lora:"TEST-LTX-Closure/ltx-2.5-22b-ic-lora-decompression-0.9.safetensors",strength:1},
 deblur:{name:"Deblur",image:false,revision:"deblur-v1-video-guide",lora:"TEST-LTX-Closure/ltx-2.5-22b-ic-lora-deblur-0.9.safetensors",strength:1},
 restore:{name:"Restore",image:false,revision:"restore-v1-bounded-video-guide",lora:"TEST-LTX-Closure/ltx-2.5-22b-ic-lora-restore-1.0.safetensors",strength:1},
 "refine-details":{name:"Refine Details",image:false,revision:"refine-v3-cropped-tiled-fusion",lora:"TEST-LTX-Closure/ltx-2.5-22b-ic-lora-refine-details-1.0.safetensors",strength:1},
 "sdr-to-hdr":{name:"SDR-to-HDR",image:false,revision:"hdr-v2-isolated-aces-exr-hlg",lora:"TEST-LTX-Closure/ltx-2.5-22b-ic-lora-sdr-to-hdr-1.0.safetensors",strength:1},
 "layout-to-render":{name:"Layout-to-Render",image:false,revision:"layout-v1-look-minus-one-two-stage",lora:"TEST-LTX-Closure/ltx-2.5-22b-ic-lora-layout-to-render-1.0.safetensors",strength:1},
} as const;
export type LtxStudioRuntimeTool=keyof typeof LTX_STUDIO_RUNTIME;
export function isLtxStudioRuntimeTool(value:string):value is LtxStudioRuntimeTool{return Object.prototype.hasOwnProperty.call(LTX_STUDIO_RUNTIME,value);}

export function buildLtxStudioWorkflow(input:{tool:LtxStudioRuntimeTool;mediaFilename:string;sourceWidth:number;sourceHeight:number;longerSide:number;durationSeconds:number;fps:number;seed:number;outputPrefix:string;instruction:string;negativePrompt:string;speed?:number;sourceHasAudio?:boolean;lookFilename?:string}){
 const definition=LTX_STUDIO_RUNTIME[input.tool];
 if(input.tool!=="alpha-gen"&&input.tool!=="sdr-to-hdr"&&!input.instruction.trim())throw Error("A scene description is required.");
 const built=buildLtxStudiosAlpha({...input,videoFilename:input.mediaFilename});
 if(input.tool==="alpha-gen")return built;
 const graph=built.graph;
 if(input.tool==="layout-to-render"){
  built.width=Math.max(64,Math.floor(built.width/64)*64);built.height=Math.max(64,Math.floor(built.height/64)*64);
  graph["1"].inputs.custom_width=built.width;graph["1"].inputs.custom_height=built.height;
  graph["11"].inputs.width=built.width;graph["11"].inputs.height=built.height;
 }
 const frames=definition.image?Math.min(145,Math.max(9,Math.floor(input.durationSeconds*input.fps/8)*8+1)):built.frames;
 if(input.tool==="restore"&&frames>97)throw Error("Restore supports at most 97 frames per window. Trim the source first.");
 graph["11"].inputs.length=frames;graph["14"].inputs.frames_number=frames;
 graph["8"].inputs.text=input.instruction;graph["9"].inputs.text=input.negativePrompt;
 graph["7"].inputs.lora_name=definition.lora;graph["7"].inputs.strength_model=definition.strength;
 if(definition.image){
  graph["1"]={class_type:"LoadImage",inputs:{image:input.mediaFilename}};
  graph["12"]={class_type:"ImageScale",inputs:{image:["1",0],upscale_method:"lanczos",width:built.width,height:built.height,crop:"disabled"}};
  if(input.tool==="ingredients"){
   graph["26"]={class_type:"RepeatImageBatch",inputs:{image:["12",0],amount:frames}};
   graph["13"].inputs.image=["26",0];graph["17"].inputs.sampler_name="euler_ancestral_cfg_pp";
  }else{
   const speed=input.tool==="slow-motion-control"?Number(input.speed??0.2):1;if(!Number.isFinite(speed)||speed<0.025||speed>1)throw Error("Motion speed must be between 0.025 and 1.");
   if(input.tool==="slow-motion-control"&&input.fps!==24)throw Error("Slow Motion Control requires 24fps playback.");
   graph["7"]={class_type:"LoraLoaderModelOnly",inputs:{model:["5",0],lora_name:definition.lora,strength_model:1}};
   graph["10"].inputs.frame_rate=input.fps/speed;
   graph["13"]={class_type:"LTXVImgToVideo",inputs:{positive:["10",0],negative:["10",1],vae:["4",0],image:["12",0],width:built.width,height:built.height,length:frames,batch_size:1,strength:1}};
  }
 }else graph["1"].inputs.frame_load_cap=frames;
 if(definition.image){
  graph["27"]={class_type:"LTXVAudioVAEDecode",inputs:{samples:["21",1],audio_vae:["3",0]}};
  graph["24"].inputs.audio=["27",0];
 }else if(input.sourceHasAudio)graph["24"].inputs.audio=["1",2];
 if(input.tool==="refine-details"){
  // Official trained-window fusion, including the single-tile case. No
  // generated audio: preserve only an actual source track on final encode.
  graph["17"].inputs.sampler_name="euler";
  graph["1"].inputs.custom_width=0;graph["1"].inputs.custom_height=0;
  graph["12"]={class_type:"ImageScale",inputs:{image:["1",0],upscale_method:"lanczos",width:built.width,height:built.height,crop:"disabled"}};
  graph["13"].inputs.image=["12",0];
  graph["20"]={class_type:"LTXVTiledFusionSampler",inputs:{model:["7",0],positive:["13",0],negative:["13",1],latents:["13",2],sigmas:["18",0],sampler:["17",0],seed:input.seed,cfg:1,tile_width:built.width>built.height?1024:576,tile_height:built.width>built.height?576:1024,overlap_frac:0.5,blend_var:0.05,grid_cycle:1,tile_frames:0,vae:["4",0],canvas_device:"auto"}};
  // The official tiled sampler returns content-only latents. Cropping the
  // guide a second time removes the actual video frames before VAE decode.
  graph["23"].inputs.samples=["20",0];delete graph["22"];delete graph["14"];delete graph["15"];delete graph["21"];
 }
 if(input.tool==="sdr-to-hdr"){
  // The official float32 node mutates its input object. A distinct loader
  // cache key keeps HDR from changing later non-HDR jobs' shared VAE dtype.
  graph["4"].inputs.vae_name="TEST-LTX-Closure/hdr-video-vae-bf16.safetensors";
  delete graph["8"];delete graph["9"];
  graph["6"]={class_type:"LTXVLoadConditioning",inputs:{file_name:"TEST-LTX-Closure/ltx-2.5-22b-ic-lora-sdr-to-hdr-scene-emb.safetensors",device:"cpu"}};
  graph["10"].inputs.positive=["6",0];graph["10"].inputs.negative=["6",0];
  graph["12"]={class_type:"LTXVSDRToHDRWorkingSpace",inputs:{image:["1",0],color_space:"srgb_gamma"}};
  graph["29"]={class_type:"LTXVVAEForceFloat32",inputs:{vae:["4",0]}};
  graph["13"].inputs.image=["12",0];graph["13"].inputs.vae=["29",0];graph["23"].inputs.vae=["29",0];
  graph["17"].inputs.sampler_name="euler";
  graph["28"]={class_type:"TESTLTXHDRExport",inputs:{image:["23",0],frame_rate:input.fps,filename_prefix:input.outputPrefix,...(input.sourceHasAudio?{audio:["1",2]}:{})}};
  graph["24"].inputs.images=["28",0];
 }
 if(input.tool==="layout-to-render"){
  if(!input.lookFilename)throw Error("Layout-to-Render requires a finished look image as well as the layout video.");
  if(built.width%64||built.height%64)throw Error("Layout-to-Render stage dimensions must be divisible by 64.");
  // Official two-stage recipe: full layout at t=0, independent look at t=-1.
  graph["28"]={class_type:"LoadImage",inputs:{image:input.lookFilename}};
  graph["29"]={class_type:"ImageScale",inputs:{image:["28",0],upscale_method:"lanczos",width:built.width,height:built.height,crop:"disabled"}};
  graph["30"]={class_type:"LTXAddVideoICLoRAGuide",inputs:{...graph["13"].inputs,positive:["13",0],negative:["13",1],latent:["13",2],image:["29",0],frame_idx:-1,crop:"center"}};
  graph["16"].inputs.positive=["30",0];graph["16"].inputs.negative=["30",1];graph["20"].inputs.latent_image=["30",2];
  graph["22"].inputs.positive=["30",0];graph["22"].inputs.negative=["30",1];graph["22"].inputs.latent=["20",0];
  delete graph["14"];delete graph["15"];delete graph["21"];
  graph["31"]={class_type:"LatentUpscaleModelLoader",inputs:{model_name:"ltx-2.5-latent-spatial-upscaler-x2-bf16-1.0.safetensors"}};
  graph["32"]={class_type:"LTXVLatentUpsampler",inputs:{samples:["22",2],upscale_model:["31",0],vae:["4",0]}};
  graph["33"]={class_type:"ImageScale",inputs:{...graph["29"].inputs,width:built.width*2,height:built.height*2}};
  graph["34"]={class_type:"VHS_LoadVideo",inputs:{...graph["1"].inputs,custom_width:built.width*2,custom_height:built.height*2}};
  graph["35"]={class_type:"LTXAddVideoICLoRAGuide",inputs:{...graph["13"].inputs,latent:["32",0],image:["34",0]}};
  graph["36"]={class_type:"LTXAddVideoICLoRAGuide",inputs:{...graph["30"].inputs,positive:["35",0],negative:["35",1],latent:["35",2],image:["33",0]}};
  graph["39"]={class_type:"CFGGuider",inputs:{...graph["16"].inputs,positive:["36",0],negative:["36",1]}};
  graph["40"]={class_type:"ManualSigmas",inputs:{sigmas:"0.909375, 0.725, 0.421875, 0.0"}};
  graph["41"]={class_type:"SamplerCustomAdvanced",inputs:{...graph["20"].inputs,guider:["39",0],sigmas:["40",0],latent_image:["36",2]}};
  graph["43"]={class_type:"LTXVCropGuides",inputs:{positive:["36",0],negative:["36",1],latent:["41",0]}};
  graph["23"].inputs.samples=["43",2];
  return {...built,workflowId:`ltx-2.5-${input.tool}`,workflowFile:definition.revision,frames,width:built.width*2,height:built.height*2};
 }
 return {...built,workflowId:`ltx-2.5-${input.tool}`,workflowFile:definition.revision,frames};
}

function options(raw:any):string[]{if(!Array.isArray(raw))return [];return Array.isArray(raw[0])?raw[0]:Array.isArray(raw[1]?.options)?raw[1].options:[];}
export async function inspectLtxStudioRuntime(base:string,tool:LtxStudioRuntimeTool){
 const common=await inspectH3LtxAlphaCompatibility(base);if(tool==="alpha-gen")return common;
 const definition=LTX_STUDIO_RUNTIME[tool];const loader=tool==="slow-motion-control"||tool==="cinemagraph"?"LoraLoaderModelOnly":"LTXICLoRALoaderModelOnly";
 const required=[loader,...(definition.image?["LoadImage","ImageScale","LTXVAudioVAEDecode",tool==="ingredients"?"RepeatImageBatch":"LTXVImgToVideo"]:[]),...(tool==="refine-details"?["LTXVTiledFusionSampler"]:[]),...(tool==="sdr-to-hdr"?["LTXVLoadConditioning","LTXVSDRToHDRWorkingSpace","LTXVVAEForceFloat32","TESTLTXHDRExport"]:[]),...(tool==="layout-to-render"?["LoadImage","ImageScale","LatentUpscaleModelLoader","LTXVLatentUpsampler"]:[])];
 if(tool==="refine-details")required.push("ImageScale");
 if(tool==="sdr-to-hdr")required.push("VAELoader");
 const records=await Promise.all(required.map(async node=>{try{const r=await fetch(base+'/object_info/'+node,{cache:'no-store',signal:AbortSignal.timeout(10000)});return [node,(await r.json())?.[node]] as const;}catch{return[node,null] as const;}}));
 const missingNodes=[...common.missingNodes,...records.filter(([,v])=>!v).map(([k])=>k)];
 const schema=records.find(([k])=>k===loader)?.[1];const hasLora=options(schema?.input?.required?.lora_name).includes(definition.lora);
 const missingAssets=[...common.missingAssets.filter(name=>name!==LTX_STUDIO_RUNTIME["alpha-gen"].lora),...(hasLora?[]:[definition.lora])];
 if(tool==="sdr-to-hdr"&&!options(records.find(([k])=>k==="LTXVLoadConditioning")?.[1]?.input?.required?.file_name).includes("TEST-LTX-Closure/ltx-2.5-22b-ic-lora-sdr-to-hdr-scene-emb.safetensors"))missingAssets.push("SDR-to-HDR fixed scene embedding");
 if(tool==="sdr-to-hdr"&&!options(records.find(([k])=>k==="VAELoader")?.[1]?.input?.required?.vae_name).includes("TEST-LTX-Closure/hdr-video-vae-bf16.safetensors"))missingAssets.push("Isolated HDR VAE loader");
 if(tool==="layout-to-render"&&!options(records.find(([k])=>k==="LatentUpscaleModelLoader")?.[1]?.input?.required?.model_name).includes("ltx-2.5-latent-spatial-upscaler-x2-bf16-1.0.safetensors"))missingAssets.push("LTX 2.5 spatial x2 upscaler");
 return {compatible:missingNodes.length===0&&missingAssets.length===0,missingNodes,missingAssets,workflowFile:definition.revision};
}
