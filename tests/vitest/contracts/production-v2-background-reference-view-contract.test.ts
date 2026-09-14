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
  normalizeProductionV2,
  productionV2PromptFingerprint,
} from "@/lib/production/v2";

function image(name: string) {
  return {
    displayImage: `/display/${name}.png`,
    workflowImage: `/workflow/${name}.png`,
  };
}

function sceneWithBackground() {
  const production =
    createProductionV2(
      "Background View Test",
      "minimax-h3",
    );

  return {
    ...production.scenes[0],
    generationMode:
      "h3-reference-to-video" as const,
    selectedBackground: {
      backgroundId: "background-1",
      snapshotName: "Background One",
      masterImageRef: image("master"),
      angleImageRefs: {
        front: image("front"),
        back: image("back"),
        left90: image("left90"),
        right90: image("right90"),
        up: image("up"),
        down: image("down"),
      },
      referenceView: "master" as const,
      identityDescription:
        "Keep geography stable.",
    },
  };
}

describe(
  "Production V2 Background Reference View",
  () => {
    it(
      "defaults legacy Background snapshots to Master",
      () => {
        const production =
          createProductionV2(
            "Legacy Master",
            "minimax-h3",
          );

        const raw =
          JSON.parse(
            JSON.stringify(production),
          ) as any;

        raw.scenes[0].selectedBackground = {
          backgroundId: "legacy-bg",
          snapshotName: "Legacy BG",
          masterImageRef: image("master"),
          identityDescription: "Legacy.",
        };

        const normalized =
          normalizeProductionV2(raw);

        expect(
          normalized.scenes[0]
            .selectedBackground
            ?.referenceView,
        ).toBe("master");
      },
    );

    it(
      "uses Master with the existing background-master contract",
      () => {
        const resolved =
          resolveProductionV2H3ReferencePlan(
            sceneWithBackground(),
          );

        const background =
          resolved.referencePlan
            .modelFacingReferences[0];

        expect(background).toMatchObject({
          sourceKind: "background",
          generationSourceType:
            "background-master",
          workflowImage:
            "/workflow/master.png",
        });

        expect(
          background.perspectiveKey,
        ).toBeUndefined();
      },
    );

    it(
      "uses the exact selected canonical directional plate",
      () => {
        const scene =
          sceneWithBackground();

        scene.selectedBackground = {
          ...scene.selectedBackground,
          referenceView: "left90",
        };

        const resolved =
          resolveProductionV2H3ReferencePlan(
            scene,
          );

        const background =
          resolved.referencePlan
            .modelFacingReferences[0];

        expect(background).toMatchObject({
          sourceKind: "background",
          generationSourceType:
            "background-angle",
          perspectiveKey: "left90",
          workflowImage:
            "/workflow/left90.png",
        });

        expect(
          background.workflowImage,
        ).not.toBe(
          "/workflow/master.png",
        );
      },
    );

    it(
      "never silently falls back to Master when a selected angle is missing",
      () => {
        const scene =
          sceneWithBackground();

        scene.selectedBackground = {
          ...scene.selectedBackground,
          referenceView: "left90",
          angleImageRefs: {
            ...scene.selectedBackground
              .angleImageRefs,
            left90: undefined,
          },
        };

        expect(
          () =>
            resolveProductionV2H3ReferencePlan(
              scene,
            ),
        ).toThrow(
          /No Master fallback was used/,
        );
      },
    );

    it(
      "changes the prompt fingerprint when the Background view changes",
      () => {
        const master =
          sceneWithBackground();

        const left = {
          ...master,
          selectedBackground: {
            ...master.selectedBackground,
            referenceView:
              "left90" as const,
          },
        };

        expect(
          productionV2PromptFingerprint(
            master,
          ),
        ).not.toBe(
          productionV2PromptFingerprint(
            left,
          ),
        );
      },
    );

    it(
      "writes the selected directional view into locked reference context",
      () => {
        const scene =
          sceneWithBackground();

        scene.selectedBackground = {
          ...scene.selectedBackground,
          referenceView: "up",
        };

        const resolved =
          resolveProductionV2H3ReferencePlan(
            scene,
          );

        const background =
          resolved.referencePlan
            .modelFacingReferences[0];

        expect(
          background.perspectiveKey,
        ).toBe("up");

        expect(
          background.generationSourceType,
        ).toBe(
          "background-angle",
        );
      },
    );
  },
);
