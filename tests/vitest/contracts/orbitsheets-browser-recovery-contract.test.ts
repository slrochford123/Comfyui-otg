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

describe("OrbitSheets browser recovery contract", () => {
  it("checks completed Character Completion jobs before a new render", () => {
    expect(panel).toContain(
      "OTG_ORBITSHEETS_COMPLETED_JOB_RECOVERY_V1",
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
  });

  it("returns the recovered durable Character Card", () => {
    expect(panel).toContain(
      "Recovered the completed OrbitSheets Character Card. No new H3 render was needed.",
    );
    expect(panel).toContain(
      "recoveredCardPathV1",
    );
    expect(panel).toContain(
      'workflowId:',
    );
  });

  it("still uses OrbitSheets for new cards", () => {
    expect(panel).toContain(
      'workflowId: "orbitsheets-h3-character-card"',
    );
    expect(panel).toContain(
      "/api/characters/orbitsheets-card",
    );
  });

  it("keeps the legacy Character Card fallback", () => {
    expect(panel).toContain(
      "[Character Card] OrbitSheets failed; using legacy Character Card fallback.",
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
