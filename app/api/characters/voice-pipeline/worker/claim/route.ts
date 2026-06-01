import { NextRequest, NextResponse } from "next/server";

import { getOwnerContext } from "@/lib/ownerKey";
import { withNoStore, readJsonBody, sessionErrorResponse } from "@/lib/http/routeHelpers";
import { claimRemoteVoicePipelineWorkerJob, type RemoteVoicePipelineWorkerAction } from "@/lib/jobs/voicePipelineJobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";


function workerOwnerKey(req: NextRequest, fallbackOwnerKey: string): string {
  const headerOwnerKey = String(req.headers.get("x-otg-owner-key") || "").trim();
  return headerOwnerKey || fallbackOwnerKey;
}

function remoteClaimAction(value: unknown): RemoteVoicePipelineWorkerAction {
  const action = String(value || "generate_training_dataset").trim();
  if (action === "start_applio_training") return "start_applio_training";
  if (action === "test_trained_voice") return "test_trained_voice";
  return "generate_training_dataset";
}
function jsonError(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status, headers: withNoStore() });
}

export async function POST(req: NextRequest) {
  try {
    const owner = await getOwnerContext(req);
    const body = await readJsonBody<Record<string, unknown>>(req.clone());
    if (!body.ok) return jsonError(body.error, body.status);

    const claimAction = remoteClaimAction(body.value.action);
    const workerId = String(body.value.workerId || req.headers.get("x-otg-worker-id") || "windows-indextts2-worker").trim();
    const job = claimRemoteVoicePipelineWorkerJob(workerOwnerKey(req, owner.ownerKey), workerId, claimAction);

    return NextResponse.json({ ok: true, job }, { headers: withNoStore() });
  } catch (error) {
    return sessionErrorResponse(error) || jsonError("Could not claim remote training dataset job.", 500);
  }
}