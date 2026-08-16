import { NextRequest } from "next/server";

import { jsonError, jsonOk, readJsonBody } from "@/lib/http/routeHelpers";
import { requireWorkerControlToken } from "@/lib/workers/workerLifecycleAuth";
import { heartbeatResourceLock } from "@/lib/workers/resourceLocks";
import { REQUIRED_RESOURCE_LOCK_IDS, type WorkerResourceLockId } from "@/lib/workers/workerCatalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const auth = requireWorkerControlToken(req);
  if (!auth.ok) return jsonError(auth.error, { status: auth.status });
  const body = await readJsonBody<Record<string, unknown>>(req.clone(), { maxBytes: 32 * 1024 });
  if (!body.ok) return jsonError(body.error, { status: body.status });
  const lockId = String(body.value.lockId || "gpu:linux-5060ti") as WorkerResourceLockId;
  if (!(REQUIRED_RESOURCE_LOCK_IDS as readonly string[]).includes(lockId)) return jsonError("Unknown resource lock ID.", { status: 400 });
  const lock = heartbeatResourceLock(
    lockId,
    String(body.value.ownerId || "").trim(),
    String(body.value.fencingToken || "").trim(),
    Number(body.value.ttlSeconds) || 120,
  );
  if (!lock) return jsonError("Lease not found, expired, or owned by another token.", { status: 409 });
  return jsonOk({ lock });
}
