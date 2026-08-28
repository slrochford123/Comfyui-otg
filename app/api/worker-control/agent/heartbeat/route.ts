import { NextRequest } from "next/server";

import { jsonError, jsonOk, readJsonBody } from "@/lib/http/routeHelpers";
import { heartbeatWorkerLifecycleCommand } from "@/lib/workers/workerLifecycleStore";
import { requireWorkerControlToken } from "@/lib/workers/workerLifecycleAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function cleanString(value: unknown): string {
  return String(value || "").trim();
}

export async function POST(req: NextRequest) {
  const token = requireWorkerControlToken(req);
  if (!token.ok) return jsonError(token.error, { status: token.status });

  const body = await readJsonBody<Record<string, unknown>>(req.clone(), { maxBytes: 64 * 1024 });
  if (!body.ok) return jsonError(body.error, { status: body.status });

  const commandId = cleanString(body.value.commandId);
  const agentId = cleanString(body.value.agentId);
  if (!agentId) return jsonError("Missing agentId.", { status: 400 });
  if (!commandId) {
    return jsonOk({ command: null, agent: { agentId, heartbeatAt: new Date().toISOString() } });
  }

  const command = heartbeatWorkerLifecycleCommand(commandId, agentId, Number(body.value.leaseSeconds) || 60);
  if (!command) return jsonError("Lifecycle command not found for this agent.", { status: 404 });
  return jsonOk({ command });
}
