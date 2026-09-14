import {
  describe,
  expect,
  it,
} from "vitest";

import fs from "node:fs";
import path from "node:path";

const panelSource =
  fs.readFileSync(
    path.join(
      process.cwd(),
      "app/app/components/CharactersPanel.tsx",
    ),
    "utf8",
  );

const directionSource =
  fs.readFileSync(
    path.join(
      process.cwd(),
      "app/api/background-angle-plate/route.ts",
    ),
    "utf8",
  );

describe(
  "Background Enhance Prompt controls",
  () => {
    it(
      "adds dedicated Background enhancement state with Medium as the default",
      () => {
        expect(
          panelSource,
        ).toContain(
          "OTG_BACKGROUND_ENHANCE_PROMPT_PP06_V2",
        );

        expect(
          panelSource,
        ).toContain(
          "characterBackgroundPromptEnhanceLevel",
        );

        expect(
          panelSource,
        ).toMatch(
          /useState<[\s\S]*?"short"\s*\|\s*"medium"\s*\|\s*"long"[\s\S]*?>\("medium"\)/,
        );

        expect(
          panelSource,
        ).toContain(
          "characterBackgroundEnhancingPrompt",
        );
      },
    );

    it(
      "renders Enhance Prompt and Small Medium Large controls next to the Background prompt",
      () => {
        expect(
          panelSource,
        ).toContain(
          'data-otg="background-enhance-prompt-controls"',
        );

        expect(
          panelSource,
        ).toContain(
          'data-otg="background-enhance-prompt-button"',
        );

        expect(
          panelSource,
        ).toContain(
          'label: "Small"',
        );

        expect(
          panelSource,
        ).toContain(
          'label: "Medium"',
        );

        expect(
          panelSource,
        ).toContain(
          'label: "Large"',
        );

        expect(
          panelSource,
        ).toContain(
          "setCharacterBackgroundPromptEnhanceLevel",
        );
      },
    );

    it(
      "uses the existing enhance-prompt API and writes the result back into the Background prompt",
      () => {
        expect(
          panelSource,
        ).toContain(
          '"/api/enhance-prompt"',
        );

        expect(
          panelSource,
        ).toContain(
          "enhanceCharacterBackgroundPromptV1",
        );

        expect(
          panelSource,
        ).toContain(
          "setCharacterBackgroundPrompt(",
        );

        expect(
          panelSource,
        ).toContain(
          "payload?.enhancedPrompt",
        );

        expect(
          panelSource,
        ).toContain(
          'context:\n                  "background image generation"',
        );
      },
    );

    it(
      "does not allow enhancement without a Background prompt",
      () => {
        expect(
          panelSource,
        ).toContain(
          "!characterBackgroundPrompt.trim()",
        );

        expect(
          panelSource,
        ).toContain(
          "Enter a Background prompt before using Enhance Prompt.",
        );
      },
    );

    it(
      "keeps the V2 directional semantics patch singular after the accidental rerun",
      () => {
        const marker =
          "OTG_BACKGROUND_FIXED_PIVOT_DIRECTION_SEMANTICS_PP06_V2";

        expect(
          directionSource
            .split(marker)
            .length - 1,
        ).toBe(1);
      },
    );
  },
);
