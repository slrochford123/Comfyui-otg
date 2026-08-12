import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const panelPath = path.join(process.cwd(), "app/app/components/CharactersPanel.tsx");
const panelSource = fs.readFileSync(panelPath, "utf8");

describe("Characters Boogu model coverage", () => {
  it("adds Boogu to the main character generator choices", () => {
    expect(panelSource).toContain('type CharacterGeneratorOptionId = "ernie" | "zturbo" | "krea2" | "boogu";');
    expect(panelSource).toContain('id: "boogu"');
    expect(panelSource).toContain('subtitle: "Boogu Image 0.1 Turbo"');
    expect(panelSource).toContain('workflowId: "presets/image_boogu_image_0_1_turbo_t2i"');
    expect(panelSource).toContain('stored === "boogu"');
  });

  it("uses the audited Boogu prompt, output, and seed nodes", () => {
    expect(panelSource).toContain('payload.promptNodeId = "43"');
    expect(panelSource).toContain('payload.saveImageNodeId = "33"');
    expect(panelSource).toContain('payload.seedNodeId = "44"');
  });

  it("adds Boogu to every visible Characters Background Studio model choice", () => {
    expect(panelSource).toContain('["boogu", "Boogu Image 0.1 Turbo"]');
    expect(panelSource).toContain('id: "boogu" as const');
    expect(panelSource).toContain('type CharacterBackgroundProvider = "ernie-image" | "z-turbo" | "krea2-turbo" | "boogu";');
  });

  it("routes Background Studio Boogu requests through the verified preset", () => {
    expect(panelSource).toContain('if (provider === "boogu")');
    expect(panelSource).toContain('body.set("workflowId", "presets/image_boogu_image_0_1_turbo_t2i")');
    expect(panelSource).toContain('body.set("promptNodeId", "43")');
    expect(panelSource).toContain('body.set("saveImageNodeId", "33")');
    expect(panelSource).toContain('body.set("seedNodeId", "44")');
  });

  it("does not override character-card workflow submissions", () => {
    expect(panelSource).toContain("if (isCharacterCardRequest)");
    expect(panelSource).toContain("return originalFetch(input as any, init);");
    expect(panelSource).toContain('includes("presets/character_card_8_angles_low_angle")');
  });
});
