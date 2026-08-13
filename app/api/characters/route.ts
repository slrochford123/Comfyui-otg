import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getOwnerContext, SessionInvalidError } from "@/lib/ownerKey";
import { createCharacter, deleteCharacter, listCharacters, loadCharacter, updateCharacterVoiceProfile, updateCharacterVoiceSelection } from "@/lib/characters/store";
import { recoverLatestTrainedApplioVoiceProfile } from "@/lib/jobs/applioArtifactRecovery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function cleanOwnerKey(value: unknown): string {
  return String(value || "").trim();
}

function hasExplicitCharacterOwner(req: NextRequest): boolean {
  const sp = req.nextUrl.searchParams;
  return !!(
    sp.get("deviceId") ||
    sp.get("device_id") ||
    sp.get("ownerId") ||
    sp.get("owner") ||
    sp.get("userId") ||
    sp.get("user_id") ||
    req.headers.get("x-otg-device-id") ||
    req.headers.get("x-device-id") ||
    req.headers.get("x-deviceid")
  );
}

function characterOwnerFallbackKeys(primaryOwnerKey: string): string[] {
  const key = cleanOwnerKey(primaryOwnerKey);
  return key ? [key] : [];
}
function listCharactersWithFallback(primaryOwnerKey: string): ReturnType<typeof listCharacters> {
  for (const ownerKey of characterOwnerFallbackKeys(primaryOwnerKey)) {
    const items = listCharacters(ownerKey);
    if (items.length > 0) return items;
  }
  return [];
}

function loadCharacterWithFallback(primaryOwnerKey: string, id: string): ReturnType<typeof loadCharacter> {
  for (const ownerKey of characterOwnerFallbackKeys(primaryOwnerKey)) {
    const record = loadCharacter(ownerKey, id);
    if (record) return record;
  }
  return null;
}

export async function GET(req: NextRequest) {
  try {
    const { ownerKey } = await getOwnerContext(req);
    const id = String(req.nextUrl.searchParams.get("id") || "").trim();
    const explicitOwner = hasExplicitCharacterOwner(req);

    if (id) {
      const record = explicitOwner ? loadCharacter(ownerKey, id) : loadCharacterWithFallback(ownerKey, id);
      if (!record) {
        return NextResponse.json({ ok: false, error: "Character not found" }, { status: 404 });
      }
      return NextResponse.json({ ok: true, character: record });
    }

    const items = explicitOwner ? listCharacters(ownerKey) : listCharactersWithFallback(ownerKey);
    return NextResponse.json({ ok: true, items });
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

    if (action === "update_voice_selection") {
      const id = String(body?.id || "").trim();
      const referenceAudioPath = String(body?.referenceAudioPath || "").trim();
      if (!id) {
        return NextResponse.json({ ok: false, error: "Character id is required" }, { status: 400 });
      }
      if (!referenceAudioPath) {
        return NextResponse.json({ ok: false, error: "referenceAudioPath is required" }, { status: 400 });
      }

      const updated = updateCharacterVoiceSelection(ownerKey, id, {
        referenceAudioPath,
        voiceSettings:
          body?.voiceSettings && typeof body.voiceSettings === "object" && !Array.isArray(body.voiceSettings)
            ? body.voiceSettings
            : undefined,
        voiceEngineUsed: body?.voiceEngineUsed,
        voiceStyleDefinition: body?.voiceStyleDefinition,
        metadata:
          body?.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)
            ? body.metadata
            : undefined,
      });

      if (!updated) {
        return NextResponse.json({ ok: false, error: "Character not found" }, { status: 404 });
      }
      return NextResponse.json({ ok: true, character: updated, items: listCharacters(ownerKey) });
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
      characterCardWorkflowImagePath: body?.characterCardWorkflowImagePath,
      characterCardPreviewImagePath: body?.characterCardPreviewImagePath,
      defaultCharacterImagePath: body?.defaultCharacterImagePath,
      defaultCharacterPreviewImagePath: body?.defaultCharacterPreviewImagePath,
      defaultCharacterSourceImagePath: body?.defaultCharacterSourceImagePath,
      backgroundRemovedDefaultImagePath: body?.backgroundRemovedDefaultImagePath,
      defaultCharacterImageStatus: body?.defaultCharacterImageStatus,
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
