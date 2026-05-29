import { NextRequest, NextResponse } from "next/server";

import { getOwnerContext } from "@/lib/ownerKey";
import { withNoStore, readJsonBody, sessionErrorResponse } from "@/lib/http/routeHelpers";
import { createProductionAudioStudioJob } from "@/lib/jobs/voicePipelineJobs";

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

export async function POST(req: NextRequest) {
  try {
    const body = await readJsonBody<Record<string, unknown>>(req.clone());
    if (!body.ok) return jsonError(body.error, body.status);

    const owner = await getOwnerContext(req);

    const result = createProductionAudioStudioJob(owner.ownerKey, body.value);
    if (!result.ok) return jsonError(result.error, result.status);

    return NextResponse.json({ job: result.job }, { headers: withNoStore() });
  } catch (error) {
    return sessionErrorResponse(error) || jsonError("Could not queue production audio-studio job.", 500, devErrorDetail(error));
  }
}
