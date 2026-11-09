import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { OTG_DATA_ROOT, safeSegment } from "@/lib/paths";
import { MEDIA_GPUS as RENDER_GPUS, PHYSICAL_MEDIA_GPUS as MEDIA_GPUS, GPU_UUIDS, mediaGpuLabel, type PhysicalMediaGpu as MediaGpu, type MediaGpu as RenderGpu } from "@/lib/mediaGpuRouting";
import { resolveComfyPhysicalGpu, detectShawnExternalOccupancy } from "./clusterGpu";
import { acquireResourceLock, heartbeatResourceLock, releaseResourceLock, listResourceLocks, type ResourceLock } from "./resourceLocks";
import { voiceGpuFileBusy } from "./voiceGpuFileLease";
import { privateMediaFeatureEnabled } from "@/lib/privateMediaRuntime";
import { requireStorageHeadroom } from "@/lib/storageAdmission";
import {acquireSharedMediaGpu,releaseSharedMediaGpu,sharedMediaGpuAvailable,sharedMediaAdmissionConfigured,registerSharedMediaTicket,cancelSharedMediaTicket,assertSharedMediaGpuOwned,shared3060FenceEnabled} from "./mediaGpuAdmission";
import { inspectComfyWorkerInstance, sameComfyWorker, type ComfyWorkerInstance } from "./comfyWorkerInstance";
import {physicalGpuState,physicalGpuCapacity} from "./physicalGpu";
import {check3060Gate,local3060Enabled,local3060Headroom,unload3060Ollama,verify3060Ollama,localJson,LOCAL_OLLAMA,LOCAL_COMFY,local3060Headers,type Local3060Fence} from "./local3060";
import { qualifyPreparedComfyGraph } from "./comfyGraphQualification";
import { readDispatchProcess, dispatchProcessState, type DispatchProcess } from "./dispatchProcess";

export type MediaQueueStatus = "queued" | "dispatching" | "running" | "unknown" | "completed" | "failed" | "canceled";
export type ComfyMediaPayload = { baseUrl: string; body: Record<string, unknown>; workerId: string;
  preSubmitCleanup?: "free" | null; releaseIdlePeer?: boolean;
  producer?: { kind: "direct" | "refmods-generation" | "realism" | "body-swap" | "production-studio-finish" | "story-3060-image" | "story-3060-audio" | "story-3060-voice"; ownerKey: string; id: string;projectId?:string } };
export type AudioMediaPayload = { owner: string; sessionId: string; jobId: string };
export type ExternalMediaPayload = { pid:number; operation:string; eligibleGpus?:MediaGpu[];caller?:DispatchProcess;backend?:DispatchProcess };
export type MediaQueueJob = { id: string; sequence: number; gpu: MediaGpu; kind: "comfy" | "audio" | "external";
  status: MediaQueueStatus; payload: ComfyMediaPayload | AudioMediaPayload | ExternalMediaPayload; createdAt: number; updatedAt: number;
  error: string | null; lease: ResourceLock | null; admissionOwner:string|null;admissionToken:number|null;admissionPhase:string|null;
  admissionTicket:number|null; ticketState:string|null;
  workerInstance: ComfyWorkerInstance | null; workerConfirmed: number | null; submissionSettled: number | null;
  dispatchProcess: DispatchProcess | null };
type Row = Omit<MediaQueueJob,"payload"|"lease"|"workerInstance"|"dispatchProcess"> & {payload: string; lease: string | null; workerInstance: string | null; dispatchProcess: string | null};
export type MediaGpuReadiness = { ready: boolean; reason: string };
export const mediaQueueEnabled = () => privateMediaFeatureEnabled("OTG_MEDIA_GPU_ROUTING");
const active = ["dispatching", "running", "unknown"];
const physical = (gpu: MediaGpu) => ({rtx3090:"shawn-3090",rtx5060ti:"slr-5060",rtx3060:"shawn-3060"} as const)[gpu];
const lockId = (gpu: MediaGpu) => ({rtx3090:"gpu:shawn-3090",rtx5060ti:"gpu:slr-5060",rtx3060:`gpu:${GPU_UUIDS.rtx3060}`} as const)[gpu];

