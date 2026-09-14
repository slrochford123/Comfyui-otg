import { describe, expect, it } from "vitest";

import fs from "node:fs";
import path from "node:path";
import {
  assertProductionV2,
  createProductionV2,
  normalizeProductionV2DurationForModel,
  productionV2DialogueDurationWarning,
  productionV2DurationsForModel,
} from "@/lib/production/v2";

const panelSource = fs.readFileSync(
  path.join(
    process.cwd(),
    "app/app/components/ProductionV2Panel.tsx",
  ),
  "utf8",
);

const v2Source = fs.readFileSync(
  path.join(
    process.cwd(),
    "lib/production/v2.ts",
  ),
  "utf8",
);

describe(
  "Production V2 LTX 2.5 qualified 5/10-second duration policy",
  () => {
    it("exposes exactly 5 and 10 seconds for LTX and H3", () => {
      expect(productionV2DurationsForModel("ltx-2.5")).toEqual([5, 10]);
      expect(productionV2DurationsForModel("minimax-h3")).toEqual([5, 10]);
    });

    it("preserves LTX 10 seconds and normalizes legacy 15 seconds to 10", () => {
      expect(normalizeProductionV2DurationForModel("ltx-2.5", 10)).toBe(10);
      expect(normalizeProductionV2DurationForModel("ltx-2.5", 15)).toBe(10);
      expect(normalizeProductionV2DurationForModel("minimax-h3", 15)).toBe(10);
    });

    it("recommends the qualified 10-second option when a 5-second LTX scene is too short for dialogue", () => {
      const production = createProductionV2("LTX Dialogue", "ltx-2.5");
      const scene = {
        ...production.scenes[0],
        dialogueTurns: [
          {
            id: "turn-1",
            speakerCharacterId: "character-1",
            text: Array.from({ length: 35 }, (_, index) => `word${index}`).join(" "),
          },
        ],
      };
      expect(productionV2DialogueDurationWarning(scene)).toContain(
        "Consider using 10 seconds.",
      );
    });

    it("accepts an in-memory LTX ten-second scene at the core assertion", () => {
      const production = createProductionV2("Valid LTX Duration", "ltx-2.5");
      production.scenes[0].durationSeconds = 10;
      expect(() => assertProductionV2(production)).not.toThrow();
    });

    it("advertises the qualified 5/10-second workflow without the obsolete lock markers", () => {
      expect(panelSource).toContain(
        "LTX 2.5 Ingredients · qualified 5s / 10s workflow",
      );
      expect(v2Source).toContain(
        "OTG_PRODUCTION_V2_LTX_R13C_DURATION_POLICY_V1",
      );
      expect(v2Source).not.toContain(
        "OTG_PRODUCTION_V2_LTX_5_SECOND_MODEL_LOCK_V1",
      );
    });
  },
);
