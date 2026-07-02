import { NextRequest } from "next/server";

import { jsonError, jsonOk } from "@/lib/http/routeHelpers";
import { getWorkerCatalog } from "@/lib/workers/workerCatalog";
import { listResourceLocks } from "@/lib/workers/resourceLocks";
import { requireWorkerControlToken } from "@/lib/workers/workerLifecycleAuth";
import {
  listRecentLifecycleCommands,
  type WorkerLifecycleCommand,
} from "@/lib/workers/workerLifecycleStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function cleanString(value: unknown): string {
  return String(value || "").trim();
}

function sanitizeStatusText(value: unknown): string | null {
  const text = cleanString(value);
  if (!text) return null;
  return text
    .replace(/bearer\s+[a-z0-9._~+/=-]+/gi, "Bearer [masked]")
    .replace(/--worker-token\s+\S+/gi, "[worker-token-arg]")
    .replace(/OTG_WORKER_TOKEN\s*=\s*[^ ;"]+/gi, "[worker-token-env]=[masked]")
    .replace(/OTG_WORKER_CONTROL_TOKEN\s*=\s*[^ ;"]+/gi, "[worker-control-token-env]=[masked]")
    .replace(/OTG_WORKER_TOKEN/gi, "[worker-token-env]")
    .replace(/OTG_WORKER_CONTROL_TOKEN/gi, "[worker-control-token-env]")
    .replace(/[A-Z]:\\[^\s"]+/g, "[local-path]")
    .replace(/\/(?:opt|home|mnt|srv|var)\/[^\s"]+/g, "[local-path]")
    .replace(/\b(?:powershell(?:\.exe)?|pwsh(?:\.exe)?|cmd(?:\.exe)?|worker-manager\.ps1|[^/\s\\]+\.ps1|[^/\s\\]+\.bat)\b/gi, "[redacted]")
    .slice(0, 500);
}

function publicWorkerCatalog() {
  return getWorkerCatalog().map((entry) => ({
    ...entry,
    displayName: sanitizeStatusText(entry.displayName),
    description: sanitizeStatusText(entry.description),
  }));
}

function workerControlEnabled(): boolean {
  return String(process.env.OTG_WORKER_CONTROL_ENABLED || "").trim() === "1";
}

function realActionsAvailable(): boolean {
  return getWorkerCatalog().some((entry) => entry.enabled && !entry.dryRunOnly);
}

function sanitizeCommandResult(result: unknown): Record<string, unknown> | undefined {
  if (!result || typeof result !== "object" || Array.isArray(result)) return undefined;
  const record = result as Record<string, unknown>;
  const health = record.health && typeof record.health === "object" && !Array.isArray(record.health)
    ? record.health as Record<string, unknown>
    : null;
  return {
    workerId: sanitizeStatusText(record.workerId),
    action: sanitizeStatusText(record.action),
    dryRun: typeof record.dryRun === "boolean" ? record.dryRun : undefined,
    realAction: typeof record.realAction === "boolean" ? record.realAction : undefined,
    finalState: sanitizeStatusText(record.finalState),
    pid: Number.isFinite(Number(record.pid)) ? Number(record.pid) : null,
    health: health ? {
      ok: typeof health.ok === "boolean" ? health.ok : undefined,
      summary: sanitizeStatusText(health.summary),
    } : undefined,
  };
}

function publicLifecycleCommand(command: WorkerLifecycleCommand): Record<string, unknown> {
  return {
    id: command.id,
    workerId: command.workerId,
    action: command.action,
    status: command.status,
    requestedBy: sanitizeStatusText(command.requestedBy),
    requestedAt: command.requestedAt,
    claimedByAgentId: sanitizeStatusText(command.claimedByAgentId),
    claimedAt: command.claimedAt,
    heartbeatAt: command.heartbeatAt,
    leaseExpiresAt: command.leaseExpiresAt,
    completedAt: command.completedAt,
    failedAt: command.failedAt,
    error: sanitizeStatusText(command.error),
    dryRun: command.dryRun,
    reason: sanitizeStatusText(command.reason),
    jobId: command.jobId || null,
    leaseSeconds: command.leaseSeconds || null,
    result: sanitizeCommandResult(command.result),
  };
}

export async function GET(req: NextRequest) {
  const enabled = workerControlEnabled();
  if (!enabled) return jsonError("Worker-control is disabled.", { status: 404 });

  const auth = requireWorkerControlToken(req);
  if (!auth.ok) return jsonError(auth.error, { status: auth.status });

  const hasRealActionWorkers = realActionsAvailable();
  const dryRunOnly = !enabled || !hasRealActionWorkers;
  return jsonOk({
    enabled,
    dryRunOnly,
    executionMode: dryRunOnly ? "dry-run" : "mixed",
    realActionsAvailable: hasRealActionWorkers,
    catalog: publicWorkerCatalog(),
    commands: listRecentLifecycleCommands(50).map(publicLifecycleCommand),
    locks: listResourceLocks(),
  });
}
