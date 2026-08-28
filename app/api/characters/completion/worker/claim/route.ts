import { NextRequest, NextResponse } from "next/server";

import { readJsonBody, withNoStore } from "@/lib/http/routeHelpers";
import { requireWorkerToken } from "@/lib/jobs/workerAuth";
import { claimCharacterCompletionJob } from "@/lib/jobs/characterCompletionJobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status, headers: withNoStore() });
}

export async function POST(req: NextRequest) {
  const token = requireWorkerToken(req);
  if (!token.ok) return jsonError(token.error, token.status);

  const body = await readJsonBody<Record<string, unknown>>(req.clone());
  if (!body.ok) return jsonError(body.error, body.status);

  const workerId = String(body.value.workerId || req.headers.get("x-otg-worker-id") || "linux-character-completion-worker").trim();
  const job = claimCharacterCompletionJob(workerId);
  return NextResponse.json({ ok: true, job }, { headers: withNoStore() });
}
