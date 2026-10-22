import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (relativePath: string) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

describe("Dialogue Replacement Phase 2 segment contract", () => {
  it("wires detected dialogue sections to editable timing boundaries", () => {
    const source = read(
      "app/app/components/EditVideoVoiceDubbingPanel.tsx",
    );

    expect(source).toContain("function updateSegment");
    expect(source).toContain('key: "start" | "end"');
    expect(source).toContain('onChange={(event) => updateSegment');
    expect(source).toContain('"start", Number(event.target.value)');
    expect(source).toContain('"end", Number(event.target.value)');
  });

  it("creates an exact standalone segment with restitch metadata", () => {
    const route = read(
      "app/api/edit-video/dialogue-segment/route.ts",
    );

    expect(route).toContain("edit_video_dialogue_segment_jobs");
    expect(route).toContain('Number(form.get("start"))');
    expect(route).toContain('Number(form.get("end"))');
    expect(route).toContain('const sourceFileName = `source${sourceExt}`');
    expect(route).toContain(
      'const segmentFileName = "dialogue_segment.mp4"',
    );
    expect(route).toContain('"libx264"');
    expect(route).toContain(
      'operation: "select-dialogue-section"',
    );
    expect(route).toContain(
      'safeJoin(jobDir, "selection.json")',
    );
  });
});
