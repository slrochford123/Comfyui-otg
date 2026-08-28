import { NextRequest } from "next/server";

import { jsonError, jsonOk, readJsonBody } from "@/lib/http/routeHelpers";
import { requireWorkerControlToken } from "@/lib/workers/workerLifecycleAuth";
import { acquireResourceLock } from "@/lib/workers/resourceLocks";
import { detectShawnExternalOccupancy } from "@/lib/workers/clusterGpu";
import { REQUIRED_RESOURCE_LOCK_IDS, type WorkerResourceLockId } from "@/lib/workers/workerCatalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const auth = requireWorkerControlToken(req);
  if (!auth.ok) return jsonError(auth.error, { status: auth.status });
  const body = await readJsonBody<Record<string, unknown>>(req.clone(), { maxBytes: 32 * 1024 });
  if (!body.ok) return jsonError(body.error, { status: body.status });
  const lockId = String(body.value.lockId || "gpu:linux-5060ti") as WorkerResourceLockId;
  if (!(REQUIRED_RESOURCE_LOCK_IDS as readonly string[]).includes(lockId) || !["gpu:slr-5060", "gpu:shawn-3090", "gpu:linux-5060ti", "gpu:linux-3090"].includes(lockId)) {
    return jsonError("This endpoint is restricted to cluster GPU resources.", { status: 400 });
  }
  if (["gpu:shawn-3090", "gpu:linux-3090"].includes(lockId)) {
    const occupancy = await detectShawnExternalOccupancy();
    if (!occupancy.available) return jsonError(occupancy.external ? "RTX 3090 is externally occupied." : "RTX 3090 is busy.", { status: 409 });
  }
  const result = acquireResourceLock({
    lockId,
    ownerId: String(body.value.ownerId || "").trim(),
    ownerType: "job",
    workerId: String(body.value.workerId || "").trim(),
    resourceName: String(body.value.resourceName || "ltx-fallback").trim(),
    ttlSeconds: Number(body.value.ttlSeconds) || 120,
  });
  if (!result.ok) return jsonError(result.error, { status: 409 });
  return jsonOk({ lock: result.lock });
}
