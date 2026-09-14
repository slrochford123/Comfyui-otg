import {
  describe,
  expect,
  it,
} from "vitest";

import {
  createProductionV2,
  productionV2DialogueDurationWarning,
} from "@/lib/production/v2";

const longDialogue =
  Array.from(
    { length: 35 },
    (_, index) => `word${index}`,
  ).join(" ");

describe(
  "Production V2 dialogue duration policy",
  () => {
    it(
      "recommends 10 seconds from a 5-second scene and never recommends 15",
      () => {
        const production =
          createProductionV2(
            "Five Second Dialogue",
            "minimax-h3",
          );

        const scene = {
          ...production.scenes[0],
          durationSeconds: 5 as const,
          dialogueTurns: [
            {
              id: "turn-1",
              speakerCharacterId:
                "character-1",
              text: longDialogue,
            },
          ],
        };

        const warning =
          productionV2DialogueDurationWarning(
            scene,
          );

        expect(
          warning,
        ).toContain(
          "Consider using 10 seconds.",
        );

        expect(
          warning,
        ).not.toContain(
          "15 seconds",
        );
      },
    );

    it(
      "recommends shortening or splitting when a 10-second scene is too long",
      () => {
        const production =
          createProductionV2(
            "Ten Second Dialogue",
            "minimax-h3",
          );

        const scene = {
          ...production.scenes[0],
          durationSeconds: 10 as const,
          dialogueTurns: [
            {
              id: "turn-1",
              speakerCharacterId:
                "character-1",
              text: longDialogue,
            },
          ],
        };

        const warning =
          productionV2DialogueDurationWarning(
            scene,
          );

        expect(
          warning,
        ).toContain(
          "shortening the dialogue or splitting it across scenes",
        );

        expect(
          warning,
        ).not.toContain(
          "15 seconds",
        );
      },
    );
  },
);
