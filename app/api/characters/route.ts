import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getOwnerContext, SessionInvalidError } from "@/lib/ownerKey";
import { createCharacter, deleteCharacter, listCharacters, loadCharacter, updateCharacterVoiceProfile } from "@/lib/characters/store";
import { recoverLatestTrainedApplioVoiceProfile } from "@/lib/jobs/applioArtifactRecovery";

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
    const body = (await req.clone().json().catch(() => null)) as any;
    const { ownerKey } = await getOwnerContext(req);
    const action = String(body?.action || "create").trim().toLowerCase();

    if (action === "delete") {
      const id = String(body?.id || "").trim();
      if (!id) {
        return NextResponse.json({ ok: false, error: "Character id is required" }, { status: 400 });
      }
      const result = deleteCharacter(ownerKey, id);
      return NextResponse.json({ ok: true, ...result, items: listCharacters(ownerKey) });
    }

    if (action === "update_voice_profile") {
      const id = String(body?.id || "").trim();
      const characterVoiceProfile = body?.characterVoiceProfile;
      if (!id) {
        return NextResponse.json({ ok: false, error: "Character id is required" }, { status: 400 });
      }
      if (!characterVoiceProfile || typeof characterVoiceProfile !== "object" || Array.isArray(characterVoiceProfile)) {
        return NextResponse.json({ ok: false, error: "characterVoiceProfile object is required" }, { status: 400 });
      }
      const updated = updateCharacterVoiceProfile(ownerKey, id, characterVoiceProfile);
      if (!updated) {
        return NextResponse.json({ ok: false, error: "Character not found" }, { status: 404 });
      }
      return NextResponse.json({ ok: true, character: updated, items: listCharacters(ownerKey) });
    }

    if (action === "recover_applio_voice_profile") {
      const id = String(body?.id || "").trim();
      const builderProfile = body?.characterVoiceProfile;
      if (!id) {
        return NextResponse.json({ ok: false, error: "Character id is required" }, { status: 400 });
      }
      const saved = loadCharacter(ownerKey, id);
      const recovered = recoverLatestTrainedApplioVoiceProfile({
        ownerKey,
        characterId: id,
        savedProfile: saved?.characterVoiceProfile || null,
        builderProfile:
          builderProfile && typeof builderProfile === "object" && !Array.isArray(builderProfile)
            ? builderProfile
            : null,
      });
      if (!recovered) {
        return NextResponse.json(
          { ok: false, error: "No valid trained Applio voice model artifact found." },
          { status: 404 },
        );
      }

      const updated = saved ? updateCharacterVoiceProfile(ownerKey, id, recovered.profile) : null;
      return NextResponse.json({
        ok: true,
        recovered: true,
        source: recovered.source,
        message: recovered.message,
        character: updated || saved || null,
        characterVoiceProfile: recovered.profile,
        items: listCharacters(ownerKey),
      });
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
      originalSourceImagePath: body?.originalSourceImagePath,
      fullBodyImagePath: body?.fullBodyImagePath,
      characterCardPath: body?.characterCardPath,
      description: body?.description,
      voiceStyleDefinition: body?.voiceStyleDefinition,
      introLine: body?.introLine,
      introVideoPath: body?.introVideoPath,
      referenceAudioPath: body?.referenceAudioPath,
      source: body?.source,
      metadata: body?.metadata,
      voiceSettings: body?.voiceSettings,
      characterVoiceProfile: body?.characterVoiceProfile,
      voiceModelArtifacts: body?.voiceModelArtifacts,
      voicePackPaths: body?.voicePackPaths,
      voiceEngineUsed: body?.voiceEngineUsed,
      voicePromptPresetMetadata: body?.voicePromptPresetMetadata,
      yellingPresetMetadata: body?.yellingPresetMetadata,
      globalPromptIdentityBlock: body?.globalPromptIdentityBlock,
    });
    return NextResponse.json({ ok: true, character: created, items: listCharacters(ownerKey) }, { status: 201 });
  } catch (e: any) {
    if (e instanceof SessionInvalidError) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ ok: false, error: e?.message || "Characters write failed" }, { status: 500 });
  }
}
