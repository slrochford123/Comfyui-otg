import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { NextRequest } from "next/server";
import { resolveNsfwAsset,resolveSavedNsfwItem } from "./nsfwGallery";
import { withNsfwWorkspace } from "./availability";
import { labRoot } from "./store";
import { mediaFileResponse } from "@/lib/mediaResponse";
const exec=promisify(execFile),pending=new Map<string,Promise<void>>();
let running=0;const waiting:Array<()=>void>=[];
async function cpuSlot(work:()=>Promise<void>){if(running<2)running++;else await new Promise<void>(resolve=>waiting.push(resolve));try{await work();}finally{const next=waiting.shift();if(next)next();else running--;}}

export async function nsfwThumbnail(request:NextRequest,owner:string,admin=false) {
 const asset=request.nextUrl.searchParams.get("saved")==="1"?resolveSavedNsfwItem(owner,request.nextUrl.searchParams.get("id")||"",admin):resolveNsfwAsset(owner,request.nextUrl.searchParams.get("id")||"",admin,false);
 const dir=withNsfwWorkspace(()=>path.join(labRoot(),"gallery-thumbnails"));await fs.mkdir(dir,{recursive:true,mode:0o700});
 const output=path.join(dir,asset.id+"-"+asset.sha256.slice(0,16)+".jpg");
 try{const st=await fs.lstat(output);if(st.isSymbolicLink()||!st.isFile())throw Error("Invalid thumbnail");}
 catch{
  if(!pending.has(output))pending.set(output,cpuSlot(async()=>{
   const tmp=output+"."+crypto.randomUUID()+".jpg";
   try{
    if(asset.mime.startsWith("image/"))await sharp(asset.file).rotate().resize({width:640,height:640,fit:"inside",withoutEnlargement:true}).jpeg({quality:80}).toFile(tmp);
    else await exec("/usr/bin/ffmpeg",["-nostdin","-v","error","-hwaccel","none","-ss","0","-i",asset.file,"-frames:v","1","-vf","scale=640:640:force_original_aspect_ratio=decrease","-threads","1","-filter_threads","1","-y",tmp],{timeout:15000,maxBuffer:128*1024});
    await fs.chmod(tmp,0o600);await fs.rename(tmp,output);
   }finally{await fs.unlink(tmp).catch(()=>undefined);}
  }).finally(()=>pending.delete(output)));
  await pending.get(output);
 }
 return mediaFileResponse(request,output,{method:request.method==="HEAD"?"HEAD":"GET",contentType:"image/jpeg",fileName:"thumbnail.jpg",cacheControl:"private, no-store"});
}
