import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const route = fs.readFileSync(
  path.join(process.cwd(), "app/api/characters/create-image/route.ts"),
  "utf8",
);
const panel = fs.readFileSync(
  path.join(process.cwd(), "app/app/components/CharacterHubPanel.tsx"),
  "utf8",
);

describe("Characters Qwen output contract", () => {
  it("uses the model-native Qwen portrait width in the workflow and API response", () => {
    expect(route).toContain("const QWEN_OUTPUT_WIDTH = 1088;");
    expect(route).toContain('setInput(graph, "456", "width", QWEN_OUTPUT_WIDTH);');
    expect(route).toContain("outputSizeForModel(config.id)");
  });

  it("shows the same Qwen dimensions in the Android Character Studio UI", () => {
    expect(panel).toContain("function characterOutputForModel(modelId: CharacterModelId)");
    expect(panel).toContain("width: 1088, height: 1920");
    expect(panel).toContain("characterOutput.width");
    expect(panel).toContain("characterOutput.height");
  });
});
