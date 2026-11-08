import fs from "node:fs";
import path from "node:path";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {GPU_UUIDS,type PhysicalMediaGpu as MediaGpu} from "@/lib/mediaGpuRouting";
const exec=promisify(execFile);
export type PhysicalGpuState={schemaVersion:1;gpu:MediaGpu;uuid:string;totalMiB:number;freeMiB:number;utilization:number;processes:Array<{pid:number;memoryMiB:number;comfy:boolean}>};
type Probe={mode:"local"|"ssh";script:string;target?:string;sshOptions?:string[]};
export async function physicalGpuState(gpu:MediaGpu):Promise<PhysicalGpuState|null>{
  const file=process.env.OTG_PHYSICAL_GPU_PROBE_CONFIG;
  if(!file)return null;
  const stat=fs.lstatSync(file);
  if(!path.isAbsolute(file)||!stat.isFile()||stat.mode&0o022||![0,process.getuid?.()].includes(stat.uid)||stat.size>16000)throw Error("Untrusted GPU telemetry configuration");
  const cfg=(JSON.parse(fs.readFileSync(file,"utf8")) as Record<MediaGpu,Probe>)[gpu];
  if(!cfg||!path.isAbsolute(cfg.script)||!/^[\w./-]+$/.test(cfg.script)||cfg.script.split("/").includes(".."))throw Error("Missing physical GPU probe");
  const local=cfg.mode==="local";
  if(!local&&(cfg.mode!=="ssh"||!cfg.target||!/^[\w.@:-]+$/.test(cfg.target)||cfg.target.startsWith("-")))throw Error("Invalid GPU probe host");
  const args=local?[cfg.script]:[...(cfg.sshOptions||[]),"-o","BatchMode=yes","-o","ConnectTimeout=3","-o","ClearAllForwardings=yes","--",cfg.target!,"/usr/bin/python3 "+cfg.script];
  const {stdout}=await exec(local?"/usr/bin/python3":"/usr/bin/ssh",args,{timeout:10000,maxBuffer:16000});
  const value=JSON.parse(stdout);
  const uuid=GPU_UUIDS[gpu];
  if(value.ok!==true||value.schemaVersion!==1||value.gpu!==gpu||value.uuid!==uuid||![value.totalMiB,value.freeMiB,value.utilization].every(Number.isFinite)||!Array.isArray(value.processes)||value.processes.some((p:PhysicalGpuState["processes"][number])=>!Number.isFinite(p.memoryMiB)||typeof p.comfy!=="boolean"))throw Error("Physical GPU identity or memory could not be verified");
  return value;
}
export function physicalGpuCapacity(state:PhysicalGpuState){
  const external=state.processes.filter(p=>!p.comfy).reduce((n,p)=>n+p.memoryMiB,0);
  if(external>512)return {ready:false,reason:"Another compute process occupies this physical GPU."};
  const reclaimable=state.processes.filter(p=>p.comfy).reduce((n,p)=>n+p.memoryMiB,0);
  if(state.freeMiB+reclaimable<Math.min(8192,state.totalMiB*0.5))return {ready:false,reason:"Insufficient available or idle reclaimable GPU memory."};
  return {ready:true,reason:"Physical GPU capacity verified"};
}
