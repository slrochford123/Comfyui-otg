import {
  LTX_V2_DEFAULT_INGREDIENT_LIMIT,
  productionV2LtxVisualIngredientCount,
  type ProductionV2EntityImage,
  type ProductionV2Scene,
} from "@/lib/production/v2";

export const LTX25_INGREDIENTS_MANIFEST_VERSION =
  "ltx25-ingredients-manifest-v2-character-view" as const;

export const LTX25_INGREDIENTS_MAX_VISUAL_REFERENCES =
  6 as const;

export type Ltx25IngredientSourceKind =
  | "character"
  | "background"
  | "asset";

export type Ltx25IngredientGenerationSourceType =
  | "character-card"
  | "background-master"
  | "background-angle"
  | "asset-default";

export type Ltx25IngredientManifestItem = {
  slot: number;
  positionLabel: string;
  sourceKind: Ltx25IngredientSourceKind;
  generationSourceType:
    Ltx25IngredientGenerationSourceType;
  sourceId: string;
  name: string;
  sourcePath: string;
  identityDescription: string;
  perspectiveKey?: string;
};

export type Ltx25IngredientsManifest = {
  version:
    typeof LTX25_INGREDIENTS_MANIFEST_VERSION;
  model: "ltx-2.5";
  mode: "ltx-ingredients-image-to-video";
  count: number;
  limit: number;
  order: "left-to-right";
  items: Ltx25IngredientManifestItem[];
};

function clean(value: unknown) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function modelFacingImagePath(
  image: ProductionV2EntityImage | null | undefined,
) {
  return clean(
    image?.workflowImage
    || image?.displayImage,
  );
}

export function ltx25IngredientPositionLabels(
  count: number,
) {
  switch (count) {
    case 1:
      return ["full sheet"];

    case 2:
      return [
        "left",
        "right",
      ];

    case 3:
      return [
        "left",
        "center",
        "right",
      ];

    case 4:
      return [
        "far left",
        "center left",
        "center right",
        "far right",
      ];

    case 5:
      return [
        "far left",
        "left center",
        "center",
        "right center",
        "far right",
      ];

    case 6:
      return [
        "leftmost",
        "second from left",
        "third from left",
        "third from right",
        "second from right",
        "rightmost",
      ];

    default:
      throw new Error(
        `LTX 2.5 Ingredients requires 1-${LTX25_INGREDIENTS_MAX_VISUAL_REFERENCES} visual references.`,
      );
  }
}

function configuredLimit(
  scene: ProductionV2Scene,
) {
  const raw = Number(
    scene.modelState.ltx.ingredients
      .visualIngredientLimit,
  );

  if (!Number.isFinite(raw)) {
    return LTX_V2_DEFAULT_INGREDIENT_LIMIT;
  }

  return Math.min(
    LTX25_INGREDIENTS_MAX_VISUAL_REFERENCES,
    Math.max(1, Math.floor(raw)),
  );
}

