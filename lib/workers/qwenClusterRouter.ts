import crypto from "node:crypto";
import {mediaQueueEnabled,acquireExternalMediaGpuChoice} from "@/lib/workers/mediaGpuQueue";
import type {MediaGpu} from "@/lib/mediaGpuRouting";
import {LOCAL_CONTEXT,LOCAL_MODEL,LOCAL_OLLAMA,LOCAL_COMFY,local3060Enabled,localJson,localPromptBudget,verify3060Ollama,unload3060Ollama,local3060Headers,local3060Headroom,waitFor3060Headroom} from "./local3060";

import {
  acquireClusterGpuLease,
  detectShawnExternalOccupancy,
  releaseClusterGpuLease,
  SHAWN_COMFY_URL,
  SHAWN_GPU_LOCK_ID,
  SHAWN_QWEN_URL,
  SLR_COMFY_URL,
  SLR_GPU_LOCK_ID,
  SLR_QWEN_URL,
  type ClusterGpuLease,
  type ShawnOccupancy,
} from "@/lib/workers/clusterGpu";

export const QWEN_CLUSTER_MODEL = "qwen3.6:27b";
export const SLR_QWEN_CONTEXT_CAP = 32_768;
export const SHAWN_QWEN_CONTEXT_CAP = 262_144;

export type QwenClusterNode = "slr" | "shawn" | "local3060";
export type QwenRoute = { node: QwenClusterNode; baseUrl: string; contextCap: number; lease: ClusterGpuLease; releaseMedia?:()=>void; markUncertain?:()=>void };

export class QwenClusterBusyError extends Error {
  readonly code = "qwen_cluster_busy";
  readonly status = 503;

  constructor(
    message =
      "No compatible Qwen GPU is currently available.",
  ) {
    super(message);
    this.name = "QwenClusterBusyError";
  }
}

export class QwenContextUnsupportedError extends Error {
  readonly code = "qwen_context_unsupported";
  readonly status = 400;

  constructor(
    requiredContextTokens: number,
    maximumContextTokens =
      SHAWN_QWEN_CONTEXT_CAP,
  ) {
    super(
      `Requested context ${requiredContextTokens} exceeds the Qwen cluster maximum of ${maximumContextTokens}.`,
    );

    this.name =
      "QwenContextUnsupportedError";
  }
}

export type RouterDependencies = {
  shawnOccupancy?: () => Promise<ShawnOccupancy>;
  sleep?: (milliseconds: number) => Promise<void>;
  allowedNodes?: readonly QwenClusterNode[];
  leaseTtlSeconds?: number;
};

function ownerId() {
  return `qwen36:${process.pid}:${Date.now()}:${crypto.randomUUID()}`;
}

function trySlr(owner: string, deps: RouterDependencies): QwenRoute | null {
  const result = acquireClusterGpuLease({
    lockId: SLR_GPU_LOCK_ID,
    ownerId: owner,
    workerId: "qwen36-router",
    purpose: "qwen36",
    ttlSeconds: deps.leaseTtlSeconds,
  });
  return result.ok ? { node: "slr", baseUrl: SLR_QWEN_URL, contextCap: SLR_QWEN_CONTEXT_CAP, lease: result.lease } : null;
}

async function tryShawn(owner: string, deps: RouterDependencies): Promise<QwenRoute | null> {
  const occupancy = await (deps.shawnOccupancy || detectShawnExternalOccupancy)();

  // A resident model on the dedicated OTG Qwen endpoint is external occupancy
  // for Comfy/video work, but it is reusable state for another Qwen request.
  // qwenCodeIsRunning() is checked separately by detectShawnExternalOccupancy(),
  // so allowing this specific recoverable state does not bypass Qwen Code or
  // active ComfyUI workload protection.
  const qwenResidentIsReusable =
    occupancy.reason === "qwen-resident-stale" && occupancy.recoverable;

  if (!occupancy.available && !qwenResidentIsReusable) return null;

  // A stale resident marker is not proof that the Qwen HTTP endpoint is
  // accepting work. Probe it before leasing the 3090 lane so an unreachable
  // endpoint falls through to the configured SLR/5060 fallback.
  try {
    const probe = await fetch(`${SHAWN_QWEN_URL}/api/tags`, {
      cache: "no-store",
      signal: AbortSignal.timeout(2_000),
    });
    if (!probe.ok) return null;
  } catch {
    return null;
  }

  const result = acquireClusterGpuLease({
    lockId: SHAWN_GPU_LOCK_ID,
    ownerId: owner,
    workerId: "qwen36-router",
    purpose: "qwen36",
    ttlSeconds: deps.leaseTtlSeconds,
  });
  return result.ok ? { node: "shawn", baseUrl: SHAWN_QWEN_URL, contextCap: SHAWN_QWEN_CONTEXT_CAP, lease: result.lease } : null;
}

