import { NextRequest, NextResponse } from "next/server";

import { withNoStore, sessionErrorResponse } from "@/lib/http/routeHelpers";
import { getOwnerContext } from "@/lib/ownerKey";
import { findLatestActiveTrainingDatasetJobForCharacter } from "@/lib/jobs/voicePipelineJobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(error: string, status = 400) {
  return NextResponse.json({ error }, { status, headers: withNoStore() });
}

export async function GET(req: NextRequest) {
  try {
    const owner = await getOwnerContext(req);
    const { searchParams } = new URL(req.url);
    const characterId = String(searchParams.get("characterId") || "").trim();

    if (!/^[A-Za-z0-9_-]{1,200}$/.test(characterId)) {
      return jsonError("Invalid characterId.", 400);
    }

    const job = findLatestActiveTrainingDatasetJobForCharacter(characterId, owner.ownerKey);
    return NextResponse.json({ job }, { headers: withNoStore() });
  } catch (error) {
    return sessionErrorResponse(error) || jsonError("Could not load active training dataset job.", 500);
  }
}