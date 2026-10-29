import fs from "node:fs";
import path from "node:path";
import {spawn} from "node:child_process";
import type {MediaGpu} from "@/lib/mediaGpuRouting";

type AdmissionConfig={mode:"local"|"ssh";script:string;authorityId?:string;uid?:number;gid?:number;target?:string;sshOptions?:string[]};
function config():AdmissionConfig|null {
  const file=process.env.OTG_MEDIA_ADMISSION_CONFIG;
  if(!file) {
    if(process.env.OTG_ENV!=="test")throw Error("The shared production GPU authority is not configured.");
    return null; // Existing isolated TEST fixtures remain backward-compatible.
  }
  if(!path.isAbsolute(file))throw Error("Invalid shared GPU configuration.");
  const cfg=JSON.parse(fs.readFileSync(file,"utf8")) as AdmissionConfig;
  if(!path.isAbsolute(cfg.script)||!/^[A-Za-z0-9_./-]+$/.test(cfg.script)||cfg.script.split("/").includes(".."))
    throw Error("Invalid installed admission helper.");
  if(cfg.mode!=="local"&&cfg.mode!=="ssh")throw Error("Invalid admission transport.");
  if(cfg.mode==="ssh"&&(!cfg.target||!/^[A-Za-z0-9_.@:-]+$/.test(cfg.target)||cfg.target.startsWith("-")))throw Error("Invalid admission host.");
  return cfg;
}
export function sharedMediaAdmissionConfigured(){return !!process.env.OTG_MEDIA_ADMISSION_CONFIG;}
export function sharedMediaAdmissionIdentity(){const value=config()?.authorityId;return value&&/^[a-f0-9-]{36}$/.test(value)?value:null;}
async function request(packet:Record<string,unknown>):Promise<Record<string,unknown>|null> {
  const cfg=config();if(!cfg)return null;
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
    child.once("exit",code=>{try{const result=JSON.parse(output);if(code||result.ok!==true)throw Error();finish(undefined,result);}catch{finish(Error("Shared GPU admission outcome is unconfirmed."));}});
    child.stdin.end(JSON.stringify(packet)+"\n");
  });
}
export async function acquireSharedMediaGpu(gpu:MediaGpu,owner:string) {
  const result=await request({action:"acquire",gpu,owner});
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
  return !result||result.busy===false||result.owned===true;
}
