import { NextRequest, NextResponse } from "next/server";

import { readJsonBody, sessionErrorResponse, withNoStore } from "@/lib/http/routeHelpers";
import { getOwnerContext } from "@/lib/ownerKey";
import { claimRemoteWorkerJob } from "@/lib/jobs/voicePipelineJobs";
import {
  getOtgWorkerJobRoute,
  normalizeOtgWorkerAction,
  normalizeOtgWorkerJobType,
} from "@/lib/jobs/workerJobContract";

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

    const jobType = normalizeOtgWorkerJobType(body.value.jobType || "character_voice_pipeline");
    if (!jobType) return jsonError("Invalid or missing jobType.", 400);

    const action = normalizeOtgWorkerAction(jobType, body.value.action);
    if (!action) return jsonError("Invalid or missing worker action for jobType.", 400);

    const route = getOtgWorkerJobRoute(jobType, action);
    if (!route) return jsonError("This job/action is not registered as a Windows worker route.", 400);

    const workerId = String(body.value.workerId || req.headers.get("x-otg-worker-id") || "windows-otg-worker").trim();
    const job = claimRemoteWorkerJob(workerOwnerKey(req, owner.ownerKey), workerId, jobType, action);

    return NextResponse.json({ ok: true, route, job }, { headers: withNoStore() });
  } catch (error) {
    return sessionErrorResponse(error) || jsonError("Could not claim worker job.", 500);
  }
}

