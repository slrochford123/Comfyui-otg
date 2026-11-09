import { NextRequest } from "next/server";
import {randomUUID} from "node:crypto";
import path from "node:path";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {authorize,studio,body,json,failure} from "@/lib/productionStudio/server";
import {assertAssetIntact,assetDirectory,probe,snapshotFile} from "@/lib/productionStudio/media";
import {continuitySource} from "@/lib/productionStudio/shotDirector";
import {plannedSeconds} from "@/lib/productionStudio/shotPolicy";
import {StudioError} from "@/lib/productionStudio/store";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function POST(req:NextRequest,c:{params:Promise<{id:string}>}) {
  try {
    const user=await authorize(req,true),{id}=await c.params,b=await body(req),s=studio(),p=s.get(user.ownerKey,id);
    if(p.revision!==b.revision)throw new StudioError("Save the latest production before choosing a frame.",409);
    const source=continuitySource(p,String(b.shotId));
    if(!source?.take?.assetId)throw new StudioError("Choose an earlier shot with an approved take.");
    const entry=await assertAssetIntact(s,user.ownerKey,id,source.take.assetId),info=await probe(entry.path);
    const end=Math.min(Number(info.format.duration),Number(entry.asset.metadata.trimOut)||plannedSeconds(source.shot)),start=Number(entry.asset.metadata.trimIn)||0;
    const time=b.seconds===null?Math.max(start,end-.1):Number(b.seconds);
    if(!Number.isFinite(time)||time<start||time>=end)throw new StudioError(`Choose a source time between ${start} and ${end} seconds.`);
    const file=path.join(assetDirectory(s,id),`${randomUUID()}-continuity.png`);
    await promisify(execFile)("ffmpeg",["-v","error","-nostdin","-ss",String(time),"-protocol_whitelist","file,pipe","-i",entry.path,"-frames:v","1",file],{timeout:30000});
    const asset=await snapshotFile(s,user.ownerKey,id,file,`Shot ${source.shot.shotNumber} at ${time.toFixed(2)}s`,"image",{sourceShotId:source.shot.id,sourceTakeId:source.take.id,sourceAssetId:entry.asset.id,sourceSeconds:time});
    const project=s.mutate(user.ownerKey,id,p.revision,{type:"shot.settings",shotId:b.shotId,patch:{storyboardId:asset.id,storyboardApproved:false,firstImageId:asset.id,continuityFrameSeconds:time,useStoryboardFirstFrame:true}});
    return json({asset,project});
  } catch(e){return failure(e);}
}
