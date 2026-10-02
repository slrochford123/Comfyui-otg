import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (relativePath: string) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

describe("H3 video snapshot picker", () => {
  it("restores snapshot entry points for first, last, and reference images", () => {
    const panel = read("app/app/components/H3Panel.tsx");

    expect(panel).toContain(
      'import VideoSnapshotPicker from "@/app/app/components/VideoSnapshotPicker";',
    );
    expect(panel).toContain("const [snapshotTarget, setSnapshotTarget]");
    expect(panel).toContain('"first" | "last" | "reference-image" | ""');
    expect(panel).toContain("setSnapshotTarget(target)");
    expect(panel).toContain('setSnapshotTarget("reference-image")');
    expect(panel.match(/>\s*Snapshot\s*</g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("routes a captured snapshot into the selected H3 image slot", () => {
    const panel = read("app/app/components/H3Panel.tsx");

    expect(panel).toContain("<VideoSnapshotPicker");
    expect(panel).toContain("open={Boolean(snapshotTarget)}");
    expect(panel).toContain("replaceSingle(firstImage, file, setFirstImage)");
    expect(panel).toContain("replaceSingle(lastImage, file, setLastImage)");
    expect(panel).toContain('addReference("image", file)');
    expect(panel).toContain('setSnapshotTarget("");');
  });

  it("keeps the picker able to upload, scrub, capture, download, and use a video frame", () => {
    const picker = read("app/app/components/VideoSnapshotPicker.tsx");

    expect(picker).toContain('const SNAPSHOT_MIME_TYPE = "image/jpeg";');
    expect(picker).toContain("Choose Video");
    expect(picker).toContain('accept="video/*"');
    expect(picker).toContain('aria-label="Snapshot video position"');
    expect(picker).toContain('document.createElement(');
    expect(picker).toContain('"canvas"');
    expect(picker).toContain("context.drawImage(");
    expect(picker).toContain("canvas.toBlob(");
    expect(picker).toContain("downloadFile(");
    expect(picker).toContain("Download Snapshot");
    expect(picker).toContain("Use Snapshot");
    expect(picker).toContain("await onSnapshot(result)");
  });
});