let connection: Database.Database | undefined;
let connectionPath = "";
// Share one lazy module resolution when both physical cards dispatch together.
let submissionModule: Promise<typeof import("./comfyPromptLease")> | undefined;
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
  const columns=new Set((connection.prepare("PRAGMA table_info(media_jobs)").all() as {name:string}[]).map(row=>row.name));
  for(const [name,type] of [["admissionOwner","TEXT"],["admissionToken","INTEGER"],["admissionPhase","TEXT"],["admissionTicket","INTEGER"],["ticketState","TEXT"],["workerInstance","TEXT"],["workerConfirmed","INTEGER"],["submissionSettled","INTEGER"],["dispatchProcess","TEXT"]])
    if(!columns.has(name))connection.exec(`ALTER TABLE media_jobs ADD COLUMN ${name} ${type}`);
  return connection;
}
const decode = (row: Row): MediaQueueJob => ({...row,payload:JSON.parse(row.payload),lease:row.lease?JSON.parse(row.lease):null,workerInstance:row.workerInstance?JSON.parse(row.workerInstance):null,dispatchProcess:row.dispatchProcess?JSON.parse(row.dispatchProcess):null});
export function getMediaQueueJob(id: string): MediaQueueJob | null {
  if (!mediaQueueEnabled()) return null;
  const row = database().prepare("SELECT * FROM media_jobs WHERE id = ?").get(id) as Row | undefined;
  return row ? decode(row) : null;
}
/** A boolean dispatcher flag alone must never bypass physical admission. */
export function assertComfyMediaDispatch(input: {ownerId?: string; baseUrl: string; workerId: string; body: BodyInit | null | undefined}) {
  const job = input.ownerId ? getMediaQueueJob(input.ownerId) : null;
  if (!job || job.kind !== "comfy" || job.status !== "dispatching" || !job.lease
    || job.lease.lockId !== lockId(job.gpu)
    || sharedMediaAdmissionConfigured(job.gpu) && (job.admissionPhase !== "executing" || job.admissionToken === null))
    throw Error("Comfy dispatch requires its durable physical GPU reservation.");
  const payload = job.payload as ComfyMediaPayload;
  if (payload.baseUrl !== input.baseUrl.replace(/\/+$/, "") || payload.workerId !== input.workerId
    || typeof input.body !== "string" || input.body !== JSON.stringify(payload.body)
    || resolveComfyPhysicalGpu(payload.baseUrl) !== physical(job.gpu)
    || !listResourceLocks().some(lock => lock.lockId === job.lease!.lockId
      && lock.ownerId === job.lease!.ownerId && lock.fencingToken === job.lease!.fencingToken))
    throw Error("Comfy dispatch does not match its reserved graph, worker and GPU.");
}
export function mediaQueueMessage(promptId:string|null|undefined,fallback:string) {
  const job=promptId?getMediaQueueJob(promptId):null;
  if(job?.status==="queued")return `Queued for ${mediaGpuLabel(job.gpu)}; waiting for earlier work to finish.`;
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
  requireStorageHeadroom(OTG_DATA_ROOT, 512 * 1024 ** 2);
  const id = input.id || randomUUID();
  if (!MEDIA_GPUS.includes(input.gpu)) throw Error("Choose a supported physical GPU.");
  if(input.gpu==="rtx3060"&&(!local3060Enabled()||!sharedMediaAdmissionConfigured("rtx3060")||input.kind==="audio"))throw Error("The requested RTX 3060 workload is not qualified for this admission lane.");
  database().prepare("INSERT INTO media_jobs (id,gpu,kind,status,payload,createdAt,updatedAt) VALUES (?,?,?,'queued',?,?,?)")
    .run(id,input.gpu,input.kind,JSON.stringify(input.payload),Date.now(),Date.now());
  bootstrapMediaGpuQueue();
  return getMediaQueueJob(id)!;
}
/** CAS protects cancellation against another process claiming this exact job. */
export function cancelQueuedMediaJob(id: string, baseUrl?: string) {
  const job = getMediaQueueJob(id);
  if (!job || baseUrl && (job.kind !== "comfy" || (job.payload as ComfyMediaPayload).baseUrl !== baseUrl.replace(/\/+$/,""))) return false;
  return database().prepare("UPDATE media_jobs SET status='canceled',updatedAt=?,admissionPhase=CASE WHEN admissionToken IS NOT NULL THEN 'releasing' ELSE admissionPhase END WHERE id=? AND status='queued'").run(Date.now(),id).changes === 1;
}
const queuesFor = (gpu: MediaGpu) => gpu === "rtx3060" ? ["http://127.0.0.1:8190"] : gpu === "rtx3090"
  ? [process.env.OTG_MEDIA_3090_IMAGE_URL || "http://100.75.162.64:8188",process.env.OTG_MEDIA_3090_H3_URL || "http://100.75.162.64:8189"]
  : [process.env.OTG_MEDIA_5060_URL || "http://100.98.212.116:8188"];
