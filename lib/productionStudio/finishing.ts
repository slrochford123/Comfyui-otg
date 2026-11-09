import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {probe} from "./media";
const exec=promisify(execFile);
/** Keep the qualified VSR graph at 1920x1080. CPU rotation/padding/cropping
 * adapts the canvas, not the model; original aspect, frame order and audio survive. */
export function finishingGeometry(width:number,height:number){
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<16||height<16)throw Error("Source video dimensions are unavailable.");
 const portrait=height>width,w=portrait?height:width,h=portrait?width:height;
 const canvasWidth=Math.ceil(Math.max(w,h*16/9)/32)*32,canvasHeight=canvasWidth*9/16;
 const x=Math.floor((canvasWidth-w)/2),y=Math.floor((canvasHeight-h)/2);
 const even=(n:number)=>Math.round(n/2)*2;
 const cropWidth=even(w/canvasWidth*1920),cropHeight=even(h/canvasHeight*1080),cropX=Math.min(1920-cropWidth,even(x/canvasWidth*1920)),cropY=Math.min(1080-cropHeight,even(y/canvasHeight*1080));
 const targetWidth=even(Math.sqrt(1_000_000*width/height)),targetHeight=even(targetWidth*height/width);
 return{width,height,portrait,canvasWidth,canvasHeight,targetWidth,targetHeight,
  prepare:[portrait?"transpose=1":"",`pad=${canvasWidth}:${canvasHeight}:${x}:${y}:black`,"setsar=1"].filter(Boolean).join(","),
  finish:[`crop=${cropWidth}:${cropHeight}:${cropX}:${cropY}`,portrait?"transpose=2":"",`scale=${targetWidth}:${targetHeight}:flags=lanczos`,"setsar=1"].filter(Boolean).join(",")};
}
export async function transformFinishVideo(source:string,dest:string,filter:string){await exec("ffmpeg",["-v","error","-nostdin","-y","-protocol_whitelist","file,pipe","-i",source,"-map","0:v:0","-map","0:a?","-vf",filter,"-c:v","libx264","-preset","fast","-crf","16","-pix_fmt","yuv420p","-c:a","copy","-fps_mode","passthrough","-movflags","+faststart",dest],{timeout:120000});}
export async function verifyFinishedVideo(source:string,finished:string,geometry:ReturnType<typeof finishingGeometry>){
 const original=await probe(source),actual=await probe(finished),v=actual.streams.find(s=>s.codec_type==="video"),prior=original.streams.find(s=>s.codec_type==="video");
 if(v?.width!==geometry.targetWidth||v?.height!==geometry.targetHeight)throw Error("Finishing returned unexpected dimensions. The original take is preserved.");
 const duration=Number(actual.format.duration),sourceDuration=Number(original.format.duration);
 const fps=(value:string|undefined)=>{const [a,b]=String(value||"0/1").split("/").map(Number);return a/(b||1);};
 if(!Number.isFinite(duration)||Math.abs(duration-sourceDuration)>.15||Math.abs(fps(v.avg_frame_rate)-fps(prior?.avg_frame_rate))>.01)throw Error("Finishing changed timing or frame rate. The original take is preserved.");
 if(original.streams.some(s=>s.codec_type==="audio")&&!actual.streams.some(s=>s.codec_type==="audio"))throw Error("Finishing output is missing the source audio. The original take is preserved.");
 return{duration,width:v.width,height:v.height,megapixels:v.width*v.height/1e6,fps:fps(v.avg_frame_rate)};
}
