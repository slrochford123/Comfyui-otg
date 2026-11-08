import { randomUUID } from "node:crypto";
import type { MediaGpu } from "@/lib/mediaGpuRouting";
import type { WorkerResourceLockId } from "./workerCatalog";
import { acquireResourceLock, canonicalResourceLockId, heartbeatResourceLock, listResourceLocks,
  releaseResourceLock, resourceLockStore, type AcquireResourceLockInput, type ResourceLock } from "./resourceLocks";
import { acquireSharedMediaGpu, assertSharedMediaGpuOwned, cancelSharedMediaTicket,
  registerSharedMediaTicket, releaseSharedMediaGpu, sharedMediaAdmissionConfigured } from "./mediaGpuAdmission";
import { probeMediaGpu } from "./mediaGpuQueue";

type Attempt = { id:string; lockId:WorkerResourceLockId; ownerId:string; workerId:string; gpu:MediaGpu;
  phase:"waiting"|"admitting"|"checking"|"active"|"releasing"|"canceled"|"released";
  ticket:number|null; token:number|null; lease:string|null };
type Result = {ok:true;lock:ResourceLock}|{ok:false;error:string;waitingToken?:string};
function db() {
  const store=resourceLockStore();
  store.exec(`CREATE TABLE IF NOT EXISTS legacy_gpu_admissions (
    id TEXT PRIMARY KEY, lockId TEXT NOT NULL, ownerId TEXT NOT NULL, workerId TEXT NOT NULL,
    gpu TEXT NOT NULL, phase TEXT NOT NULL, ticket INTEGER, token INTEGER, lease TEXT);
    CREATE UNIQUE INDEX IF NOT EXISTS legacy_gpu_admission_live
      ON legacy_gpu_admissions(lockId,ownerId) WHERE phase!='released';`);
  return store;
}
const get=(id:string)=>db().prepare("SELECT * FROM legacy_gpu_admissions WHERE id=?").get(id) as Attempt;
const leaseOf=(attempt:Attempt):ResourceLock=>JSON.parse(attempt.lease!);
const gpuOf=(id:WorkerResourceLockId):MediaGpu|null=>canonicalResourceLockId(id)==="gpu:shawn-3090"?"rtx3090":canonicalResourceLockId(id)==="gpu:slr-5060"?"rtx5060ti":null;
const busy=(attempt?:Attempt):Result=>({ok:false,error:"GPU resource is busy or admission is unconfirmed; no worker execution is authorized.",...(attempt?{waitingToken:`wait_${attempt.id}`}:{})});
function matching(id:WorkerResourceLockId,owner:string,fence:string):Attempt|undefined {
  return (db().prepare("SELECT * FROM legacy_gpu_admissions WHERE lockId=? AND ownerId=?").all(canonicalResourceLockId(id),owner) as Attempt[])
    .find(a=>fence===`wait_${a.id}`||a.lease&&leaseOf(a).fencingToken===fence);
}
function presentLease(attempt:Attempt) {
  const lease=attempt.lease?leaseOf(attempt):null;
  return lease&&listResourceLocks().find(l=>l.lockId===lease.lockId&&l.ownerId===lease.ownerId&&l.fencingToken===lease.fencingToken);
}
async function releaseAttempt(attempt:Attempt) {
  // A persisted grant token is mandatory. An unknown grant never ages out.
  if(attempt.token===null)throw Error("Shared GPU release lacks its durable fencing token.");
  await releaseSharedMediaGpu(attempt.gpu,attempt.id,attempt.token);
  db().transaction(()=>{
    const current=get(attempt.id);if(current.phase!=="releasing")return;
    const lease=leaseOf(current);releaseResourceLock(lease.lockId,lease.ownerId,lease.fencingToken);
    db().prepare("UPDATE legacy_gpu_admissions SET phase='released' WHERE id=? AND phase='releasing'").run(attempt.id);
  }).immediate();
}

