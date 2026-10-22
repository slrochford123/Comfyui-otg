import fs from "node:fs";

import { NextRequest, NextResponse } from "next/server";

import { findUsableTrainedVoiceArtifact } from "@/lib/characterVoiceAudioStudio";
import { listCharacters } from "@/lib/characters/store";
import { getOwnerContext, SessionInvalidError } from "@/lib/ownerKey";
import { loadVoicesLibrary, resolveVoicesFile } from "@/lib/voicesStudio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function hasReadableFile(filePath: unknown) {
  const clean = String(filePath || "").trim();
  if (!clean) return false;
  try {
    return fs.existsSync(clean) && fs.statSync(clean).isFile() && fs.statSync(clean).size > 0;
  } catch {
    return false;
  }
}

export async function GET(req: NextRequest) {
  try {
    const owner = await getOwnerContext(req);
    const characters = listCharacters(owner.ownerKey);
    const characterItems = characters
      .map((character) => {
        const artifact = findUsableTrainedVoiceArtifact(character.characterVoiceProfile);
        const modelPath = String(artifact?.modelPath || "").trim();
        const indexPath = String(artifact?.indexPath || "").trim();
        if (!artifact || !hasReadableFile(modelPath) || !hasReadableFile(indexPath)) return null;

        const samplePath = String(
          artifact.approvedSamplePath ||
            character.characterVoiceProfile?.approvedSamplePath ||
            character.referenceAudioPath ||
            "",
        ).trim();

        return {
          id: `character:${character.id}:${artifact.id}`,
          name: `${character.name} - Trained Character Voice`,
          engine: "character",
          provider: "applio",
          characterId: character.id,
          characterName: character.name,
          voiceModelId: artifact.id,
          path: modelPath,
          modelPath,
          indexPath,
          samplePath: hasReadableFile(samplePath) ? samplePath : "",
          displayPath: artifact.id,
          usable: true,
          notes: "Real trained Applio character voice model. Use Preserve Performance to keep timing and emotion from the video dialogue.",
          updatedAt: artifact.updatedAt || character.updatedAt,
        };
      })
      .filter(Boolean);

    const referenceItems = loadVoicesLibrary(owner.ownerKey).voices
      .map((voice) => {
        const samplePath = resolveVoicesFile(voice.refAudioRel);
        if (!hasReadableFile(samplePath)) return null;
        return {
          id: `library:${voice.voiceId}`,
          name: voice.name,
          engine: "reference",
          provider: "voice-library",
          voiceId: voice.voiceId,
          path: samplePath,
          samplePath,
          displayPath: voice.refAudioRel,
          refText: voice.refText,
          tags: voice.tags,
          type: voice.type,
          usable: true,
          notes: "Saved voice-library reference sample. Seed-VC preserves the source performance while changing voice character.",
          createdAt: voice.createdAt,
          updatedAt: voice.updatedAt,
        };
      })
      .filter(Boolean);

    const items = [...referenceItems, ...characterItems];

    return NextResponse.json({ ok: true, items }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error: any) {
    if (error instanceof SessionInvalidError) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json(
      { ok: false, error: error?.message || "Voice model scan failed." },
      { status: 500, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
