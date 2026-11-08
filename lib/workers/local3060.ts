import fs from "node:fs";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {localGpuEnvironment,shared3060FenceEnabled} from "./mediaGpuAdmission";
import {GPU_UUIDS} from "@/lib/mediaGpuRouting";

export const LOCAL_MODEL = "qwen3.5:4b";
export const LOCAL_CONTEXT = 8192;
export const LOCAL_OLLAMA = "http://127.0.0.1:11436";
export const LOCAL_COMFY = "http://127.0.0.1:8190";
export const LOCAL_MODEL_DIGEST = "2a654d98e6fba55d452b7043684e9b57a947e393bbffa62485a7aac05ee4eefd";
export const local3060Enabled = () => localGpuEnvironment() !== null && process.env.OTG_LOCAL_AI_3060 === "1";
const run = promisify(execFile);
export type Local3060Fence = {owner:string; token:number; jobId:string};
export function local3060Headers(fence?:Local3060Fence):Record<string,string> {
  if (!shared3060FenceEnabled()) return {};
  const environment = localGpuEnvironment();
  if (!environment || !fence || !Number.isSafeInteger(fence.token) || fence.token < 1)
    throw Error("RTX 3060 request has no verified fencing token.");
  return {"X-OTG-Admission-Environment": environment, "X-OTG-Admission-Owner":fence.owner,
    "X-OTG-Admission-Token":String(fence.token), "X-OTG-Admission-Job":fence.jobId};
}

/** Base64 image transport bytes are not input text tokens. Reserve vision and output space separately. */
export function localPromptBudget(payload: Record<string,unknown>) {
  let imageCount=0;
  const input = JSON.stringify({prompt:payload.prompt,messages:payload.messages,system:payload.system,format:payload.format,tools:payload.tools,images:payload.images},(key,value)=>{
    if(key==="images"&&Array.isArray(value)){imageCount+=value.length;return undefined;}
    return value;
  });
  return {imageCount,estimatedTokens:Math.ceil(Buffer.byteLength(input)/2.7)+imageCount*1800+1400};
}

export async function localJson(url:string, init?:RequestInit) {
  const response=await fetch(url,{...init,cache:"no-store",redirect:"error",signal:init?.signal||AbortSignal.timeout(5000)});
  if(!response.ok)throw Error(`Local RTX 3060 service returned HTTP ${response.status}.`);
  return response.json();
}

export async function check3060Gate(){
  const proof=await localJson(LOCAL_COMFY+"/otg-admission");
  if(proof.uuid!==GPU_UUIDS.rtx3060||(shared3060FenceEnabled()?proof.protocol!==2||proof.authority!==process.env.OTG_3060_AUTHORITY_ID:proof.protocol!==1)||proof.pid<2)throw Error("The RTX 3060 ComfyUI admission gate is not verified.");
  return proof;
}

export async function verify3060Ollama(){
  if(!local3060Enabled()||!process.env.OTG_3060_ADMISSION_CONFIG)throw Error("Local RTX 3060 inference is not enabled or lacks its durable authority.");
  const {stdout}=await run("/usr/bin/systemctl",["show","otg-ollama-3060.service","-p","MainPID","-p","DevicePolicy","-p","ControlGroup"],{timeout:4000,maxBuffer:8192});
  const values=Object.fromEntries(stdout.trim().split("\n").map(line=>[line.slice(0,line.indexOf("=")),line.slice(line.indexOf("=")+1)]));
  const pid=Number(values.MainPID);
  if(!Number.isSafeInteger(pid)||pid<2||values.DevicePolicy!=="closed"||values.ControlGroup!=="/system.slice/otg-ollama-3060.service")throw Error("The kernel-restricted Ollama service is not active.");
  const environment=fs.readFileSync(`/proc/${pid}/environ`,"utf8").split("\0");
  if(!environment.includes(`CUDA_VISIBLE_DEVICES=${GPU_UUIDS.rtx3060}`)||!environment.includes("OLLAMA_HOST=127.0.0.1:11436"))throw Error("The live Ollama process does not match the dedicated 3060 endpoint.");
  if(shared3060FenceEnabled()){
    const fence=await localJson(LOCAL_OLLAMA+"/otg-admission");
    if(fence.protocol!==2||fence.uuid!==GPU_UUIDS.rtx3060||fence.authority!==process.env.OTG_3060_AUTHORITY_ID)
      throw Error("The shared Ollama admission gateway is not verified.");
  }
  const tags=await localJson(LOCAL_OLLAMA+"/api/tags");
  if(!Array.isArray(tags.models)||!tags.models.some((m:{name:string;digest:string})=>m.name===LOCAL_MODEL&&m.digest===LOCAL_MODEL_DIGEST))throw Error("The qualified local qwen3.5:4b model is missing or has changed.");
  return {pid,cgroup:values.ControlGroup};
}