/** Adapter for existing HTTP lease clients; never submits, stages or rewrites a graph. */
export async function acquireLegacyGpu(input:AcquireResourceLockInput):Promise<Result> {
  const lockId=canonicalResourceLockId(input.lockId),gpu=gpuOf(lockId);
  if(!gpu||!input.ownerId.trim()||!input.workerId.trim())return {ok:false,error:"A GPU, ownerId and workerId are required."};
  if(!sharedMediaAdmissionConfigured()) {
    // Isolated TEST compatibility only. Production must never silently fall back.
    if(process.env.OTG_ENV!=="test")throw Error("Shared production GPU authority is not configured.");
    if(!(await probeMediaGpu(gpu)).ready)return busy();
    return acquireResourceLock(input);
  }
  let attempt=db().transaction(()=>{
    const existing=db().prepare("SELECT * FROM legacy_gpu_admissions WHERE lockId=? AND ownerId=? AND phase!='released'")
      .get(lockId,input.ownerId) as Attempt|undefined;
    if(existing)return existing;
    // Preserve already-running pre-upgrade clients. Do not invent central ownership.
    const old=listResourceLocks().find(l=>l.lockId===lockId);
    if(old)return null;
    const id=randomUUID();
    db().prepare("INSERT INTO legacy_gpu_admissions(id,lockId,ownerId,workerId,gpu,phase) VALUES(?,?,?,?,?,'waiting')")
      .run(id,lockId,input.ownerId,input.workerId,gpu);
    return get(id);
  }).immediate();
  if(!attempt) {
    const old=listResourceLocks().find(l=>l.lockId===lockId&&l.ownerId===input.ownerId&&l.workerId===input.workerId&&!l.persistent);
    if(!old)return busy();
    const renewed=heartbeatResourceLock(lockId,old.ownerId,old.fencingToken,input.ttlSeconds);
    return renewed?{ok:true,lock:renewed}:busy();
  }
  if(attempt.workerId!==input.workerId)return busy();
  if(attempt.phase==="waiting") {
    const ticket=await registerSharedMediaTicket([gpu],attempt.id);
    if(ticket.ticket===null||ticket.state!=="waiting")return busy(attempt);
    db().prepare("UPDATE legacy_gpu_admissions SET ticket=? WHERE id=? AND phase='waiting' AND (ticket IS NULL OR ticket<=?)").run(ticket.ticket,attempt.id,ticket.ticket);
    if(!(await probeMediaGpu(gpu,undefined,{admissionOwner:attempt.id})).ready)return busy(attempt);
    db().transaction(()=>{
      const current=get(attempt!.id);if(current.phase!=="waiting"||current.ticket!==ticket.ticket)return;
      const acquired=acquireResourceLock({...input,lockId,persistent:true});
      if(!acquired.ok)return;
      // A concurrent pre-upgrade lock cannot be adopted as an unstarted attempt.
      if(!acquired.lock.persistent)return;
      db().prepare("UPDATE legacy_gpu_admissions SET phase='admitting',lease=? WHERE id=? AND phase='waiting'")
        .run(JSON.stringify(acquired.lock),current.id);
    }).immediate();
    attempt=get(attempt.id);
  }
  if(attempt.phase==="admitting") {
    const grant=await acquireSharedMediaGpu(gpu,attempt.id,attempt.ticket);
    db().transaction(()=>{
      const current=get(attempt!.id);
      if(current.phase!=="admitting"||current.lease!==attempt!.lease||current.ticket!==attempt!.ticket)return;
      if(grant.granted&&grant.token!==null)db().prepare("UPDATE legacy_gpu_admissions SET phase='checking',token=? WHERE id=?").run(grant.token,current.id);
      else {
        const lease=leaseOf(current);releaseResourceLock(lockId,lease.ownerId,lease.fencingToken);
        db().prepare("UPDATE legacy_gpu_admissions SET phase='waiting',lease=NULL WHERE id=?").run(current.id);
      }
    }).immediate();
    attempt=get(attempt.id);
  }
  if(attempt.phase==="checking") {
    const ready=await probeMediaGpu(gpu,undefined,{admissionOwner:attempt.id,lease:leaseOf(attempt)});
    db().prepare("UPDATE legacy_gpu_admissions SET phase=? WHERE id=? AND phase='checking'")
      .run(ready.ready?"active":"releasing",attempt.id);
    attempt=get(attempt.id);
  }
  if(attempt.phase==="releasing") {await releaseAttempt(attempt);return busy();}
  if(attempt.phase!=="active")return busy(attempt);
  // Idempotent retry must not probe/evict a client which already started rendering.
  await assertSharedMediaGpuOwned(gpu,attempt.id);
  const current=get(attempt.id),lease=presentLease(current);
  return current.phase==="active"&&lease?{ok:true,lock:lease}:busy();
}

export async function heartbeatLegacyGpu(lockId:WorkerResourceLockId,ownerId:string,fence:string,ttl:number) {
  const attempt=matching(lockId,ownerId,fence);
  if(!attempt)return heartbeatResourceLock(lockId,ownerId,fence,ttl); // Existing lease clients, including service locks.
  if(attempt.phase!=="active"||!attempt.lease||leaseOf(attempt).fencingToken!==fence)return null;
  await assertSharedMediaGpuOwned(attempt.gpu,attempt.id);
  if(get(attempt.id).phase!=="active")return null;
  return heartbeatResourceLock(lockId,ownerId,fence,ttl);
}

export async function releaseLegacyGpu(lockId:WorkerResourceLockId,ownerId:string,fence:string) {
  let attempt=matching(lockId,ownerId,fence);
  if(!attempt)return releaseResourceLock(lockId,ownerId,fence);
  if(fence===`wait_${attempt.id}`) {
    // Waiting cancellation is not permission to interrupt or free a granted GPU.
    db().prepare("UPDATE legacy_gpu_admissions SET phase='canceled' WHERE id=? AND phase='waiting'").run(attempt.id);
    attempt=get(attempt.id);
    if(attempt.phase==="released")return true;
    if(attempt.phase!=="canceled")return false;
    // Recover a lost enqueue response; terminal tickets cannot be revived.
    const ticket=await registerSharedMediaTicket([attempt.gpu],attempt.id);
    if(ticket.ticket===null)return false;
    await cancelSharedMediaTicket(attempt.gpu,attempt.id,ticket.ticket);
    db().prepare("UPDATE legacy_gpu_admissions SET phase='released' WHERE id=? AND phase='canceled'").run(attempt.id);
    return true;
  }
  if(attempt.phase==="released")return true; // Lost release reply, exact old fence only.
  // Old workers can call release from finally after a failed/uncertain submit.
  // Do not free known busy or unreachable hardware on that signal alone.
  if(attempt.phase==="active"&&!(await probeMediaGpu(attempt.gpu,undefined,{admissionOwner:attempt.id,lease:leaseOf(attempt)})).ready)return false;
  db().prepare("UPDATE legacy_gpu_admissions SET phase='releasing' WHERE id=? AND phase='active'").run(attempt.id);
  attempt=get(attempt.id);
  if(attempt.phase!=="releasing")return false;
  await releaseAttempt(attempt);return true;
}
