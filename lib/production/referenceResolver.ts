import {
  productionV2H3VoiceBindings,
  type ProductionV2EntityImage,
  type ProductionV2ReferencePlan,
  type ProductionV2Scene,
  type ProductionV2VisualReference,
} from "@/lib/production/v2";

export const H3_REFERENCE_RESOLVER_VERSION = "h3-reference-manifest-v1";
export const H3_MAX_IMAGE_REFERENCES = 9;

function clean(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function imagePath(image: ProductionV2EntityImage) {
  return clean(image.workflowImage || image.displayImage);
}

function visualReference(
  sourceKind: "character" | "background" | "asset",
  sourceId: string,
  name: string,
  image: ProductionV2EntityImage,
  identityDescription: string,
  slot: number,
): ProductionV2VisualReference {
  const workflowImage = imagePath(image);
  if (!workflowImage) throw new Error(`${name} does not have a usable canonical ${sourceKind} reference image.`);
  if (slot < 1 || slot > H3_MAX_IMAGE_REFERENCES) throw new Error(`MiniMax H3 Reference-to-Video supports at most ${H3_MAX_IMAGE_REFERENCES} image references.`);
  return {
    id: `${sourceKind}:${sourceId}:canonical`,
    name,
    sourceKind,
    generationSourceType: sourceKind === "character" ? "character-card" : sourceKind === "background" ? "background-master" : "asset-default",
    sourceId,
    pictureSlot: slot as ProductionV2VisualReference["pictureSlot"],
    subjectSlot: slot as ProductionV2VisualReference["subjectSlot"],
    identityDescription: clean(identityDescription),
    displayImage: clean(image.displayImage) || workflowImage,
    workflowImage,
  };
}

export function resolveProductionV2H3ReferencePlan(scene: ProductionV2Scene): ProductionV2Scene {
  if (scene.generationMode !== "h3-reference-to-video") return scene;
  const candidates = [
    ...scene.selectedCharacters.map((character) => ({
      kind: "character" as const,
      id: character.characterId,
      name: character.snapshotName,
      image: character.characterCardRef,
      description: character.identityDescription,
    })),
    ...(scene.selectedBackground ? [{
      kind: "background" as const,
      id: scene.selectedBackground.backgroundId,
      name: scene.selectedBackground.snapshotName,
      image: scene.selectedBackground.masterImageRef,
      description: scene.selectedBackground.identityDescription,
    }] : []),
    ...scene.selectedAssets.map((asset) => ({
      kind: "asset" as const,
      id: asset.assetId,
      name: asset.snapshotName,
      image: asset.defaultImageRef,
      description: asset.identityDescription,
    })),
  ];
  if (!candidates.length) throw new Error("Select at least one Character, Background, or Asset reference for H3 Reference-to-Video.");
  if (candidates.length > H3_MAX_IMAGE_REFERENCES) {
    throw new Error(`The selected entities require ${candidates.length} image references; MiniMax H3 accepts at most ${H3_MAX_IMAGE_REFERENCES}. No entity was dropped.`);
  }
  const modelFacingReferences = candidates.map((item, index) => visualReference(
    item.kind,
    item.id,
    item.name,
    item.image,
    item.description,
    index + 1,
  ));
  const plan: ProductionV2ReferencePlan = {
    status: "planned",
    userSelectedEntityIds: {
      characterIds: scene.selectedCharacters.map((item) => item.characterId),
      backgroundId: scene.selectedBackground?.backgroundId || null,
      assetIds: scene.selectedAssets.map((item) => item.assetId),
    },
    modelFacingReferences,
    resolvedVoiceReferences: [],
    budgeterVersion: H3_REFERENCE_RESOLVER_VERSION,
  };
  const sceneWithVisuals = { ...scene, referencePlan: plan };
  const resolvedVoiceReferences = productionV2H3VoiceBindings(sceneWithVisuals);
  return {
    ...sceneWithVisuals,
    referencePlan: { ...plan, resolvedVoiceReferences },
    modelState: {
      ...scene.modelState,
      h3: { ...scene.modelState.h3, referenceToVideo: { resolvedVoiceBindings: resolvedVoiceReferences } },
    },
  };
}

function referenceDefinition(reference: ProductionV2VisualReference) {
  const subject = `<Subject ${reference.subjectSlot}>`;
  const picture = `<Picture ${reference.pictureSlot}>`;
  const identity = clean(reference.identityDescription);
  if (reference.sourceKind === "character") {
    return `${subject} is ${reference.name}, the Character represented by ${picture}. Preserve ${reference.name}'s identity and every visible identity-critical characteristic from the supplied Character reference.${identity ? ` Canonical Character metadata: ${identity}` : ""}`;
  }
  if (reference.sourceKind === "background") {
    return `${subject} is ${reference.name}, the Background represented by ${picture}. Preserve the established environment geography and every visible continuity-critical characteristic from the supplied Background reference.${identity ? ` Canonical Background metadata: ${identity}` : ""}`;
  }
  return `${subject} is ${reference.name}, the Asset represented by ${picture}. Preserve the Asset's shape, proportions, materials, colors, and every visible continuity-critical characteristic from the supplied Asset reference.${identity ? ` Canonical Asset metadata: ${identity}` : ""}`;
}

export function buildProductionV2LockedReferenceContext(scene: ProductionV2Scene) {
  if (scene.generationMode !== "h3-reference-to-video") return "";
  if (scene.referencePlan.status !== "planned" || !scene.referencePlan.modelFacingReferences.length) {
    throw new Error("Resolve the ordered H3 reference manifest before building locked reference context.");
  }
  scene.referencePlan.modelFacingReferences.forEach((reference, index) => {
    const expected = index + 1;
    if (reference.pictureSlot !== expected || reference.subjectSlot !== expected) {
      throw new Error("H3 Picture and Subject labels must match the exact ordered reference manifest.");
    }
  });
  const voiceLines = scene.referencePlan.resolvedVoiceReferences.map((binding) =>
    `<Audio ${binding.audioSlot}> is the saved voice-timbre reference for <Subject ${binding.subjectSlot}> (S${binding.speakerId}).`,
  );
  return [
    "subject_definitions:",
    ...scene.referencePlan.modelFacingReferences.map(referenceDefinition),
    ...voiceLines,
  ].join("\n\n");
}
