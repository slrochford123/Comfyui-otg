import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const panel = readFileSync(
  resolve(
    process.cwd(),
    "app/app/components/CharactersPanel.tsx",
  ),
  "utf8",
);

describe("Qwen Image Edit 2.1 browser recovery contract", () => {
  it("checks completed Character Completion jobs before a new render", () => {
    expect(panel).toContain(
      "OTG_QWEN21_COMPLETED_JOB_RECOVERY_V1",
    );
    expect(panel).toContain(
      '"/api/characters/completion"',
    );
    expect(panel).toContain(
      "deferredCharacterSave",
    );
    expect(panel).toContain(
      "sourceCandidatesV1.includes(",
    );
    expect(panel).toContain(
      "recoveredExpressionV1 === characterCardExpression",
    );
  });

  it("returns the recovered durable Character Card", () => {
    expect(panel).toContain(
      "Recovered the completed Qwen Image Edit 2.1 Character Card. No new render was needed.",
    );
    expect(panel).toContain(
      "recoveredCardPathV1",
    );
    expect(panel).toContain(
      'workflowId:',
    );
  });

  it("still uses the card route for new Qwen cards", () => {
    expect(panel).toContain(
      'workflowId: "qwen-image-edit-2.1-character-card"',
    );
    expect(panel).toContain(
      "/api/characters/orbitsheets-card",
    );
  });

  it("keeps the legacy Character Card fallback", () => {
    expect(panel).toContain(
      "[Character Card] Qwen Image Edit 2.1 failed; using legacy Character Card fallback.",
    );
    expect(panel).toContain(
      "submitLegacyCharacterCardJob",
    );
  });

  it("does not contain the stale four-body completion failure", () => {
    expect(panel).not.toContain(
      "Character completion finished without all four body references and the Character Card.",
    );
  });
});
