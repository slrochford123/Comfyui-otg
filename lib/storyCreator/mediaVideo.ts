import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {resolveFfmpegPath,resolveFfprobePath} from "@/lib/ffmpeg";

const run=promisify(execFile);
async function probe(file:string) {
  const result=await run(resolveFfprobePath(),["-v","error","-show_streams","-of","json",file],{timeout:30_000,maxBuffer:256*1024});
  return JSON.parse(result.stdout).streams as {codec_type:string;width?:number;height?:number;duration?:string;avg_frame_rate?:string;nb_frames?:string}[];
}
/** H3's native temporal alignment can add four frames. Trim only our derived preview. */
export async function finalizeStoryPreview(source:string,destination:string) {
  const streams=await probe(source),video=streams.find(s=>s.codec_type==="video");
  if(!video||video.avg_frame_rate!=="24/1"||Number(video.duration)<5||Number(video.nb_frames)<120)throw Error("The video worker returned an incomplete preview. No frozen frames were added.");
  const audio=streams.some(s=>s.codec_type==="audio");
  await run(resolveFfmpegPath(),["-nostdin","-hide_banner","-loglevel","error","-y","-threads","2","-i",source,
    "-map","0:v:0",...(audio?["-map","0:a:0","-af","atrim=duration=5,asetpts=PTS-STARTPTS","-c:a","aac","-b:a","192k"]:["-an"]),
    "-vf","trim=end_frame=120,setpts=PTS-STARTPTS","-frames:v","120","-t","5","-c:v","libx264","-preset","fast","-crf","18","-pix_fmt","yuv420p","-threads","2","-movflags","+faststart",destination],
    {timeout:120_000,maxBuffer:256*1024});
  const result=(await probe(destination)).find(s=>s.codec_type==="video");
  if(!result||result.nb_frames!=="120"||result.avg_frame_rate!=="24/1"||Math.abs(Number(result.duration)-5)>0.01||result.width!==video.width||result.height!==video.height)throw Error("The preview failed its frame-count and duration checks.");
  return destination;
}
