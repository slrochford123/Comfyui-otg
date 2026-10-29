import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { OTG_DATA_ROOT } from "@/lib/paths";
import { MEDIA_GPUS, type MediaGpu } from "@/lib/mediaGpuRouting";
import { resolveComfyPhysicalGpu, detectShawnExternalOccupancy } from "./clusterGpu";
import { acquireResourceLock, heartbeatResourceLock, releaseResourceLock, listResourceLocks, type ResourceLock } from "./resourceLocks";
import { voiceGpuFileBusy } from "./voiceGpuFileLease";

export type MediaQueueStatus = "queued" | "dispatching" | "running" | "unknown" | "completed" | "failed" | "canceled";
export type ComfyMediaPayload = { baseUrl: string; body: Record<string, unknown>; workerId: string;
  preSubmitCleanup?: "free" | null; releaseIdlePeer?: boolean };
export type AudioMediaPayload = { owner: string; sessionId: string; jobId: string };
export type ExternalMediaPayload = { pid:number; operation:string };
export type MediaQueueJob = { id: string; sequence: number; gpu: MediaGpu; kind: "comfy" | "audio" | "external";
  status: MediaQueueStatus; payload: ComfyMediaPayload | AudioMediaPayload | ExternalMediaPayload; createdAt: number; updatedAt: number;
  error: string | null; lease: ResourceLock | null };
type Row = Omit<MediaQueueJob,"payload"|"lease"> & {payload: string; lease: string | null};
export type MediaGpuReadiness = { ready: boolean; reason: string };
export const mediaQueueEnabled = () => process.env.OTG_ENV === "test" && process.env.OTG_MEDIA_GPU_ROUTING === "1";
const active = ["dispatching", "running", "unknown"];
const physical = (gpu: MediaGpu) => gpu === "rtx3090" ? "shawn-3090" : "slr-5060";
const lockId = (gpu: MediaGpu) => gpu === "rtx3090" ? "gpu:shawn-3090" as const : "gpu:slr-5060" as const;

let connection: Database.Database | undefined;
let connectionPath = "";
function database() {
  const filename = process.env.OTG_MEDIA_GPU_QUEUE_DB || path.join(OTG_DATA_ROOT,"media-gpu-queue","queue.sqlite");
  if (connection && filename === connectionPath) return connection;
  connection?.close();
  fs.mkdirSync(path.dirname(filename), {recursive:true,mode:0o700});
  connection = new Database(filename);
  connectionPath = filename;
  fs.chmodSync(filename,0o600);
  connection.pragma("busy_timeout = 10000");
  connection.pragma("synchronous = FULL");
  connection.exec(`CREATE TABLE IF NOT EXISTS media_jobs (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, gpu TEXT NOT NULL,
    kind TEXT NOT NULL, status TEXT NOT NULL, payload TEXT NOT NULL,
    createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL, error TEXT, lease TEXT);
    CREATE INDEX IF NOT EXISTS media_jobs_state ON media_jobs(gpu,status,sequence);`);
  return connection;
}
const decode = (row: Row): MediaQueueJob => ({...row,payload:JSON.parse(row.payload),lease:row.lease?JSON.parse(row.lease):null});
export function getMediaQueueJob(id: string): MediaQueueJob | null {
  if (!mediaQueueEnabled()) return null;
  const row = database().prepare("SELECT * FROM media_jobs WHERE id = ?").get(id) as Row | undefined;
  return row ? decode(row) : null;
}
export function mediaQueueMessage(promptId:string|null|undefined,fallback:string) {
  const job=promptId?getMediaQueueJob(promptId):null;
  if(job?.status==="queued")return `Queued for ${job.gpu==="rtx3090"?"RTX 3090":"RTX 5060 Ti"}; waiting for earlier work to finish.`;
  if(job?.status==="unknown")return "Waiting for confirmation from the original GPU; no duplicate generation will be submitted.";
  return fallback;
}
export function queuedMediaJobs() {
  if (!mediaQueueEnabled()) return [];
  return (database().prepare("SELECT * FROM media_jobs WHERE status IN ('queued','dispatching','running','unknown') ORDER BY sequence").all() as Row[]).map(decode);
}
function update(id: string, status: MediaQueueStatus, error: string | null = null, lease?: ResourceLock | null) {
  if (lease === undefined) database().prepare("UPDATE media_jobs SET status=?,error=?,updatedAt=? WHERE id=?").run(status,error,Date.now(),id);
  else database().prepare("UPDATE media_jobs SET status=?,error=?,updatedAt=?,lease=? WHERE id=?").run(status,error,Date.now(),lease?JSON.stringify(lease):null,id);
}
export function enqueueMediaJob(input: { id?: string; gpu: MediaGpu; kind: MediaQueueJob["kind"]; payload: MediaQueueJob["payload"] }) {
  const id = input.id || randomUUID();
  if (!MEDIA_GPUS.includes(input.gpu)) throw Error("Choose a supported physical GPU.");
  database().prepare("INSERT INTO media_jobs (id,gpu,kind,status,payload,createdAt,updatedAt) VALUES (?,?,?,'queued',?,?,?)")
    .run(id,input.gpu,input.kind,JSON.stringify(input.payload),Date.now(),Date.now());
  bootstrapMediaGpuQueue();
  return getMediaQueueJob(id)!;
}
/** CAS protects cancellation against another process claiming this exact job. */
export function cancelQueuedMediaJob(id: string, baseUrl?: string) {
  const job = getMediaQueueJob(id);
  if (!job || baseUrl && (job.kind !== "comfy" || (job.payload as ComfyMediaPayload).baseUrl !== baseUrl.replace(/\/+$/,""))) return false;
  return database().prepare("UPDATE media_jobs SET status='canceled',updatedAt=? WHERE id=? AND status='queued'").run(Date.now(),id).changes === 1;
}
const queuesFor = (gpu: MediaGpu) => gpu === "rtx3090"
  ? [process.env.OTG_MEDIA_3090_IMAGE_URL || "http://100.75.162.64:8188",process.env.OTG_MEDIA_3090_H3_URL || "http://100.75.162.64:8189"]
  : [process.env.OTG_MEDIA_5060_URL || "http://100.98.212.116:8188"];
