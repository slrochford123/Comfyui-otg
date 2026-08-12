// @vitest-environment node

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const route = fs.readFileSync(
  path.join(root, "app/api/characters/create-image/route.ts"),
  "utf8",
);
const enhanceRoute = fs.readFileSync(
  path.join(root, "app/api/characters/enhance-description/route.ts"),
  "utf8",
);

const structureStart = route.indexOf(
  "const STANDARD_CHARACTER_STRUCTURE_RULE",
);
const structureEnd = route.indexOf(
  "const STANDARD_CHARACTER_NEGATIVE_PROMPT",
  structureStart,
);
const structureRule = route.slice(structureStart, structureEnd).toLowerCase();

const negativeStart = structureEnd;
const negativeEnd = route.indexOf("const supportCache", negativeStart);
const negativePrompt = route.slice(negativeStart, negativeEnd).toLowerCase();

const promptStart = route.indexOf("function buildPrompt(");
const promptEnd = route.indexOf("function mutateWorkflow(", promptStart);
const buildPrompt = route.slice(promptStart, promptEnd);

describe("Standard Character strict full-body rule Phase 9c", () => {
  it("contains every required Standard structural instruction", () => {
    for (const instruction of [
      "create exactly one character",
      "full-body standing character in a neutral pose",
      "top of the head to the bottom of the feet",
      "both arms must be fully visible",
      "both legs must be fully visible",
      "exactly two arms and exactly two legs",
      "do not crop the head, hands, legs, or feet",
      "portrait, bust shot, half-body shot, close-up, or chibi",
      "long-shot full-figure framing",
      "camera far enough back to show the entire body",
    ]) {
      expect(structureRule).toContain(instruction);
    }
  });

  it("contains every required Standard crop and anatomy exclusion", () => {
    for (const exclusion of [
      "cropped feet",
      "partial body",
      "upper body only",
      "half body",
      "bust shot",
      "close-up",
      "portrait crop",
      "chibi",
      "extra arms",
      "extra legs",
      "missing arms",
      "missing legs",
      "hidden feet",
      "cut off limbs",
    ]) {
      expect(negativePrompt).toContain(`"${exclusion}"`);
    }
  });

  it("keeps all Standard positive and negative rules out of Freeform", () => {
    expect(buildPrompt).toContain(
      'args.mode === "standard" ? STANDARD_CHARACTER_STRUCTURE_RULE : ""',
    );
    expect(route).toContain(
      'return mode === "standard" ? STANDARD_CHARACTER_NEGATIVE_PROMPT : ""',
    );
  });

  it("leaves Character Enhance Prompt description-only", () => {
    expect(enhanceRoute).not.toContain("STANDARD_CHARACTER_STRUCTURE_RULE");
    expect(enhanceRoute).not.toContain("STANDARD_CHARACTER_NEGATIVE_PROMPT");
    expect(enhanceRoute.toLowerCase()).not.toContain(
      "create exactly one character",
    );
    expect(enhanceRoute.toLowerCase()).not.toContain("cropped feet");
  });

  it("injects structure, description, and Art Style in that order", () => {
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

  it("retains exact portrait output and routing behavior", () => {
    expect(route).toContain("const OUTPUT_WIDTH = 1080");
    expect(route).toContain("const OUTPUT_HEIGHT = 1920");
    expect(route).toContain('preferredBackend: "image-primary"');
    expect(route).toContain('label: "local-3090-fallback"');
    expect(route).toContain("const seed = randomSeed()");
  });
});
