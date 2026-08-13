import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const qwenSource = fs.readFileSync(
  path.join(process.cwd(), "app", "app", "components", "QwenSceneBuilderPanel.tsx"),
  "utf8",
);

const routeSource = fs.readFileSync(
  path.join(process.cwd(), "app", "api", "production", "picture", "scene-pass", "route.ts"),
  "utf8",
);

describe("Production Storyboard equipped background contract", () => {
  it("shows equipped references and a compact background preview before submission", () => {
    expect(qwenSource).toContain("OTG_QWEN_SCENE_BACKGROUND_EQUIP_V1_START");
    expect(qwenSource).toContain('data-otg-equipped-reference-strip="true"');
    expect(qwenSource).toContain('data-otg-equipped-reference={ref.type}');
    expect(qwenSource).toContain("Background equipped");
    expect(qwenSource).toContain('data-otg-background-submit-confirmation="true"');
  });

  it("equips or replaces one background and submits the ordered reference set", () => {
    expect(qwenSource).toContain('nextReferences = nextReferences.filter((ref) => ref.locked || ref.type !== "background")');
    expect(qwenSource).toContain('references: qwenOrderedReferencesV1([...nextReferences, normalized])');
    expect(qwenSource).toContain("const referencesForSubmit = qwenOrderedReferencesV1(selectedPass.references);");
    expect(qwenSource).toContain("references: referencesForSubmit.map((ref, index) => ({");
    expect(qwenSource).toContain("Equip Background");
  });

  it("orders the workflow as base, character, background, then object without dropping the background", () => {
    expect(routeSource).toContain("OTG_SCENE_PASS_REFERENCE_ORDER_V1_START");
    expect(routeSource).toContain('if (type === "character") return 1;');
    expect(routeSource).toContain('if (type === "background" || type === "plate") return 2;');
    expect(routeSource).toContain('[scene-pass-reference-order]');
    expect(routeSource).toContain("stagedReferences: comfyReferences.map((ref) => ({");
    expect(routeSource).toContain("includesBackground: references.some");
  });
});
