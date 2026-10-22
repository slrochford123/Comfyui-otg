import {buildH3LtxAlphaWorkflow} from "@/lib/h3SpecialModes/ltxAlphaMotion";

export function buildLtxStudiosAlpha(input: {videoFilename:string;sourceWidth:number;sourceHeight:number;longerSide:number;durationSeconds:number;fps:number;seed:number;outputPrefix:string}) {
  if (!(input.sourceWidth>0&&input.sourceHeight>0)) throw new Error("Source video dimensions are unavailable.");
  const scale=input.longerSide/Math.max(input.sourceWidth,input.sourceHeight);
  const width=Math.max(32,Math.floor(input.sourceWidth*scale/32)*32);
  const height=Math.max(32,Math.floor(input.sourceHeight*scale/32)*32);
  const frames=Math.max(9,Math.min(145,Math.floor((input.durationSeconds*input.fps-1)/8)*8+1));
  const built=buildH3LtxAlphaWorkflow({...input,width,height,frames});
  // Match the reference and output temporal extent instead of decoding all
  // source frames into a shorter latent. Alpha Gen requires empty text.
  built.graph["1"]={class_type:"VHS_LoadVideo",inputs:{video:input.videoFilename,force_rate:input.fps,custom_width:width,custom_height:height,frame_load_cap:frames,skip_first_frames:0,select_every_nth:1,format:"LTXV"}};
  delete built.graph["2"];
  built.graph["13"].inputs.image=["1",0];
  return {...built,width,height,frames};
}
