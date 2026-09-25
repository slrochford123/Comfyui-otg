import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function read(rel: string) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

describe("Qwen Image Edit 2.1 Character Card integration", () => {
  it("uses Qwen Image Edit 2.1 first and preserves legacy fallback", () => {
    const src = read("app/app/components/CharactersPanel.tsx");

    expect(src).toContain("submitQwenEditCharacterCardJob");
    expect(src).toContain("/api/characters/orbitsheets-card");
    expect(src).toContain("submitLegacyCharacterCardJob");
    expect(src).toContain(
      "Qwen Image Edit 2.1 failed; using legacy Character Card fallback",
    );
    expect(src).toContain(
      'workflowId: "qwen-image-edit-2.1-character-card"',
    );
    expect(src).toContain(
      'return "presets/character_card_8_angles_low_angle"',
    );
  });

  it("uses the processed full-body source as the Qwen card input", () => {
    const src = read("app/app/components/CharactersPanel.tsx");

    expect(src).toContain(
      "sourceServerPath",
    );
    expect(src).toContain(
      "createCharacterCardCandidateFromProcessedSource",
    );
  });

  it("uses Qwen Image Edit 2.1 card-builder workflows", () => {
    const src = read(
      "app/api/characters/orbitsheets-card/route.ts",
    );

    const standard = read(
      "comfy_workflows/card_builder/qwen21_character_card.api.json",
    );
    const freeform = read(
      "comfy_workflows/card_builder/qwen21_freeform_character_card.api.json",
    );

    expect(src).toContain(
      "qwen21_character_card.api.json",
    );
    expect(src).toContain(
      "qwen21_freeform_character_card.api.json",
    );
    expect(src).toContain(
      "Qwen Image Edit 2.1 Character Card",
    );
    expect(src).toContain("normalizeExpression");
    expect(src).toContain("Selected expression:");
    expect(src).toContain(
      "Make every visible face use this",
    );
    expect(src).toContain("expression, especially the front view");
    expect(src).toContain(
      "width: 1920",
    );
    expect(src).toContain(
      "height: 1080",
    );
    expect(standard).toContain("TextEncodeQwenImage21");
    expect(standard).toContain("qwen_image_2.1_int8_convrot.safetensors");
    expect(standard).toContain("five-view character card");
    expect(standard).toContain("CLOSE-UP FACE shot");
    expect(standard).not.toContain("CLOSE-UP BACK shot");
    expect(freeform).toContain("FRONT view");
    expect(freeform).toContain("BACK view");
    expect(freeform).toContain("CLOSE-UP FACE shot");
    expect(freeform).not.toContain("HALF-BODY FRONT shot");
    expect(freeform).not.toContain("HALF-BODY BACK shot");
  });
});
