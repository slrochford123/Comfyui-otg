import { NextRequest } from "next/server";

import { jsonError, jsonOk, readJsonBody } from "@/lib/http/routeHelpers";
import { completeWorkerLifecycleCommand } from "@/lib/workers/workerLifecycleStore";
import { requireWorkerControlToken } from "@/lib/workers/workerLifecycleAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function cleanString(value: unknown): string {
  return String(value || "").trim();
}

export async function POST(req: NextRequest) {
  const token = requireWorkerControlToken(req);
  if (!token.ok) return jsonError(token.error, { status: token.status });

  const body = await readJsonBody<Record<string, unknown>>(req.clone(), { maxBytes: 128 * 1024 });
  if (!body.ok) return jsonError(body.error, { status: body.status });

  const commandId = cleanString(body.value.commandId);
  const agentId = cleanString(body.value.agentId);
  if (!commandId) return jsonError("Missing commandId.", { status: 400 });
  if (!agentId) return jsonError("Missing agentId.", { status: 400 });

  const command = completeWorkerLifecycleCommand(commandId, agentId, body.value.result);
  if (!command) return jsonError("Lifecycle command not found for this agent.", { status: 404 });
  return jsonOk({ command });
}
