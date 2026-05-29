import { NextRequest, NextResponse } from "next/server";

import { getOwnerContext } from "@/lib/ownerKey";
import { withNoStore, readJsonBody, sessionErrorResponse } from "@/lib/http/routeHelpers";
import { getQueuedContractJob, resumeVoicePipelineJob, stopVoicePipelineJob } from "@/lib/jobs/voicePipelineJobs";

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
    if (!job || job.jobType !== "character_voice_pipeline") return jsonError("Job not found.", 404);

    return NextResponse.json({ job }, { headers: withNoStore() });
  } catch (error) {
    return sessionErrorResponse(error) || jsonError("Could not load character voice-pipeline job.", 500);
  }
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ jobId: string }> }) {
  try {
    const owner = await getOwnerContext(req);
    const { jobId } = await ctx.params;
    const body = await readJsonBody<Record<string, unknown>>(req.clone());
    if (!body.ok) return jsonError(body.error, body.status);

    const action = String(body.value.action || "").trim().toLowerCase();
    const job =
      action === "stop"
        ? stopVoicePipelineJob(owner.ownerKey, jobId)
        : action === "resume"
          ? resumeVoicePipelineJob(owner.ownerKey, jobId)
          : null;

    if (!job || job.jobType !== "character_voice_pipeline") {
      return jsonError(action ? "Job not found or action is not supported." : "Missing job action.", action ? 404 : 400);
    }

    return NextResponse.json({ job }, { headers: withNoStore() });
  } catch (error) {
    return sessionErrorResponse(error) || jsonError("Could not update character voice-pipeline job.", 500);
  }
}