export function buildLtx25IngredientsManifest(
  scene: ProductionV2Scene,
): Ltx25IngredientsManifest {
  if (scene.model !== "ltx-2.5") {
    throw new Error(
      "LTX 2.5 Ingredients manifest requires an LTX 2.5 Scene.",
    );
  }

  if (
    scene.generationMode
    !== "ltx-ingredients-image-to-video"
  ) {
    throw new Error(
      "LTX 2.5 Ingredients manifest requires Ingredients Image-to-Video mode.",
    );
  }

  const candidates: Array<
    Omit<
      Ltx25IngredientManifestItem,
      "slot" | "positionLabel"
    >
  > = [];

  /*
   * OTG_PRODUCTION_V2_LTX_R13C_MANIFEST_AUTHORITY_V1
   * Canonical ordering:
   *
   * 1. complete saved Character Cards
   * 2. Background Master
   * 3. Asset Defaults
   *
   * Selector/default/directional Character images are UI/legacy data only.
   * Directional Background plates remain available to H3, but LTX
   * Ingredients always receives the Background Master.
   */
  for (const character of scene.selectedCharacters) {
    const image =
      character.characterCardRef;

    const sourcePath =
      modelFacingImagePath(
        image,
      );

    if (!sourcePath) {
      throw new Error(
        `${character.snapshotName} does not have a usable complete saved Character Card for LTX Ingredients. No selector/default/directional fallback was used.`,
      );
    }

    candidates.push({
      sourceKind: "character",
      generationSourceType:
        "character-card",
      sourceId:
        character.characterId,
      name:
        character.snapshotName,
      sourcePath,
      identityDescription:
        clean(
          character.identityDescription,
        ),
      perspectiveKey:
        "character-card",
    });
  }

  if (scene.selectedBackground) {
    const background =
      scene.selectedBackground;

    const image =
      background.masterImageRef;

    const sourcePath =
      modelFacingImagePath(image);

    if (!sourcePath) {
      throw new Error(
        `${background.snapshotName} does not have a usable Background Master for LTX Ingredients. No directional plate fallback was used.`,
      );
    }

    candidates.push({
      sourceKind: "background",
      generationSourceType:
        "background-master",
      sourceId:
        background.backgroundId,
      name:
        background.snapshotName,
      sourcePath,
      identityDescription:
        clean(
          background.identityDescription,
        ),
    });
  }

  for (const asset of scene.selectedAssets) {
    const sourcePath =
      modelFacingImagePath(
        asset.defaultImageRef,
      );

    if (!sourcePath) {
      throw new Error(
        `${asset.snapshotName} does not have a usable Asset Default image for LTX Ingredients.`,
      );
    }

    candidates.push({
      sourceKind: "asset",
      generationSourceType:
        "asset-default",
      sourceId:
        asset.assetId,
      name:
        asset.snapshotName,
      sourcePath,
      identityDescription:
        clean(asset.identityDescription),
    });
  }

  const expectedCount =
    productionV2LtxVisualIngredientCount(
      scene,
    );

  if (
    expectedCount
    !== candidates.length
  ) {
    throw new Error(
      "LTX Ingredients manifest count does not match the Production Scene selection state.",
    );
  }

  if (!candidates.length) {
    throw new Error(
      "Select at least one Character, Background, or Asset for LTX 2.5 Ingredients.",
    );
  }

  const limit =
    configuredLimit(scene);

  if (
    candidates.length
    > LTX25_INGREDIENTS_MAX_VISUAL_REFERENCES
  ) {
    throw new Error(
      `LTX 2.5 Ingredients accepts at most ${LTX25_INGREDIENTS_MAX_VISUAL_REFERENCES} visual Ingredients; ${candidates.length} are selected.`,
    );
  }

  if (candidates.length > limit) {
    throw new Error(
      `The Scene allows ${limit} LTX visual Ingredients, but ${candidates.length} are selected.`,
    );
  }

  const positions =
    ltx25IngredientPositionLabels(
      candidates.length,
    );

  return {
    version:
      LTX25_INGREDIENTS_MANIFEST_VERSION,
    model: "ltx-2.5",
    mode:
      "ltx-ingredients-image-to-video",
    count:
      candidates.length,
    limit,
    order: "left-to-right",
    items:
      candidates.map(
        (candidate, index) => ({
          ...candidate,
          slot: index + 1,
          positionLabel:
            positions[index],
        }),
      ),
  };
}

function sourceDescription(
  item: Ltx25IngredientManifestItem,
) {
  if (
    item.generationSourceType
    === "character-card"
  ) {
    return "complete saved Character Card";
  }

  if (
    item.generationSourceType
    === "asset-default"
  ) {
    return "canonical Asset Default";
  }

  if (
    item.generationSourceType
    === "background-master"
  ) {
    return "Background Master";
  }

  return item.perspectiveKey
    ? `canonical Background ${item.perspectiveKey} plate`
    : "canonical Background plate";
}

function buildLtx25IngredientsReferenceBody(
  manifest: Ltx25IngredientsManifest,
) {
  const lines = [
    `The supplied reference sheet contains ${manifest.count} canonical visual Ingredients arranged left-to-right.`,
    "The reference sheet is conditioning only. Do not render the sheet, borders, panels, reference-board layout, labels, or mapping text as the opening frame or as part of the generated scene.",
    "Character Card Ingredients are authoritative for character identity, face, body, costume, silhouette, and proportions. The Background Master is authoritative for environment geometry, style, and location. Asset Defaults are authoritative for object identity, material, shape, and colors.",
    "The user Scene Prompt remains authoritative for action, dialogue, camera, performance, and new events. A Continue Scene first frame, when present, remains separate and authoritative for the immediate starting composition and continuity.",
    "",
  ];

  for (const item of manifest.items) {
    const identity =
      clean(item.identityDescription);

    lines.push(
      `Ingredient ${item.slot} (${item.positionLabel}) is ${item.name}, using its ${sourceDescription(item)}.${identity ? ` Canonical identity metadata: ${identity}` : ""}`,
    );
  }

  return lines.join("\n").trim();
}

/*
 * OTG_PRODUCTION_V2_LTX_R13C_OFFICIAL_PROMPT_SEMANTICS_V1
 */
export function buildLtx25IngredientsLockedContext(
  manifest: Parameters<typeof buildLtx25IngredientsReferenceBody>[0],
): string {
  const referenceBody =
    buildLtx25IngredientsReferenceBody(
      manifest,
    ).trim();

  return [
    "Reference sheet:",
    referenceBody,
    "",
    "Generated video:",
  ].join("\n");
}
