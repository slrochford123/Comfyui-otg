import type { NextRequest } from "next/server";
import { loadCharacter } from "@/lib/characters/store";
import { h3CardImages, type H3CardReference } from "@/lib/h3CardReferences";
import type { H3DirectReference } from "@/lib/h3DirectJobs";
import { compileH3CharacterVoices, type H3CastBinding, type H3CharacterVoicePlan } from "@/lib/h3CharacterVoices";
import type { H3SmartReferenceInput } from "@/lib/h3SmartReferences";
import { productionAudioMediaReadable } from "@/lib/productionAudioAccess";
import { resolveProductionV2MediaPath } from "@/lib/production/h3Comfy";
import { studioFileSha256 } from "@/lib/h3StudioMedia";
import { resolveSavedH3CorrectionVoice } from "@/lib/h3CharacterVoicesServer";

export async function bindH3CardImages(request: NextRequest, owner: string, images: H3DirectReference[], input: unknown) {
  if (input === undefined) return;
  if (!Array.isArray(input) || input.length !== images.length) throw Error("The Character Card selections no longer match the Reference Deck.");
  await Promise.all(input.map(async (raw: unknown, index) => {
    if (raw === null) return;
    if (!raw || typeof raw !== "object") throw Error("Invalid Character Card reference.");
    const {characterId,imageId,version} = raw as H3CardReference;
    if (![characterId,imageId,version].every(value => typeof value === "string" && value.length > 0 && value.length <= 120)) throw Error("Invalid Character Card reference.");
    const card = loadCharacter(owner, characterId);
    if (!card || card.updatedAt !== version) throw Error("A selected Character Card changed. Reopen Choose Character to use its current approved image.");
    const asset = h3CardImages(card).find(image => image.id === imageId);
    const file = asset && resolveProductionV2MediaPath(asset.path);
    if (!file || !await productionAudioMediaReadable(request,file) || await studioFileSha256(file) !== images[index].originalSha256) {
      throw Error("The selected image no longer matches its approved Character Card asset.");
    }
    images[index].characterRef = {characterId,imageId,version};
    images[index].characterKey = characterId;
    images[index].characterName = card.name;
  }));
}

export async function h3DeckVoicePlan(request: NextRequest, owner: string, smart: H3SmartReferenceInput | undefined,
  prompt: string, duration: 5 | 10): Promise<H3CharacterVoicePlan | undefined> {
  if (!smart) return;
  const references = smart.referenceMap;
  const ids = [...new Set(references.flatMap(ref => ref.kind !== "audio" && ref.characterKey ? [ref.characterKey] : []))];
  if (!ids.length) return;
  const bindings: H3CastBinding[] = [];
  const voiceTargets: H3CharacterVoicePlan["voiceTargets"] = [];
  const subjects = [...new Set(references.filter(ref => ref.kind !== "audio").map(ref => ref.characterKey || ref.tag))];
  for (const id of ids) {
    const card = loadCharacter(owner,id);
    if (!card) continue;
    const target = await resolveSavedH3CorrectionVoice(request,owner,id);
    if (target) voiceTargets.push(target);
    bindings.push({characterId:id,name:card.name,subject:`<Subject ${subjects.indexOf(id)+1}>`,
      visual:references.filter(ref => ref.characterKey===id && ref.kind!=="audio").map(ref=>ref.tag),audio:[],
      ...(target ? {voiceId:target.modelId,voiceName:target.sample.name} : {})});
  }
  let events: H3CharacterVoicePlan["events"] = [];
  try {
    events = compileH3CharacterVoices({prompt,cast:bindings,references,mode:"h3-reference-to-video",
      durationSeconds:duration,firstImage:!!smart.firstFrame,lastImage:false,dialogueOnly:true}).events;
  } catch {
    // The creative prompt is left intact. An ambiguous cast requires manual speaker confirmation.
  }
  return {recipe:"native",bindings,events,references,refMods:smart.refMods,voiceTargets,inputHashes:{}};
}
