import { execFile } from "node:child_process";
import os from "node:os";
import { promisify } from "node:util";

import {
  acquireResourceLock,
  listResourceLocks,
  releaseResourceLock,
  type ResourceLock,
} from "@/lib/workers/resourceLocks";

const execFileAsync = promisify(execFile);

export const SLR_GPU_LOCK_ID = "gpu:slr-5060" as const;
export const SHAWN_GPU_LOCK_ID = "gpu:shawn-3090" as const;
export const SLR_QWEN_URL = "http://100.98.212.116:11435";
export const SHAWN_QWEN_URL = "http://100.75.162.64:11435";
export const SLR_COMFY_URL = "http://100.98.212.116:8188";
export const SHAWN_COMFY_URL = "http://100.75.162.64:8188";

export type ClusterGpuId = "slr-5060" | "shawn-3090";

export type ClusterGpuPurpose = "image" | "video" | "ltx-fallback" | "qwen36" | "external-qwen-code";
export type ClusterGpuLease = ResourceLock & { purpose: ClusterGpuPurpose };

export type ShawnOccupancy = {
  available: boolean;
  external: boolean;
  recoverable: boolean;
  reason: "available" | "worker-lock" | "qwen-code" | "qwen-resident-stale" | "comfy-active" | "probe-error";
};

type OccupancyDependencies = {
  fetcher?: typeof fetch;
  processList?: () => Promise<string>;
  locks?: ResourceLock[];
};

async function defaultProcessList(): Promise<string> {
  const result = await execFileAsync("ps", ["-eo", "comm=,args="], { timeout: 2_000, maxBuffer: 1024 * 1024 });
  return result.stdout;
}

function qwenCodeIsRunning(processes: string): boolean {
  return /(?:^|[\/\s])qwen(?:\s|$).*--model|@qwen-code\/qwen-code|qwen-code\/cli\.js|Qwen Code/i.test(processes);
}

function configuredHosts(name: string): string[] {
  return String(process.env[name] || "").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
}

/** Resolve a Comfy generation URL to the physical cluster GPU it consumes. */
export function resolveComfyPhysicalGpu(rawUrl: string, hostname = os.hostname()): ClusterGpuId | null {
  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    const port = parsed.port || (parsed.protocol === "https:" ? "443" : "80");
    const generationPorts = new Set([
      "8188",
      "8191",
      "8288",
      ...String(process.env.OTG_CLUSTER_COMFY_GENERATION_PORTS || "").split(",").map((value) => value.trim()).filter(Boolean),
    ]);
    if (!generationPorts.has(port)) return null;

    const slrHosts = new Set(["100.98.212.116", "192.168.1.113", "slr", "otg-slr", ...configuredHosts("OTG_5060_COMFY_HOSTS")]);
    const shawnHosts = new Set(["100.75.162.64", "192.168.1.166", "shawn", "otg-shawn", ...configuredHosts("OTG_3090_COMFY_HOSTS")]);
    if (slrHosts.has(host)) return "slr-5060";
    if (shawnHosts.has(host)) return "shawn-3090";

    if (host === "127.0.0.1" || host === "localhost" || host === "::1") {
      const local = String(hostname || "").trim().toLowerCase().split(".")[0];
      if (local === "slr" || local === "otg-slr") return "slr-5060";
      if (local === "shawn" || local === "otg-shawn") return "shawn-3090";
    }
    return null;
  } catch {
    return null;
  }
}

function hasResidentModel(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return false;
  const models = (payload as { models?: unknown }).models;
  return Array.isArray(models) && models.length > 0;
}

function comfyQueueActive(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return false;
  const queue = payload as { queue_running?: unknown; queue_pending?: unknown };
  return (Array.isArray(queue.queue_running) && queue.queue_running.length > 0)
    || (Array.isArray(queue.queue_pending) && queue.queue_pending.length > 0);
}

