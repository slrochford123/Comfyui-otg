import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  productionAudioAnalysisRoot,
  productionAudioGalleryRoots,
  productionAudioProductionsRoot,
} from "@/lib/productionAudioSourcePaths";

describe("Production Audio Studio persistent source paths", () => {
  it("searches the authenticated owner's persistent gallery first", () => {
    const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "otg-audio-root-"));
    const configuredGalleryDir = path.join(dataRoot, "configured-gallery");

    const roots = productionAudioGalleryRoots("slrochford123", {
      dataRoot,
      configuredGalleryDir,
      galleryProfile: "test_profile",
    });

    expect(roots[0]).toBe(
      path.join(dataRoot, "user_galleries", "slrochford123"),
    );
    expect(roots).toContain(configuredGalleryDir);
    expect(roots).toContain(
      path.join(dataRoot, "user_galleries", "test_profile"),
    );
    expect(roots).toContain(
      path.join(dataRoot, "user_galleries", "default"),
    );
  });

  it("deduplicates owner, configured, and profile gallery roots", () => {
    const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "otg-audio-dedupe-"));
    const ownerGallery = path.join(
      dataRoot,
      "user_galleries",
      "test_profile",
    );

    const roots = productionAudioGalleryRoots("test_profile", {
      dataRoot,
      configuredGalleryDir: ownerGallery,
      galleryProfile: "test_profile",
    });

    expect(roots.filter((value) => value === ownerGallery)).toHaveLength(1);
  });

  it("derives analysis and production roots from the persistent data root", () => {
    const dataRoot = path.join(os.tmpdir(), "otg-runtime-test-data");

    expect(productionAudioProductionsRoot(dataRoot)).toBe(
      path.join(dataRoot, "productions"),
    );
    expect(productionAudioAnalysisRoot(dataRoot)).toBe(
      path.join(dataRoot, "production_audio_analysis"),
    );
  });

  it("binds both Audio Studio routes to the shared persistent path helper", () => {
    const analyze = fs.readFileSync(
      path.join(
        process.cwd(),
        "app/api/production/audio/analyze-clip/route.ts",
      ),
      "utf8",
    );
    const dub = fs.readFileSync(
      path.join(
        process.cwd(),
        "app/api/production/audio/dub-preview/route.ts",
      ),
      "utf8",
    );

    for (const source of [analyze, dub]) {
      expect(source).toContain("productionAudioGalleryRoots");
      expect(source).toContain("productionAudioProductionsRoot");
      expect(source).toContain("for (const galleryRoot of galleryRoots)");
      expect(source).not.toContain(
        'path.join(REPO_ROOT, "data", "productions")',
      );
    }

    expect(analyze).toContain("productionAudioAnalysisRoot");
    expect(analyze).toContain("const ownerKey = await ownerKeyFromRequest(request)");
    expect(dub).toContain("const ownerKey = await ownerKeyFromRequest(request)");
  });
});
