import fs from "node:fs";

import { NextRequest, NextResponse } from "next/server";

import { findUsableTrainedVoiceArtifact } from "@/lib/characterVoiceAudioStudio";
import { listCharacters } from "@/lib/characters/store";
import { getOwnerContext, SessionInvalidError } from "@/lib/ownerKey";

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
    const items = characters
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