class Local3060OccupiedError extends Error {}
export async function local3060Headroom(minimumMiB:number, allowOllama=false) {
  const {stdout}=await run("/usr/bin/nvidia-smi",["-i",GPU_UUIDS.rtx3060,"--query-gpu=uuid,memory.free","--format=csv,noheader,nounits"],{timeout:4000,maxBuffer:8192});
  const [uuid,free]=stdout.trim().split(",").map(x=>x.trim());
  const available=Number(fs.readFileSync("/proc/meminfo","utf8").match(/^MemAvailable:\s+(\d+)/m)?.[1])/1024;
  if(uuid!==GPU_UUIDS.rtx3060||!(Number(free)>=minimumMiB)||!(available>=8192))throw Error("RTX 3060 VRAM or workstation RAM is below the admission budget.");
  const processes=await run("/usr/bin/nvidia-smi",["-i",GPU_UUIDS.rtx3060,"--query-compute-apps=pid,used_gpu_memory","--format=csv,noheader,nounits"],{timeout:4000,maxBuffer:8192});
  const gate=await check3060Gate();
  for(const line of processes.stdout.trim().split("\n").filter(Boolean)){
    const pid=Number(line.split(",")[0]);
    if(pid===gate.pid)continue;
    if(allowOllama&&Number.isSafeInteger(pid)&&pid>1&&fs.readFileSync(`/proc/${pid}/cgroup`,"utf8").includes("/system.slice/otg-ollama-3060.service"))continue;
    throw new Local3060OccupiedError("An unreserved compute process occupies the RTX 3060.");
  }
}

/** Model listing can become empty before CUDA releases the old runner context. */
export async function waitFor3060Headroom(minimumMiB:number) {
  for(let attempt=0;;attempt++){
    try { await local3060Headroom(minimumMiB); return; }
    catch(error){
      if(!(error instanceof Local3060OccupiedError)||attempt===3)throw error;
      await new Promise(resolve=>setTimeout(resolve,250));
    }
  }
}

export async function unload3060Ollama(fence?:Local3060Fence){
  const resident=await localJson(LOCAL_OLLAMA+"/api/ps");
  if(!Array.isArray(resident.models)||resident.models.some((m:{name:string})=>m.name!==LOCAL_MODEL))throw Error("Unverified model residency on the assistant GPU.");
  if(!resident.models.length)return;
  await localJson(LOCAL_OLLAMA+"/api/generate",{method:"POST",headers:{"content-type":"application/json",...local3060Headers(fence)},body:JSON.stringify({model:LOCAL_MODEL,prompt:"",stream:false,keep_alive:0}),signal:AbortSignal.timeout(15000)});
  for(let i=0;i<20;i++){
    const state=await localJson(LOCAL_OLLAMA+"/api/ps");
    if(Array.isArray(state.models)&&!state.models.length)return;
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  throw Error("Local Ollama VRAM cleanup is unconfirmed.");
}
