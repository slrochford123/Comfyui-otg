// @vitest-environment node

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

const route = fs.readFileSync(
  path.join(
    root,
    "app/api/characters/enhance-description/route.ts",
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

const functionStart = hub.indexOf(
  "async function enhanceCharacterDescription()",
);
const functionEnd = hub.indexOf(
  "const isFreeform =",
  functionStart,
);
const enhanceFunction = hub.slice(functionStart, functionEnd);

describe("Character Description Quality Phase 8f", () => {
  it("preserves body plan and rejects invented transformations or lore", () => {
    expect(route).toContain(
      "Preserve the user's basic body plan",
    );
    expect(route).toContain(
      "unless the user explicitly requested a change",
    );
    expect(route).toContain(
      "Do not invent powers, transformations, seasonal transformations, lore, backstory, personality, or story behavior.",
    );
  });

  it("targets a restrained number of concrete visual additions", () => {
    expect(route).toContain(
      "about 5-8 plausible concrete visual details",
    );
    expect(route).toContain(
      "one natural paragraph around 60-90 words",
    );
  });

  it("uses restrained sampling for the Character model", () => {
    expect(route).toContain("temperature: 0.45");
    expect(route).toContain("top_p: 0.85");
    expect(route).toContain("repeat_penalty: 1.1");
    expect(route).toContain("num_predict: 170");
    expect(route).toContain("num_ctx: 2048");
  });

  it("keeps Art Style separate from description enhancement", () => {
    expect(enhanceFunction).toContain("prompt: cleaned");
    expect(enhanceFunction).not.toContain("selectedStylePreset");
    expect(enhanceFunction).not.toContain("styleLabel");
    expect(enhanceFunction).not.toContain("stylePrompt");
    expect(enhanceFunction).not.toContain("workflowId");
    expect(enhanceFunction).not.toContain("enhanceLevel");
    expect(hub).toContain(
      "Art Style\n            is applied separately when you generate.",
    );
  });

  it("refines generic provider output without a deterministic fallback", () => {
    expect(route).toContain("function looksGeneric");
    expect(route).toContain("draft: first");
    expect(route).not.toContain("function conservativeFallback");
    expect(route).not.toContain(
      "clearly defined facial or identifying features, materials, colors",
    );
  });

  it("preserves the editable description and exposes provider errors", () => {
    expect(enhanceFunction).toContain("setDescription(enhanced)");
    expect(enhanceFunction).toContain("setCreateError(");
    expect(enhanceFunction).toContain("data?.error");
  });
});
