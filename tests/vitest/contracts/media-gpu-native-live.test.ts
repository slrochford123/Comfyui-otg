/** Explicit opt-in, tiny model-free native queue proof. Never a benchmark/AI-quality claim. */
import {it,expect} from "vitest";
import fs from "node:fs";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {randomUUID,createHash} from "node:crypto";
import {enqueueComfyMedia,getMediaQueueJob,tickMediaGpuQueue,closeMediaGpuQueueForTests} from "@/lib/workers/mediaGpuQueue";
import {setResourceLockStorePathForTests} from "@/lib/workers/resourceLocks";
it.skipIf(process.env.OTG_MEDIA_GPU_LIVE_QA!=="1")("executes the same reserved UUID on each actual worker, without loading models",async()=>{
  const root=String(process.env.OTG_MEDIA_GPU_QA_ROOT||"");
  if(!/^\/home\/shawn-rochford\/AI\/research\/media-gpu-routing-20261029-[A-Za-z0-9]+$/.test(root))throw Error("A new dedicated research directory is required.");
  process.env.OTG_ENV="test";process.env.OTG_MEDIA_GPU_ROUTING="1";
  process.env.OTG_MEDIA_GPU_QUEUE_DB=path.join(root,"native-proof.sqlite");
  process.env.OTG_VOICE_GPU_LOCK_FILE="/home/shawn-rochford/AI/runtime/test/voice-gpu.lock";
  setResourceLockStorePathForTests(path.join(root,"native-proof-locks.sqlite"));
  const bases=["http://100.75.162.64:8188","http://100.75.162.64:8189","http://100.98.212.116:8188"];
  async function idle(){for(const base of bases){const q=await(await fetch(base+"/queue",{signal:AbortSignal.timeout(5000)})).json();expect(q.queue_running).toEqual([]);expect(q.queue_pending).toEqual([]);}}
  const report:{kind:string;aiInference:boolean;freeOrInterruptIssued:boolean;runs:unknown[]}={kind:"Actual ComfyUI queue and artifact proof with 64px EmptyImage",aiInference:false,freeOrInterruptIssued:false,runs:[]};
  try{
    await idle();
    const gpu=execFileSync("nvidia-smi",["--query-gpu=name,memory.free","--format=csv,noheader,nounits"],{encoding:"utf8"});
    expect(gpu).toContain("RTX 3090");expect(Number(gpu.trim().split(",")[1])).toBeGreaterThan(20000);
    // Desktop graphics can report nonzero utilization while every inference
    // worker is idle. This proof uses CPU EmptyImage, not a GPU model.
    const compute=execFileSync("nvidia-smi",["--query-compute-apps=used_gpu_memory","--format=csv,noheader,nounits"],{encoding:"utf8"});
    expect(compute.trim().split("\n").every(value=>Number(value)<1024)).toBe(true);
    for(const [base,label] of [[bases[1],"rtx3090"],[bases[2],"rtx5060ti"]]){
      await idle();
      const before=await(await fetch(base+"/system_stats")).json();
      expect(before.devices.map((d:{name:string})=>d.name).join(" ").toLowerCase()).toContain(label==="rtx3090"?"rtx 3090":"rtx 5060 ti");
      const started=Date.now();
      const response=await enqueueComfyMedia({baseUrl:base,workerId:"media-live-qa",releaseIdlePeer:false,
        body:{client_id:`media-qa-${randomUUID()}`,prompt:{"1":{class_type:"EmptyImage",inputs:{width:64,height:64,batch_size:1,color:2351750}},
          "2":{class_type:"SaveImage",inputs:{images:["1",0],filename_prefix:`research/media-gpu-${label}-${randomUUID()}`}}}}});
      const {prompt_id}=await response.json();
      const deadline=Date.now()+30_000;
      do{await tickMediaGpuQueue();if(["completed","failed"].includes(getMediaQueueJob(prompt_id)!.status))break;await new Promise(r=>setTimeout(r,200));}while(Date.now()<deadline);
      expect(getMediaQueueJob(prompt_id)?.status).toBe("completed");
      const history=await(await fetch(`${base}/history/${prompt_id}`)).json();
      expect(history[prompt_id].prompt[1]).toBe(prompt_id);
      const file=history[prompt_id].outputs["2"].images[0];
      const media=await fetch(`${base}/view?${new URLSearchParams(file)}`);expect(media.ok).toBe(true);
      const bytes=Buffer.from(await media.arrayBuffer());expect(bytes.subarray(1,4).toString()).toBe("PNG");
      fs.writeFileSync(path.join(root,`native-proof-${label}.png`),bytes,{mode:0o600});
      report.runs.push({gpu:label,base,promptId:prompt_id,elapsedMs:Date.now()-started,artifact:`native-proof-${label}.png`,sha256:createHash("sha256").update(bytes).digest("hex")});
    }
    await idle();
  }finally{
    fs.writeFileSync(path.join(root,"native-queue-proof.json"),JSON.stringify(report,null,2),{mode:0o600});
    closeMediaGpuQueueForTests();setResourceLockStorePathForTests(null);
  }
},60_000);
