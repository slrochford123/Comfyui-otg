// @vitest-environment node

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

const route = fs.readFileSync(
  path.join(
    root,
    "app/api/characters/create-image/route.ts",
  ),
  "utf8",
);

const hub = fs.readFileSync(
  path.join(
    root,
    "app/app/components/CharacterHubPanel.tsx",
  ),
  "utf8",
);

describe("Character prompt rules Phase 6", () => {
  it("uses the Standard rule before the user description and selected style", () => {
    expect(route).toContain(
      'args.mode === "standard" ? STANDARD_CHARACTER_STRUCTURE_RULE : ""',
    );
    expect(route).toContain(
      "args.description.trim()",
    );
    expect(route).toContain(
      "STYLE_PROMPTS[args.style]",
    );
    expect(route).not.toContain(
      "const framing =",
    );
    expect(route).not.toContain(
      "const modeRules =",
    );
  });

  it("injects the focused negative rule set only for Standard", () => {
    expect(route).toContain(
      'return mode === "standard" ? STANDARD_CHARACTER_NEGATIVE_PROMPT : ""',
    );
    expect(route).toContain('"cropped feet"');
    expect(route).toContain('"missing legs"');
  });

  it("removes the Character Rules panel", () => {
    expect(hub).not.toContain(
      "Character Rules",
    );
    expect(hub).toContain(
      "Freeform stays unrestricted by Standard anatomy and framing rules.",
    );
  });

  it("preserves the fixed output contract", () => {
    expect(route).toContain(
      "const OUTPUT_WIDTH = 1080",
    );
    expect(route).toContain(
      "const OUTPUT_HEIGHT = 1920",
    );
    expect(hub).toContain(
      "1080 x 1920 portrait",
    );
  });
});
