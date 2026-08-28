import type { AssetRecord } from "@/lib/assets/store";
import type { BackgroundRecordV36B } from "@/lib/backgrounds/store";
import type { CharacterRecord, CharacterReferenceAsset } from "@/lib/characters/store";
import type {
  ProductionV2CatalogAsset,
  ProductionV2CatalogBackground,
  ProductionV2CatalogCharacter,
  ProductionV2CatalogPerspective,
  ProductionV2EntityImage,
} from "@/lib/production/v2";

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function image(displayImage: unknown, workflowImage: unknown): ProductionV2EntityImage {
  const display = clean(displayImage || workflowImage);
  const workflow = clean(workflowImage || displayImage);
  return { displayImage: display || undefined, workflowImage: workflow || undefined };
}

function characterPerspective(key: string, label: string, asset?: CharacterReferenceAsset): ProductionV2CatalogPerspective | null {
  if (!asset) return null;
  const reference = image(asset.url || asset.serverPath, asset.serverPath || asset.url);
  if (!reference.displayImage && !reference.workflowImage) return null;
  return { key, label, ...reference };
}

export function characterToProductionV2Catalog(record: CharacterRecord): ProductionV2CatalogCharacter {
  const defaultImage = image(
    record.defaultCharacterPreviewImagePath
      || record.defaultCharacterImagePath
      || record.backgroundRemovedDefaultImagePath
      || record.previewImagePath
      || record.fullBodyImagePath
      || record.imagePath,
    record.defaultCharacterImagePath
      || record.backgroundRemovedDefaultImagePath
      || record.defaultCharacterSourceImagePath
      || record.fullBodyImagePath
      || record.imagePath,
  );
  const characterCard = image(
    record.characterCardPreviewImagePath
      || record.characterReferences?.characterCard?.url
      || record.characterReferences?.characterCard?.serverPath
      || record.characterCardPath
      || record.characterCardWorkflowImagePath,
    record.characterCardWorkflowImagePath
      || record.characterReferences?.characterCard?.serverPath
      || record.characterCardPath,
  );
  const body = record.characterReferences?.body;
  const perspectives = [
    characterPerspective("front", "Front", body?.front),
    characterPerspective("left-profile", "Left", body?.leftProfile),
    characterPerspective("right-profile", "Right", body?.rightProfile),
    characterPerspective("back", "Back", body?.back),
  ].filter(Boolean) as ProductionV2CatalogPerspective[];
  return {
    id: record.id,
    name: record.name,
    updatedAt: record.updatedAt,
    defaultImage,
    characterCard,
    identityDescription: clean(record.globalPromptIdentityBlock || record.description),
    perspectives,
    voiceRef: record.referenceAudioPath ? {
      sourcePath: record.referenceAudioPath,
      engine: clean(record.voiceEngineUsed) || undefined,
      status: clean(record.voiceStatus) || undefined,
    } : undefined,
  };
}

const BACKGROUND_PERSPECTIVES = [
  ["front", "Front"],
  ["back", "Back"],
  ["left90", "Left"],
  ["right90", "Right"],
  ["up", "Up"],
  ["down", "Down"],
] as const;

export function backgroundToProductionV2Catalog(record: BackgroundRecordV36B): ProductionV2CatalogBackground {
  const masterImage = image(
    record.establishingImage?.displayImage || record.displayImage || record.imageUrl || record.imagePath,
    record.establishingImage?.workflowImage || record.workflowImage || record.imagePath || record.imageUrl,
  );
  const perspectives = BACKGROUND_PERSPECTIVES.map(([key, label]) => {
    const asset = record.angleImages?.[key];
    if (!asset) return null;
    const reference = image(asset.displayImage, asset.workflowImage);
    return reference.displayImage || reference.workflowImage ? { key, label, ...reference } : null;
  }).filter(Boolean) as ProductionV2CatalogPerspective[];
  const identityDescription = [
    clean(record.continuityBlock),
    clean(record.masterPrompt),
    record.doNotChange?.length ? `Do not change: ${record.doNotChange.map(clean).filter(Boolean).join(", ")}.` : "",
  ].filter(Boolean).join(" ");
  return { id: record.id, name: record.name, updatedAt: record.updatedAt, masterImage, identityDescription, perspectives };
}

function perspectiveLabel(key: string) {
  return key
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function assetToProductionV2Catalog(record: AssetRecord): ProductionV2CatalogAsset {
  return {
    id: record.id,
    name: record.name,
    updatedAt: record.updatedAt,
    defaultImage: image(record.defaultImage.displayImage, record.defaultImage.workflowImage),
    identityDescription: clean(record.description),
    perspectives: Object.entries(record.perspectives || {}).map(([key, value]) => ({
      key,
      label: perspectiveLabel(key),
      ...image(value.displayImage, value.workflowImage),
    })),
  };
}