export async function acquireQwenClusterRoute(requiredContextTokens: number, waitMs = 30_000, deps: RouterDependencies = {}): Promise<QwenRoute> {
  if(local3060Enabled())throw Error("Local assistance requires the RTX 3060 durable dispatcher.");
  const required = Math.max(1, Math.floor(Number(requiredContextTokens) || SLR_QWEN_CONTEXT_CAP));
  if (
    required >
    SHAWN_QWEN_CONTEXT_CAP
  ) {
    throw new QwenContextUnsupportedError(
      required,
      SHAWN_QWEN_CONTEXT_CAP,
    );
  }
  const owner = ownerId();
  const deadline = Date.now() + Math.max(0, waitMs);
  const sleep = deps.sleep || ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const allowedNodes = Array.from(
    new Set<QwenClusterNode>(
      deps.allowedNodes
      || ["shawn", "slr"],
    ),
  );

  do {
    for (const node of allowedNodes) {
      if (node === "slr") {
        if (
          required
          > SLR_QWEN_CONTEXT_CAP
        ) {
          continue;
        }

        const slr =
          trySlr(
            owner,
            deps,
          );

        if (slr) {
          return slr;
        }

        continue;
      }

      if (node === "shawn") {
        const shawn =
          await tryShawn(
            owner,
            deps,
          );

        if (shawn) {
          return shawn;
        }
      }
    }

    if (
      Date.now()
      >= deadline
    ) {
      break;
    }

    await sleep(
      Math.min(
        500,
        Math.max(
          1,
          deadline - Date.now(),
        ),
      ),
    );
  } while (
    Date.now()
    <= deadline
  );
  throw new QwenClusterBusyError(required > SLR_QWEN_CONTEXT_CAP
    ? "The RTX 3090 required for this context is occupied; the request was not routed to the 32768-context RTX 5060 Ti."
    : undefined);
}

function estimatedContext(payload: Record<string, unknown>): number {
  const options = payload.options && typeof payload.options === "object" ? payload.options as Record<string, unknown> : {};
  const explicit = Number(options.num_ctx || payload.required_context || 0);
  if (Number.isFinite(explicit) && explicit > 0) return Math.floor(explicit);
  return Math.max(1, Math.ceil(JSON.stringify(payload.messages || payload.prompt || "").length / 3));
}

const DEFINITE_CONNECT_FAILURE_CODES = new Set([
  "ECONNREFUSED",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "ENOTFOUND",
  "EAI_AGAIN",
  "UND_ERR_CONNECT_TIMEOUT",
]);

function transportFailureCode(error: unknown): string {
  if (!error || typeof error !== "object") return "";

  const directCode = (error as { code?: unknown }).code;
  const cause = (error as { cause?: unknown }).cause;
  const causeCode =
    cause && typeof cause === "object"
      ? (cause as { code?: unknown }).code
      : undefined;

  if (typeof causeCode === "string") return causeCode;
  return typeof directCode === "string" ? directCode : "";
}

function leaseCanReleaseImmediatelyAfterTransportFailure(
  error: unknown,
): boolean {
  return DEFINITE_CONNECT_FAILURE_CODES.has(transportFailureCode(error));
}

function qwenComfyBaseUrlForNode(node: QwenClusterNode) {
  return node === "slr" ? SLR_COMFY_URL : SHAWN_COMFY_URL;
}

async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = 5_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      cache: "no-store",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

