import crypto from "node:crypto";

import {
  acquireResourceLock,
  heartbeatResourceLock,
  releaseResourceLock,
  type ResourceLock,
} from "@/lib/workers/resourceLocks";

export const RTX_5060_GPU_LOCK_ID = "gpu:linux-5060ti" as const;
const DEFAULT_LEASE_TTL_SECONDS = 120;

export type Comfy5060Lease = ResourceLock & { purpose: "image" | "ltx-fallback" };

export function isRtx5060Comfy8188Endpoint(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.port !== "8188") return false;
    const explicitHosts = new Set([
      "100.98.212.116",
      "192.168.1.113",
      ...String(process.env.OTG_5060_COMFY_HOSTS || "").split(",").map((value) => value.trim()).filter(Boolean),
    ]);
    return explicitHosts.has(parsed.hostname);
  } catch {
    return false;
  }
}

export function createComfyLeaseOwnerId(prefix: string): string {
  return `${prefix}:${process.pid}:${Date.now()}:${crypto.randomUUID()}`;
}

export function acquireComfy5060Lease(input: {
  ownerId: string;
  workerId: string;
  purpose: "image" | "ltx-fallback";
  ttlSeconds?: number;
}): { ok: true; lease: Comfy5060Lease } | { ok: false; error: string; existing?: ResourceLock } {
  const result = acquireResourceLock({
    lockId: RTX_5060_GPU_LOCK_ID,
    ownerId: input.ownerId,
    ownerType: "job",
    workerId: input.workerId,
    resourceName: input.purpose,
    ttlSeconds: input.ttlSeconds || DEFAULT_LEASE_TTL_SECONDS,
  });
  return result.ok
    ? { ok: true, lease: { ...result.lock, purpose: input.purpose } }
    : result;
}

export function heartbeatComfy5060Lease(lease: Comfy5060Lease, ttlSeconds = DEFAULT_LEASE_TTL_SECONDS): Comfy5060Lease | null {
  const renewed = heartbeatResourceLock(
    RTX_5060_GPU_LOCK_ID,
    lease.ownerId,
    lease.fencingToken,
    ttlSeconds,
  );
  return renewed ? { ...renewed, purpose: lease.purpose } : null;
}

export function releaseComfy5060Lease(lease: Comfy5060Lease): boolean {
  return releaseResourceLock(RTX_5060_GPU_LOCK_ID, lease.ownerId, lease.fencingToken);
}
