import fs from "node:fs";
import path from "node:path";

import {
  describe,
  expect,
  it,
} from "vitest";

const panel = fs.readFileSync(
  path.join(
    process.cwd(),
    "app/app/components/ProductionV2Panel.tsx",
  ),
  "utf8",
);

const route = fs.readFileSync(
  path.join(
    process.cwd(),
    "app/api/production/v2/generation/route.ts",
  ),
  "utf8",
);

const v2 = fs.readFileSync(
  path.join(
    process.cwd(),
    "lib/production/v2.ts",
  ),
  "utf8",
);

describe(
  "Production V2 LTX 2.5 Ingredients UI activation",
  () => {
    it(
      "allows the Generate action to submit either supported Production model",
      () => {
        expect(panel).toContain(
          "async function generateVideo()",
        );

        expect(panel).toContain(
          'selectedScene.model === "ltx-2.5"',
        );

        expect(panel).toContain(
          "Generate with LTX 2.5",
        );

        expect(panel).toContain(
          'data-otg="production-v2-generate-video"',
        );

        expect(panel).not.toContain(
          'if (!production || !selectedScene || selectedScene.model !== "minimax-h3") return;',
        );

        expect(panel).not.toContain(
          "LTX setup pending",
        );

        expect(panel).not.toContain(
          "LTX 2.5 Ingredients generation setup and qualification are pending.",
        );
      },
    );

    it(
      "keeps LTX constrained to the qualified 5- and 10-second backend path",
      () => {
        expect(v2).toContain(
          'scene.durationSeconds !== 5',
        );

        expect(v2).toContain(
          "production-qualified for 5- or 10-second scenes only",
        );

        expect(route).toContain(
          'scene.durationSeconds !== 5',
        );

        expect(route).toContain(
          "createProductionV2Ltx25GenerationJob",
        );
      },
    );

    /*
     * OTG_LTX_CHARACTER_VIEW_CONTRACT_R2
     */
    it(
      "keeps Retry H3-only without requiring a manual Final Prompt review gate",
      () => {
        const legacyManualReviewGate = [
          'currentPrompt.reviewStatus === "reviewed"',
          'selectedScene.model === "minimax-h3"',
        ].join(" && ");

        expect(panel)
          .toContain(
            'data-otg="production-v2-video-retry"',
          );

        expect(panel)
          .toContain(
            '{selectedScene.model === "minimax-h3" ? (',
          );

        expect(panel)
          .not.toContain(
            legacyManualReviewGate,
          );

        expect(panel)
          .not.toContain(
            "Review Final Prompt",
          );

        expect(panel)
          .not.toContain(
            "Final Prompt Reviewed",
          );

        expect(panel)
          .toContain(
            'title="Prompt Preview"',
          );

        expect(panel)
          .toContain(
            'data-otg="production-v2-generate-video"',
          );

        expect(panel)
          .toContain(
            '"Generate with LTX 2.5"',
          );
      },
    );

  },
);
