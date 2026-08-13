import { NextRequest } from "next/server";

import { jsonError, jsonOk, readJsonBody } from "@/lib/http/routeHelpers";
import { requireWorkerControlToken } from "@/lib/workers/workerLifecycleAuth";
import { acquireResourceLock } from "@/lib/workers/resourceLocks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const auth = requireWorkerControlToken(req);
  if (!auth.ok) return jsonError(auth.error, { status: auth.status });
  const body = await readJsonBody<Record<string, unknown>>(req.clone(), { maxBytes: 32 * 1024 });
  if (!body.ok) return jsonError(body.error, { status: body.status });
  if (body.value.lockId !== "gpu:linux-5060ti") return jsonError("This endpoint is restricted to gpu:linux-5060ti.", { status: 400 });
  const result = acquireResourceLock({
    lockId: "gpu:linux-5060ti",
    ownerId: String(body.value.ownerId || "").trim(),
    ownerType: "job",
    workerId: String(body.value.workerId || "").trim(),
    resourceName: String(body.value.resourceName || "ltx-fallback").trim(),
    ttlSeconds: Number(body.value.ttlSeconds) || 120,
  });
  if (!result.ok) return jsonError(result.error, { status: 409 });
  return jsonOk({ lock: result.lock });
}
