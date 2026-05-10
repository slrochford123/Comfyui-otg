import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getOwnerContext, SessionInvalidError } from "@/lib/ownerKey";
import { createCharacter, deleteCharacter, listCharacters, loadCharacter } from "@/lib/characters/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { ownerKey } = await getOwnerContext(req);
    const id = String(req.nextUrl.searchParams.get("id") || "").trim();
    if (id) {
      const record = loadCharacter(ownerKey, id);
      if (!record) {
        return NextResponse.json({ ok: false, error: "Character not found" }, { status: 404 });
      }
      return NextResponse.json({ ok: true, character: record });
    }
    return NextResponse.json({ ok: true, items: listCharacters(ownerKey) });
  } catch (e: any) {
    if (e instanceof SessionInvalidError) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ ok: false, error: e?.message || "Characters request failed" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { ownerKey } = await getOwnerContext(req);
    const body = (await req.json().catch(() => null)) as any;
    const action = String(body?.action || "create").trim().toLowerCase();

    if (action === "delete") {
      const id = String(body?.id || "").trim();
      if (!id) {
        return NextResponse.json({ ok: false, error: "Character id is required" }, { status: 400 });
      }
      const result = deleteCharacter(ownerKey, id);
      return NextResponse.json({ ok: true, ...result, items: listCharacters(ownerKey) });
    }

    if (action !== "create") {
      return NextResponse.json({ ok: false, error: `Unsupported action: ${action}` }, { status: 400 });
    }

    const created = createCharacter(ownerKey, {
      id: body?.id,
      name: body?.name,
      imagePath: body?.imagePath,
      previewImagePath: body?.previewImagePath,
      transparentImagePath: body?.transparentImagePath,
      description: body?.description,
      voiceStyleDefinition: body?.voiceStyleDefinition,
      introLine: body?.introLine,
      introVideoPath: body?.introVideoPath,
      referenceAudioPath: body?.referenceAudioPath,
      source: body?.source,
    });
    return NextResponse.json({ ok: true, character: created, items: listCharacters(ownerKey) }, { status: 201 });
  } catch (e: any) {
    if (e instanceof SessionInvalidError) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ ok: false, error: e?.message || "Characters write failed" }, { status: 500 });
  }
}
