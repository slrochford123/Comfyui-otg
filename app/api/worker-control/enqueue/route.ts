import { NextRequest } from "next/server";

import { jsonError, jsonOk, readJsonBody } from "@/lib/http/routeHelpers";
import { normalizeWorkerLifecycleAction } from "@/lib/workers/workerCatalog";
import { requireWorkerControlToken } from "@/lib/workers/workerLifecycleAuth";
import { enqueueWorkerLifecycleCommand } from "@/lib/workers/workerLifecycleStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function cleanString(value: unknown): string {
  return String(value || "").trim();
}

function workerControlEnabled(): boolean {
  if (String(process.env.OTG_WORKER_CONTROL_ENABLED || "").trim() === "1") return true;
  return process.env.NODE_ENV === "development"
    && /(?:^|\/)OTG-Character-Rework\/?$/.test(String(process.env.OTG_WORK_REPO || "").trim());
}

export async function POST(req: NextRequest) {
  if (!workerControlEnabled()) return jsonError("Worker-control is disabled.", { status: 404 });

  const auth = requireWorkerControlToken(req);
  if (!auth.ok) return jsonError(auth.error, { status: auth.status });

  const body = await readJsonBody<Record<string, unknown>>(req.clone(), { maxBytes: 64 * 1024 });
  if (!body.ok) return jsonError(body.error, { status: body.status });

  const action = normalizeWorkerLifecycleAction(body.value.action);
  if (!action) return jsonError("Invalid worker lifecycle action.", { status: 400 });
  const command = enqueueWorkerLifecycleCommand({
    workerId: cleanString(body.value.workerId),
    action,
    requestedBy: cleanString(body.value.requestedBy) || "dev-enqueue",
    dryRun: body.value.dryRun !== false,
    reason: cleanString(body.value.reason) || "TEST/dev manual enqueue.",
    jobId: cleanString(body.value.jobId) || null,
    leaseSeconds: Number(body.value.leaseSeconds) || null,
  });
  if (!command.ok) return jsonError(command.error, { status: 400 });
  return jsonOk({ command: command.command });
}
