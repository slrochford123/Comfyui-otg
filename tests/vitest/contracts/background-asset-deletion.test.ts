import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const tempRoots: string[] = [];

afterEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("background stable asset lifecycle", () => {
  it("retains a shared asset until the last referencing background is deleted", async () => {
    const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "otg-background-delete-"));
    tempRoots.push(dataRoot);
    vi.stubEnv("OTG_DATA_DIR", dataRoot);
    vi.resetModules();

    const store = await import("@/lib/backgrounds/store");
    const ownerKey = "asset-owner";
    const assetPath = path.join(store.backgroundAssetDir(ownerKey), "shared.png");
    fs.writeFileSync(assetPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const imageUrl = store.backgroundImageUrlForPath(assetPath);

    store.saveBackground(ownerKey, {
      id: "first",
      name: "First",
      imagePath: assetPath,
      imageUrl,
      displayImage: imageUrl,
      workflowImage: assetPath,
    });
    store.saveBackground(ownerKey, {
      id: "second",
      name: "Second",
      imagePath: assetPath,
      imageUrl,
      displayImage: imageUrl,
      workflowImage: assetPath,
    });

    expect(store.deleteBackground(ownerKey, "first")).toBe(true);
    expect(fs.existsSync(assetPath)).toBe(true);
    expect(store.deleteBackground(ownerKey, "second")).toBe(true);
    expect(fs.existsSync(assetPath)).toBe(false);
  });
});
