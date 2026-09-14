import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  "app/api/enhance-prompt/route.ts",
  "utf8",
);

describe(
  "Production V2 final Enhance runtime contract",
  () => {
    it(
      "scopes the runtime override to exact Production V2 video modes",
      () => {
        expect(source).toContain(
          "OTG_PRODUCTION_V2_FINAL_ENHANCE_RUNTIME_R12E4_V1",
        );

        expect(source).toContain(
          '"h3-text-to-video"',
        );

        expect(source).toContain(
          '"h3-image-to-video"',
        );

        expect(source).toContain(
          '"h3-reference-to-video"',
        );

        expect(source).toContain(
          '"ltx-ingredients-image-to-video"',
        );
      },
    );

    it(
      "prefers Shawn then SLR with node-specific already-installed models",
      () => {
        expect(source).toContain(
          '["shawn", "slr"] as const',
        );

        expect(source).toContain(
          '"qwen3.5:4b"',
        );

        expect(source).toContain(
          '"redule26/huihui_ai_qwen2.5-vl-7b-abliterated:latest"',
        );

        expect(source).toContain(
          '"production-v2-video-prompt-enhancement"',
        );
      },
    );

    it(
      "gives Production V2 final text enhancement a 120 second execution budget",
      () => {
        expect(source).toMatch(
          /PRODUCTION_V2_PROMPT_ENHANCE_TIMEOUT_MS[\s\S]{0,120}\|\| 120_000/,
        );

        expect(source).toContain(
          "productionV2VideoContext\n          ? 180\n          : 90",
        );
      },
    );

    it(
      "preserves generic enhancer timeout and keep-alive behavior",
      () => {
        expect(source).toContain(
          "promptEnhanceKeepAliveForContext(context)",
        );

        expect(source).toMatch(
          /PROMPT_ENHANCE_TIMEOUT_MS[\s\S]{0,120}\|\| 45_000/,
        );
      },
    );
  },
);
