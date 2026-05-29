import { NextRequest, NextResponse } from "next/server";

import { withNoStore, readJsonBody, sessionErrorResponse } from "@/lib/http/routeHelpers";
import { getOwnerContext } from "@/lib/ownerKey";
import {
  listProductionAudioStudioResults,
  saveProductionAudioStudioResult,
} from "@/lib/jobs/productionAudioStudioResults";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status, headers: withNoStore() });
}

export async function GET(req: NextRequest) {
  try {
    const owner = await getOwnerContext(req);
    return NextResponse.json({ ok: true, items: listProductionAudioStudioResults(owner.ownerKey) }, { headers: withNoStore() });
  } catch (error) {
    return sessionErrorResponse(error) || jsonError("Could not load Audio Studio results.", 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await readJsonBody<Record<string, unknown>>(req.clone());
    if (!body.ok) return jsonError(body.error, body.status);

    const owner = await getOwnerContext(req);
    const result = saveProductionAudioStudioResult(owner.ownerKey, {
      clipId: body.value.clipId,
      audioStudioResult: body.value.audioStudioResult,
    });
    if (!result.ok) return jsonError(result.error, result.status);

    return NextResponse.json({ ok: true, item: result.item, items: result.items }, { headers: withNoStore() });
  } catch (error) {
    return sessionErrorResponse(error) || jsonError("Could not save Audio Studio result.", 500);
  }
}
