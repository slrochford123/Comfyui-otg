// @vitest-environment node

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const route = fs.readFileSync(
  path.join(
    process.cwd(),
    "app/api/characters/create-image/route.ts",
  ),
  "utf8",
);

const hub = fs.readFileSync(
  path.join(
    process.cwd(),
    "app/app/components/CharacterHubPanel.tsx",
  ),
  "utf8",
);

describe("Character no extra prompt rules Phase 6c", () => {
  it("allows only the intentional Standard full-body rule", () => {
    expect(route).toContain(
      "const STANDARD_CHARACTER_STRUCTURE_RULE",
    );
    expect(route).toContain(
      'args.mode === "standard" ? STANDARD_CHARACTER_STRUCTURE_RULE : ""',
    );
    expect(route).not.toContain("const modeRules =");
    expect(route).not.toContain("const framing =");
  });

  it("keeps style presets active", () => {
    expect(route).toContain(
      "STYLE_PROMPTS",
    );
    expect(route).toContain(
      "STYLE_PROMPTS[args.style]",
    );
  });

  it("keeps Freeform unrestricted", () => {
    expect(route).toContain(
      'type CharacterCreateMode = "standard" | "freeform"',
    );
    expect(route).toContain(
      'return mode === "standard" ? STANDARD_CHARACTER_NEGATIVE_PROMPT : ""',
    );
  });

  it("removes the visible prompt-rule panel", () => {
    expect(hub).not.toContain(
      "Character Rules",
    );
  });
});
