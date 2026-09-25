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

const runtimeControls = readFileSync(
  resolve(
    process.cwd(),
    "app/app/components/CharacterCandidateRuntimeControls.tsx",
  ),
  "utf8",
);

describe("Character Hub Qwen Image Edit 2.1 card contract", () => {
  it("recognizes Qwen Image Edit 2.1 as a canonical-card result", () => {
    expect(hub).toContain(
      "OTG_CHARACTER_HUB_QWEN21_CARD_UI_V1",
    );
    expect(hub).toContain("isOrbitSheetsV2");
    expect(hub).toContain("pipelineVersion");
    expect(hub).toContain("qwen-image-edit-2.1");
    expect(hub).toContain(
      "legacyFourBodyReferencesComplete",
    );
  });

  it("does not require four body masters for Qwen card V2", () => {
    expect(hub).toContain(
      "(!isOrbitSheetsV2 && !legacyFourBodyReferencesComplete)",
    );
    expect(hub).not.toContain(
      "Character completion finished without all four body references and the Character Card.",
    );
  });

  it("hydrates the Qwen card into Character Hub", () => {
    expect(hub).toContain(
      '"Qwen Image Edit 2.1 Character Card"',
    );
    expect(hub).toContain(
      '"Six-view Character Card"',
    );
    expect(hub).toContain(
      '"qwen-image-edit-2.1-character-card"',
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
      "Recovered the completed Qwen Image Edit 2.1 Character Card job",
    );
  });

  it("forces a fresh render when regenerating an existing card", () => {
    expect(hub).toContain(
      "existingCardWillBeRegenerated",
    );
    expect(hub).toContain(
      "if (!jobId && !existingCardWillBeRegenerated)",
    );
    expect(runtimeControls).toContain(
      "Regenerate Character Card",
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

  it("describes Qwen Image Edit 2.1 as primary with legacy fallback", () => {
    expect(hub).toContain(
      "Qwen Image Edit 2.1 is the primary card generator",
    );
    expect(hub).toContain(
      "legacy four-angle generation remains the automatic fallback",
    );
  });
});
