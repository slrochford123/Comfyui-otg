import fs from "node:fs";
import path from "node:path";

import {
  describe,
  expect,
  it,
} from "vitest";

import {
  buildH3Workflow,
  h3RequiredNodeClassesForBackend,
} from "@/lib/production/h3Workflows";

type GraphNode = {
  class_type: string;
  inputs: Record<string, unknown>;
};

type Graph = Record<string, GraphNode>;

const root = process.cwd();

const schedulerSource =
  fs.readFileSync(
    path.join(
      root,
      "lib/production/h3GenerationScheduler.ts",
    ),
    "utf8",
  );

const routeSource =
  fs.readFileSync(
    path.join(
      root,
      "app/api/production/v2/generation/route.ts",
    ),
    "utf8",
  );

function r2v(
  backend: "rtx3090" | "rtx5060ti",
  startImageFilename?: string,
) {
  return buildH3Workflow({
    backend,
    mode: "h3-reference-to-video",
    h3Quality: "lq",
    finalPrompt:
      "<Picture 1> shows <Subject 1> while the existing scene continues naturally with the same environment.",
    durationSeconds: 5,
    seed: 123456,
    outputPrefix:
      `contract/r11b/${backend}`,
    startImageFilename,
    references: [
      {
        id:
          "contract-picture-1",
        name:
          "Contract Picture 1",
        sourceKind:
          "production-upload",
        generationSourceType:
          "production-upload",
        sourceId:
          "contract-picture-1",
        pictureSlot: 1,
        subjectSlot: 1,
        identityDescription:
          "Contract visual reference.",
        displayImage:
          "contract-picture-1.png",
        workflowImage:
          "contract-picture-1.png",
        uploadedFilename:
          "contract-picture-1.png",
      },
    ],
    voices: [],
    operation:
      "scene-generation",
    videoReferenceFilename:
      "previous-scene.mp4",
    includeVideoReferenceAudio:
      false,
  });
}

describe(
  "Production V2 H3 R2V frame-0 continuation guide",
  () => {
    it.each([
      "rtx3090",
      "rtx5060ti",
    ] as const)(
      "%s builds continued R2V with native MiniMaxH3AddGuide",
      (backend) => {
        const built =
          r2v(
            backend,
            "continuation-final-frame.jpg",
          );

        const graph =
          built.graph as Graph;

        expect(
          graph["39"].class_type,
        ).toBe(
          "MiniMaxH3ReferenceToVideo",
        );

        expect(
          graph["40"],
        ).toMatchObject({
          class_type:
            "LoadImage",
          inputs: {
            image:
              "continuation-final-frame.jpg",
          },
        });

        expect(
          graph["93"],
        ).toMatchObject({
          class_type:
            "MiniMaxH3AddGuide",
          inputs: {
            positive: ["39", 0],
            latent: ["39", 1],
            frame_idx: 0,
            image: ["40", 0],
          },
        });

        expect(
          graph["93"].inputs.vae,
        ).toEqual(
          graph["39"].inputs.vae,
        );

        /*
         * AddGuide modifies conditioning only.
         */
        expect(
          graph["32"].inputs.conditioning,
        ).toEqual(
          ["93", 0],
        );

        /*
         * R2V AV latent remains direct.
         */
        expect(
          graph["21"].inputs.latent_image,
        ).toEqual(
          ["39", 1],
        );

        /*
         * Previous Scene remains an R2V video reference.
         */
        expect(
          graph["39"].inputs[
            "ref_videos.ref_video_0"
          ],
        ).toEqual(
          ["61", 0],
        );

        expect(
          graph["39"].inputs[
            "ref_video_audios.ref_video_audio_0"
          ],
        ).toBeUndefined();
      },
    );

    it.each([
      "rtx3090",
      "rtx5060ti",
    ] as const)(
      "%s leaves ordinary non-continuation R2V unanchored",
      (backend) => {
        const built =
          r2v(
            backend,
            undefined,
          );

        const graph =
          built.graph as Graph;

        const addGuides =
          Object.values(graph)
            .filter(
              (node) =>
                node.class_type
                  === "MiniMaxH3AddGuide",
            );

        expect(addGuides)
          .toHaveLength(0);

        expect(
          graph["32"].inputs.conditioning,
        ).toEqual(
          ["39", 0],
        );

        expect(
          graph["21"].inputs.latent_image,
        ).toEqual(
          ["39", 1],
        );
      },
    );

    it(
      "requires AddGuide on both qualified H3 backends",
      () => {
        expect(
          h3RequiredNodeClassesForBackend(
            "rtx3090",
          ),
        ).toContain(
          "MiniMaxH3AddGuide",
        );

        expect(
          h3RequiredNodeClassesForBackend(
            "rtx5060ti",
          ),
        ).toContain(
          "MiniMaxH3AddGuide",
        );
      },
    );

    it(
      "uploads the existing durable startImage as the continued R2V guide",
      () => {
        expect(
          schedulerSource,
        ).toContain(
          "OTG_PRODUCTION_V2_H3_R2V_GUIDE_UPLOAD_R11B_V1",
        );

        expect(
          schedulerSource,
        ).toContain(
          "const continuationGuide =",
        );

        expect(
          schedulerSource,
        ).toContain(
          "job.payload.startImage",
        );

        expect(
          schedulerSource,
        ).toContain(
          "continuationGuide.workflowImage",
        );

        expect(
          schedulerSource,
        ).toContain(
          "_continuation_frame0",
        );
      },
    );

    it(
      "re-verifies the same Continue Scene final frame before R2V job creation",
      () => {
        expect(
          routeSource,
        ).toContain(
          "OTG_PRODUCTION_V2_H3_R2V_CONTINUATION_GUIDE_HANDOFF_R11B_V1",
        );

        expect(
          routeSource,
        ).toMatch(
          /h3-reference-to-video[\s\S]*?Boolean\(scene\.continuation\)[\s\S]*?continuationStartingImage/,
        );

        expect(
          routeSource,
        ).toMatch(
          /scene\.continuation\.lastFramePath[\s\S]*?startImage\.workflowImage[\s\S]*?continuationFramePath/,
        );

        expect(
          routeSource,
        ).toContain(
          "includeAudio: false",
        );
      },
    );
  },
);
