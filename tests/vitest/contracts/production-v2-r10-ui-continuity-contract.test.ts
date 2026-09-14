import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();

const panel = readFileSync(
  path.join(
    root,
    "app/app/components/ProductionV2Panel.tsx",
  ),
  "utf8",
);

const v2 = readFileSync(
  path.join(
    root,
    "lib/production/v2.ts",
  ),
  "utf8",
);

const postprocess = readFileSync(
  path.join(
    root,
    "app/api/production/v2/postprocess/route.ts",
  ),
  "utf8",
);

describe(
  "Production V2 R10 UI continuity contract",
  () => {
    it(
      "previews a saved Scene without silently selecting it",
      () => {
        expect(panel).toContain(
          "OTG_PRODUCTION_V2_PREVIEW_WITHOUT_SELECTION_R10_V1",
        );

        expect(panel).toContain(
          'data-otg="production-v2-preview-saved-scene"',
        );

        expect(panel).toContain(
          'data-otg="production-v2-select-saved-scene"',
        );

        expect(panel).not.toContain(
          "onClick={() => { onSelect(); if (preview) onOpen(); }}",
        );
      },
    );

    it(
      "carries only the natural-language user prompt across H3 mode changes",
      () => {
        expect(v2).toContain(
          "OTG_PRODUCTION_V2_MODE_SHARED_USER_PROMPT_R10_V1",
        );

        expect(v2).toContain(
          "const sharedUserPrompt =",
        );

        expect(v2).toContain(
          "const destinationPromptState =",
        );

        expect(v2).toContain(
          "userPrompt: sharedUserPrompt",
        );

        expect(v2).toContain(
          "return invalidateProductionV2Prompts({",
        );
      },
    );

    it(
      "serves the existing continuation final frame through owner verification",
      () => {
        expect(postprocess).toContain(
          "OTG_PRODUCTION_V2_CONTINUATION_FRAME_PREVIEW_R10_V1",
        );

        expect(postprocess).toContain(
          'action !== "continuation-frame"',
        );

        expect(postprocess).toContain(
          "scene.continuation",
        );

        expect(postprocess).toContain(
          ".lastFramePath",
        );

        expect(postprocess).toContain(
          "assertProductionV2OwnedFile",
        );

        expect(panel).toContain(
          "Previous Scene — Last Frame",
        );

        expect(panel).toContain(
          "production-v2-continuation-last-frame",
        );
      },
    );

    it(
      "exposes native spell check, clear, undo, and three enhancement sizes",
      () => {
        expect(panel).toContain(
          "OTG_PRODUCTION_V2_PROMPT_TOOLS_R10_V1",
        );

        expect(panel).toContain(
          "spellCheck={true}",
        );

        expect(panel).toContain(
          "autoCorrect=\"on\"",
        );

        expect(panel).toMatch(
          />\s*Clear\s*</,
        );

        expect(panel).toMatch(
          />\s*Undo\s*</,
        );

        expect(panel).toContain(
          "Enhance Short",
        );

        expect(panel).toContain(
          "Enhance Medium",
        );

        expect(panel).toContain(
          "Enhance Long",
        );

        expect(panel).toContain(
          "enhanceLevel: level",
        );
      },
    );
  },
);
