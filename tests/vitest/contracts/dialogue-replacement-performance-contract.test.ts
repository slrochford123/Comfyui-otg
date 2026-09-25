import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (relativePath: string) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

describe("Dialogue Replacement performance conversion contract", () => {
  it("exposes Dialogue Replacement in Edit Video", () => {
    const editVideo = read("app/app/components/EditVideoPanel.tsx");
    expect(editVideo).toContain(
      '{ id: "voice", label: "Dialogue Replacement", disabled: false }',
    );
  });

  it("sends trained Character voices through Applio Preserve Performance", () => {
    const source = read(
      "app/app/components/EditVideoVoiceDubbingPanel.tsx",
    );

    expect(source).toContain(
      'const trainedCharacter = selectedModel.engine === "character"',
    );
    expect(source).toContain('form.append("engine", "applio")');
    expect(source).toContain(
      'form.append("model_path", selectedModel.modelPath || selectedModel.path)',
    );
    expect(source).toContain(
      'form.append("index_path", selectedModel.indexPath || "")',
    );
    expect(source).toContain(
      'form.append("dub_mode", "preserve_performance")',
    );
    expect(source).toContain('form.append("emotion", "preserve")');
  });

  it("presents the three-step Dialogue Replacement workflow", () => {
    const source = read(
      "app/app/components/EditVideoVoiceDubbingPanel.tsx",
    );

    expect(source).toContain("Dialogue Replacement");
    expect(source).toContain("Step 1: Perform the line");
    expect(source).toContain("Step 2: Convert to character voice");
    expect(source).toContain(
      "Put the approved performance into an existing video",
    );
    expect(source).toContain("MiniMax H3 lip-sync replacement");
    expect(source).toContain("Conform + automatic re-stitch");
  });
});
