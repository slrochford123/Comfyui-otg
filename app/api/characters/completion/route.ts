import { NextRequest, NextResponse } from "next/server";

import { readJsonBody, sessionErrorResponse, withNoStore } from "@/lib/http/routeHelpers";
import { getOwnerContext } from "@/lib/ownerKey";
import {
  createCharacterCompletionJob,
  listCharacterCompletionJobs,
} from "@/lib/jobs/characterCompletionJobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status, headers: withNoStore() });
}

export async function POST(req: NextRequest) {
  try {
    const owner = await getOwnerContext(req);
    const body = await readJsonBody<Record<string, unknown>>(req.clone());
    if (!body.ok) return jsonError(body.error, body.status);

    const created = createCharacterCompletionJob(owner.ownerKey, body.value);
    if (!created.ok) return jsonError(created.error, created.status);

    return NextResponse.json(
      {
        ok: true,
        job: created.job,
        reused: created.reused,
      },
      { status: created.reused ? 200 : 202, headers: withNoStore() },
    );
  } catch (error) {
    return sessionErrorResponse(error) || jsonError("Could not queue character completion job.", 500);
  }
}

export async function GET(req: NextRequest) {
  try {
    const owner = await getOwnerContext(req);
    const characterId = String(req.nextUrl.searchParams.get("characterId") || "").trim();
    const jobs = listCharacterCompletionJobs(owner.ownerKey, characterId);
    return NextResponse.json({ ok: true, jobs }, { headers: withNoStore() });
  } catch (error) {
    return sessionErrorResponse(error) || jsonError("Could not list character completion jobs.", 500);
  }
}
