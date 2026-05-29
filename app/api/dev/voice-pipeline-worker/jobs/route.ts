import { NextRequest, NextResponse } from "next/server";

import { withNoStore, sessionErrorResponse } from "@/lib/http/routeHelpers";
import { listVoicePipelineJobs } from "@/lib/jobs/voicePipelineJobs";
import { getOwnerContext } from "@/lib/ownerKey";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status, headers: withNoStore() });
}

function devWorkerDisabled() {
  return process.env.NODE_ENV === "production";
}

export async function GET(req: NextRequest) {
  if (devWorkerDisabled()) return jsonError("Not found.", 404);

  try {
    const owner = await getOwnerContext(req);
    return NextResponse.json({ jobs: listVoicePipelineJobs(owner.ownerKey) }, { headers: withNoStore() });
  } catch (error) {
    return sessionErrorResponse(error) || jsonError("Could not list no-op voice pipeline jobs.", 500);
  }
}
