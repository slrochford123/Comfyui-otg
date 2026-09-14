import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const panel = fs.readFileSync(
  path.join(
    process.cwd(),
    "app/app/components/ProductionV2Panel.tsx",
  ),
  "utf8",
);

describe(
  "Production V2 LTX 2.5 Character Card authority UI",
  () => {
    it(
      "shows one canonical Character Card Ingredient per selected Character",
      () => {
        expect(panel).toContain(
          'data-otg="production-v2-ltx-character-card-references"',
        );
        expect(panel).toContain(
          'data-otg="production-v2-ltx-character-card-ingredient"',
        );
        expect(panel).toContain(
          "Canonical LTX identity source: Character Card",
        );
        expect(panel).toContain(
          "character.characterCardRef",
        );
      },
    );

    it(
      "does not expose the legacy directional Character selector as model-facing LTX control",
      () => {
        expect(panel).not.toContain(
          "LTX_CHARACTER_VIEW_OPTIONS",
        );
        expect(panel).not.toContain(
          "LtxCharacterViewSelector",
        );
        expect(panel).not.toContain(
          "LTX Character Views",
        );
        expect(panel).not.toContain(
          "LTX view set to",
        );
        expect(panel).not.toContain(
          'data-otg="production-v2-ltx-character-view-selector"',
        );
      },
    );
  },
);
