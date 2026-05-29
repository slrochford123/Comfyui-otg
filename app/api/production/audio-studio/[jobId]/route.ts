import { NextRequest, NextResponse } from "next/server";

import { getOwnerContext } from "@/lib/ownerKey";
import { withNoStore, sessionErrorResponse } from "@/lib/http/routeHelpers";
import { getQueuedContractJob } from "@/lib/jobs/voicePipelineJobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status, headers: withNoStore() });
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ jobId: string }> }) {
  try {
    const owner = await getOwnerContext(req);
    const { jobId } = await ctx.params;
    const job = getQueuedContractJob(owner.ownerKey, jobId);
    if (!job || job.jobType !== "production_audio_studio") return jsonError("Job not found.", 404);

    return NextResponse.json({ job }, { headers: withNoStore() });
  } catch (error) {
    return sessionErrorResponse(error) || jsonError("Could not load production audio-studio job.", 500);
  }
}
