import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (relativePath: string) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

describe("Dialogue Replacement Phase 2 segment contract", () => {
  it("wires the Step 3 UI to dialogue segment creation", () => {
    const source = read(
      "app/app/components/EditVideoVoiceDubbingPanel.tsx",
    );

    expect(source).toContain("Preview Selection");
    expect(source).toContain("Cut Section");
    expect(source).toContain(
      'fetch("/api/edit-video/dialogue-segment"',
    );
    expect(source).toContain(
      'form.append("start", String(segmentStart))',
    );
    expect(source).toContain(
      'form.append("end", String(segmentEnd))',
    );
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
