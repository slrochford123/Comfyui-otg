import { NextRequest, NextResponse } from "next/server";

import {
  readJsonBody,
  sessionErrorResponse,
  withNoStore,
} from "@/lib/http/routeHelpers";
import { requeueRemoteWorkerJob } from "@/lib/jobs/voicePipelineJobs";
import { hasValidWorkerToken } from "@/lib/jobs/workerAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(error: string, status = 400) {
  return NextResponse.json(
    { ok: false, error },
    { status, headers: withNoStore() },
  );
}

export async function POST(req: NextRequest) {
  try {
    if (!hasValidWorkerToken(req)) {
      return jsonError("Invalid or missing worker token.", 401);
    }

    const ownerKey = String(
      req.headers.get("x-otg-owner-key") || "",
    ).trim();

    if (!ownerKey) {
      return jsonError("Missing x-otg-owner-key.", 400);
    }

    const body =
      await readJsonBody<Record<string, unknown>>(req.clone());

    if (!body.ok) {
      return jsonError(body.error, body.status);
    }

    const jobId = String(body.value.jobId || "").trim();
    if (!jobId) {
      return jsonError("Missing jobId.", 400);
    }

    const message = String(
      body.value.message ||
        "Waiting for an available compatible Linux GPU.",
    ).trim();

    const job = requeueRemoteWorkerJob(
      ownerKey,
      jobId,
      message,
      body.value.result,
    );

    if (!job) {
      return jsonError("Job not found.", 404);
    }

    return NextResponse.json(
      { ok: true, job },
      { headers: withNoStore() },
    );
  } catch (error) {
    return (
      sessionErrorResponse(error) ||
      jsonError("Could not requeue worker job.", 500)
    );
  }
}
