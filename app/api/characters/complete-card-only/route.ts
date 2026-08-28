import { NextRequest, NextResponse } from "next/server";
import { completeCharacterCardOnly, sanitizeOwnerId } from "../../../../lib/characters/characterBuilderPersistence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function ownerFromRequest(request: NextRequest): string {
  return sanitizeOwnerId(
    request.nextUrl.searchParams.get("ownerId") ||
      process.env.OTG_DEFAULT_OWNER_ID ||
      process.env.OTG_OWNER_ID ||
      "slrochford12300"
  );
}

export async function POST(request: NextRequest) {
  const ownerId = ownerFromRequest(request);
  const body = await request.json().catch(() => ({}));
  const state = body.state && typeof body.state === "object" ? body.state : body;

  const character = await completeCharacterCardOnly(ownerId, state);

  return NextResponse.json({
    ok: true,
    character,
  });
}
