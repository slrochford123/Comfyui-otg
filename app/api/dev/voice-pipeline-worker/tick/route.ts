import { NextRequest, NextResponse } from "next/server";

import { withNoStore, readJsonBody, sessionErrorResponse } from "@/lib/http/routeHelpers";
import { getOwnerContext } from "@/lib/ownerKey";
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

function devWorkerDisabled() {
  return process.env.NODE_ENV === "production";
}

export async function POST(req: NextRequest) {
  if (devWorkerDisabled()) return jsonError("Not found.", 404);

  try {
    const body = await readJsonBody<Record<string, unknown>>(req.clone());
    if (!body.ok) return jsonError(body.error, body.status);

    const requestedOwnerKey =
      typeof body.value.ownerKey === "string" ? body.value.ownerKey.trim() : "";

    if (requestedOwnerKey && !/^[A-Za-z0-9_-]{1,160}$/.test(requestedOwnerKey)) {
      return jsonError("Invalid ownerKey.", 400);
    }

    const ownerKey = requestedOwnerKey || (await getOwnerContext(req)).ownerKey;
    const requestedJobId =
      typeof body.value.jobId === "string" ? body.value.jobId.trim() : "";

    if (requestedJobId && !/^[A-Za-z0-9_-]{1,200}$/.test(requestedJobId)) {
      return jsonError("Invalid jobId.", 400);
    }

    const result = await tickVoicePipelineWorker(ownerKey, {
      limit: Number(body.value.limit || 1),
      jobId: requestedJobId || undefined,
    });
    return NextResponse.json(result, { headers: withNoStore() });
  } catch (error) {
    return sessionErrorResponse(error) || jsonError("Could not tick no-op voice pipeline worker.", 500, devErrorDetail(error));
  }
}
