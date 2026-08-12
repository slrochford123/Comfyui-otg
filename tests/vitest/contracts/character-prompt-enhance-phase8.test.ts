// @vitest-environment node

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const hub = fs.readFileSync(
  path.join(
    process.cwd(),
    "app/app/components/CharacterHubPanel.tsx",
  ),
  "utf8",
);

const enhanceFunctionStart = hub.indexOf(
  "async function enhanceCharacterDescription()",
);
const enhanceFunctionEnd = hub.indexOf(
  "const isFreeform =",
  enhanceFunctionStart,
);
const enhanceFunction = hub.slice(
  enhanceFunctionStart,
  enhanceFunctionEnd,
);

describe("Character Prompt Enhance Phase 8", () => {
  it("adds the Enhance Prompt button to Character Description", () => {
    expect(hub).toContain(
      'data-otg="character-description-enhance"',
    );
    expect(hub).toContain(
      '"Enhance Prompt"',
    );
    expect(hub).toContain(
      '"Enhancing Description..."',
    );
  });

  it("uses the dedicated Character description enhancement API", () => {
    expect(enhanceFunction).toContain(
      '"/api/characters/enhance-description"',
    );
    expect(enhanceFunction).not.toContain(
      '"/api/enhance-prompt"',
    );
    expect(enhanceFunction).toContain(
      'credentials: "include"',
    );
  });

  it("sends only the editable Character description", () => {
    expect(enhanceFunction).toContain(
      "prompt: cleaned",
    );
    expect(enhanceFunction).not.toContain("enhanceLevel");
    expect(enhanceFunction).not.toContain("workflowId:");
  });

  it("keeps Character Art Style separate from enhancement", () => {
    expect(enhanceFunction).not.toContain(
      "selectedStylePreset",
    );
    expect(enhanceFunction).not.toContain("styleLabel");
    expect(enhanceFunction).not.toContain("stylePrompt");
  });

  it("replaces the same editable Character Description field", () => {
    expect(hub).toContain(
      "setDescription(enhanced)",
    );
    expect(hub).toContain(
      "Review or edit it before generating.",
    );
  });

  it("keeps enhancement separate from Generate Character", () => {
    expect(hub).toContain(
      "onClick={enhanceCharacterDescription}",
    );
    expect(hub).toContain(
      "onClick={generateCharacter}",
    );
  });
});