function qwenComfyQueueIsActive(payload: unknown) {
  if (!payload || typeof payload !== "object") return false;
  const queue = payload as { queue_running?: unknown; queue_pending?: unknown };
  return (Array.isArray(queue.queue_running) && queue.queue_running.length > 0)
    || (Array.isArray(queue.queue_pending) && queue.queue_pending.length > 0);
}

async function ensureComfyLaneFreeForQwen(node: QwenClusterNode) {
  const baseUrl = qwenComfyBaseUrlForNode(node);
  const queueResponse = await fetchWithTimeout(`${baseUrl}/queue`, {}, 3_000);
  if (!queueResponse.ok) {
    throw new QwenClusterBusyError(`${node} ComfyUI queue check failed before Enhance Prompt GPU release.`);
  }

  if (qwenComfyQueueIsActive(await queueResponse.json().catch(() => null))) {
    throw new QwenClusterBusyError(`${node} ComfyUI is currently running or queued; Enhance Prompt will wait.`);
  }

  const freeResponse = await fetchWithTimeout(
    `${baseUrl}/free`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ unload_models: true, free_memory: true }),
    },
    10_000,
  );

  if (!freeResponse.ok && freeResponse.status !== 404) {
    throw new QwenClusterBusyError(`${node} ComfyUI /free failed before Enhance Prompt.`);
  }

  /*
   * Some configured ComfyUI builds do not expose /free.  An empty queue is
   * still a valid hand-off boundary for Qwen: the Ollama keep_alive=0 unload
   * below remains the authoritative model-release step.  Treat only a
   * missing endpoint as a compatibility case; preserve failures from an
   * endpoint that exists but rejected the release request.
   */
}

async function unloadQwenModel(baseUrl: string, model: string) {
  const safeModel = String(model || "").trim();
  if (!safeModel) return;

  const response = await fetchWithTimeout(
    `${baseUrl}/api/generate`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: safeModel,
        prompt: "",
        stream: false,
        keep_alive: 0,
      }),
    },
    15_000,
  );

  if (!response.ok) {
    throw new Error(`Qwen model unload failed at ${baseUrl} for ${safeModel} (${response.status}).`);
  }
}

