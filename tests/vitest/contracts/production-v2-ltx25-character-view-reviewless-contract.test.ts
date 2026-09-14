import { describe, expect, it } from "vitest";

import {
  createProductionV2,
  productionV2LtxCharacterReferenceImage,
  productionV2PromptFingerprint,
  type ProductionV2CharacterSelection,
} from "@/lib/production/v2";

function character(
  view: "default" | "left" | "right" | "back",
  directionalPath: string,
): ProductionV2CharacterSelection {
  return {
    characterId: "char-1",
    snapshotName: "io",
    defaultImageRef: {
      workflowImage: "/legacy-default.png",
    },
    characterCardRef: {
      workflowImage: "/canonical-card.png",
    },
    ltxReferenceView: view,
    ltxViewImageRefs: {
      [view]: {
        workflowImage: directionalPath,
      },
    },
    identityDescription: "io canonical identity",
    speaking: false,
    visible: true,
  };
}

describe(
  "Production V2 LTX legacy Character-view state is reviewless and non-model-facing",
  () => {
    it(
      "keeps the Character Card authoritative regardless of legacy directional selection",
      () => {
        const left = character(
          "left",
          "/legacy-left.png",
        );
        const right = character(
          "right",
          "/legacy-right.png",
        );

        expect(
          productionV2LtxCharacterReferenceImage(left)
            ?.workflowImage,
        ).toBe("/canonical-card.png");
        expect(
          productionV2LtxCharacterReferenceImage(right)
            ?.workflowImage,
        ).toBe("/canonical-card.png");
      },
    );

    it(
      "does not stale an LTX prompt fingerprint when only legacy directional metadata changes",
      () => {
        const production =
          createProductionV2(
            "Legacy LTX View Metadata",
            "ltx-2.5",
          );
        const scene = production.scenes[0];

        scene.selectedCharacters = [
          character(
            "left",
            "/legacy-left.png",
          ),
        ];
        const leftFingerprint =
          productionV2PromptFingerprint(scene);

        scene.selectedCharacters = [
          character(
            "right",
            "/legacy-right.png",
          ),
        ];
        const rightFingerprint =
          productionV2PromptFingerprint(scene);

        expect(rightFingerprint).toBe(
          leftFingerprint,
        );
      },
    );

    it(
      "does stale the fingerprint when the authoritative Character Card changes",
      () => {
        const production =
          createProductionV2(
            "Card Authority Fingerprint",
            "ltx-2.5",
          );
        const scene = production.scenes[0];
        const first = character(
          "left",
          "/legacy-left.png",
        );
        scene.selectedCharacters = [first];
        const before =
          productionV2PromptFingerprint(scene);

        scene.selectedCharacters = [
          {
            ...first,
            characterCardRef: {
              workflowImage: "/canonical-card-v2.png",
            },
          },
        ];
        const after =
          productionV2PromptFingerprint(scene);

        expect(after).not.toBe(before);
      },
    );
  },
);