async function readJson(url: string) {
  const response = await fetch(url,{cache:"no-store",redirect:"error",signal:AbortSignal.timeout(5000)});
  if (!response.ok) throw Error(`GPU readiness unavailable (HTTP ${response.status}).`);
  return response.json();
}
/** Probe every service on a physical card. An unavailable sibling fails closed. */
export async function probeMediaGpu(gpu: MediaGpu, ownJob?: string): Promise<MediaGpuReadiness> {
  try {
    if (queuedMediaJobs().some(j => j.gpu === gpu && j.id !== ownJob && (active.includes(j.status) || !ownJob))) return {ready:false,reason:"A media job owns or is waiting for this GPU."};
    if (listResourceLocks().some(lock => lock.ownerId !== ownJob && [lockId(gpu),`comfy-submit:${physical(gpu)}`].includes(lock.lockId))) return {ready:false,reason:"Another tool owns this GPU."};
    if (gpu === "rtx3090" && voiceGpuFileBusy()) return {ready:false,reason:"A voice operation owns the 3090."};
    for (const base of queuesFor(gpu)) {
      const q = await readJson(base+"/queue");
      if (!Array.isArray(q.queue_running) || !Array.isArray(q.queue_pending)) throw Error("Invalid GPU queue response.");
      if (q.queue_running.length || q.queue_pending.length) return {ready:false,reason:"ComfyUI is rendering or has queued work."};
      if(process.env.NODE_ENV!=="test") {
        const stats=await readJson(base+"/system_stats");
        const expected=gpu==="rtx3090"?"rtx 3090":"rtx 5060 ti";
        if(!Array.isArray(stats.devices)||!stats.devices.some((device:{name?:string})=>String(device.name||"").toLowerCase().includes(expected)))
          throw Error("The configured worker does not report the expected GPU.");
      }
    }
    if (gpu === "rtx3090" && process.env.NODE_ENV !== "test") {
      const occupancy=await detectShawnExternalOccupancy({locks:listResourceLocks().filter(lock=>lock.ownerId!==ownJob)});
      if(!occupancy.available)return {ready:false,reason:"The 3090 is reserved by an existing external workload."};
    }
    return {ready:true,reason:"Idle"};
  } catch { return {ready:false,reason:"GPU readiness cannot be confirmed; existing work is protected."}; }
}
/** Non-mutating preference for graph preparation. Dispatch checks again atomically. */
export async function preferMediaGpu(compatible: readonly MediaGpu[]): Promise<MediaGpu | null> {
  const ordered = MEDIA_GPUS.filter(gpu => compatible.includes(gpu));
  for (const gpu of ordered) if ((await probeMediaGpu(gpu)).ready) return gpu;
  return ordered[0] || null;
}
export async function enqueueComfyMedia(payload: ComfyMediaPayload, onAccepted?: (id:string)=>void|Promise<void>) {
  const parsed=new URL(payload.baseUrl);
  if(parsed.protocol!=="http:" || parsed.username || parsed.password || parsed.pathname!=="/" || parsed.search || parsed.hash)
    throw Error("The media queue only accepts configured private worker origins.");
  const resolved = resolveComfyPhysicalGpu(payload.baseUrl);
  if (!resolved) throw Error("ComfyUI endpoint does not map to a known physical GPU.");
  const id = randomUUID();
  payload = {...payload,baseUrl:payload.baseUrl.replace(/\/+$/,""),body:{...payload.body,prompt_id:id}};
  const job = enqueueMediaJob({id,gpu:resolved==="shawn-3090"?"rtx3090":"rtx5060ti",kind:"comfy",payload});
  // This is durable APPLICATION acceptance, not proof of Comfy execution.
  await onAccepted?.(id);
  return Response.json({prompt_id:id,number:job.sequence,node_errors:{},otg_queue:"waiting-for-gpu"},{status:202});
}
function finish(job: MediaQueueJob, status: "completed"|"failed", error: string | null = null) {
  update(job.id,status,error,null);
  if (job.lease) releaseResourceLock(job.lease.lockId,job.lease.ownerId,job.lease.fencingToken);
}
async function reconcileComfy(job: MediaQueueJob) {
  const payload = job.payload as ComfyMediaPayload;
  try {
    const history = await readJson(`${payload.baseUrl}/history/${job.id}`);
    const record = history[job.id];
    if (record?.status?.completed === true || ["success","error"].includes(record?.status?.status_str)) {
      finish(job,record.status.status_str === "success" ? "completed" : "failed",record.status.status_str === "success" ? null : "ComfyUI execution failed; inspect the saved node traceback.");
      return;
    }
    const q = await readJson(payload.baseUrl+"/queue");
    if (!Array.isArray(q.queue_running) || !Array.isArray(q.queue_pending)) throw Error("Invalid queue");
    if ([...q.queue_running,...q.queue_pending].some(row=>Array.isArray(row)&&row[1]===job.id)) update(job.id,"running");
    else update(job.id,"unknown","Awaiting backend proof. This job will not be automatically resubmitted or replaced.");
  } catch { update(job.id,"unknown","Worker unavailable; retaining this GPU reservation until its original job can be reconciled."); }
}
async function dispatch(job: MediaQueueJob) {
  if(job.kind==="external") {
    const grant=globals.__otgMediaQueue?.external.get(job.id);
    if(!grant){finish(job,"failed","The waiting request ended before GPU execution. Retry the original operation.");return;}
    update(job.id,"running");let released=false;
    grant(()=>{if(released)return;released=true;finish(job,"completed");globals.__otgMediaQueue?.external.delete(job.id);});
    return;
  }
  if (job.kind === "audio") {
    try {
      const { executeQueuedAudioJob } = await import("@/lib/audioEditing/jobs");
      await executeQueuedAudioJob(job.payload as AudioMediaPayload,job.gpu);
      finish(job,"completed");
    } catch(error) { finish(job,"failed",error instanceof Error?error.message:"Audio worker failed."); }
    return;
  }
  const payload = job.payload as ComfyMediaPayload;
  try {
    const { submitComfyPromptWithGpuLease } = await import("./comfyPromptLease");
    const response = await submitComfyPromptWithGpuLease({ ...payload, ownerId:job.id, queueDispatch:true,
      init:{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload.body)},submitTimeoutMs:60_000 });
    if (!response.ok) {
      if (response.status < 500) finish(job,"failed",(await response.text()).slice(0,2000));
      else update(job.id,"unknown","Submission response was inconclusive; no automatic retry.");
      return;
    }
    const result = await response.json();
    if (result.prompt_id !== job.id) { update(job.id,"unknown","Worker did not preserve the reserved prompt UUID; no automatic retry."); return; }
    update(job.id,"running");
  } catch { update(job.id,"unknown","Submission outcome is unknown; reconcile the reserved UUID instead of resubmitting."); }
}
type QueueGlobals = typeof globalThis & {__otgMediaQueue?: {timer:ReturnType<typeof setInterval>;ticking:boolean;audio:Set<string>;external:Map<string,(release:()=>void)=>void>}};
const globals = globalThis as QueueGlobals;
/** Legacy local services can queue safely without pretending they have a 5060 runtime. */
export async function acquireExternalMediaGpu(gpu:MediaGpu,operation:string):Promise<()=>void> {
  if(!mediaQueueEnabled())throw Error("The shared media queue is not enabled.");
  const id=randomUUID();bootstrapMediaGpuQueue();
  return new Promise<()=>void>((resolve,reject)=>{
    globals.__otgMediaQueue!.external.set(id,resolve);
    try{enqueueMediaJob({id,gpu,kind:"external",payload:{pid:process.pid,operation}});}
    catch(error){globals.__otgMediaQueue!.external.delete(id);reject(error);}
  });
}
/** One dispatch per physical GPU; SQLite claims also serialize competing Node processes. */
export async function tickMediaGpuQueue() {
  if (!mediaQueueEnabled()) return;
  const state = globals.__otgMediaQueue;
  if (state?.ticking) return;
  if (state) state.ticking=true;
  try {
    for (const gpu of MEDIA_GPUS) {
      let running = queuedMediaJobs().find(job=>job.gpu===gpu&&active.includes(job.status));
      if (running) {
        if (running.lease) heartbeatResourceLock(running.lease.lockId,running.lease.ownerId,running.lease.fencingToken,300);
        if (running.kind === "comfy") await reconcileComfy(running);
        else if (running.kind==="external") {
          const pid=(running.payload as ExternalMediaPayload).pid;
          try{process.kill(pid,0);}catch{update(running.id,"unknown","The original external-service request stopped. Confirm its service has finished before recovering this GPU.");}
        } else if (!state?.audio.has(running.id)) {
          // Never start a second child after a web-process restart. Inspect the original PID/status.
          const { queuedAudioJobState } = await import("@/lib/audioEditing/jobs");
          const status = queuedAudioJobState(running.payload as AudioMediaPayload);
          if (status === "completed" || status === "failed" || status === "canceled") finish(running,status==="completed"?"completed":"failed",status==="completed"?null:"Audio operation ended or was canceled.");
        }
        running = queuedMediaJobs().find(job=>job.gpu===gpu&&active.includes(job.status));
        if (running) continue;
      }
      const waiting = queuedMediaJobs().find(job=>job.gpu===gpu&&job.status==="queued");
      if(waiting?.kind==="external"&&!state?.external.has(waiting.id)){
        const pid=(waiting.payload as ExternalMediaPayload).pid;
        try{process.kill(pid,0);}catch{update(waiting.id,"failed","The original request stopped before GPU execution; no work was submitted.");}
        continue;
      }
      if (!waiting || !(await probeMediaGpu(gpu,waiting.id)).ready) continue;
      // Each claim attempt has a distinct owner: a losing Node process must not
      // release the winning process's reentrant resource-lock token.
      const acquired = acquireResourceLock({lockId:lockId(gpu),ownerId:`${waiting.id}:${randomUUID()}`,ownerType:"job",workerId:"media-gpu-queue",resourceName:"media-render",ttlSeconds:300});
      if (!acquired.ok) continue;
      const claimed = database().transaction(() => {
        if (database().prepare("SELECT id FROM media_jobs WHERE gpu=? AND status IN ('dispatching','running','unknown')").get(gpu)) return false;
        return database().prepare("UPDATE media_jobs SET status='dispatching',lease=?,updatedAt=? WHERE id=? AND status='queued'")
          .run(JSON.stringify(acquired.lock),Date.now(),waiting.id).changes===1;
      }).immediate();
      if (!claimed) { releaseResourceLock(acquired.lock.lockId,acquired.lock.ownerId,acquired.lock.fencingToken); continue; }
      const job = getMediaQueueJob(waiting.id)!;
      if (job.kind === "audio") state?.audio.add(job.id);
      void dispatch(job).finally(()=>state?.audio.delete(job.id));
    }
  } finally { if (state) state.ticking=false; }
}
export function bootstrapMediaGpuQueue() {
  if (!mediaQueueEnabled() || globals.__otgMediaQueue) return;
  const timer=setInterval(()=>void tickMediaGpuQueue().catch(()=>{/* Preserve rows; retry read-only readiness on next tick. */}),2000);
  timer.unref();
  globals.__otgMediaQueue={timer,ticking:false,audio:new Set(),external:new Map()};
}
export function closeMediaGpuQueueForTests() {
  if(globals.__otgMediaQueue)clearInterval(globals.__otgMediaQueue.timer);
  delete globals.__otgMediaQueue; connection?.close();connection=undefined;connectionPath="";
}
