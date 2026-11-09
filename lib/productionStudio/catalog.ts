import fs from "node:fs";
import { listCharacters } from "@/lib/characters/store";
import { listBackgrounds } from "@/lib/backgrounds/store";
import { listAssets } from "@/lib/assets/store";
import {
  characterRefVoiceChoices,
  resolveCharacterRefVoice,
} from "@/lib/h3SpecialModes/characterRefVoice";
import {
  readH3RefModSidecar,
  writeH3RefModSidecar,
} from "@/lib/h3SpecialModes/refModCreation";
import { canUseCharacterRefMod } from "@/lib/h3SpecialModes/characterRefCardAccess";
import { resolveProductionV2MediaPath } from "@/lib/production/h3Comfy";
import { snapshotFile, probe } from "./media";
import { StudioError, type StudioStore } from "./store";
import { assertOwnerMediaFile } from "@/lib/ownerMediaAccess";
import { listSessions, readSession, assetFile } from "@/lib/audioEditing/store";
import { productionRefModLocation } from "./pinnedRefMods";
export function catalog(owner: string) {
  return {
    characters: listCharacters(owner).map((c) => ({
      id: c.id,
      name: c.name,
      hasVoice: !!c.referenceAudioPath,
      hasRefMod: !!c.metadata?.refModLibraryName,
    })),
    locations: listBackgrounds(owner).map((c) => ({ id: c.id, name: c.name })),
    props: listAssets(owner).map((c) => ({ id: c.id, name: c.name })),
    voices: characterRefVoiceChoices(owner),
    audio: listSessions(owner).flatMap((session) =>
      readSession(owner, session.id)
        .assets.filter((a) => a.kind === "audio")
        .map((a) => ({
          id: `${session.id}:${a.id}`,
          name: `${session.title} · ${a.name}`,
        })),
    ),
  };
}
function local(source: string | undefined, owner: string) {
  if (!source) throw new StudioError("This asset has no saved source file.");
  const file = resolveProductionV2MediaPath(source);
  if (!file || !fs.existsSync(file))
    throw new StudioError(
      "The original source is unavailable on this host. Upload a local copy to pin it.",
      422,
    );
  assertOwnerMediaFile(file, owner);
  return file;
}
export async function importCatalogAsset(
  s: StudioStore,
  owner: string,
  project: string,
  kind: string,
  id: string,
) {
  s.get(owner, project);
  if (kind === "audio") {
    const [sessionId, assetId] = id.split(":"),
      session = readSession(owner, sessionId),
      a = session.assets.find((a) => a.id === assetId);
    if (!a || a.kind !== "audio")
      throw new StudioError("Audio asset not found.", 404);
    return snapshotFile(
      s,
      owner,
      project,
      assetFile(owner, session, assetId),
      a.name,
      "audio",
      {
        sourceId: id,
        purpose: a.suggestedLane || "soundtrack",
        duration: a.duration,
      },
    );
  }
  if (kind === "voice") {
    const v = resolveCharacterRefVoice(owner, id),
      p = await probe(v.path);
    return snapshotFile(s, owner, project, v.path, v.name + ".wav", "audio", {
      sourceId: id,
      purpose: "voice-reference",
      duration: Number(p.format.duration) || 0,
    });
  }
  if (kind === "character") {
    const c = listCharacters(owner).find((c) => c.id === id);
    if (!c) throw new StudioError("Character not found.", 404);
    const images = [
      c.defaultCharacterImagePath || c.fullBodyImagePath || c.imagePath,
      ...(Array.isArray(c.metadata?.productionReferencePaths) ? c.metadata.productionReferencePaths.map(String) : []),
      ...(Array.isArray(c.metadata?.refModViews) ? c.metadata.refModViews.map(v => String((v as {path?:string}).path || "")).filter(Boolean) : []),
      ...Object.values(c.characterReferences?.body || {}).map(
        (v) => v?.serverPath,
      ),
    ].filter(Boolean) as string[];
    const imageIds: string[] = [];
    for (const image of [...new Set(images)]) {
      const a = await snapshotFile(
        s,
        owner,
        project,
        local(image, owner),
        c.name,
        "image",
        { sourceCharacterId: c.id },
      );
      imageIds.push(a.id);
    }
    let voiceId: string | undefined;
    if (c.referenceAudioPath) {
      const source = local(c.referenceAudioPath, owner),
        info = await probe(source);
      const a = await snapshotFile(
        s,
        owner,
        project,
        source,
        c.name + " voice",
        "audio",
        {
          purpose: "voice-reference",
          refText: c.introLine || "",
          duration: Number(info.format.duration) || 0,
        },
      );
      voiceId = a.id;
    }
    let bundleId: string | undefined, refModName: string | undefined;
    const name = String(c.metadata?.refModLibraryName || "");
    if (name) {
      if (!canUseCharacterRefMod(owner, name))
        throw new StudioError("Character RefMod unavailable.", 403);
      const sidecar = readH3RefModSidecar(name);
      if (
        sidecar?.ownerKey !== owner ||
        !sidecar.savedPath ||
        !fs.existsSync(sidecar.savedPath)
      )
        throw new StudioError(
          "The RefMod bundle is not readable on this host. Its character card alone is not a replacement for the bundle.",
          422,
        );
      const { pinnedName, workerFile } = productionRefModLocation(name, sidecar.savedPath, project);
      const a = await snapshotFile(
        s,
        owner,
        project,
        sidecar.savedPath,
        c.name + " RefMod",
        "refmod",
        {
          libraryName: pinnedName,
          backend: c.metadata?.refModBackend,
          characterId: c.id,
          imageIds,
        },
      );
      // Additive identity bundle, never overwrite an installed model or original RefMod.
      await fs.promises.copyFile(
        s.asset(owner, project, a.id).path,
        workerFile,
        fs.constants.COPYFILE_EXCL,
      );
      let voice = sidecar.voice;
      if (voice) {
        const info = await probe(voice.path);
        const pinned = await snapshotFile(
          s,
          owner,
          project,
          voice.path,
          c.name + " approved voice.wav",
          "audio",
          {
            purpose: "voice-reference",
            refText: c.introLine || "",
            duration: Number(info.format.duration) || 0,
          },
        );
        voiceId = pinned.id;
        voice = {
          ...voice,
          path: s.asset(owner, project, pinned.id).path,
          originalPath: s.asset(owner, project, pinned.id).path,
          sha256: pinned.sha256,
        };
      }
      writeH3RefModSidecar({
        ...sidecar,
        libraryName: pinnedName,
        name: `${c.name} · Production ${project.slice(0, 8)}`,
        savedPath: workerFile,
        voice,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      bundleId = a.id;
      refModName = pinnedName;
    }
    if (!imageIds.length)
      throw new StudioError("Character has no saved image.");
    return snapshotFile(
      s,
      owner,
      project,
      s.asset(owner, project, imageIds[0]).path,
      c.name,
      "character",
      {
        sourceId: id,
        description: c.description,
        imageIds,
        voiceId,
        bundleId,
        refModName,
        sourceVersion: c.updatedAt,
      },
    );
  }
  if (kind === "location") {
    const c = listBackgrounds(owner).find((c) => c.id === id);
    if (!c) throw new StudioError("Location not found.", 404);
    return snapshotFile(
      s,
      owner,
      project,
      local(
        c.establishingImage?.workflowImage || c.workflowImage || c.imagePath,
        owner,
      ),
      c.name,
      "image",
      { sourceId: id, purpose: "location", description: c.masterPrompt },
    );
  }
  if (kind === "prop") {
    const c = listAssets(owner).find((c) => c.id === id);
    if (!c) throw new StudioError("Asset not found.", 404);
    return snapshotFile(
      s,
      owner,
      project,
      local(c.defaultImage.workflowImage, owner),
      c.name,
      "image",
      { sourceId: id, purpose: "prop", description: c.description },
    );
  }
  throw new StudioError("Choose a supported library.");
}
