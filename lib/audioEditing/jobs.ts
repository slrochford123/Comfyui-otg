import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { atomicJson, sessionRoot, readSession, saveSession, containedFile, assertId, reserveSessionStart } from "./store";
import type { AudioAsset, AudioGpu, AudioSession } from "./contracts";
import { applyEnhancedTrack } from "./contracts";
import { acquireResourceLock, releaseResourceLock, heartbeatResourceLock, type ResourceLock } from "@/lib/workers/resourceLocks";
import type { WorkerResourceLockId } from "@/lib/workers/workerCatalog";
import { voiceGpuFileBusy } from "@/lib/workers/voiceGpuFileLease";
import { mediaQueueEnabled, enqueueMediaJob, getMediaQueueJob, cancelQueuedMediaJob, preferMediaGpu, type AudioMediaPayload } from "@/lib/workers/mediaGpuQueue";
import { mediaGpuCandidates, type MediaGpu } from "@/lib/mediaGpuRouting";
import { audioTransportReady, audioWorkerScript } from "./transport";

export type AudioOperation = "import" | "separate" | "mix" | "enhance" | "speech" | "extract" | "music" | "effects";
type Manifest = { id: string; sessionId: string; operation: AudioOperation; gpu: AudioGpu; source?: string;
  session: AudioSession; params: Record<string, unknown>; createdAt: string; pid?: number };
export type AudioJobStatus = { id: string; status: "queued" | "running" | "completed" | "failed" | "canceled";
  stage: string; progress: number; elapsedSeconds?: number; assets?: AudioAsset[]; };
