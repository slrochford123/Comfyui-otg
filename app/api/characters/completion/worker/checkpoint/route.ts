import { NextRequest, NextResponse } from "next/server";

import { readJsonBody, withNoStore } from "@/lib/http/routeHelpers";
import { requireWorkerToken } from "@/lib/jobs/workerAuth";
import { checkpointCharacterCompletionJob } from "@/lib/jobs/characterCompletionJobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status, headers: withNoStore() });
}

export async function POST(req: NextRequest) {
  const token = requireWorkerToken(req);
  if (!token.ok) return jsonError(token.error, token.status);

  const ownerKey = String(req.headers.get("x-otg-owner-key") || "").trim();
  if (!ownerKey) return jsonError("Missing x-otg-owner-key.", 400);

  const body = await readJsonBody<Record<string, unknown>>(req.clone());
  if (!body.ok) return jsonError(body.error, body.status);

  const jobId = String(body.value.jobId || "").trim();
  const progress = Number(body.value.progress);
  if (!jobId || !Number.isFinite(progress)) return jsonError("Missing jobId or valid progress.", 400);

  const job = checkpointCharacterCompletionJob(ownerKey, jobId, progress, body.value.message, body.value.result);
  if (!job) return jsonError("Character completion job not found.", 404);
  return NextResponse.json({ ok: true, job }, { headers: withNoStore() });
}
