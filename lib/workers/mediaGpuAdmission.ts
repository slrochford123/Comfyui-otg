import fs from "node:fs";
import path from "node:path";
import {spawn} from "node:child_process";
import {GPU_UUIDS,type PhysicalMediaGpu as MediaGpu} from "@/lib/mediaGpuRouting";

export function localGpuEnvironment() {
  if (process.env.OTG_ENV === "test") return "test";
  if (["prod", "production"].includes(process.env.OTG_ENV || "") &&
      process.env.OTG_SHARED_3060_PRODUCTION === "1" &&
      process.env.OTG_SHARED_3060_FENCE === "1") return "prod";
  return null;
}
export const shared3060FenceEnabled = () => process.env.OTG_SHARED_3060_FENCE === "1";

type AdmissionConfig={mode:"local"|"ssh";script:string;authorityId?:string;uid?:number;gid?:number;target?:string;sshOptions?:string[]};
function config(gpu?:MediaGpu):AdmissionConfig|null {
  const local3060=gpu==="rtx3060";
  const file=local3060?process.env.OTG_3060_ADMISSION_CONFIG:process.env.OTG_MEDIA_ADMISSION_CONFIG;
  if(local3060 && (!localGpuEnvironment() || !file))throw Error("The RTX 3060 admission authority is not configured.");
  if(!file) {
    if(process.env.OTG_ENV!=="test")throw Error("The shared production GPU authority is not configured.");
    return null; // Existing isolated TEST fixtures remain backward-compatible.
  }
  if(!path.isAbsolute(file))throw Error("Invalid shared GPU configuration.");
  const cfg=JSON.parse(fs.readFileSync(file,"utf8")) as AdmissionConfig;
  if(local3060&&cfg.mode!=="local")throw Error("The RTX 3060 authority must be local.");
  if(local3060&&shared3060FenceEnabled()){
    const expected = process.env.OTG_3060_AUTHORITY_ID;
    if (!expected || !/^[a-f0-9-]{36}$/.test(expected) || cfg.authorityId !== expected)
      throw Error("The shared RTX 3060 authority identity does not match.");
  }
  if(!path.isAbsolute(cfg.script)||!/^[A-Za-z0-9_./-]+$/.test(cfg.script)||cfg.script.split("/").includes(".."))
    throw Error("Invalid installed admission helper.");
  if(cfg.mode!=="local"&&cfg.mode!=="ssh")throw Error("Invalid admission transport.");
  if(cfg.mode==="ssh"&&(!cfg.target||!/^[A-Za-z0-9_.@:-]+$/.test(cfg.target)||cfg.target.startsWith("-")))throw Error("Invalid admission host.");
  return cfg;
}
export function sharedMediaAdmissionConfigured(gpu?:MediaGpu){return !!(gpu==="rtx3060"?process.env.OTG_3060_ADMISSION_CONFIG:process.env.OTG_MEDIA_ADMISSION_CONFIG);}
export function sharedMediaAdmissionIdentity(){const value=config()?.authorityId;return value&&/^[a-f0-9-]{36}$/.test(value)?value:null;}
async function request(packet:Record<string,unknown>):Promise<Record<string,unknown>|null> {
  const gpu=packet.gpu as MediaGpu,cfg=config(gpu);if(!cfg)return null;
  if(gpu==="rtx3060"){
    if(Array.isArray(packet.gpus)&&packet.gpus.some(g=>g!=="rtx3060"))throw Error("The assistant card cannot be part of a render fallback set.");
    packet={...packet,gpu:GPU_UUIDS.rtx3060,...(packet.gpus?{gpus:[GPU_UUIDS.rtx3060]}:{})};
  }
  const local=cfg.mode==="local";
  const binary=local?"/usr/bin/python3":"/usr/bin/ssh";
  const args=local?[cfg.script]:[...(cfg.sshOptions||[]),"-o","BatchMode=yes","-o","ConnectTimeout=5","-o","ClearAllForwardings=yes","--",cfg.target!,"/usr/bin/python3 "+cfg.script];
  return new Promise((resolve,reject)=>{
    const child=spawn(binary,args,{stdio:["pipe","pipe","pipe"],
      ...(local&&process.getuid?.()===0?{uid:1000,gid:1000}:{}),
      env:{NODE_ENV:process.env.NODE_ENV||"production",PATH:"/usr/local/bin:/usr/bin:/bin",HOME:process.env.HOME,LANG:"C.UTF-8"}});
    let output="",done=false;
    const finish=(error?:Error,value?:Record<string,unknown>)=>{if(done)return;done=true;clearTimeout(timer);error?reject(error):resolve(value!);};
    const timer=setTimeout(()=>{child.kill("SIGTERM");finish(Error("Shared GPU admission outcome is unconfirmed."));},15000);
    child.stdout.on("data",chunk=>{output+=String(chunk);if(output.length>8192){child.kill("SIGTERM");finish(Error("Invalid admission response."));}});
    child.stderr.resume();child.stdin.on("error",()=>{/* exit handler retains ambiguity */});
    child.once("error",()=>finish(Error("Shared GPU authority could not be contacted.")));
    // exit can precede the final stdout chunk; close waits for all stdio to drain.
    child.once("close",code=>{try{const result=JSON.parse(output);if(code||result.ok!==true)throw Error();finish(undefined,result);}catch{finish(Error("Shared GPU admission outcome is unconfirmed."));}});
    child.stdin.end(JSON.stringify(packet)+"\n");
  });
}
export async function acquireSharedMediaGpu(gpu:MediaGpu,owner:string,ticket?:number|null) {
  const result=await request({action:"acquire",gpu,owner,...(ticket!=null?{ticket}:{})});
  if(!result)return {granted:true,token:null};
  if(typeof result.granted!=="boolean"||result.granted&&(!Number.isSafeInteger(result.token)||Number(result.token)<1))throw Error("Invalid admission grant.");
  return {granted:result.granted,token:result.granted?Number(result.token):null};
}
export async function releaseSharedMediaGpu(gpu:MediaGpu,owner:string,token:number) {
  const result=await request({action:"release",gpu,owner,token});
  if(!result||result.done!==true)throw Error("Shared GPU release is unconfirmed.");
}
export async function sharedMediaGpuAvailable(gpu:MediaGpu,owner="00000000-0000-0000-0000-000000000000") {
  const result=await request({action:"status",gpu,owner});
  return !result||result.owned===true||(result.busy===false&&result.turn!==false);
}
export async function registerSharedMediaTicket(gpus:readonly MediaGpu[],owner:string):Promise<{ticket:number|null;state:string}> {
  const result=await request({action:"enqueue",gpu:gpus[0],gpus,owner});
  if(!result)return {ticket:null,state:"waiting"};
  if(!Number.isSafeInteger(result.ticket)||Number(result.ticket)<1||!["waiting","granted","canceled","done"].includes(String(result.state)))
    throw Error("The shared GPU authority does not support durable waiting tickets.");
  return {ticket:Number(result.ticket),state:String(result.state)};
}
export async function cancelSharedMediaTicket(gpu:MediaGpu,owner:string,ticket:number) {
  const result=await request({action:"cancel",gpu,owner,ticket});
  if(!result||result.done!==true)throw Error("Waiting ticket cancellation is unconfirmed or the GPU is already granted.");
}
export async function assertSharedMediaGpuOwned(gpu:MediaGpu,owner:string,token?:number) {
  const result=await request({action:"status",gpu,owner,...(token!=null?{token}:{})});
  if(!result || (token!=null&&result.fenced!==true) || result.busy!==true || result.owned!==true)throw Error("The shared audio GPU reservation is no longer confirmed; no cache or model was changed.");
}