export const engineConfigPath = () => process.env.OTG_AUDIO_ENGINE_CONFIG || "/home/shawn-rochford/AI/runtime/test/unified-audio/engines.json";
export function engineConfig() { return JSON.parse(fs.readFileSync(engineConfigPath(), "utf8")); }
export function assertAudioTestEnabled() {
  if (process.env.OTG_ENV !== "test" || process.env.OTG_AUDIO_EDITING_ENABLED !== "1") throw Error("Unified Audio Editing is available only in the configured TEST environment.");
}
export function capabilities() {
  try {
    const cfg = engineConfig();
    return { enabled: true, engines: cfg.verified || {}, researchOnly: cfg.researchOnly || [],
      notes: cfg.notes || [], pythonReady: fs.existsSync(cfg.python) };
  } catch { return { enabled: true, engines: {}, researchOnly: [], pythonReady: false,
    notes: ["The isolated audio engine configuration is not installed."] }; }
}
function jobDir(owner: string, session: string, job: string) { return path.join(sessionRoot(owner, session), "jobs", assertId(job)); }
function readManifest(owner: string, session: string, id: string): Manifest {
  return JSON.parse(fs.readFileSync(path.join(jobDir(owner,session,id), "request.json"), "utf8"));
}
function isWorkerAlive(manifest: Manifest, file: string) {
  if (!manifest.pid) return false;
  try {
    const args = fs.readFileSync(`/proc/${manifest.pid}/cmdline`, "utf8");
    return args.includes(file) && (args.includes("audio-editing-worker.py") || args.includes("audio-editing-remote.py") || args.includes("audio-editing-restricted-remote.py"));
  } catch { return false; }
}
export function reconcileJob(owner: string, sessionId: string, id: string) {
  const root = jobDir(owner, sessionId, id);
  const file = path.join(root, "request.json");
  const manifest = readManifest(owner,sessionId,id);
  const statusFile = path.join(root,"status.json");
  let state: AudioJobStatus = fs.existsSync(statusFile) ? JSON.parse(fs.readFileSync(statusFile,"utf8"))
    : { id, status: "queued", stage: "Starting", progress: 0 };
  if (["running","queued"].includes(state.status))state.elapsedSeconds=Math.max(state.elapsedSeconds||0,(Date.now()-Date.parse(manifest.createdAt))/1000);
  if(remoteExecutionUnconfirmed(root)&&!isWorkerAlive(manifest,file)) {
    state={...state,status:"running",stage:"Remote execution is unconfirmed; GPU reservation retained. No duplicate job will be submitted."};
    atomicJson(statusFile,state);return state;
  }
  if(["running","queued"].includes(state.status)&&fs.existsSync(path.join(root,"cancel"))) {
    if(!isWorkerAlive(manifest,file)) {
      state={...state,status:"canceled",stage:"Canceled; original media retained.",progress:0};atomicJson(statusFile,state);
    } else state.stage="Canceling the isolated operation; original media retained.";
  }
  const queue = getMediaQueueJob(id);
  const awaitingDispatch = queue && ["queued","dispatching"].includes(queue.status) && !manifest.pid;
  if (queue?.status === "failed" && state.status !== "completed") {
    state = {...state,status:"failed",stage:queue.error || "The queued audio operation failed."}; atomicJson(statusFile,state);
  }
  if (["running","queued"].includes(state.status) && !awaitingDispatch && !isWorkerAlive(manifest,file) && Date.now()-Date.parse(manifest.createdAt)>10000) {
    state = { id, status: "failed", stage: "The worker stopped. Your source and edits are safe; retry this operation.", progress: 0 };
    atomicJson(statusFile,state);
  }
  if (state.status === "completed") {
    const session = readSession(owner, sessionId);
    const result = JSON.parse(fs.readFileSync(path.join(root,"result.json"),"utf8"));
    if (!session.completedJobs.includes(id)) {
      for (const asset of result.assets as AudioAsset[]) {
        containedFile(sessionRoot(owner,sessionId),asset.file);
        if (!session.assets.some(a=>a.id===asset.id)) session.assets.push(asset);
      }
      if (result.stems) session.stems = result.stems;
      if (result.engine && manifest.operation === "separate") session.separation = { engine: result.engine,
        warnings: result.warnings || [], cacheKey: String(manifest.params.cacheKey || "") };
      if (result.enhanced) applyEnhancedTrack(session,manifest.params.sourceAssetId,result.enhanced);
      session.completedJobs.push(id);
      saveSession(owner,session);
    }
    state.assets = result.assets.map((a:AudioAsset)=>({...a,file:""}));
  }
  return state;
}
export function sessionJobs(owner: string, sessionId: string) {
  const root = path.join(sessionRoot(owner,sessionId),"jobs");
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root).filter(id=>/^[a-f0-9-]{36}$/.test(id)).flatMap(id=>{
    try { return [reconcileJob(owner,sessionId,id)]; } catch { return []; }
  });
}
async function admission(gpu: AudioGpu, id: string): Promise<ResourceLock[]> {
  if (gpu === "cpu") return [];
  if (gpu === "rtx3090" && voiceGpuFileBusy()) throw Error("RTX 3090 is busy with a voice/audio operation. Existing work was not interrupted.");
  const locks: ResourceLock[] = [];
  const release = () => locks.forEach(l=>releaseResourceLock(l.lockId,l.ownerId,l.fencingToken));
  try {
    const lockIds: WorkerResourceLockId[] = gpu === "rtx3090" ? ["comfy-submit:shawn-3090","gpu:shawn-3090"] : ["gpu:slr-5060"];
    for (const lockId of lockIds) {
      const result = acquireResourceLock({lockId,ownerId:id,ownerType:"job",workerId:"test-audio-editing",resourceName:"isolated-audio",ttlSeconds:90});
      if (!result.ok) throw Error("The selected GPU is busy. Existing work was not interrupted.");
      locks.push(result.lock);
    }
    const bases = gpu === "rtx3090" ? ["http://100.75.162.64:8188","http://100.75.162.64:8189"] : ["http://100.98.212.116:8188"];
    for (const base of bases) {
      const res = await fetch(`${base}/queue`,{cache:"no-store",signal:AbortSignal.timeout(3000)});
      if (!res.ok) throw Error("Cannot verify the GPU queue; no model was started.");
      const q = await res.json();
      if (!Array.isArray(q.queue_running)||!Array.isArray(q.queue_pending)||q.queue_running.length||q.queue_pending.length)
        throw Error("An existing generation is active or queued. Audio processing will not interrupt it.");
    }
    return locks;
  } catch(error) { release(); throw error; }
}
export async function startJob(owner: string, sessionId: string, operation: AudioOperation, source: string | undefined,
  params: Record<string, unknown>, gpu: AudioGpu | "auto" = "cpu") {
  // Reserve synchronously before the first await, across Node processes as well
  // as concurrent requests. Never steal a live process's admission reservation.
  const releaseReservation=reserveSessionStart(owner,sessionId);
  try { return await startReservedJob(owner,sessionId,operation,source,params,gpu); }
  finally { releaseReservation(); }
}
async function startReservedJob(owner: string, sessionId: string, operation: AudioOperation, source: string | undefined,
  params: Record<string, unknown>, gpu: AudioGpu | "auto") {
  const session = readSession(owner,sessionId);
  const existing = sessionJobs(owner,sessionId).find(j=>j.status==="queued"||j.status==="running");
  if (existing) throw Error("This session already has an active operation. Wait or cancel it first.");
  const cfg = engineConfig();
  const ai = ["separate","speech","music","effects"].includes(operation) || operation === "enhance" && params.engine === "mossformer";
  const capability = operation === "speech" && params.variant === "base" ? "speech-base"
    : operation === "enhance" && params.engine === "mossformer" ? "enhance-mossformer"
    : operation === "separate" && params.engine === "bandit" ? "separate-bandit" : operation;
  if (gpu === "auto") {
    const supported = mediaGpuCandidates("auto",["rtx3090","rtx5060ti"].filter(candidate=>cfg.verified?.[capability]?.[candidate] &&
      audioTransportReady(cfg,candidate as MediaGpu)) as MediaGpu[]);
    const selected = await preferMediaGpu(supported);
    if (!selected) throw Error("This audio engine has no qualified GPU configuration. Existing workloads were not changed.");
    gpu = selected;
  }
  if (ai && !cfg.verified?.[capability]?.[gpu]) throw Error(`This operation has not been qualified on ${gpu}. Select an available engine.`);
  if (!audioTransportReady(cfg,gpu)) throw Error("The selected GPU isolated audio connection is not qualified. Existing workloads remain untouched.");
  if(gpu!=="cpu"&&cfg.transports?.[gpu]?.protocol==="slr-audio-v1"&&!mediaQueueEnabled())
    throw Error("The restricted audio connection requires the durable GPU queue; no worker was started.");
  if (source) containedFile(sessionRoot(owner,sessionId),source);
  const id = crypto.randomUUID();
  const root = jobDir(owner,sessionId,id);
  fs.mkdirSync(root,{recursive:true,mode:0o700});
  const manifest: Manifest = {id,sessionId,operation,gpu,source,params,session,createdAt:new Date().toISOString()};
  const file = path.join(root,"request.json");
  if (mediaQueueEnabled() && gpu !== "cpu") {
    atomicJson(file,manifest);
    atomicJson(path.join(root,"status.json"),{id,status:"queued",stage:`Waiting for ${gpu === "rtx3090" ? "RTX 3090" : "RTX 5060 Ti"}`,progress:0});
    enqueueMediaJob({id,gpu,kind:"audio",payload:{owner,sessionId,jobId:id}});
    return {id,status:"queued",gpu};
  }
  const locks = await admission(gpu,id);
  const release = ()=>locks.forEach(l=>releaseResourceLock(l.lockId,l.ownerId,l.fencingToken));
  try {
    atomicJson(file,manifest);
    atomicJson(path.join(root,"status.json"),{id,status:"queued",stage:"Starting isolated worker",progress:0});
    const script = audioWorkerScript(cfg,gpu);
    const log = fs.openSync(path.join(root,"worker.log"),"a",0o600);
    const cache=path.join(path.dirname(engineConfigPath()),"engine-cache");
    const temp=path.join(root,"temp");fs.mkdirSync(temp,{recursive:true,mode:0o700});
    const workerEnv:NodeJS.ProcessEnv={NODE_ENV:process.env.NODE_ENV||"production",PATH:process.env.PATH,HOME:process.env.HOME,LANG:process.env.LANG||"C.UTF-8",
      ...(process.env.SSH_AUTH_SOCK?{SSH_AUTH_SOCK:process.env.SSH_AUTH_SOCK}:{}),
      OTG_AUDIO_ENGINE_CONFIG:engineConfigPath(),OMP_NUM_THREADS:"4",MKL_NUM_THREADS:"4",TMPDIR:temp,
      HF_HUB_OFFLINE:"1",TRANSFORMERS_OFFLINE:"1",HF_HOME:path.join(cache,"huggingface"),
      TORCH_HOME:path.join(cache,"torch"),TRITON_CACHE_DIR:path.join(cache,"triton"),XDG_CACHE_HOME:path.join(cache,"xdg")};
    const child = spawn(cfg.python,[script,file],{detached:true,stdio:["ignore",log,log],
      env:workerEnv});
    fs.closeSync(log);
    manifest.pid = child.pid;
    atomicJson(file,manifest);
    const heartbeat = setInterval(()=>{for(const l of locks) {
      try { if(!heartbeatResourceLock(l.lockId,l.ownerId,l.fencingToken,90)) child.kill("SIGTERM"); }
      catch { child.kill("SIGTERM"); }
    }},20000);
    heartbeat.unref();
    child.on("error",()=>{ clearInterval(heartbeat); release(); atomicJson(path.join(root,"status.json"),{id,status:"failed",stage:"The isolated worker could not start.",progress:0}); });
    child.on("exit",()=>{ clearInterval(heartbeat); release(); });
    child.unref();
    return { id, status:"queued" };
  } catch(error) { release(); throw error; }
}
export function cancelJob(owner: string, sessionId: string, id: string) {
  const root = jobDir(owner,sessionId,id);
  const manifest = readManifest(owner,sessionId,id);
  const state = reconcileJob(owner,sessionId,id);
  if (!["queued","running"].includes(state.status)) return state;
  if(remoteExecutionUnconfirmed(root)&&!isWorkerAlive(manifest,path.join(root,"request.json")))
    throw Error("Remote execution is unconfirmed. Reconnect and reconcile this operation before releasing its GPU reservation.");
  cancelQueuedMediaJob(id);
  fs.writeFileSync(path.join(root,"cancel"),"cancel",{mode:0o600});
  if (isWorkerAlive(manifest,path.join(root,"request.json"))) {
    // The restricted client must retain its SSH supervisor until remote exit is
    // acknowledged. Signaling its whole group would sever that acknowledgement.
    try {
      const restricted=fs.readFileSync(`/proc/${manifest.pid}/cmdline`,"utf8").includes("audio-editing-restricted-remote.py");
      process.kill(restricted?manifest.pid!:-manifest.pid!,"SIGTERM");
    } catch { /* already exited */ }
  }
  return {id,status:"canceled",stage:"Canceled; source media retained.",progress:0};
}

