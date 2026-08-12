import { NextRequest } from "next/server";

import { jsonError, jsonOk, readJsonBody } from "@/lib/http/routeHelpers";
import { requireWorkerControlToken } from "@/lib/workers/workerLifecycleAuth";
import { heartbeatResourceLock } from "@/lib/workers/resourceLocks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const auth = requireWorkerControlToken(req);
  if (!auth.ok) return jsonError(auth.error, { status: auth.status });
  const body = await readJsonBody<Record<string, unknown>>(req.clone(), { maxBytes: 32 * 1024 });
  if (!body.ok) return jsonError(body.error, { status: body.status });
  const lock = heartbeatResourceLock(
    "gpu:linux-5060ti",
    String(body.value.ownerId || "").trim(),
    String(body.value.fencingToken || "").trim(),
    Number(body.value.ttlSeconds) || 120,
  );
  if (!lock) return jsonError("Lease not found, expired, or owned by another token.", { status: 409 });
  return jsonOk({ lock });
}
