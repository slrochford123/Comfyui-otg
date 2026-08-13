import { NextRequest, NextResponse } from "next/server";

import { readJsonBody, sessionErrorResponse, withNoStore } from "@/lib/http/routeHelpers";
import { getOwnerContext } from "@/lib/ownerKey";
import { checkpointRemoteWorkerJob } from "@/lib/jobs/voicePipelineJobs";
import { hasValidWorkerToken } from "@/lib/jobs/workerAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status, headers: withNoStore() });
}

function workerOwnerKey(req: NextRequest, fallbackOwnerKey: string): string {
  const headerOwnerKey = String(req.headers.get("x-otg-owner-key") || "").trim();
  return headerOwnerKey || fallbackOwnerKey;
}

async function resolveWorkerOwnerKey(req: NextRequest): Promise<string> {
  if (hasValidWorkerToken(req)) {
    const headerOwnerKey = String(req.headers.get("x-otg-owner-key") || "").trim();
    if (!headerOwnerKey) throw new Error("Missing x-otg-owner-key for worker checkpoint.");
    return headerOwnerKey;
  }
  const owner = await getOwnerContext(req);
  return workerOwnerKey(req, owner.ownerKey);
}

export async function POST(req: NextRequest) {
  try {
    const ownerKey = await resolveWorkerOwnerKey(req);
    const body = await readJsonBody<Record<string, unknown>>(req.clone());
    if (!body.ok) return jsonError(body.error, body.status);

    const jobId = String(body.value.jobId || "").trim();
    if (!jobId) return jsonError("Missing jobId.", 400);

    const rawProgress = Number(body.value.progress);
    if (!Number.isFinite(rawProgress)) return jsonError("Missing valid progress.", 400);

    const result = body.value.result && typeof body.value.result === "object" ? body.value.result : {};
    const message = String(body.value.message || "Remote Windows worker checkpoint.").trim();
    const job = checkpointRemoteWorkerJob(ownerKey, jobId, result, rawProgress, message);

    if (!job) return jsonError("Job not found.", 404);
    return NextResponse.json({ ok: true, job }, { headers: withNoStore() });
  } catch (error) {
    return sessionErrorResponse(error) || jsonError("Could not checkpoint worker job.", 500);
  }
}