/** Dispatcher entrypoint. All paths are resolved from an owner-scoped manifest, never HTTP paths. */
export async function executeQueuedAudioJob(payload: AudioMediaPayload, gpu: MediaGpu) {
  const {owner,sessionId,jobId:id}=payload;
  const root=jobDir(owner,sessionId,id),file=path.join(root,"request.json");
  const manifest=readManifest(owner,sessionId,id);
  if (manifest.id!==id || manifest.sessionId!==sessionId || manifest.gpu!==gpu) throw Error("Queued audio identity changed.");
  if (fs.existsSync(path.join(root,"cancel"))) throw Error("Canceled before audio execution.");
  if (manifest.pid) throw Error("This audio job already owns a worker; refusing duplicate execution.");
  const cfg=engineConfig();
  const script=audioWorkerScript(cfg,gpu);
  const log=fs.openSync(path.join(root,"worker.log"),"a",0o600);
  const cache=path.join(path.dirname(engineConfigPath()),"engine-cache"),temp=path.join(root,"temp");
  fs.mkdirSync(temp,{recursive:true,mode:0o700});
  const env:NodeJS.ProcessEnv={NODE_ENV:process.env.NODE_ENV||"production",PATH:process.env.PATH,HOME:process.env.HOME,LANG:process.env.LANG||"C.UTF-8",
    ...(process.env.SSH_AUTH_SOCK?{SSH_AUTH_SOCK:process.env.SSH_AUTH_SOCK}:{}),OTG_AUDIO_ENGINE_CONFIG:engineConfigPath(),
    OMP_NUM_THREADS:"4",MKL_NUM_THREADS:"4",TMPDIR:temp,HF_HUB_OFFLINE:"1",TRANSFORMERS_OFFLINE:"1",
    HF_HOME:path.join(cache,"huggingface"),TORCH_HOME:path.join(cache,"torch"),TRITON_CACHE_DIR:path.join(cache,"triton"),XDG_CACHE_HOME:path.join(cache,"xdg")};
  try {
    await new Promise<void>((resolve,reject)=>{
      const child=spawn(cfg.python,[script,file],{detached:true,stdio:["ignore",log,log],env});
      manifest.pid=child.pid;atomicJson(file,manifest);
      child.once("error",()=>reject(Error("The isolated audio worker could not start.")));
      child.once("exit",()=>{
        const status=queuedAudioJobState(payload);
        if(status==="completed")resolve();else reject(Error(status==="canceled"?"Audio operation canceled.":"Audio processing failed; inspect this operation's saved worker log."));
      });
    });
  } finally {fs.closeSync(log);}
}
export function queuedAudioJobState(payload: AudioMediaPayload): string {
  if(remoteExecutionUnconfirmed(jobDir(payload.owner,payload.sessionId,payload.jobId)))return "unknown";
  return reconcileJob(payload.owner,payload.sessionId,payload.jobId).status;
}
function remoteExecutionUnconfirmed(root:string) {
  const file=path.join(root,"remote-execution.json");
  if(!fs.existsSync(file))return false;
  try{return JSON.parse(fs.readFileSync(file,"utf8")).outcome==="pending";}catch{return true;}
}
