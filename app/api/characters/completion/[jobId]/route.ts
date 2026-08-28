import { NextRequest, NextResponse } from "next/server";

import { sessionErrorResponse, withNoStore } from "@/lib/http/routeHelpers";
import { getOwnerContext } from "@/lib/ownerKey";
import { hasValidWorkerToken } from "@/lib/jobs/workerAuth";
import {
  cancelCharacterCompletionJob,
  getCharacterCompletionJob,
} from "@/lib/jobs/characterCompletionJobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status, headers: withNoStore() });
}

export async function GET(req: NextRequest, context: { params: Promise<{ jobId: string }> }) {
  try {
    const { jobId } = await context.params;
    let ownerKey = "";

    if (hasValidWorkerToken(req)) {
      ownerKey = String(req.headers.get("x-otg-owner-key") || "").trim();
      if (!ownerKey) return jsonError("Missing x-otg-owner-key for worker job read.", 400);
    } else {
      const owner = await getOwnerContext(req);
      ownerKey = owner.ownerKey;
    }

    const job = getCharacterCompletionJob(ownerKey, jobId);
    if (!job) return jsonError("Character completion job not found.", 404);
    return NextResponse.json({ ok: true, job }, { headers: withNoStore() });
  } catch (error) {
    return sessionErrorResponse(error) || jsonError("Could not load character completion job.", 500);
  }
}


export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ jobId: string }> },
) {
  try {
    const { jobId } = await context.params;
    const owner = await getOwnerContext(req);
    const job = cancelCharacterCompletionJob(owner.ownerKey, jobId);
    if (!job) return jsonError("Character completion job not found.", 404);

    return NextResponse.json(
      { ok: true, job },
      { headers: withNoStore() },
    );
  } catch (error) {
    return (
      sessionErrorResponse(error) ||
      jsonError("Could not cancel character completion job.", 500)
    );
  }
}
