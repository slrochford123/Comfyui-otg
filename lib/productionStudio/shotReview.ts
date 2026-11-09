import {execFile} from "node:child_process";
import {promisify} from "node:util";
import path from "node:path";
import fs from "node:fs/promises";
import {assertAssetIntact,assetDirectory,snapshotFile,probe} from "./media";
import {type StudioStore} from "./store";
import {nativeShotSeconds} from "./shotPolicy";
export function reviewRange(fpsValue:string|undefined,sourceDuration:number,seconds:number,start=0){
 nativeShotSeconds(seconds);
 const [n,d=1]=String(fpsValue||"").split("/").map(Number),fps=n/d;
 if(!Number.isFinite(fps)||fps<1||fps>240||!Number.isFinite(start)||start<0)throw Error("Cannot establish frame-accurate timing for this source.");
 const first=Math.round(start*fps),frames=Math.round(seconds*fps),end=first+frames;
 if(end/fps>sourceDuration+1/fps)throw Error("The source is shorter than the planned review range. Keep this take and retry generation or adjust the shot explicitly.");
 return {fps,first,end,frames,start:first/fps,duration:frames/fps};
}
export async function shotReviewProxy(s:StudioStore,owner:string,project:string,id:string,seconds:number,jobId:string,canceled:()=>boolean){
 const source=await assertAssetIntact(s,owner,project,id),info=await probe(source.path),video=info.streams.find(v=>v.codec_type==="video");
 // Finishing already applies the source's approved trim. Never trim that start twice.
 const start=source.asset.metadata.finished===true?0:Number(source.asset.metadata.trimIn)||0;
 const range=reviewRange(video?.avg_frame_rate,Number(info.format.duration),seconds,start);
 const existing=s.assets(owner,project).find(a=>a.metadata.reviewFor===id&&a.metadata.sourceSha256===source.asset.sha256&&a.metadata.trimStartFrame===range.first&&a.metadata.trimEndFrame===range.end);
 if(existing){await assertAssetIntact(s,owner,project,existing.id);return existing;}
 const file=path.join(assetDirectory(s,project),`${jobId}-review.mp4`),controller=new AbortController();
 const timer=setInterval(()=>{if(canceled())controller.abort();},250);
 try{
  await promisify(execFile)("ffmpeg",["-v","error","-nostdin","-y","-protocol_whitelist","file,pipe","-i",source.path,"-map","0:v:0","-map","0:a:0?","-vf",`trim=start_frame=${range.first}:end_frame=${range.end},setpts=PTS-STARTPTS,scale='min(960,iw)':-2`,"-af",`atrim=start=${range.start}:end=${range.start+range.duration},asetpts=PTS-STARTPTS`,"-fps_mode","passthrough","-c:v","libx264","-preset","veryfast","-crf","20","-threads","2","-c:a","aac","-b:a","160k","-movflags","+faststart",file],{signal:controller.signal,timeout:600000,maxBuffer:1_000_000});
  const check=await probe(file),out=check.streams.find(v=>v.codec_type==="video") as {nb_frames?:string;duration?:string}|undefined;
  if(Number(out?.nb_frames)!==range.frames||Math.abs(Number(check.format.duration)-range.duration)>1/range.fps+.005)throw Error("Review trim verification failed. The original take is unchanged.");
  return await snapshotFile(s,owner,project,file,`${source.asset.name} · ${seconds}s review.mp4`,"video",{reviewFor:id,sourceSha256:source.asset.sha256,trimStartFrame:range.first,trimEndFrame:range.end,sourceIn:range.start,sourceOut:range.start+range.duration,duration:range.duration,plannedDuration:seconds,fps:range.fps,sourceDuration:Number(info.format.duration),audioTrimmed:true});
 }finally{clearInterval(timer);await fs.unlink(file).catch(()=>{});}
}
