import {
  describe,
  expect,
  it,
} from "vitest";

import {
  resolveProductionV2H3ReferencePlan,
} from "@/lib/production/referenceResolver";

import {
  createProductionV2,
} from "@/lib/production/v2";

describe(
  "Production V2 model-facing reference sources",
  () => {
    it(
      "uses Character Card, Background Master, and Asset Default sources deterministically",
      () => {
        const production =
          createProductionV2(
            "Reference Sources",
            "minimax-h3",
          );

        const base =
          production.scenes[0];

        const scene = {
          ...base,
          generationMode:
            "h3-reference-to-video" as const,
          selectedCharacters: [
            {
              characterId: "character-1",
              snapshotName: "Character One",
              defaultImageRef: {
                displayImage:
                  "/display/character-default.png",
                workflowImage:
                  "/workflow/character-default.png",
              },
              characterCardRef: {
                displayImage:
                  "/display/character-card.png",
                workflowImage:
                  "/workflow/character-card.png",
              },
              identityDescription:
                "Character identity.",
              speaking: false,
              visible: true,
            },
          ],
          selectedBackground: {
            backgroundId:
              "background-1",
            snapshotName:
              "Background One",
            masterImageRef: {
              displayImage:
                "/display/background-master.png",
              workflowImage:
                "/workflow/background-master.png",
            },
            angleImageRefs: {},
            identityDescription:
              "Background identity.",
          },
          selectedAssets: [
            {
              assetId: "asset-1",
              snapshotName: "Asset One",
              defaultImageRef: {
                displayImage:
                  "/display/asset-default.png",
                workflowImage:
                  "/workflow/asset-default.png",
              },
              identityDescription:
                "Asset identity.",
            },
          ],
        };

        const resolved =
          resolveProductionV2H3ReferencePlan(
            scene,
          );

        const references =
          resolved.referencePlan
            .modelFacingReferences;

        expect(
          references,
        ).toHaveLength(
          3,
        );

        expect(
          references[0],
        ).toMatchObject({
          sourceKind: "character",
          sourceId: "character-1",
          generationSourceType:
            "character-card",
          workflowImage:
            "/workflow/character-card.png",
          pictureSlot: 1,
          subjectSlot: 1,
        });

        expect(
          references[0].workflowImage,
        ).not.toBe(
          "/workflow/character-default.png",
        );

        expect(
          references[1],
        ).toMatchObject({
          sourceKind: "background",
          sourceId: "background-1",
          generationSourceType:
            "background-master",
          workflowImage:
            "/workflow/background-master.png",
          pictureSlot: 2,
          subjectSlot: 2,
        });

        expect(
          references[2],
        ).toMatchObject({
          sourceKind: "asset",
          sourceId: "asset-1",
          generationSourceType:
            "asset-default",
          workflowImage:
            "/workflow/asset-default.png",
          pictureSlot: 3,
          subjectSlot: 3,
        });
      },
    );
  },
);
