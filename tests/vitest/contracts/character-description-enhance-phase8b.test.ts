// @vitest-environment node

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

const hub = fs.readFileSync(
  path.join(
    root,
    "app/app/components/CharacterHubPanel.tsx",
  ),
  "utf8",
);

const route = fs.readFileSync(
  path.join(
    root,
    "app/api/characters/enhance-description/route.ts",
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
const enhanceFunction = hub.slice(
  functionStart,
  functionEnd,
);

describe("Character Description Enhance Phase 8b", () => {
  it("uses the dedicated Character enhancement route", () => {
    expect(enhanceFunction).toContain(
      '"/api/characters/enhance-description"',
    );
    expect(enhanceFunction).not.toContain(
      '"/api/enhance-prompt"',
    );
  });

  it("does not send selected Art Style into enhancement", () => {
    expect(enhanceFunction).not.toContain(
      "selectedStylePreset",
    );
    expect(enhanceFunction).not.toContain(
      "styleLabel",
    );
    expect(enhanceFunction).not.toContain(
      "stylePrompt",
    );
  });

  it("sends only the current Character Description", () => {
    expect(enhanceFunction).toContain(
      "prompt: cleaned",
    );
    expect(enhanceFunction).not.toContain(
      "enhanceLevel",
    );
    expect(enhanceFunction).not.toContain(
      "workflowId:",
    );
  });

  it("keeps Character-only descriptive guidance on the server", () => {
    expect(route).toContain(
      "character-description writer",
    );
    expect(route).toContain(
      "Describe what the character actually looks like rather than listing categories of detail.",
    );
    expect(route).toContain(
      "facial details",
    );
    expect(route).toContain(
      "clothing pieces",
    );
    expect(route).toContain(
      "materials",
    );
  });

  it("keeps art direction and framing out of enhancement", () => {
    expect(route).toContain(
      "Do not add an art style",
    );
    expect(route).toContain(
      "camera, lens, lighting, background, environment, composition, framing",
    );
    expect(route).toContain(
      "crop instruction, pose instruction, anatomy rule",
    );
  });

  it("keeps the result editable and Art Style separate in the UI", () => {
    expect(enhanceFunction).toContain(
      "setDescription(enhanced)",
    );
    expect(hub).toContain(
      "Art Style",
    );
    expect(hub).toContain(
      "applied separately",
    );
  });
});
