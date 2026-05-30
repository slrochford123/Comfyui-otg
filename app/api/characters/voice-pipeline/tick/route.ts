import { NextRequest, NextResponse } from "next/server";

import { withNoStore, readJsonBody, sessionErrorResponse } from "@/lib/http/routeHelpers";
import { getOwnerContext } from "@/lib/ownerKey";
import { findVoicePipelineJobOwnerKey } from "@/lib/jobs/voicePipelineJobs";
import { tickVoicePipelineWorker } from "@/lib/jobs/voicePipelineWorker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(error: string, status = 400, detail?: unknown) {
  return NextResponse.json(
    {
      ok: false,
      error,
      ...(process.env.NODE_ENV !== "production" && detail ? { detail } : {}),
    },
    { status, headers: withNoStore() },
  );
}

function devErrorDetail(error: unknown) {
  if (process.env.NODE_ENV === "production") return undefined;
  const err = error as { name?: unknown; message?: unknown; stack?: unknown };
  return {
    name: String(err?.name || "Error"),
    message: String(err?.message || error || "Unknown error"),
    stack: typeof err?.stack === "string" ? err.stack.split("\n").slice(0, 8).join("\n") : null,
  };
}

function isSafeOwnerKey(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,160}$/.test(value);
}

export async function POST(req: NextRequest) {
  try {
    const body = await readJsonBody<Record<string, unknown>>(req.clone());
    if (!body.ok) return jsonError(body.error, body.status);

    const owner = await getOwnerContext(req);

    const requestedJobId =
      typeof body.value.jobId === "string" ? body.value.jobId.trim() : "";

    if (requestedJobId && !/^[A-Za-z0-9_-]{1,200}$/.test(requestedJobId)) {
      return jsonError("Invalid jobId.", 400);
    }

    const limit = Number(body.value.limit || 1);
    const result = await tickVoicePipelineWorker(owner.ownerKey, {
      limit,
      jobId: requestedJobId || undefined,
    });

    if (result.processed > 0 || !requestedJobId) {
      return NextResponse.json(result, { headers: withNoStore() });
    }

    const storedOwnerKey = findVoicePipelineJobOwnerKey(requestedJobId);
    if (!storedOwnerKey || storedOwnerKey === owner.ownerKey || !isSafeOwnerKey(storedOwnerKey)) {
      return NextResponse.json(result, { headers: withNoStore() });
    }

    const fallbackResult = await tickVoicePipelineWorker(storedOwnerKey, {
      limit,
      jobId: requestedJobId,
    });

    return NextResponse.json(fallbackResult.processed > 0 ? fallbackResult : result, { headers: withNoStore() });
  } catch (error) {
    return sessionErrorResponse(error) || jsonError("Could not tick character voice-pipeline worker.", 500, devErrorDetail(error));
  }
}