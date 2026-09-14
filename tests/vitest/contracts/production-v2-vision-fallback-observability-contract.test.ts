import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

const panel = fs.readFileSync(
  path.join(
    root,
    "app/app/components/ProductionV2Panel.tsx",
  ),
  "utf8",
);

const vision = fs.readFileSync(
  path.join(
    root,
    "app/api/vision-prompt/route.ts",
  ),
  "utf8",
);

describe(
  "Production V2 vision fallback + preflight observability R12E10",
  () => {
    it(
      "keeps sequential one-image transport while retaining a fallback path",
      () => {
        expect(panel).toContain(
          "OTG_PRODUCTION_V2_VISION_PATH_FALLBACK_R12E10_V1",
        );

        expect(panel).toContain(
          "fallbackImagePath?: string;",
        );

        expect(panel).toContain(
          "const imagePathCandidates =",
        );

        expect(panel).toContain(
          "new Set(",
        );

        expect(panel).toContain(
          'purpose:\n                        "prompt_enhancement"',
        );
      },
    );

    it(
      "I2V keeps workflow image primary and display image fallback",
      () => {
        expect(panel).toContain(
          "startingImage\n              ?.workflowImage",
        );

        expect(panel).toContain(
          "startingImage\n              ?.displayImage",
        );

        expect(panel).toContain(
          '"starting_image"',
        );
      },
    );

    it(
      "R2V retains Character Card, Background, and Asset authority with fallbacks",
      () => {
        expect(panel).toContain(
          ".characterCardRef\n              .workflowImage",
        );

        expect(panel).toContain(
          ".characterCardRef\n              .displayImage",
        );

        expect(panel).toContain(
          "backgroundImage\n              ?.workflowImage",
        );

        expect(panel).toContain(
          "backgroundImage\n              ?.displayImage",
        );

        expect(panel).toContain(
          ".defaultImageRef\n              .workflowImage",
        );

        expect(panel).toContain(
          ".defaultImageRef\n              .displayImage",
        );
      },
    );

    it(
      "does not hide complete visual failure from diagnostics",
      () => {
        expect(panel).toContain(
          "visionFailureDetails",
        );

        expect(panel).toContain(
          "failureDetails:",
        );
      },
    );

    it(
      "records every pre-Qwen stage without loosening the resolver",
      () => {
        expect(vision).toContain(
          "OTG_PRODUCTION_V2_VISION_PREFLIGHT_TELEMETRY_R12E10_V1",
        );

        expect(vision).toContain(
          "[ProductionV2VisionEnhance] preflight_received",
        );

        expect(vision).toContain(
          "[ProductionV2VisionEnhance] preflight_rejected",
        );

        expect(vision).toContain(
          "[ProductionV2VisionEnhance] file_missing",
        );

        expect(vision).toContain(
          "[ProductionV2VisionEnhance] preflight_resolved",
        );

        expect(vision).toContain(
          "[ProductionV2VisionEnhance] image_prepare_failed",
        );

        expect(vision).toContain(
          "[ProductionV2VisionEnhance] image_prepared",
        );

        expect(vision).toContain(
          "[ProductionV2VisionEnhance] durable_submit",
        );

        expect(vision).toContain(
          'reason: "remote URLs are not allowed"',
        );
      },
    );

    it(
      "gives cold single-image vision enough execution time without persistent residency",
      () => {
        expect(vision).toContain(
          "180_000",
        );

        expect(vision).toContain(
          "|| 120_000",
        );

        expect(vision).toContain(
          "allowedNodes: [\n              \"slr\",",
        );

        expect(vision).toContain(
          "keepAlive: 0",
        );

        expect(vision).toContain(
          "leaseTtlSeconds: 180",
        );

        expect(vision).toContain(
          '"production-v2-vision-enhance"',
        );
      },
    );
  },
);