async function readJson(url: string) {
  const response = await fetch(url,{cache:"no-store",redirect:"error",signal:AbortSignal.timeout(5000)});
  if (!response.ok) throw Error(`GPU readiness unavailable (HTTP ${response.status}).`);
  return response.json();
}
/** Probe every service on a physical card. An unavailable sibling fails closed. */
export async function probeMediaGpu(gpu: MediaGpu, ownJob?: string, reservation?: {lease?:ResourceLock|null;admissionOwner:string}): Promise<MediaGpuReadiness> {
  try {
    const own = ownJob ? getMediaQueueJob(ownJob) : null;
    const ownLease=reservation?.lease||own?.lease;
    const otherLocks = listResourceLocks().filter(lock => !(ownLease
      && lock.lockId === ownLease.lockId && lock.ownerId === ownLease.ownerId
      && lock.fencingToken === ownLease.fencingToken));
    if (queuedMediaJobs().some(j => j.gpu === gpu && j.id !== ownJob && (active.includes(j.status) || !ownJob&&!reservation))) return {ready:false,reason:"A media job owns or is waiting for this GPU."};
    if (otherLocks.some(lock => [lockId(gpu),`comfy-submit:${physical(gpu)}`].includes(lock.lockId))) return {ready:false,reason:"Another tool owns this GPU."};
    if(!await sharedMediaGpuAvailable(gpu,reservation?.admissionOwner||own?.admissionOwner||undefined))
      return {ready:false,reason:"Another application has reserved this physical GPU."};
    if (gpu === "rtx3090" && voiceGpuFileBusy()) return {ready:false,reason:"A voice operation owns the 3090."};
    for (const base of queuesFor(gpu)) {
      const q = await readJson(base+"/queue");
      if (!Array.isArray(q.queue_running) || !Array.isArray(q.queue_pending)) throw Error("Invalid GPU queue response.");
      if (q.queue_running.length || q.queue_pending.length) return {ready:false,reason:"ComfyUI is rendering or has queued work."};
      if(process.env.NODE_ENV!=="test") {
        const stats=await readJson(base+"/system_stats");
        const expected=mediaGpuLabel(gpu).toLowerCase();
        if(!Array.isArray(stats.devices)||!stats.devices.some((device:{name?:string})=>String(device.name||"").toLowerCase().includes(expected)))
          throw Error("The configured worker does not report the expected GPU.");
      }
    }
    if(gpu==="rtx3060"){ await check3060Gate();await local3060Headroom(2048,true); }
    else if(process.env.OTG_PHYSICAL_GPU_PROBE_CONFIG){
      const state=await physicalGpuState(gpu);
      if(!state)return {ready:false,reason:"Physical GPU telemetry unavailable."};
      const capacity=physicalGpuCapacity(state);if(!capacity.ready)return capacity;
    }
    if (gpu === "rtx3090" && process.env.NODE_ENV !== "test") {
      const occupancy=await detectShawnExternalOccupancy({locks:otherLocks});
      if(!occupancy.available)return {ready:false,reason:"The 3090 is reserved by an existing external workload."};
    }
    return {ready:true,reason:"Idle"};
  } catch { return {ready:false,reason:"GPU readiness cannot be confirmed; existing work is protected."}; }
}
/** Non-mutating preference for graph preparation. Dispatch checks again atomically. */
export async function preferMediaGpu(compatible: readonly RenderGpu[]): Promise<RenderGpu | null> {
  const ordered = RENDER_GPUS.filter(gpu => compatible.includes(gpu));
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
  const bindBeforeEnqueue = payload.producer?.kind === "story-3060-audio";
  if (bindBeforeEnqueue) await onAccepted?.(id);
  const job = enqueueMediaJob({id,gpu:resolved==="shawn-3060"?"rtx3060":resolved==="shawn-3090"?"rtx3090":"rtx5060ti",kind:"comfy",payload});
  // This is durable APPLICATION acceptance, not proof of Comfy execution.
  if (!bindBeforeEnqueue) await onAccepted?.(id);
  return Response.json({prompt_id:id,number:job.sequence,node_errors:{},otg_queue:"waiting-for-gpu"},{status:202});
}
function finish(job: MediaQueueJob, status: "completed"|"failed", error: string | null = null) {
  update(job.id,status,error,null);
  if(job.admissionToken!==null)database().prepare("UPDATE media_jobs SET admissionPhase='releasing' WHERE id=?").run(job.id);
  if (job.lease) releaseResourceLock(job.lease.lockId,job.lease.ownerId,job.lease.fencingToken);
}
async function releaseCompletedAdmissions(gpus:readonly MediaGpu[]) {
  const rows=database().prepare(`SELECT * FROM media_jobs WHERE gpu IN (${gpus.map(()=>"?").join(",")}) AND admissionPhase='releasing' AND admissionToken IS NOT NULL LIMIT 32`).all(...gpus) as Row[];
  for(const row of rows) {
    try {
      await releaseSharedMediaGpu(row.gpu,row.admissionOwner!,row.admissionToken!);
      database().prepare("UPDATE media_jobs SET admissionToken=NULL,admissionPhase=NULL,admissionTicket=NULL,ticketState=CASE WHEN status='queued' THEN NULL ELSE 'closed' END,admissionOwner=CASE WHEN status='queued' THEN ? ELSE admissionOwner END WHERE id=? AND admissionToken=? AND admissionPhase='releasing'").run(randomUUID(),row.id,row.admissionToken);
    }catch{/* Durable release intent survives restarts; do not free an unknown grant. */}
  }
}
function eligibleTicketGpus(job:MediaQueueJob):MediaGpu[] {
  return job.kind==="external" ? MEDIA_GPUS.filter(gpu=>((job.payload as ExternalMediaPayload).eligibleGpus||[job.gpu]).includes(gpu)) : [job.gpu];
}
/** Only metadata crosses environments. Payloads, owners' media and parents stay local. */
export function orderedMediaWaiters(jobs:MediaQueueJob[],gpu:MediaGpu,now=Date.now()){
  if(gpu!=="rtx3060")return jobs;
  const rank=(job:MediaQueueJob)=>job.ticketState==="waiting"||job.ticketState==="registering"?0:
    now-job.createdAt>=30_000?1:job.kind==="external"&&(job.payload as ExternalMediaPayload).operation==="qwen-assistance"?2:3;
  return [...jobs].sort((a,b)=>rank(a)-rank(b)||a.sequence-b.sequence);
}
async function synchronizeWaitingTickets(gpus:readonly MediaGpu[]) {
  const ended=database().prepare(`SELECT * FROM media_jobs WHERE gpu IN (${gpus.map(()=>"?").join(",")}) AND status IN ('completed','failed','canceled') AND admissionToken IS NULL AND ticketState IS NOT NULL AND ticketState!='closed' LIMIT 32`).all(...gpus) as Row[];
  for(const row of ended.filter(r=>sharedMediaAdmissionConfigured(r.gpu)))try {
    const job=decode(row),ticket=await registerSharedMediaTicket(eligibleTicketGpus(job),job.admissionOwner!);
    if(ticket.ticket!==null)await cancelSharedMediaTicket(job.gpu,job.admissionOwner!,ticket.ticket);
    database().prepare("UPDATE media_jobs SET ticketState='closed' WHERE id=? AND status IN ('completed','failed','canceled') AND admissionToken IS NULL").run(job.id);
  }catch{/* Cancellation intent survives a lost registration/cancel reply. */}
  // Advertise each environment's eligible heads, not an unbounded backlog. This
  // bounds authority round trips and prevents one busy environment flooding FIFO.
  // Global fairness is registration-order among live heads, not wall-clock arrival.
  const waiting=queuedMediaJobs().filter(job=>gpus.includes(job.gpu)&&sharedMediaAdmissionConfigured(job.gpu)&&job.status==="queued"&&!job.lease&&job.admissionPhase===null&&job.admissionToken===null);
  const heads=new Set(gpus.map(gpu=>orderedMediaWaiters(waiting,gpu).find(job=>eligibleTicketGpus(job).includes(gpu))?.id));
  for(const job of waiting.filter(job=>heads.has(job.id))) {
    if(producerState(job)!=="active")continue;
    database().prepare("UPDATE media_jobs SET admissionOwner=COALESCE(admissionOwner,?),ticketState='registering' WHERE id=? AND status='queued' AND lease IS NULL").run(randomUUID(),job.id);
    const current=getMediaQueueJob(job.id)!;
    try {
      const ticket=await registerSharedMediaTicket(eligibleTicketGpus(current),current.admissionOwner!);
      if(ticket.state!=="waiting")continue;
      database().prepare("UPDATE media_jobs SET admissionTicket=?,ticketState='waiting' WHERE id=? AND status='queued' AND lease IS NULL AND admissionOwner=?")
        .run(ticket.ticket,job.id,current.admissionOwner);
    }catch{/* Old/unreachable authority fails closed; do not bypass ticket ordering. */}
  }
}
function releaseLocalReservation(job:MediaQueueJob) {
  if(job.lease)releaseResourceLock(job.lease.lockId,job.lease.ownerId,job.lease.fencingToken);
}
/** A failed parent cannot authorize a waiting render, including after a restart. */
function producerState(job: MediaQueueJob): "active" | "terminal" | "unavailable" {
  if (job.kind !== "comfy") return "active";
  const payload = job.payload as ComfyMediaPayload, producer = payload.producer;
  if(job.gpu==="rtx3060"){
    if (producer?.kind === "story-3060-audio") {
      if (payload.workerId !== producer.kind || payload.body.client_id !== `story-3060-audio-${producer.id}`) return "unavailable";
      let db: Database.Database | undefined;
      try {
        db = new Database(path.join(OTG_DATA_ROOT,"story-creator","story-creator.sqlite"),{readonly:true,fileMustExist:true});
        const row = db.prepare("SELECT kind,status,provider_contract_json AS contract FROM story_audio_assets WHERE id=? AND project_id=? AND owner_key=? AND external_job_id=?")
          .get(producer.id,producer.projectId,producer.ownerKey,job.id) as {kind:string;status:string;contract:string}|undefined;
        if (!row) return "unavailable";
        const {provider} = JSON.parse(row.contract);
        const valid = row.kind === "music" ? provider === "ace-step-1.5-3060"
          : ["dialogue","narration"].includes(row.kind) && provider === "qwen3-tts-3060";
        if (!valid) return "unavailable";
        return row.status === "running" ? "active" : "terminal";
      } catch { return "unavailable"; }
      finally { db?.close(); }
    }
    if(!producer || !["story-3060-image","story-3060-voice"].includes(producer.kind)||payload.workerId!==producer.kind)return "unavailable";
    let db:Database.Database|undefined;
    try{
      db=new Database(path.join(OTG_DATA_ROOT,"story-creator","story-media.sqlite"),{readonly:true,fileMustExist:true});
      const row=db.prepare("SELECT project,status,record FROM media WHERE id=? AND owner=?").get(producer.id,producer.ownerKey) as {project:string;status:string;record:string}|undefined;
      if(!row)return "unavailable";
      const record=JSON.parse(row.record);
      const profileMatches=producer.kind==="story-3060-voice"
        ? record.profile==="qwen3-tts-3060"&&record.command?.operation==="voice"
        : (record.profile==="z-image-turbo-3060"&&record.command?.operation==="image")
        ||(record.profile==="flux2-klein-edit-3060"&&record.command?.operation==="edit"&&typeof record.command.sourceId==="string"&&record.command.sourceId.length>0);
      if(!profileMatches||record.status!==row.status||record.id!==producer.id||record.ownerKey!==producer.ownerKey||record.projectId!==row.project||producer.projectId!==row.project||record.backendJob?.promptId!==job.id||payload.body.client_id!==(producer.kind==="story-3060-voice"?"story-3060-voice-":"story-3060-")+record.id)return "unavailable";
      if(record.cancelRequested)return "terminal";
      return row.status==="running"?"active":["failed","canceled","ready"].includes(row.status)?"terminal":"unavailable";
    }catch{return "unavailable";}finally{db?.close();}
  }
  if (!producer) return "active";
  if (producer.kind === "production-studio-finish") {
    // Studio jobs live in SQLite, not the H3 Direct JSON-file store. Read only:
    // scheduler validation must never create a missing parent or bypass consent.
    let db: Database.Database | undefined;
    try {
      db = new Database(path.join(OTG_DATA_ROOT,"production-studio","studio.sqlite"),{readonly:true,fileMustExist:true});
      const row = db.prepare("SELECT project,status,json FROM jobs WHERE id=? AND owner=?").get(producer.id,producer.ownerKey) as {project:string;status:string;json:string}|undefined;
      if (!row) return "unavailable";
      const parent = JSON.parse(row.json);
      if (parent.id !== producer.id || parent.kind !== "finish" || parent.projectId !== row.project
        || parent.status !== row.status || parent.backendId !== job.id
        || payload.workerId !== "production-studio-finish" || payload.body.client_id !== `studio-${parent.id}`
        || job.gpu !== "rtx5060ti") return "unavailable";
      return ["failed","canceled","completed","canceling","attention"].includes(parent.status) ? "terminal"
        : ["queued","running"].includes(parent.status) ? "active" : "unavailable";
    } catch { return "unavailable"; }
    finally { db?.close(); }
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(producer.id) || !["direct", "refmods-generation", "realism", "body-swap"].includes(producer.kind)) return "unavailable";
  const file = producer.kind === "direct"
    ? path.join(OTG_DATA_ROOT, "h3-direct", safeSegment(producer.ownerKey), "jobs", producer.id + ".json")
    : path.join(OTG_DATA_ROOT, "h3-special", producer.kind, safeSegment(producer.ownerKey), "jobs", producer.id + ".json");
  try {
    if (!fs.lstatSync(file).isFile()) return "unavailable";
    const parent = JSON.parse(fs.readFileSync(file, "utf8"));
    if (parent.id !== producer.id || parent.ownerKey !== producer.ownerKey || parent.promptId && parent.promptId !== job.id
      || parent.clientId !== payload.body.client_id || parent.backend !== job.gpu) return "unavailable";
    return ["failed", "canceled", "completed", "canceling"].includes(parent.status) ? "terminal" : "active";
  } catch { return "unavailable"; }
}
async function authorizeSharedDispatch(job:MediaQueueJob) {
  if(!sharedMediaAdmissionConfigured(job.gpu)&&process.env.OTG_ENV==="test"&&job.gpu!=="rtx3060")return true;
  try {
    const grant=await acquireSharedMediaGpu(job.gpu,job.admissionOwner!,job.admissionTicket);
    if(!grant.granted) {
      database().prepare("UPDATE media_jobs SET status='queued',lease=NULL,admissionPhase=NULL,admissionToken=NULL WHERE id=? AND status='dispatching' AND lease=? AND admissionPhase='admitting'").run(job.id,JSON.stringify(job.lease));
      releaseLocalReservation(job);return false;
    }
    // The exact attempt's local fencing token prevents a delayed SSH response
    // from executing after another process recovered/requeued this admission.
    const changed=database().prepare("UPDATE media_jobs SET admissionToken=?,admissionPhase='executing' WHERE id=? AND status='dispatching' AND admissionPhase='admitting' AND lease=?")
      .run(grant.token,job.id,JSON.stringify(job.lease)).changes;
    if(!changed)return false;
    job.admissionToken=grant.token;job.admissionPhase="executing";return true;
  }catch {
    database().prepare("UPDATE media_jobs SET status='unknown',error='Shared GPU grant is unconfirmed; no backend submission has occurred.' WHERE id=? AND admissionPhase='admitting' AND lease=?")
      .run(job.id,JSON.stringify(job.lease));return false;
  }
}
async function recoverSharedAdmission(job:MediaQueueJob) {
  // No backend can execute before the admitting -> executing CAS. Retrying
  // only this idempotent grant is therefore not retrying a generation.
  try {
    const grant=await acquireSharedMediaGpu(job.gpu,job.admissionOwner!,job.admissionTicket);
    const changed=database().prepare("UPDATE media_jobs SET status='queued',lease=NULL,admissionPhase=NULL,admissionToken=?,error=NULL WHERE id=? AND admissionPhase='admitting' AND lease=?")
      .run(grant.granted?grant.token:null,job.id,JSON.stringify(job.lease)).changes;
    if(changed)releaseLocalReservation(job);
  }catch{/* Reservation stays unknown; never bypass the physical authority. */}
}
function localFence(job:MediaQueueJob):Local3060Fence|undefined {
  return job.admissionOwner && job.admissionToken!==null
    ? {owner:job.admissionOwner,token:job.admissionToken,jobId:job.id} : undefined;
}
async function confirmLocalFence(job:MediaQueueJob) {
  if(!shared3060FenceEnabled())return;
  const fence=localFence(job);
  if(!fence)throw Error("Missing RTX 3060 fencing proof.");
  await assertSharedMediaGpuOwned("rtx3060",fence.owner,fence.token);
}

