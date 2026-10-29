import {acquireResourceLock,heartbeatResourceLock,releaseResourceLock,listResourceLocks} from "@/lib/workers/resourceLocks";
import {acquireVoiceGpuFileLease,voiceGpuFileBusy} from "@/lib/workers/voiceGpuFileLease";
import {releaseIdle3090Peer} from "@/lib/workers/comfy3090Peer";
import type {WorkerResourceLockId} from "@/lib/workers/workerCatalog";

export class AuxiliaryGpuBusyError extends Error {}

export async function auxiliary3090Busy(){
  if(voiceGpuFileBusy()||listResourceLocks().some(lock=>lock.lockId==="gpu:shawn-3090"||lock.lockId==="comfy-submit:shawn-3090"))return true;
  const queues=await Promise.all([8188,8189].map(async port=>{
    const response=await fetch(`http://100.75.162.64:${port}/queue`,{cache:"no-store",signal:AbortSignal.timeout(3000)});
    const data=response.ok?await response.json():null;
    if(!data||!Array.isArray(data.queue_running)||!Array.isArray(data.queue_pending))throw Error("Cannot verify RTX 3090 queue readiness.");
    return data.queue_running.length+data.queue_pending.length>0;
  }));
  return queues.some(Boolean);
}

// Audio inference must share the same physical admission domain as video.
// This is an intentional render-duration lease with heartbeats, unlike the
// ordinary short Comfy submission mutex. Existing work is never interrupted.
export async function acquireAuxiliary3090(ownerId:string){
  const {mediaQueueEnabled,acquireExternalMediaGpu}=await import("./mediaGpuQueue");
  if(mediaQueueEnabled()){
    const {requestedMediaGpu}=await import("@/lib/mediaGpuRoutingServer");
    if(await requestedMediaGpu()==="rtx5060ti")throw new AuxiliaryGpuBusyError("This legacy audio/voice service has only a verified RTX 3090 runtime. Choose Automatic or RTX 3090, or use the dual-GPU tools in Audio Editing.");
    const releaseGpu=await acquireExternalMediaGpu("rtx3090",ownerId);
    let releaseVoice:(()=>void)|null=null;
    try{
      releaseVoice=await acquireVoiceGpuFileLease();
      const fetcher=(url:string,init:RequestInit)=>fetch(url,{...init,signal:AbortSignal.timeout(5000)});
      await releaseIdle3090Peer("http://100.75.162.64:8189",fetcher);
      await releaseIdle3090Peer("http://100.75.162.64:8188",fetcher);
      return ()=>{releaseVoice?.();releaseVoice=null;releaseGpu();};
    }catch(error){releaseVoice?.();releaseGpu();throw error;}
  }
  const acquired:Array<{lockId:WorkerResourceLockId;ownerId:string;fencingToken:string}>=[];
  let timer:ReturnType<typeof setInterval>|null=null;
  let releaseVoice:(()=>void)|null=null;
  const release=()=>{if(timer)clearInterval(timer);timer=null;releaseVoice?.();releaseVoice=null;for(const lock of acquired.reverse())releaseResourceLock(lock.lockId,lock.ownerId,lock.fencingToken);acquired.length=0;};
  try{
    for(const lockId of ["comfy-submit:shawn-3090","gpu:shawn-3090"] as WorkerResourceLockId[]){
      const result=acquireResourceLock({lockId,ownerId,ownerType:"job",workerId:"test-audio-3090",resourceName:"auxiliary-audio-inference",ttlSeconds:1800});
      if(!result.ok)throw new AuxiliaryGpuBusyError("RTX 3090 is busy with another operation. Try again when it finishes.");
      acquired.push(result.lock);
    }
    releaseVoice=await acquireVoiceGpuFileLease();
    const fetcher=(url:string,init:RequestInit)=>fetch(url,{...init,signal:AbortSignal.timeout(5000)});
    // Each call checks and unloads only the opposite idle Comfy worker.
    await releaseIdle3090Peer("http://100.75.162.64:8189",fetcher);
    await releaseIdle3090Peer("http://100.75.162.64:8188",fetcher);
    timer=setInterval(()=>{for(const lock of acquired){try{heartbeatResourceLock(lock.lockId,lock.ownerId,lock.fencingToken,1800);}catch{console.warn("TEST audio GPU lease heartbeat could not be persisted");}}},30000);
    timer.unref?.();
    return release;
  }catch(error){release();throw error instanceof AuxiliaryGpuBusyError?error:new AuxiliaryGpuBusyError(error instanceof Error?error.message:"Cannot verify RTX 3090 readiness; audio submission refused safely.");}
}
