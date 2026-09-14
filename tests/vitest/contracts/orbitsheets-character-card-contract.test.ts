import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function read(rel: string) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

describe("OrbitSheets Character Card integration", () => {
  it("uses OrbitSheets first and preserves legacy fallback", () => {
    const src = read("app/app/components/CharactersPanel.tsx");

    expect(src).toContain("submitOrbitSheetsCharacterCardJob");
    expect(src).toContain("/api/characters/orbitsheets-card");
    expect(src).toContain("submitLegacyCharacterCardJob");
    expect(src).toContain(
      "OrbitSheets failed; using legacy Character Card fallback",
    );
    expect(src).toContain(
      'workflowId: "orbitsheets-h3-character-card"',
    );
    expect(src).toContain(
      'return "presets/character_card_8_angles_low_angle"',
    );
  });

  it("uses the processed full-body source as the OrbitSheets input", () => {
    const src = read("app/app/components/CharactersPanel.tsx");

    expect(src).toContain(
      "sourceServerPath",
    );
    expect(src).toContain(
      "createCharacterCardCandidateFromProcessedSource",
    );
  });

  it("keeps the server integration TEST-scoped to the H3 8189 lane", () => {
    const src = read(
      "app/api/characters/orbitsheets-card/route.ts",
    );

    expect(src).toContain(
      "http://100.75.162.64:8189",
    );
    expect(src).toContain(
      "CharacterTurnaroundSheetH3.json",
    );
    expect(src).toContain(
      "minimax_h3_fl2va_pruned_int8_convrot.safetensors",
    );
    expect(src).toContain(
      "minimax_h3_fl2v_lightx2v_turbo_4step_v0.1_comfy.safetensors",
    );
    expect(src).toContain(
      'workflow["47"].inputs.steps = 4',
    );
    expect(src).toContain(
      'workflow["60"].inputs.count = 6',
    );
    expect(src).toContain(
      'workflow["60"].inputs.mode = "sharpness_diversity"',
    );
  });
});
