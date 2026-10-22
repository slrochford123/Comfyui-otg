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

  it("sends trained Character voices through Applio and reference samples through Seed-VC", () => {
    const source = read(
      "app/app/components/EditVideoVoiceDubbingPanel.tsx",
    );

    expect(source).toContain('engine: target.engine === "character" ? "applio" : "auto"');
    expect(source).toContain('dubMode: mode === "rewrite" ? "rewrite_line" : "preserve_performance"');
    expect(source).toContain('emotion: "preserve"');
    expect(source).toContain("modelPath: target.modelPath || \"\"");
    expect(source).toContain("indexPath: target.indexPath || \"\"");
    expect(source).toContain("samplePath: target.samplePath || (target.engine === \"reference\" ? target.path : \"\")");
    expect(source).toContain('fetch("/api/production/audio/dub-preview"');
  });

  it("presents the simplified upload, analyze, map, and convert workflow", () => {
    const source = read(
      "app/app/components/EditVideoVoiceDubbingPanel.tsx",
    );

    expect(source).toContain("Video Voice Studio");
    expect(source).toContain("Preserve Performance");
    expect(source).toContain("Rewrite Dialogue");
    expect(source).toContain("Upload Video");
    expect(source).toContain("Analyze Speech");
    expect(source).toContain("Assign target voices");
    expect(source).toContain("Convert Voices");
    expect(source).toContain('fetch("/api/production/audio/analyze-clip"');
    expect(source).toContain('fetch("/api/voice/reference"');
  });
});
