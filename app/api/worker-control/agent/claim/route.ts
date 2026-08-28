import { NextRequest } from "next/server";

import { jsonError, jsonOk, readJsonBody } from "@/lib/http/routeHelpers";
import { getWorkerCatalogEntry, type WorkerPlatform, WORKER_PLATFORMS } from "@/lib/workers/workerCatalog";
import { claimWorkerLifecycleCommand } from "@/lib/workers/workerLifecycleStore";
import { requireWorkerControlToken } from "@/lib/workers/workerLifecycleAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function cleanString(value: unknown): string {
  return String(value || "").trim();
}

function platformFrom(value: unknown): WorkerPlatform | null {
  const platform = cleanString(value);
  return (WORKER_PLATFORMS as readonly string[]).includes(platform) ? platform as WorkerPlatform : null;
}

export async function POST(req: NextRequest) {
  const token = requireWorkerControlToken(req);
  if (!token.ok) return jsonError(token.error, { status: token.status });

  const body = await readJsonBody<Record<string, unknown>>(req.clone(), { maxBytes: 64 * 1024 });
  if (!body.ok) return jsonError(body.error, { status: body.status });

  const agentId = cleanString(body.value.agentId);
  const platform = platformFrom(body.value.platform);
  const capabilities = Array.isArray(body.value.capabilities)
    ? body.value.capabilities.map(cleanString).filter(Boolean)
    : [];
  if (!agentId) return jsonError("Missing agentId.", { status: 400 });
  if (!platform) return jsonError("Missing or invalid platform.", { status: 400 });
  if (capabilities.length === 0) return jsonError("Missing capabilities.", { status: 400 });

  const command = claimWorkerLifecycleCommand({ agentId, platform, capabilities });
  if (!command) return jsonOk({ command: null });

  const entry = getWorkerCatalogEntry(command.workerId);
  return jsonOk({
    command: {
      commandId: command.id,
      workerId: command.workerId,
      action: command.action,
      dryRun: command.dryRun,
      leaseSeconds: command.leaseSeconds || 60,
      reason: command.reason,
      requiredResources: entry?.resources || [],
      dependencies: entry?.dependencies || [],
    },
  });
}
