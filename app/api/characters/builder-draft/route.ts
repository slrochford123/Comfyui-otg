import { NextRequest, NextResponse } from "next/server";
import { clearDraft, readDraft, sanitizeOwnerId, writeDraft } from "../../../../lib/characters/characterBuilderPersistence";

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

export async function GET(request: NextRequest) {
  const ownerId = ownerFromRequest(request);
  const draft = await readDraft(ownerId);
  return NextResponse.json({ ok: true, draft });
}

export async function PUT(request: NextRequest) {
  const ownerId = ownerFromRequest(request);
  const body = await request.json().catch(() => ({}));

  const draft = await writeDraft(ownerId, {
    mode: body.mode,
    characterId: body.characterId,
    currentStage: body.currentStage,
    state: body.state || {},
  });

  return NextResponse.json({ ok: true, draft });
}

export async function DELETE(request: NextRequest) {
  const ownerId = ownerFromRequest(request);
  await clearDraft(ownerId);
  return NextResponse.json({ ok: true });
}
