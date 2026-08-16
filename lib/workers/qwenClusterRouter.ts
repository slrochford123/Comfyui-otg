import crypto from "node:crypto";

import {
  acquireClusterGpuLease,
  detectShawnExternalOccupancy,
  releaseClusterGpuLease,
  SHAWN_GPU_LOCK_ID,
  SHAWN_QWEN_URL,
  SLR_GPU_LOCK_ID,
  SLR_QWEN_URL,
  type ClusterGpuLease,
  type ShawnOccupancy,
} from "@/lib/workers/clusterGpu";

export const QWEN_CLUSTER_MODEL = "qwen3.6:27b";
export const SLR_QWEN_CONTEXT_CAP = 32_768;
export const SHAWN_QWEN_CONTEXT_CAP = 262_144;

export type QwenClusterNode = "slr" | "shawn";
export type QwenRoute = { node: QwenClusterNode; baseUrl: string; contextCap: number; lease: ClusterGpuLease };

export class QwenClusterBusyError extends Error {
  readonly code = "qwen_cluster_busy";
  readonly status = 503;
  constructor(message = "No compatible Qwen GPU is currently available; the request remained queued until its wait timeout.") {
    super(message);
    this.name = "QwenClusterBusyError";
  }
}

export type RouterDependencies = {
  shawnOccupancy?: () => Promise<ShawnOccupancy>;
  sleep?: (milliseconds: number) => Promise<void>;
  allowedNodes?: readonly QwenClusterNode[];
};

function ownerId() {
  return `qwen36:${process.pid}:${Date.now()}:${crypto.randomUUID()}`;
}

function trySlr(owner: string): QwenRoute | null {
  const result = acquireClusterGpuLease({ lockId: SLR_GPU_LOCK_ID, ownerId: owner, workerId: "qwen36-router", purpose: "qwen36" });
  return result.ok ? { node: "slr", baseUrl: SLR_QWEN_URL, contextCap: SLR_QWEN_CONTEXT_CAP, lease: result.lease } : null;
}

async function tryShawn(owner: string, deps: RouterDependencies): Promise<QwenRoute | null> {
  const occupancy = await (deps.shawnOccupancy || detectShawnExternalOccupancy)();
  if (!occupancy.available) return null;
  const result = acquireClusterGpuLease({ lockId: SHAWN_GPU_LOCK_ID, ownerId: owner, workerId: "qwen36-router", purpose: "qwen36" });
  return result.ok ? { node: "shawn", baseUrl: SHAWN_QWEN_URL, contextCap: SHAWN_QWEN_CONTEXT_CAP, lease: result.lease } : null;
}

export async function acquireQwenClusterRoute(requiredContextTokens: number, waitMs = 30_000, deps: RouterDependencies = {}): Promise<QwenRoute> {
  const required = Math.max(1, Math.floor(Number(requiredContextTokens) || SLR_QWEN_CONTEXT_CAP));
  if (required > SHAWN_QWEN_CONTEXT_CAP) throw new QwenClusterBusyError(`Requested context ${required} exceeds the Qwen cluster maximum of ${SHAWN_QWEN_CONTEXT_CAP}.`);
  const owner = ownerId();
  const deadline = Date.now() + Math.max(0, waitMs);
  const sleep = deps.sleep || ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const allowedNodes = new Set<QwenClusterNode>(deps.allowedNodes || ["slr", "shawn"]);
  do {
    if (allowedNodes.has("slr") && required <= SLR_QWEN_CONTEXT_CAP) {
      const slr = trySlr(owner);
      if (slr) return slr;
    }
    if (allowedNodes.has("shawn")) {
      const shawn = await tryShawn(owner, deps);
      if (shawn) return shawn;
    }
    if (Date.now() >= deadline) break;
    await sleep(Math.min(500, Math.max(1, deadline - Date.now())));
  } while (Date.now() <= deadline);
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

export async function qwenClusterFetch(path: "/api/generate" | "/api/chat", payload: Record<string, unknown>, options: {
  requiredContextTokens?: number;
  waitMs?: number;
  timeoutMs?: number;
  allowedNodes?: readonly QwenClusterNode[];
  routerDependencies?: RouterDependencies;
} = {}): Promise<Response> {
  const startedAt = Date.now();
  const totalTimeoutMs = Math.max(1, options.timeoutMs ?? 180_000);
  const requiredContext = options.requiredContextTokens || estimatedContext(payload);
  const route = await acquireQwenClusterRoute(requiredContext, Math.min(options.waitMs ?? 30_000, totalTimeoutMs), {
    ...options.routerDependencies,
    allowedNodes: options.allowedNodes || options.routerDependencies?.allowedNodes,
  });
  const controller = new AbortController();
  const remainingTimeoutMs = totalTimeoutMs - (Date.now() - startedAt);
  if (remainingTimeoutMs <= 0) {
    releaseClusterGpuLease(route.lease);
    throw new DOMException("Qwen cluster request timed out while waiting for a GPU lease.", "AbortError");
  }
  const timer = setTimeout(() => controller.abort(), remainingTimeoutMs);
  let responseCompleted = false;
  try {
    const routedOptions: Record<string, unknown> = { ...(payload.options as Record<string, unknown> || {}), num_ctx: Math.min(requiredContext, route.contextCap) };
    delete routedOptions.num_gpu;
    const routedPayload = {
      ...payload,
      model: QWEN_CLUSTER_MODEL,
      stream: false,
      keep_alive: 0,
      options: routedOptions,
    };
    const response = await fetch(`${route.baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(routedPayload),
      cache: "no-store",
      signal: controller.signal,
    });
    const bytes = await response.arrayBuffer();
    responseCompleted = true;
    return new Response(bytes, { status: response.status, statusText: response.statusText, headers: response.headers });
  } finally {
    clearTimeout(timer);
    // A transport failure after POST is ambiguous. Retain the bounded lease to
    // expiry so another GPU workload cannot overlap a still-running inference.
    if (responseCompleted) releaseClusterGpuLease(route.lease);
  }
}
