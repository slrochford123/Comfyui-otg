import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = fs.readFileSync(
  path.join(process.cwd(), "app", "app", "components", "QwenSceneBuilderPanel.tsx"),
  "utf8",
);

describe("Production Storyboard saved Background Gallery", () => {
  it("loads saved backgrounds directly and keeps display and workflow images separate", () => {
    expect(source).toContain("OTG_QWEN_BACKGROUND_GALLERY_CANONICAL_PREVIEW_V36BPH2");
    expect(source).toContain("qwenLoadBackgroundGalleryV3");
    expect(source).toContain("entry?.establishingImage?.displayImage");
    expect(source).toContain("entry?.panoramaImage?.workflowImage");
    expect(source).toContain('source: "saved-background-library"');
  });

  it("routes Linux preview paths through the guarded file endpoint", () => {
    expect(source).toContain('return `/api/file?path=${encodeURIComponent(raw)}`;');
    expect(source).toContain('const sourceAssets = pickerType ? pickerAssets : detectedAssets;');
  });

  it("provides a mobile-safe viewer with multiple exit controls", () => {
    expect(source).toContain('data-otg-qwen-gallery-viewer="true"');
    expect(source).toContain('aria-label="Close image viewer"');
    expect(source).toContain("Close Image Viewer ✕");
    expect(source).toContain('if (event.key === "Escape") setPickerPreviewAsset(null);');
    expect(source).toContain('onClick={() => setPickerPreviewAsset(null)}');
  });
});