export async function detectShawnExternalOccupancy(deps: OccupancyDependencies = {}): Promise<ShawnOccupancy> {
  const locks = deps.locks || listResourceLocks();
  if (locks.some((lock) => lock.lockId === SHAWN_GPU_LOCK_ID)) {
    return { available: false, external: false, recoverable: false, reason: "worker-lock" };
  }
  try {
    const processList = await (deps.processList || defaultProcessList)();
    if (qwenCodeIsRunning(processList)) {
      return { available: false, external: true, recoverable: false, reason: "qwen-code" };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2_000);
    try {
      const response = await (deps.fetcher || fetch)(`${SHAWN_QWEN_URL}/api/ps`, {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) return { available: false, external: true, recoverable: false, reason: "probe-error" };
      if (hasResidentModel(await response.json().catch(() => null))) {
        return { available: false, external: true, recoverable: true, reason: "qwen-resident-stale" };
      }
      const comfyResponse = await (deps.fetcher || fetch)(`${SHAWN_COMFY_URL}/queue`, {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!comfyResponse.ok) return { available: false, external: true, recoverable: false, reason: "probe-error" };
      if (comfyQueueActive(await comfyResponse.json().catch(() => null))) {
        return { available: false, external: false, recoverable: false, reason: "comfy-active" };
      }
    } finally {
      clearTimeout(timer);
    }
    return { available: true, external: false, recoverable: false, reason: "available" };
  } catch {
    return { available: false, external: true, recoverable: false, reason: "probe-error" };
  }
}

export function acquireClusterGpuLease(input: {
  lockId: typeof SLR_GPU_LOCK_ID | typeof SHAWN_GPU_LOCK_ID;
  ownerId: string;
  workerId: string;
  purpose: ClusterGpuPurpose;
  ttlSeconds?: number;
}) {
  const result = acquireResourceLock({
    lockId: input.lockId,
    ownerId: input.ownerId,
    ownerType: input.purpose === "external-qwen-code" ? "system" : "job",
    workerId: input.workerId,
    resourceName: input.purpose,
    ttlSeconds: input.ttlSeconds || 15 * 60,
  });
  return result.ok
    ? { ok: true as const, lease: { ...result.lock, purpose: input.purpose } as ClusterGpuLease }
    : result;
}

export async function acquireShawnClusterGpuLease(input: Omit<Parameters<typeof acquireClusterGpuLease>[0], "lockId">) {
  const occupancy = await detectShawnExternalOccupancy();
  if (!occupancy.available) {
    return { ok: false as const, error: occupancy.external ? "RTX 3090 is externally occupied." : "RTX 3090 is busy.", occupancy };
  }
  return acquireClusterGpuLease({ ...input, lockId: SHAWN_GPU_LOCK_ID });
}

export function releaseClusterGpuLease(lease: ClusterGpuLease): boolean {
  return releaseResourceLock(lease.lockId, lease.ownerId, lease.fencingToken);
}

export function clusterGpuLockPurpose(lockId: typeof SLR_GPU_LOCK_ID | typeof SHAWN_GPU_LOCK_ID): ClusterGpuPurpose | null {
  const lock = listResourceLocks().find((candidate) => candidate.lockId === lockId);
  const purpose = lock?.resourceName;
  return purpose === "image" || purpose === "video" || purpose === "ltx-fallback" || purpose === "qwen36" || purpose === "external-qwen-code"
    ? purpose
    : null;
}

export type ClusterLaneState =
  | "available"
  | "starting"
  | "busy-image"
  | "busy-video"
  | "busy-qwen"
  | "externally-occupied"
  | "unavailable/error";

export async function getClusterLaneStates(fetcher: typeof fetch = fetch): Promise<{
  slrImage: ClusterLaneState;
  shawnVideo: ClusterLaneState;
}> {
  const locks = listResourceLocks();
  const slr = locks.find((lock) => lock.lockId === SLR_GPU_LOCK_ID);
  const shawn = locks.find((lock) => lock.lockId === SHAWN_GPU_LOCK_ID);
  let slrImage: ClusterLaneState = slr
    ? slr.resourceName === "qwen36" ? "busy-qwen" : "busy-image"
    : "available";
  if (!slr && process.env.NODE_ENV !== "test") {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2_000);
    try {
      const response = await fetcher(`${SLR_COMFY_URL}/system_stats`, { cache: "no-store", signal: controller.signal });
      if (!response.ok) slrImage = "unavailable/error";
    } catch {
      slrImage = "unavailable/error";
    } finally {
      clearTimeout(timer);
    }
  }
  if (shawn) {
    return {
      slrImage,
      shawnVideo: shawn.resourceName === "qwen36" ? "busy-qwen" : "busy-video",
    };
  }
  const occupancy = await detectShawnExternalOccupancy({ fetcher, locks });
  return {
    slrImage,
    shawnVideo: occupancy.reason === "qwen-code" || occupancy.reason === "qwen-resident-stale"
      ? "externally-occupied"
      : occupancy.reason === "probe-error" ? "unavailable/error"
        : occupancy.reason === "comfy-active" ? "busy-video" : "available",
  };
}
