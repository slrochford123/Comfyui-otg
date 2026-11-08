import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {resolveFfmpegPath,resolveFfprobePath} from "@/lib/ffmpeg";

const run=promisify(execFile);
async function probe(file:string) {
  const result=await run(resolveFfprobePath(),["-v","error","-show_streams","-of","json",file],{timeout:30_000,maxBuffer:256*1024});
  return JSON.parse(result.stdout).streams as {codec_type:string;width?:number;height?:number;duration?:string;avg_frame_rate?:string;nb_frames?:string}[];
}
/** H3's native temporal alignment can add four frames. Trim only our derived preview. */
export async function finalizeStoryPreview(source:string,destination:string,seconds=5) {
  const frames=Math.round(seconds*24);
  if(!Number.isFinite(seconds)||seconds<1||seconds>10||Math.abs(frames/24-seconds)>0.001)
    throw Error("Choose a clip duration between 1 and 10 seconds aligned to a 24 FPS frame.");
  const streams=await probe(source),video=streams.find(s=>s.codec_type==="video");
  if(!video||video.avg_frame_rate!=="24/1"||Number(video.duration)<seconds-.01||Number(video.nb_frames)<frames)throw Error("The video worker returned an incomplete preview. No frozen frames were added.");
  const audio=streams.some(s=>s.codec_type==="audio");
  await run(resolveFfmpegPath(),["-nostdin","-hide_banner","-loglevel","error","-y","-threads","2","-i",source,
    "-map","0:v:0",...(audio?["-map","0:a:0","-af",`atrim=duration=${seconds},asetpts=PTS-STARTPTS`,"-c:a","aac","-b:a","192k"]:["-an"]),
    "-vf",`trim=end_frame=${frames},setpts=PTS-STARTPTS`,"-frames:v",String(frames),"-t",String(seconds),"-c:v","libx264","-preset","fast","-crf","18","-pix_fmt","yuv420p","-threads","2","-movflags","+faststart",destination],
    {timeout:120_000,maxBuffer:256*1024});
  const result=(await probe(destination)).find(s=>s.codec_type==="video");
  if(!result||Number(result.nb_frames)!==frames||result.avg_frame_rate!=="24/1"||Math.abs(Number(result.duration)-seconds)>0.01||result.width!==video.width||result.height!==video.height)throw Error("The preview failed its frame-count and duration checks.");
  return destination;
}

/** MiniMax base and Ref2VA use different prompt sections. Image roles follow actual conditioning. */
export function storyVideoPrompt(action: string, mode: "text" | "reference" | "first-frame", seconds: number, subject: string, native: number) {
  const name = subject.replace(/[<>\n\r]/g,"").slice(0,100) || "the supplied subject";
  const body = `[Shot 1] ${action.trim()}${seconds < native ? ` Complete the action by ${seconds} seconds, then hold the final state until the end.` : ""}`;
  const sound = "overall_soundscape: Natural sounds matching the visible action.\n\nnon_diegetic_music: N/A";
  if (mode==="reference") return [
    `subject_definitions:\n<Subject 1> is ${name}. Use <Picture 1> for identity or location appearance.`,
    `summary:\n[reference generation] A ${seconds}-second clip.`,
    "retention_analysis:\n<Subject 1> (appears in [Shot 1]): fully_preserved - retain the referenced appearance.",
    `detailed_description:\n${body}`,sound,
  ].join("\n\n");
  return [mode==="first-frame"?"<Picture 1> is the actual first frame of [Shot 1] at 0.00 seconds. Develop the action from that frame.":"",
    "integrated_multimodal_description: "+body,sound].filter(Boolean).join("\n\n");
}