export async function qwenClusterFetch(path: "/api/generate" | "/api/chat", payload: Record<string, unknown>, options: {
  requiredContextTokens?: number;
  waitMs?: number;
  timeoutMs?: number;
  allowedNodes?: readonly QwenClusterNode[];
  routerDependencies?: RouterDependencies;
  model?: string;
  modelByNode?: Partial<Record<QwenClusterNode, string>>;
  keepAlive?: string | number;
  leaseTtlSeconds?: number;
    onRouteAcquired?: (
      route: {
        node: QwenClusterNode;
        baseUrl: string;
        contextCap: number;
      },
    ) => Promise<void> | void;
} = {}): Promise<Response> {
  if(local3060Enabled()||options.allowedNodes?.includes("local3060")){
    if(!local3060Enabled())throw Error("This saved request requires the TEST RTX 3060; no other GPU will be used.");
    return execute3060(path,payload,{timeoutMs:options.timeoutMs,onAcquired:()=>options.onRouteAcquired?.({node:"local3060",baseUrl:LOCAL_OLLAMA,contextCap:LOCAL_CONTEXT})});
  }
  const startedAt = Date.now();
  const totalTimeoutMs = Math.max(1, options.timeoutMs ?? 180_000);
  const requiredContext = options.requiredContextTokens || estimatedContext(payload);
  const queued = mediaQueueEnabled();
  // A per-node fallback alias is not evidence of the same requested model.
  const exactQueuedModel = String(options.model || payload.model || options.modelByNode?.shawn
    || options.modelByNode?.slr || QWEN_CLUSTER_MODEL).trim();

  // Do not let an ambiguous Qwen transport failure poison a GPU lane for the
  // generic 15-minute resource-lock TTL. Keep the safety window slightly
  // longer than the maximum request lifetime instead.
  const inferredLeaseTtlSeconds =
    Math.max(30, Math.ceil(totalTimeoutMs / 1000) + 30);
  const leaseTtlSeconds =
    options.leaseTtlSeconds
    ?? options.routerDependencies?.leaseTtlSeconds
    ?? inferredLeaseTtlSeconds;

  const legacyRoute=()=>acquireQwenClusterRoute(requiredContext, Math.min(options.waitMs ?? 30_000, totalTimeoutMs), {
    ...options.routerDependencies,
    allowedNodes: options.allowedNodes || options.routerDependencies?.allowedNodes,
    leaseTtlSeconds,
  });
  const queuedRoute=async():Promise<QwenRoute>=>{
    const allowed=options.allowedNodes||options.routerDependencies?.allowedNodes||["shawn","slr"];
    const compatible:MediaGpu[]=[];
    for(const node of ["shawn","slr"] as const){
      const cap=node==="shawn"?SHAWN_QWEN_CONTEXT_CAP:SLR_QWEN_CONTEXT_CAP;
      if(!allowed.includes(node)||requiredContext>cap)continue;
      const model=String(options.modelByNode?.[node]||exactQueuedModel).trim();
      if(model!==exactQueuedModel)continue;
      try{
        const response=await fetchWithTimeout(`${node==="shawn"?SHAWN_QWEN_URL:SLR_QWEN_URL}/api/tags`,{},3000);
        const data=await response.json();
        if(response.ok&&Array.isArray(data.models)&&data.models.some((m:{name?:string;model?:string})=>m.name===model||m.model===model))compatible.push(node==="shawn"?"rtx3090":"rtx5060ti");
      }catch{/* Unreachable or absent exact model is not a fallback candidate. */}
    }
    if(!compatible.length)throw new QwenClusterBusyError("The requested Qwen model and context are not available on a qualified GPU.");
    const admission=await acquireExternalMediaGpuChoice(compatible,"qwen-assistance",Math.max(1,Math.min(options.waitMs??30000,totalTimeoutMs-(Date.now()-startedAt))));
    const node=admission.gpu==="rtx3090"?"shawn":"slr";
    return {node,baseUrl:node==="shawn"?SHAWN_QWEN_URL:SLR_QWEN_URL,contextCap:node==="shawn"?SHAWN_QWEN_CONTEXT_CAP:SLR_QWEN_CONTEXT_CAP,lease:{...admission.lease,purpose:"qwen36"},releaseMedia:admission.release,markUncertain:admission.uncertain};
  };
  const route=await (queued?queuedRoute():legacyRoute());
  const releaseRoute=()=>route.releaseMedia?route.releaseMedia():releaseClusterGpuLease(route.lease);
  const controller = new AbortController();
  const remainingTimeoutMs = totalTimeoutMs - (Date.now() - startedAt);
  if (remainingTimeoutMs <= 0) {
    releaseRoute();
    throw new DOMException("Qwen cluster request timed out before model execution could begin.", "AbortError");
  }

  const timer = setTimeout(() => controller.abort(), remainingTimeoutMs);
  let responseCompleted = false;
  let releaseLeaseAfterFailure = false;
  let requestMayHaveStarted = false;

  try {
    const routedModel = queued ? exactQueuedModel : String(options.modelByNode?.[route.node] || options.model || QWEN_CLUSTER_MODEL).trim() || QWEN_CLUSTER_MODEL;
    if (queued) {
      // Qualification before waiting can become stale. Recheck only the chosen
      // worker, before unloading anything or starting an inference request.
      const response = await fetchWithTimeout(`${route.baseUrl}/api/tags`, {}, Math.min(3000, remainingTimeoutMs));
      const data = await response.json();
      if (!response.ok || !Array.isArray(data.models)
        || !data.models.some((model: {name?: string; model?: string}) => model.name === routedModel || model.model === routedModel))
        throw new QwenClusterBusyError("The exact requested model is no longer available on the admitted GPU; no substitute was executed.");
    }
    const routedKeepAlive = options.keepAlive ?? 0;
    const keepAliveDisablesResidency =
      routedKeepAlive === 0 ||
      routedKeepAlive === "0" ||
      routedKeepAlive === "0s";
    const unloadModelAfterRequest =
      payload._otgForceModelUnload === true ||
      keepAliveDisablesResidency;
    if (unloadModelAfterRequest) {
      await ensureComfyLaneFreeForQwen(route.node);
      await unloadQwenModel(route.baseUrl, routedModel);
    }
    const routedOptions: Record<string, unknown> = { ...(payload.options as Record<string, unknown> || {}), num_ctx: Math.min(requiredContext, route.contextCap) };
    delete routedOptions.num_gpu;
    const routedPayload = {
      ...payload,
      model: routedModel,
      stream: false,
      keep_alive: routedKeepAlive,
      options: routedOptions,
    };
    delete (routedPayload as Record<string, unknown>)._otgForceModelUnload;
    // Admission (including Comfy-busy refusal) must finish before crossing
    // the durable running boundary. A pre-execution refusal can then requeue.
    await options.onRouteAcquired?.({node:route.node,baseUrl:route.baseUrl,contextCap:route.contextCap});
    requestMayHaveStarted = true;
    const response = await fetch(`${route.baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(routedPayload),
      cache: "no-store",
      signal: controller.signal,
    });
    const bytes = await response.arrayBuffer();
    if (unloadModelAfterRequest) {
      await unloadQwenModel(route.baseUrl, routedModel);
    }
    responseCompleted = true;
    const headers = new Headers(response.headers);
    headers.set("x-otg-qwen-model", routedModel);
    headers.set("x-otg-qwen-node", route.node);
    return new Response(bytes, { status: response.status, statusText: response.statusText, headers });
  } catch (error) {
    // Connection-establishment failures prove the request did not reach the
    // Ollama inference server, so retaining the GPU lease provides no safety.
    // Abort/socket failures remain ambiguous and retain the bounded lease.
    releaseLeaseAfterFailure =
      !requestMayHaveStarted || leaseCanReleaseImmediatelyAfterTransportFailure(error);
    throw error;
  } finally {
    clearTimeout(timer);

    if (responseCompleted || releaseLeaseAfterFailure) {
      releaseRoute();
    } else route.markUncertain?.();
  }
}

/** Local and cloud callers never share a fallback list. Lease ends only after
 * the complete HTTP response and model cleanup have been confirmed. */
export async function execute3060(path:"/api/generate"|"/api/chat",payload:Record<string,unknown>,options:{
  timeoutMs?:number;signal?:AbortSignal;onAcquired?:()=>void|Promise<void>;
  onChunk?:(chunk:Record<string,unknown>)=>void;
  admissionWaitMs?:number;
  onPhase?:(phase:"queued"|"generating")=>void;
}={}):Promise<Response>{
  options.signal?.throwIfAborted();
  if(!local3060Enabled())throw Error("The RTX 3060 local provider is not configured.");
  const budget=localPromptBudget(payload);
  if(budget.estimatedTokens>LOCAL_CONTEXT||budget.imageCount>2)throw new QwenContextUnsupportedError(budget.estimatedTokens,LOCAL_CONTEXT);
  await verify3060Ollama();
  let reservation:Awaited<ReturnType<typeof acquireExternalMediaGpuChoice>>;
  options.onPhase?.("queued");
  try{reservation=await acquireExternalMediaGpuChoice(["rtx3060"],"qwen-assistance",options.admissionWaitMs??45_000,options.signal);}
  catch(error){if(options.signal?.aborted)throw error;throw new QwenClusterBusyError("Waiting for the dedicated RTX 3060; rendering GPUs are not eligible.");}
  let started=false,confirmed=false;
  let phase="worker preflight";
  try{
    options.signal?.throwIfAborted();
    const server=await verify3060Ollama();
    await unload3060Ollama(reservation.fence);
    const cleanup=await fetch(LOCAL_COMFY+"/free",{method:"POST",redirect:"error",signal:AbortSignal.timeout(5000),headers:{"content-type":"application/json",...local3060Headers(reservation.fence)},body:JSON.stringify({unload_models:true,free_memory:true})});
    if(!cleanup.ok)throw Error("RTX 3060 ComfyUI cleanup was not confirmed.");
    phase="preflight GPU headroom";
    await waitFor3060Headroom(4608);
    const requested=payload.options as Record<string,unknown>|undefined;
    const numPredict=Math.max(1,Math.min(1400,Number(requested?.num_predict)||1400));
    const timeout=AbortSignal.timeout(Math.max(1000,options.timeoutMs||180_000));
    // A user can cancel persistence immediately. Drain an already-started
    // response under the physical lease so cancellation cannot race a render.
    const signal=timeout;
    await options.onAcquired?.();
    options.signal?.throwIfAborted();
    reservation.bindBackend(server.pid);
    signal.throwIfAborted();
    options.onPhase?.("generating");
    phase="Ollama response";
    started=true;
    const r=await fetch(LOCAL_OLLAMA+path,{method:"POST",headers:{"content-type":"application/json",...local3060Headers(reservation.fence)},redirect:"error",signal,body:JSON.stringify({
      model:LOCAL_MODEL,...Object.fromEntries(["prompt","messages","system","images","format","tools"].filter(k=>payload[k]!==undefined).map(k=>[k,payload[k]])),
      options:{num_ctx:LOCAL_CONTEXT,num_predict:numPredict,temperature:0.35},think:false,keep_alive:"45s",stream:!!options.onChunk,
    })});
     let result:Record<string,unknown>;
     let consumerFailed=false,consumerError:unknown;
    if(options.onChunk&&r.ok){
      const reader=r.body?.pipeThrough(new TextDecoderStream()).getReader();
      if(!reader)throw Error("Local AI returned no stream.");
      let buffer="",ended=false,last:Record<string,unknown>={};
      try {
        while(true){
          const read=await reader.read();if(read.done)break;
          buffer+=read.value;if(buffer.length>2_000_000)throw Error("Local AI stream line exceeded its limit.");
          let nl:number;while((nl=buffer.indexOf("\n"))>=0){
            const line=buffer.slice(0,nl).trim();buffer=buffer.slice(nl+1);if(!line)continue;
            last=JSON.parse(line);if(last.error)throw Error("The local model reported an execution error.");
            if(last.done===true)ended=true;
            if(!consumerFailed&&!options.signal?.aborted){
              try{options.onChunk(last);}
              catch(error){consumerFailed=true;consumerError=error;}
            }
          }
        }
        if(buffer.trim()||!ended)throw Error("Local AI stream ended without a completion receipt.");
      }finally{reader.releaseLock();}
      result=last;
    }else result=await r.json();
    // Completed HTTP failures are not replayed. A completed success must
    // attest full GPU residency before it can replace a user's prompt.
    phase="GPU residency attestation";
    try{
      if(r.ok){
        const attest=async()=>{
          const state=await localJson(LOCAL_OLLAMA+"/api/ps");
          const model=state.models?.find((v:{name:string})=>v.name===LOCAL_MODEL);
          if(!model||model.size<=0||model.size!==model.size_vram||model.context_length!==LOCAL_CONTEXT)
            throw Error("The local response did not verify full RTX 3060 model residency.");
          await local3060Headroom(0,true);
        };
        // Retry only a timed-out read-only check under the same reservation.
        try { await attest(); }
        catch(error) {
          if (!(error instanceof Error) || error.name!=="TimeoutError") throw error;
          console.warn("[rtx3060] residency probe timed out; checking once more",reservation.fence?.jobId);
          await attest();
        }
      }
    }finally{
      try{
        await unload3060Ollama(reservation.fence);
        await waitFor3060Headroom(0);
        confirmed=true;
      }catch(error){phase="model cleanup";throw error;}
    }
    options.signal?.throwIfAborted();
     if(consumerFailed)throw consumerError;
    if(r.ok&&result.done_reason==="length")throw Error("The local output limit was reached. No partial result was applied.");
    return Response.json(result,{status:r.status,headers:{"x-otg-qwen-model":LOCAL_MODEL,"x-otg-qwen-node":"local3060"}});
  }catch(error){
    if(!options.signal?.aborted)console.warn("[rtx3060] request ended",reservation.fence?.jobId,phase,
      error instanceof Error ? error.name : "UnknownError");
    if(error instanceof Error&&error.name==="TimeoutError")throw new Error(`RTX 3060 ${phase} timed out.`,{cause:error});
    throw error;
  }finally{
    if(!started||confirmed)reservation.release();
    else reservation.uncertain();
  }
}
