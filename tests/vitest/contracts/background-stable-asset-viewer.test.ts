import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const route = fs.readFileSync(path.join(root, "app/api/backgrounds/route.ts"), "utf8");
const store = fs.readFileSync(path.join(root, "lib/backgrounds/store.ts"), "utf8");
const characters = fs.readFileSync(path.join(root, "app/app/components/CharactersPanel.tsx"), "utf8");

describe("background stable asset and viewer contract", () => {
  it("canonicalizes temporary Comfy history references into stable owner assets", () => {
    expect(route).toContain("OTG_BACKGROUND_STABLE_ASSET_CANONICALIZATION_V36BPI1");
    expect(route).toContain("/api/comfy/history-image");
    expect(route).toContain("/view");
    expect(route).toContain("backgroundAssetDir");
    expect(route).toContain("backgroundImageUrlForPath");
    expect(route).toContain("listAndRepairBackgrounds");
  });

  it("restricts background imports to exact configured origins and approved media roots", () => {
    expect(route).toContain("OTG_BACKGROUND_IMPORT_EXACT_ORIGIN_AND_MEDIA_ROOTS_V36BSEC1");
    expect(route).toContain("new URL(base).origin === target.origin");
    expect(route).toContain("configuredBackgroundImportRoots");
    expect(route).toContain("fs.realpathSync");
    expect(route).not.toContain("isPrivateOrLocalHost");
  });

  it("deletes only stable assets that are no longer referenced", () => {
    expect(store).toContain("OTG_BACKGROUND_DELETE_UNSHARED_ASSETS_V36BSEC1");
    expect(store).toContain("retainedAssets.has(candidate)");
    expect(store).toContain("recordAssetPaths");
  });

  it("keeps panorama workflow images ahead of establishing images", () => {
    expect(store).toContain("OTG_BACKGROUND_STABLE_ASSET_STORE_V36BPI1");
    const workflowBlock = store.slice(store.indexOf("const workflowImage ="), store.indexOf("const record:", store.indexOf("const workflowImage =")));
    expect(workflowBlock.indexOf("panoramaImage?.workflowImage")).toBeGreaterThanOrEqual(0);
    expect(workflowBlock.indexOf("establishingImage?.workflowImage")).toBeGreaterThan(workflowBlock.indexOf("panoramaImage?.workflowImage"));
  });

  it("provides a mobile-safe Background Studio viewer and broken-image fallback", () => {
    expect(characters).toContain("OTG_BACKGROUND_STABLE_ASSET_VIEWER_V36BPI1");
    expect(characters).toContain("Close Image Viewer ✕");
    expect(characters).toContain("savedBackgroundImageFailuresV36BPI1");
    expect(characters).toContain("event.target === event.currentTarget");
    expect(characters).toContain('event.key === "Escape"');
    expect(characters).toContain('document.body.style.overflow = "hidden"');
    expect(characters).toContain("Refresh Library to repair it");
  });
});
