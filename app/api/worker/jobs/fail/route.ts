import { NextRequest, NextResponse } from "next/server";

import { readJsonBody, sessionErrorResponse, withNoStore } from "@/lib/http/routeHelpers";
import { getOwnerContext } from "@/lib/ownerKey";
import { failRemoteWorkerJob } from "@/lib/jobs/voicePipelineJobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status, headers: withNoStore() });
}

function workerOwnerKey(req: NextRequest, fallbackOwnerKey: string): string {
  const headerOwnerKey = String(req.headers.get("x-otg-owner-key") || "").trim();
  return headerOwnerKey || fallbackOwnerKey;
}

export async function POST(req: NextRequest) {
  try {
    const owner = await getOwnerContext(req);
    const body = await readJsonBody<Record<string, unknown>>(req.clone());
    if (!body.ok) return jsonError(body.error, body.status);

    const jobId = String(body.value.jobId || "").trim();
    if (!jobId) return jsonError("Missing jobId.", 400);

    const error = String(body.value.error || body.value.message || "Remote Windows worker failed.").trim();
    const job = failRemoteWorkerJob(workerOwnerKey(req, owner.ownerKey), jobId, error, body.value.result);

    if (!job) return jsonError("Job not found.", 404);
    return NextResponse.json({ ok: true, job }, { headers: withNoStore() });
  } catch (error) {
    return sessionErrorResponse(error) || jsonError("Could not fail worker job.", 500);
  }
}

