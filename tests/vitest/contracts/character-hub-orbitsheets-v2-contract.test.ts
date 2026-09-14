import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const hub = readFileSync(
  resolve(
    process.cwd(),
    "app/app/components/CharacterHubPanel.tsx",
  ),
  "utf8",
);

describe("Character Hub OrbitSheets V2 contract", () => {
  it("recognizes OrbitSheets V2 as a canonical-card result", () => {
    expect(hub).toContain(
      "OTG_CHARACTER_HUB_ORBITSHEETS_V2_UI_V1",
    );
    expect(hub).toContain("isOrbitSheetsV2");
    expect(hub).toContain("pipelineVersion");
    expect(hub).toContain("orbitsheets-h3");
    expect(hub).toContain(
      "legacyFourBodyReferencesComplete",
    );
  });

  it("does not require four body masters for OrbitSheets V2", () => {
    expect(hub).toContain(
      "(!isOrbitSheetsV2 && !legacyFourBodyReferencesComplete)",
    );
    expect(hub).not.toContain(
      "Character completion finished without all four body references and the Character Card.",
    );
  });

  it("hydrates the OrbitSheets card into Character Hub", () => {
    expect(hub).toContain(
      '"OrbitSheets H3 Character Card"',
    );
    expect(hub).toContain(
      '"Six-view Character Card"',
    );
    expect(hub).toContain(
      '"orbitsheets-h3-character-card"',
    );
  });

  it("recovers an already-completed matching job before POST", () => {
    expect(hub).toContain(
      "OTG_CHARACTER_HUB_COMPLETED_CARD_RECOVERY_V1",
    );
    expect(hub).toContain(
      "/api/characters/completion?characterId=",
    );
    expect(hub).toContain(
      "sourceCandidates.includes(",
    );
    expect(hub).toContain(
      "Recovered the completed Character Card job. No new H3 render was submitted.",
    );
  });

  it("keeps the four-master preview legacy-only", () => {
    expect(hub).toContain(
      "!isOrbitSheetsCharacterCardV2 && characterReferences?.body",
    );
    expect(hub).toContain(
      "Legacy four-angle 1080×1920 masters",
    );
  });

  it("describes OrbitSheets as primary with legacy fallback", () => {
    expect(hub).toContain(
      "OrbitSheets H3 creates a six-view identity sheet",
    );
    expect(hub).toContain(
      "legacy four-angle Character Card generator runs automatically",
    );
  });
});
