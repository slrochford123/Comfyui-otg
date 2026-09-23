import fs from "node:fs";
import path from "node:path";

import {
  describe,
  expect,
  it,
} from "vitest";

import {
  assertProductionV2H3StartingImage,
  createProductionV2,
  productionV2PromptFingerprint,
} from "@/lib/production/v2";

const readSource = (file: string) =>
  fs.readFileSync(
    path.join(
      process.cwd(),
      file,
    ),
    "utf8",
  );

describe(
  "Production V2 MiniMax H3 Continue Scene contract",
  () => {
    it(
      "accepts the server-prepared final frame as an H3 production-upload Starting Image",
      () => {
        expect(
          () =>
            assertProductionV2H3StartingImage({
              id: "continuation-frame",
              name: "Scene 1 Final Frame",
              sourceKind:
                "production-upload",
              generationSourceType:
                "production-upload",
              sourceId:
                "media-scene-1",
              workflowImage:
                "/tmp/production/continuation.jpg",
            }),
        ).not.toThrow();
      },
    );

    it(
      "includes continuation lineage in the prompt fingerprint",
      () => {
        const production =
          createProductionV2(
            "Continuation Fingerprint",
            "minimax-h3",
          );

        const scene =
          production.scenes[0];

        const withContinuation = {
          ...scene,
          continuation: {
            sourceSceneId:
              "scene-source",
            sourceSceneNumber:
              1,
            sourceMediaVersionId:
              "media-a",
            sourceMediaPath:
              "/owned/source-a.mp4",
            lastFramePath:
              "/owned/tail-a.jpg",
            createdAt:
              "2026-09-06T00:00:00.000Z",
          },
        };

        const changedVersion = {
          ...withContinuation,
          continuation: {
            ...withContinuation.continuation,
            sourceMediaVersionId:
              "media-b",
            sourceMediaPath:
              "/owned/source-b.mp4",
            lastFramePath:
              "/owned/tail-b.jpg",
          },
        };

        expect(
          productionV2PromptFingerprint(
            withContinuation,
          ),
        ).not.toBe(
          productionV2PromptFingerprint(
            changedVersion,
          ),
        );
      },
    );

    it(
      "prepares H3 continuation as I2V with the exact server-extracted final frame",
      () => {
        const source =
          readSource(
            "app/api/production/v2/postprocess/route.ts",
          );

        expect(source).toContain(
          "OTG_PRODUCTION_V2_H3_CONTINUATION_START_FRAME_V1",
        );

        expect(source).toContain(
          '"h3-image-to-video" as const',
        );

        expect(source).toContain(
          '"production-upload" as const',
        );

        expect(source).toContain(
          "workflowImage:",
        );

        expect(source).toContain(
          "extracted.outputPath",
        );
      },
    );

    it(
      "re-verifies H3 continuation paths before durable job creation and does not carry prior audio",
      () => {
        const source =
          readSource(
            "app/api/production/v2/generation/route.ts",
          );

        expect(source).toContain(
          "OTG_PRODUCTION_V2_H3_CONTINUATION_OWNER_VERIFIED_HANDOFF_V1",
        );

        expect(source).toMatch(
          /resolveProductionV2Version\([\s\S]*?scene\.continuation\.sourceSceneId[\s\S]*?scene\.continuation\.sourceMediaVersionId/,
        );

        expect(source).toMatch(
          /assertProductionV2OwnedFile\([\s\S]*?scene\.continuation\.lastFramePath/,
        );

        expect(source).toMatch(
          /startImage\.sourceKind\s*!==\s*"production-upload"/,
        );

        expect(source).toContain(
          "videoReference = {",
        );

        expect(source).toContain(
          "includeAudio: false",
        );

        expect(source).toMatch(
          /startImage,[\s\S]*?references,[\s\S]*?voices,[\s\S]*?videoReference,[\s\S]*?userLoras:/,
        );
      },
    );

    it(
      "uploads the continuation video during ordinary H3 R2V without dropping Pictures or voices",
      () => {
        const source =
          readSource(
            "lib/production/h3GenerationScheduler.ts",
          );

        expect(source).toContain(
          "OTG_PRODUCTION_V2_H3_R2V_CONTINUATION_UPLOAD_V1",
        );

        expect(source).toMatch(
          /job\.mode === "h3-reference-to-video"[\s\S]*?job\.payload\.videoReference[\s\S]*?mediaType:\s*"video"[\s\S]*?for \(const reference of job\.payload\.references\)[\s\S]*?for \(const voice of job\.payload\.voices\)/,
        );
      },
    );

    it(
      "clips H3 Production video references to a selected 5-second window before Comfy upload",
      () => {
        const panel =
          readSource(
            "app/app/components/ProductionV2Panel.tsx",
          );
        const route =
          readSource(
            "app/api/production/v2/generation/route.ts",
          );
        const scheduler =
          readSource(
            "lib/production/h3GenerationScheduler.ts",
          );
        const jobs =
          readSource(
            "lib/production/h3GenerationJobs.ts",
          );

        expect(panel).toContain(
          'data-otg="production-v2-h3-reference-window"',
        );
        expect(panel).toContain(
          'aria-label="H3 reference video 5-second start time"',
        );
        expect(panel).toContain(
          "videoClipStartSeconds: clipStartSeconds",
        );
        expect(route).toContain(
          "videoClipStartSeconds",
        );
        expect(route).toContain(
          "clipStartSeconds",
        );
        expect(jobs).toContain(
          "clipStartSeconds?: number;",
        );
        expect(scheduler).toContain(
          "prepareH3ReferenceVideoClip",
        );
        expect(scheduler).toContain(
          "trimH3ReferenceVideoClip",
        );
        expect(scheduler).toContain(
          "sourcePath: referenceClip.outputPath",
        );
      },
    );

    it(
      "combines prior-video conditioning with normal H3 R2V image and voice conditioning",
      () => {
        const source =
          readSource(
            "lib/production/h3Workflows.ts",
          );

        expect(source).toContain(
          "OTG_PRODUCTION_V2_H3_R2V_COMBINED_VIDEO_REFERENCE_V1",
        );

        expect(source).toContain(
          'inputs["ref_videos.ref_video_0"]',
        );

        expect(source).toContain(
          "ref_images.ref_image_",
        );

        expect(source).toContain(
          "ref_audios.ref_audio_",
        );

        expect(source).toMatch(
          /assertReferencePromptMatchesManifest\([\s\S]*?references\.forEach[\s\S]*?videos\.forEach[\s\S]*?voices\.forEach[\s\S]*?ref_videos\.ref_video_0/,
        );
      },
    );

    it(
      "exposes Continue Scene for H3 while preserving I2V to R2V mode switching",
      () => {
        const source =
          readSource(
            "app/app/components/ProductionV2Panel.tsx",
          );

        expect(source).toContain(
          "OTG_PRODUCTION_V2_CONTINUE_SCENE_UI_V2",
        );

        expect(source).toContain(
          'selectedScene.model === "ltx-2.5" || selectedScene.model === "minimax-h3"',
        );

        expect(source).toContain(
          'data-otg="production-v2-continue-scene"',
        );

        expect(source).toContain(
          "switchProductionV2SceneMode",
        );
      },
    );

    it(
      "keeps the existing durable H3 job video-reference field instead of creating a parallel job schema",
      () => {
        const source =
          readSource(
            "lib/production/h3GenerationJobs.ts",
          );

        expect(source).toContain(
          "videoReference?: {",
        );

        expect(source).toContain(
          "mediaVersionId: string;",
        );

        expect(source).toContain(
          "mediaPath: string;",
        );

        expect(source).toContain(
          "includeAudio: boolean;",
        );
      },
    );
  },
);
