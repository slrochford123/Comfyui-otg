// @vitest-environment node

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const route = fs.readFileSync(
  path.join(
    process.cwd(),
    "app/api/characters/enhance-description/route.ts",
  ),
  "utf8",
);

describe("Character Description Enhance Phase 8c", () => {
  it("requires concrete visual choices rather than category filler", () => {
    expect(route).toContain(
      "Add about 5-8 plausible concrete visual details",
    );
    expect(route).toContain(
      "Actually choose appropriate details and describe them.",
    );
    expect(route).toContain(
      "develop the unusual biological or material features",
    );
  });

  it("detects generic boilerplate", () => {
    expect(route).toContain(
      "function looksGeneric",
    );
    expect(route).toContain(
      "clearly defined facial",
    );
    expect(route).toContain(
      "character-specific details",
    );
    expect(route).toContain(
      "consistent with the original concept",
    );
  });

  it("runs a refinement pass when the first response is generic", () => {
    expect(route).toContain(
      "function refinementInstruction",
    );
    expect(route).toContain(
      "draft: first",
    );
    expect(route).toContain(
      "refined: true",
    );
  });

  it("does not use the old deterministic generic fallback", () => {
    expect(route).not.toContain(
      "function conservativeFallback",
    );
    expect(route).toContain(
      "The original description was preserved.",
    );
  });

  it("keeps Art Style and scene direction out of the Character description", () => {
    expect(route).toContain(
      "Do not add an art style",
    );
    expect(route).toContain(
      "camera, lens, lighting, background, environment, composition, framing",
    );
  });

  it("uses the dedicated Character provider model contract", () => {
    expect(route).toContain(
      "OLLAMA_CHARACTER_DESCRIPTION_MODEL",
    );
    expect(route).toContain(
      '"qwen2.5:3b"',
    );
    expect(route).toContain(
      "OLLAMA_CHARACTER_DESCRIPTION_URL",
    );

    expect(route).not.toContain(
      "OLLAMA_PROMPT_ENHANCE_MODEL_LARGE",
    );
    expect(route).not.toContain(
      "OLLAMA_PROMPT_ENHANCE_MODEL_MEDIUM",
    );
  });
});
