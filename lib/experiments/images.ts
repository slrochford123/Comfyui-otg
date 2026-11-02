import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {RequestError} from "@/lib/requestError";
import {LAB_IMAGE_EDGE,MAX_LAB_IMAGE_BYTES,MAX_LAB_REFERENCE_BYTES} from "./imageTypes";
const execute=promisify(execFile);
export const labImagePaths=(file:string)=>({image:file+".reference.png",manifest:file+".reference.json"});
export type PreparedLabImage={file:string;sha256:string;bytes:number;mime:string;width:number;height:number;originalWidth:number;originalHeight:number};
export function imagePrepareServiceOptions(uid:number,work:string,lock:string):string[] {
  // Release directories can be mode 0700 and owned by the deployment account.
  // Permit read-only traversal, not write-permission bypass, in the root worker.
  return uid===0 ? ["-p","ProtectSystem=strict","-p",`ReadWritePaths=${work} ${lock}`,"-p","PrivateDevices=yes","-p","PrivateNetwork=yes","-p","PrivateTmp=yes","-p","ProtectHome=read-only","-p","ProtectKernelTunables=yes","-p","ProtectKernelModules=yes","-p","ProtectControlGroups=yes","-p","RestrictSUIDSGID=yes","-p","CapabilityBoundingSet=CAP_DAC_READ_SEARCH","-p","UMask=0077"] : ["--user"];
}
async function digest(file:string) {
  const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
  const stat=fs.fstatSync(fd);
  if(!stat.isFile()||stat.nlink!==1){fs.closeSync(fd);throw new RequestError("Image integrity check failed.",409);}
  const hash=crypto.createHash("sha256");
  for await(const data of fs.createReadStream(file,{fd,autoClose:true}))hash.update(data);
  return hash.digest("hex");
}
/** CPU-only, serialized, memory/time-limited decoding. Never runs inside the web process. */
export async function prepareLabImage(file:string,sourceSha256:string,signal?:AbortSignal):Promise<PreparedLabImage> {
  const stat=fs.lstatSync(file);
  if(!stat.isFile()||stat.nlink!==1||stat.size>MAX_LAB_IMAGE_BYTES||! /^[a-f0-9]{64}$/.test(sourceSha256))throw new RequestError("Image integrity check failed.",409);
  const targets=labImagePaths(file);
  if(fs.existsSync(targets.manifest)&&fs.existsSync(targets.image)) {
    try {
      const metaStat=fs.lstatSync(targets.manifest);if(!metaStat.isFile()||metaStat.nlink!==1||metaStat.size>4096)throw Error("manifest");
      const info=JSON.parse(fs.readFileSync(targets.manifest,"utf8")),imageStat=fs.lstatSync(targets.image);
      if(info.version===1&&info.sourceSha256===sourceSha256&&imageStat.isFile()&&imageStat.nlink===1&&imageStat.size===info.bytes&&imageStat.size<=MAX_LAB_REFERENCE_BYTES&&await digest(targets.image)===info.sha256&&await digest(file)===sourceSha256)return {...info,file:targets.image};
    }catch{/* Rebuild from the verified original, never serve an unsafe derivative. */}
  }
  const uid=process.getuid?.();if(uid===undefined)throw new RequestError("Image preparation requires the local Linux worker.",503);
  const runtime=uid===0?"/run/lock":`/run/user/${uid}`,script=path.join(process.cwd(),"scripts/experiments/prepare-image.cjs"),lock=runtime+"/slr-h3-image-prepare.lock";
  const unit=`otg-image-prepare-${crypto.randomUUID()}`;
  const env:NodeJS.ProcessEnv={NODE_ENV:process.env.NODE_ENV,PATH:"/usr/bin:/bin",HOME:process.env.HOME,LANG:"C.UTF-8",...(uid===0?{}:{XDG_RUNTIME_DIR:runtime,DBUS_SESSION_BUS_ADDRESS:`unix:path=${runtime}/bus`})};
  let staging:string|undefined;
  try {
    let input=file;
    if(uid===0){
      // PROD has no root user bus. Decode in a system unit with no GPU/network,
      // read-only traversal capability and writes only to an owned workspace.
      const fd=fs.openSync(lock,fs.constants.O_CREAT|fs.constants.O_RDWR|fs.constants.O_NOFOLLOW,0o600);
      try{const s=fs.fstatSync(fd);if(!s.isFile()||s.nlink!==1||s.uid!==0)throw Error("Unsafe image lock");}finally{fs.closeSync(fd);}
      staging=fs.mkdtempSync(path.join(path.dirname(file),".image-prepare-"));input=path.join(staging,"source.media");
      await fs.promises.copyFile(file,input,fs.constants.COPYFILE_EXCL|fs.constants.COPYFILE_FICLONE);
    }
    const {stdout}=await execute("/usr/bin/systemd-run",[...imagePrepareServiceOptions(uid,staging||path.dirname(file),lock),"--quiet","--pipe","--wait","--collect",`--unit=${unit}`,"-p","MemoryMax=1G","-p","MemorySwapMax=0","-p","TasksMax=48","-p","RuntimeMaxSec=90","-p","CPUQuota=100%","-p","Nice=10","-p","NoNewPrivileges=yes","/usr/bin/flock","--exclusive","--timeout","60",lock,process.execPath,"--max-old-space-size=128",script,input,sourceSha256],{timeout:95000,maxBuffer:16384,signal,env});
    const result=JSON.parse(stdout);
    if(!result.ok||result.sourceSha256!==sourceSha256||result.bytes>MAX_LAB_REFERENCE_BYTES||result.width>LAB_IMAGE_EDGE||result.height>LAB_IMAGE_EDGE)throw Error("Invalid image receipt");
    if(staging){
      const prepared=labImagePaths(input);
      if(await digest(prepared.image)!==result.sha256||await digest(file)!==sourceSha256)throw Error("Prepared image integrity");
      fs.renameSync(prepared.image,targets.image);fs.renameSync(prepared.manifest,targets.manifest);
    }
    return {...result,file:targets.image};
  }catch(error){
    await execute("/usr/bin/systemctl",[...(uid===0?[]:["--user"]),"stop",unit+".service"],{timeout:10000,maxBuffer:4096,env}).catch(()=>{});
    if(signal?.aborted)throw new RequestError("Image upload canceled. Your original file is unchanged.",499);
    const details=error as {stdout?:string;stderr?:string};let code="";
    try{code=JSON.parse(details.stdout||"{}").code;}catch{/* no safe worker receipt */}
    if(code==="unsupported")throw new RequestError("This image format could not be decoded on this server. Try exporting it as JPEG, PNG or WebP; image resolution is not limited to 40 megapixels.",415);
    if(code==="corrupt")throw new RequestError("This image is damaged or incomplete. Choose the original file again; resizing it manually is not required.",415);
    if(code==="integrity")throw new RequestError("The uploaded image changed during preparation. Choose the file again.",409);
    throw new RequestError("Image preparation could not finish within the safe memory/time budget. Your original is unchanged. Please retry, or export a JPEG/WebP copy.",503);
  }finally{if(staging)fs.rmSync(staging,{recursive:true,force:true});}
}