async function reconcileComfy(job: MediaQueueJob) {
  const payload = job.payload as ComfyMediaPayload;
  try {
    const history = await readJson(`${payload.baseUrl}/history/${job.id}`);
    const record = history[job.id];
    if (record?.status?.completed === true || ["success","error"].includes(record?.status?.status_str)) {
      if(job.gpu==="rtx3060"){
        await confirmLocalFence(job);
        if(record.status.status_str==="success"){
          if (payload.producer?.kind === "story-3060-audio") {
            const {publishStory3060Audio}=await import("@/lib/storyCreator/audio3060");
            await publishStory3060Audio(payload.producer,job.id,record);
          } else {
            const {publishStory3060Image}=await import("@/lib/storyCreator/mediaExecution");
            await publishStory3060Image(payload.producer!,job.id,record);
          }
        }
        const clean=await fetch(LOCAL_COMFY+"/free",{method:"POST",redirect:"error",signal:AbortSignal.timeout(5000),headers:{"content-type":"application/json",...local3060Headers(localFence(job))},body:JSON.stringify({unload_models:true,free_memory:true})});
        if(!clean.ok)throw Error("3060 cleanup could not be verified");
        await local3060Headroom(8192);
      }
      finish(job,record.status.status_str === "success" ? "completed" : "failed",record.status.status_str === "success" ? null : "ComfyUI execution failed; inspect the saved node traceback.");
      return;
    }
    const q = await readJson(payload.baseUrl+"/queue");
    if (!Array.isArray(q.queue_running) || !Array.isArray(q.queue_pending)) throw Error("Invalid queue");
    if ([...q.queue_running,...q.queue_pending].some(row=>Array.isArray(row)&&row[1]===job.id)) {
      update(job.id,"running");
      // A queue observation bound to this same process also establishes which
      // worker accepted an initially uncertain POST. Never guess from uptime.
      if (job.workerInstance && !job.workerConfirmed) {
        const observed = await inspectComfyWorkerInstance(payload.baseUrl);
        if(job.gpu==="rtx3060"&&!observed)throw Error("The RTX 3060 worker identity could not be recorded. No image was submitted.");
        if (observed && sameComfyWorker(job.workerInstance, observed.instance))
          database().prepare("UPDATE media_jobs SET workerConfirmed=1 WHERE id=? AND workerInstance=?").run(job.id,JSON.stringify(job.workerInstance));
      }
    } else if (job.workerInstance && job.workerConfirmed && job.submissionSettled) {
      const observed = await inspectComfyWorkerInstance(payload.baseUrl, job.workerInstance);
      if (observed?.previousStopped && !sameComfyWorker(job.workerInstance, observed.instance)) {
        // Recheck after the trusted process probe; an empty history by itself
        // is NOT proof that execution ended. Other physical lanes must be idle.
        for (const base of queuesFor(job.gpu)) {
          const fresh = await readJson(base + "/queue");
          if (!Array.isArray(fresh.queue_running) || !Array.isArray(fresh.queue_pending)
            || fresh.queue_running.length || fresh.queue_pending.length) throw Error("Physical worker not idle");
        }
        if ((await readJson(`${payload.baseUrl}/history/${job.id}`))[job.id]) return;
        finish(job,"failed","The original ComfyUI worker stopped during rendering and no completion history survived. Check available outputs before an explicit retry; nothing was resubmitted automatically.");
      } else update(job.id,"unknown","The original GPU request is unconfirmed; its reservation is protected until execution can be verified.");
    } else update(job.id,"unknown",job.error || "Awaiting backend proof. This job will not be automatically resubmitted or replaced.");
  } catch { update(job.id,"unknown",job.error || "Worker unavailable; retaining this GPU reservation until its original job can be reconciled."); }
}
async function dispatch(job: MediaQueueJob) {
  if(!await authorizeSharedDispatch(job))return;
  // Readiness may change while the shared authority is being contacted. No
  // worker or cleanup call has happened yet, so this attempt can safely wait.
  const readiness = await probeMediaGpu(job.gpu, job.id);
  if (!readiness.ready) {
    database().prepare("UPDATE media_jobs SET status='queued',error=?,lease=NULL,admissionPhase=CASE WHEN admissionToken IS NOT NULL THEN 'releasing' ELSE NULL END,updatedAt=? WHERE id=? AND status='dispatching' AND lease=?")
      .run(readiness.reason,Date.now(),job.id,JSON.stringify(job.lease));
    releaseLocalReservation(job);
    return;
  }
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
      if(job.gpu==="rtx3060")throw Error("Use a qualified RTX 3060 Comfy audio workflow.");
      await executeQueuedAudioJob(job.payload as AudioMediaPayload,job.gpu);
      finish(job,"completed");
    } catch(error) {
      const { queuedAudioJobState } = await import("@/lib/audioEditing/jobs");
      if(queuedAudioJobState(job.payload as AudioMediaPayload)==="unknown")
        update(job.id,"unknown","Remote audio execution is unconfirmed; retaining the original reservation without retry.");
      else finish(job,"failed",error instanceof Error?error.message:"Audio worker failed.");
    }
    return;
  }
  const payload = job.payload as ComfyMediaPayload;
  let postStarted = false;
  try {
    if(job.gpu==="rtx3060"){await confirmLocalFence(job);await unload3060Ollama(localFence(job));await local3060Headroom(8192);}
    await qualifyPreparedComfyGraph(payload.baseUrl, payload.body.prompt);
    const { submitComfyPromptWithGpuLease } = await (submissionModule ??= import("./comfyPromptLease"));
    const response = await submitComfyPromptWithGpuLease({ ...payload, ownerId:job.id, queueDispatch:true,
      init:{method:"POST",headers:{"Content-Type":"application/json",...(job.gpu==="rtx3060"?{"X-OTG-Admission-Owner":job.admissionOwner!,"X-OTG-Admission-Token":String(job.admissionToken),...local3060Headers(localFence(job))}:{})},body:JSON.stringify(payload.body)},submitTimeoutMs:60_000,
      beforeSubmit: async () => {
        if (producerState(job) !== "active") throw Error("The original request ended or cannot be verified; no render was submitted.");
        const observed = await inspectComfyWorkerInstance(payload.baseUrl);
        if (observed) {
          job.workerInstance = observed.instance;
          database().prepare("UPDATE media_jobs SET workerInstance=?,workerConfirmed=NULL WHERE id=?").run(JSON.stringify(observed.instance),job.id);
        }
        postStarted = true;
      } });
    if (!response.ok) {
      if (!postStarted || response.status < 500) finish(job,"failed",(await response.text()).slice(0,2000));
      else update(job.id,"unknown","Submission response was inconclusive; no automatic retry.");
      return;
    }
    const result = await response.json();
    if (result.prompt_id !== job.id) { update(job.id,"unknown","Worker did not preserve the reserved prompt UUID; no automatic retry."); return; }
    if (job.workerInstance) {
      const observed = await inspectComfyWorkerInstance(payload.baseUrl).catch(() => null);
      if (observed && sameComfyWorker(job.workerInstance,observed.instance))
        database().prepare("UPDATE media_jobs SET workerConfirmed=1 WHERE id=?").run(job.id);
    }
    update(job.id,"running");
  } catch (error) {
    if (!postStarted) finish(job,"failed",error instanceof Error ? error.message : "The request ended before submission.");
    else update(job.id,"unknown","Submission outcome is unknown; reconcile the reserved UUID instead of resubmitting.");
  } finally {
    database().prepare("UPDATE media_jobs SET submissionSettled=? WHERE id=?").run(Date.now(),job.id);
  }
}
type QueueGlobals = typeof globalThis & {__otgMediaQueue?: {timer:ReturnType<typeof setInterval>;ticking:Set<string>;audio:Set<string>;external:Map<string,(release:()=>void)=>void>}};
const globals = globalThis as QueueGlobals;
/** Legacy local services can queue safely without pretending they have a 5060 runtime. */
export async function acquireExternalMediaGpu(gpu:MediaGpu,operation:string):Promise<()=>void> {
  const result=await acquireExternalMediaGpuChoice([gpu],operation);
  return result.release;
}
/** Endpoint/model qualification happens in the caller; only unstarted external jobs can move. */
export async function acquireExternalMediaGpuChoice<G extends MediaGpu>(eligibleGpus:readonly G[],operation:string,waitMs?:number,signal?:AbortSignal):Promise<{gpu:G;release:()=>void;lease:ResourceLock;uncertain:()=>void;bindBackend:(pid:number)=>void;fence?:Local3060Fence}> {
  signal?.throwIfAborted();
  if(!mediaQueueEnabled())throw Error("The shared media queue is not enabled.");
  const choices=MEDIA_GPUS.filter(g=>(eligibleGpus as readonly MediaGpu[]).includes(g));
  if(choices.includes("rtx3060")&&choices.length!==1)throw Error("The assistant GPU is not a render fallback.");
  const gpu=choices.length===1?choices[0]:await preferMediaGpu(choices.filter((g):g is RenderGpu=>g!=="rtx3060"));if(!gpu)throw Error("No qualified GPU supports this operation.");
  const id=randomUUID();bootstrapMediaGpuQueue();
  return new Promise((resolve,reject)=>{
    let ended=false;let timer:ReturnType<typeof setTimeout>|undefined;
    const cleanup=()=>{if(timer)clearTimeout(timer);signal?.removeEventListener("abort",abort);};
    const abort=()=>{ended=true;cleanup();if(cancelQueuedMediaJob(id))globals.__otgMediaQueue?.external.delete(id);reject(signal?.reason||Error("GPU request cancelled before execution."));};
    globals.__otgMediaQueue!.external.set(id,release=>{
      if(ended){release();return;}
      ended=true;cleanup();
      const job=getMediaQueueJob(id);
      if(!job?.lease){release();reject(Error("GPU reservation was not confirmed"));return;}
      resolve({gpu:job.gpu as G,release,lease:job.lease,fence:localFence(job),uncertain:()=>update(id,"unknown","External execution is unconfirmed. Reservation retained; do not retry until the original service is reconciled."),
        bindBackend:pid=>{
          const backend=readDispatchProcess(pid);
          const changed=database().prepare("UPDATE media_jobs SET payload=? WHERE id=? AND status='running' AND gpu='rtx3060'")
            .run(JSON.stringify({...job.payload,backend}),id);
          if(changed.changes!==1)throw Error("Could not bind the original RTX 3060 execution identity.");
        }});
    });
    try{enqueueMediaJob({id,gpu,kind:"external",payload:{pid:process.pid,operation,eligibleGpus:choices,...(gpu==="rtx3060"?{caller:readDispatchProcess()}:{})}});
      if(waitMs!==undefined)timer=setTimeout(()=>{
        ended=true;cleanup();if(cancelQueuedMediaJob(id))globals.__otgMediaQueue?.external.delete(id);
        reject(Error("No compatible GPU became available before the request deadline."));
      },Math.max(1,waitMs));
      signal?.addEventListener("abort",abort,{once:true});if(signal?.aborted)abort();
    }
    catch(error){cleanup();globals.__otgMediaQueue!.external.delete(id);reject(error);}
  });
}
/** One dispatch per physical GPU; SQLite claims also serialize competing Node processes. */
export async function tickMediaGpuQueue() {
  if (!mediaQueueEnabled()) return;
  // A disconnected renderer authority must not stall TEST-local assistance.
  await Promise.all([tickGroup("render",RENDER_GPUS),...(local3060Enabled()?[tickGroup("local3060",["rtx3060"])]:[])]);
}
async function tickGroup(group:string,gpus:readonly MediaGpu[]){
  const state = globals.__otgMediaQueue;
  if (state?.ticking.has(group)) return;
  state?.ticking.add(group);
  try {
    await releaseCompletedAdmissions(gpus);
    await synchronizeWaitingTickets(gpus);
    // External operations have not uploaded worker-specific assets or bound a parent
    // to an endpoint. They can safely move while queued; prepared Comfy graphs cannot.
    for(const job of queuedMediaJobs().filter(j=>gpus.includes(j.gpu)&&j.kind==="external"&&j.status==="queued"&&j.admissionToken===null&&!j.lease&&j.admissionPhase===null)){
      const choices=(job.payload as ExternalMediaPayload).eligibleGpus;
      if(!choices||choices.length<2)continue;
      for(const gpu of MEDIA_GPUS.filter(g=>choices.includes(g))){
        // Do not jump an older waiting job on the destination card.
        if(queuedMediaJobs().some(other=>other.gpu===gpu&&other.id!==job.id&&other.status==="queued"&&other.sequence<job.sequence))continue;
        if(!(await probeMediaGpu(gpu,job.id)).ready)continue;
        if(gpu!==job.gpu)database().prepare("UPDATE media_jobs SET gpu=?,updatedAt=? WHERE id=? AND gpu=? AND status='queued' AND lease IS NULL AND admissionToken IS NULL AND admissionPhase IS NULL")
          .run(gpu,Date.now(),job.id,job.gpu);
        break;
      }
    }
    for (const gpu of gpus) {
      let running = queuedMediaJobs().find(job=>job.gpu===gpu&&active.includes(job.status));
      if (running) {
        if (running.lease) heartbeatResourceLock(running.lease.lockId,running.lease.ownerId,running.lease.fencingToken,300);
        // Admission, inventory checks and the final POST are asynchronous. A
        // polling tick (including another Node process) must not recover their
        // live owner or rewrite dispatching -> unknown before POST is possible.
        // Persisted PID + start ticks + boot ID also prevents PID reuse after a
        // restart from hiding an abandoned submission. Dead owners still take
        // the existing fail-closed recovery path; never resubmit blindly.
        if (running.dispatchProcess && dispatchProcessState(running.dispatchProcess) !== "stopped") continue;
        if(running.admissionPhase==="admitting") {await recoverSharedAdmission(running);continue;}
        if (running.kind === "comfy") await reconcileComfy(running);
        else if (running.kind==="external"&&gpu==="rtx3060") {
          const work=running.payload as ExternalMediaPayload;
          const original=work.backend||work.caller;
          const abandoned=work.caller&&dispatchProcessState(work.caller)==="stopped";
          if(shared3060FenceEnabled()&&(running.status==="unknown"||abandoned)){
            try{
              await confirmLocalFence(running);
              const fence=localFence(running);
              const receipt=await localJson(LOCAL_OLLAMA+"/otg-terminal",{headers:local3060Headers(fence)});
              if(receipt.completed===true){
                await unload3060Ollama(fence);
                await local3060Headroom(0);
                finish(running,"failed","The original Ollama request ended and its grant was released. No result was replayed.");
                continue;
              }
            }catch{/* Without terminal proof the original grant remains protected. */}
          }
          if(original&&dispatchProcessState(original)==="stopped"){
            try{
              const current=await verify3060Ollama();
              const resident=await localJson(LOCAL_OLLAMA+"/api/ps");
              if(work.backend?.pid===current.pid&&work.backend.startTicks===readDispatchProcess(current.pid).startTicks||!Array.isArray(resident.models)||resident.models.length)throw Error("Original service may still own work");
              await local3060Headroom(0);
              finish(running,"failed","Original local execution stopped. Its grant was reconciled; nothing was replayed.");
            }catch{update(running.id,"unknown","The original RTX 3060 execution is unconfirmed. Its reservation remains protected.");}
          }
        }else if (running.kind==="external") {
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
      const waiting = orderedMediaWaiters(queuedMediaJobs().filter(job=>job.gpu===gpu&&job.status==="queued"),gpu)[0];
      if (waiting) {
        const producer = producerState(waiting);
        if (producer === "terminal") { cancelQueuedMediaJob(waiting.id); continue; }
        if (producer === "unavailable") { update(waiting.id, "queued", "The original request cannot be verified; no render was submitted."); continue; }
      }
      if(waiting?.kind==="external"&&!state?.external.has(waiting.id)){
        const pid=(waiting.payload as ExternalMediaPayload).pid;
        try{process.kill(pid,0);}catch{finish(waiting,"failed","The original request stopped before GPU execution; no work was submitted.");}
        continue;
      }
      if (!waiting || waiting.admissionPhase === "releasing"
        || sharedMediaAdmissionConfigured(gpu)&&waiting.admissionToken===null&&(waiting.ticketState!=="waiting"||waiting.admissionTicket===null)
        || !(await probeMediaGpu(gpu,waiting.id)).ready) continue;
      const dispatchOwner = JSON.stringify(readDispatchProcess());
      // Each claim attempt has a distinct owner: a losing Node process must not
      // release the winning process's reentrant resource-lock token.
      const acquired = acquireResourceLock({lockId:lockId(gpu),ownerId:`${waiting.id}:${randomUUID()}`,ownerType:"job",workerId:"media-gpu-queue",resourceName:"media-render",ttlSeconds:300});
      if (!acquired.ok) continue;
      const claimed = database().transaction(() => {
        if (database().prepare("SELECT id FROM media_jobs WHERE gpu=? AND status IN ('dispatching','running','unknown')").get(gpu)) return false;
        return database().prepare("UPDATE media_jobs SET status='dispatching',lease=?,updatedAt=?,admissionOwner=COALESCE(admissionOwner,?),admissionPhase=?,dispatchProcess=?,submissionSettled=NULL WHERE id=? AND gpu=? AND status='queued' AND lease IS NULL AND (admissionPhase IS NULL OR admissionPhase!='releasing') AND admissionTicket IS ?")
          .run(JSON.stringify(acquired.lock),Date.now(),randomUUID(),sharedMediaAdmissionConfigured(gpu)?"admitting":null,dispatchOwner,waiting.id,gpu,waiting.admissionTicket).changes===1;
      }).immediate();
      if (!claimed) { releaseResourceLock(acquired.lock.lockId,acquired.lock.ownerId,acquired.lock.fencingToken); continue; }
      const job = getMediaQueueJob(waiting.id)!;
      if (job.kind === "audio") state?.audio.add(job.id);
      void dispatch(job).finally(()=>{
        // Do not clear a successor's ownership if recovery replaced this claim.
        database().prepare("UPDATE media_jobs SET dispatchProcess=NULL WHERE id=? AND dispatchProcess=? AND (lease=? OR lease IS NULL)")
          .run(job.id,dispatchOwner,JSON.stringify(job.lease));
        state?.audio.delete(job.id);
      });
    }
  } finally { state?.ticking.delete(group); }
}
export function bootstrapMediaGpuQueue() {
  if (!mediaQueueEnabled() || globals.__otgMediaQueue) return;
  const timer=setInterval(()=>void tickMediaGpuQueue().catch(()=>{/* Preserve rows; retry read-only readiness on next tick. */}),2000);
  timer.unref();
  globals.__otgMediaQueue={timer,ticking:new Set(),audio:new Set(),external:new Map()};
}
export function closeMediaGpuQueueForTests() {
  if(globals.__otgMediaQueue)clearInterval(globals.__otgMediaQueue.timer);
  delete globals.__otgMediaQueue; connection?.close();connection=undefined;connectionPath="";
}
