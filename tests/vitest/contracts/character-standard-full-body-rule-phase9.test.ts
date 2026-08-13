// @vitest-environment node

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const route = fs.readFileSync(
  path.join(process.cwd(), "app/api/characters/create-image/route.ts"),
  "utf8",
);

const promptStart = route.indexOf("function buildPrompt(");
const promptEnd = route.indexOf("function mutateWorkflow(", promptStart);
const buildPrompt = route.slice(promptStart, promptEnd);

describe("Standard Character full-body rule Phase 9", () => {
  it("applies the structural rule only to Standard mode", () => {
    expect(buildPrompt).toContain(
      'args.mode === "standard" ? STANDARD_CHARACTER_STRUCTURE_RULE : ""',
    );
    expect(buildPrompt).toContain("args.description.trim()");
  });

  it("keeps Art Style separate and after the user description", () => {
    const structureIndex = buildPrompt.indexOf("STANDARD_CHARACTER_STRUCTURE_RULE");
    const descriptionIndex = buildPrompt.indexOf("args.description.trim()");
    const styleIndex = buildPrompt.indexOf(
      'selectedArtStylePrompt?.trim() || ""',
    );

    expect(buildPrompt).toContain(
      "const selectedArtStylePrompt = STYLE_PROMPTS[args.style]",
    );
    expect(structureIndex).toBeLessThan(descriptionIndex);
    expect(descriptionIndex).toBeLessThan(styleIndex);
  });

  it("keeps Standard negative guidance out of Freeform", () => {
    expect(route).toContain(
      'return mode === "standard" ? STANDARD_CHARACTER_NEGATIVE_PROMPT : ""',
    );
  });

  it("preserves fixed output and existing model/workflow routing", () => {
    expect(route).toContain("const OUTPUT_WIDTH = 1080");
    expect(route).toContain("const OUTPUT_HEIGHT = 1920");

    for (const workflow of [
      "image_ernie_image_turbo.json",
      "image_z_image_turbo.json",
      "image_krea2_turbo_t2i.json",
      "image_boogu_image_0_1_turbo_t2i.json",
      "image_mage_flow_turbo_t2i_int8.json",
    ]) {
      expect(route).toContain(workflow);
    }

    expect(route).toContain("validateBackend(imagePrimary, config)");
    expect(route).toContain("validateBackend(local3090, config)");
  });
});
