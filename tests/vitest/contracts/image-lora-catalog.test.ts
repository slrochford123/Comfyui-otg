import { describe, expect, it } from "vitest";

import {
  reconcileImageLoraCatalog,
  type ImageLoraCatalogEntry,
} from "../../../lib/imageLoraCatalogServer";

function entry(overrides: Partial<ImageLoraCatalogEntry> = {}): ImageLoraCatalogEntry {
  return {
    name: "existing.safetensors",
    label: "Existing",
    description: "Existing description",
    usage: "Existing usage",
    strength: 1,
    mature: false,
    modelId: "presets/image_ernie_image_turbo",
    enabled: true,
    discoveredOn: [],
    missingOn: [],
    ...overrides,
  };
}

describe("image LoRA catalog synchronization", () => {
  it("adds newly discovered files as disabled admin-review items", () => {
    const result = reconcileImageLoraCatalog([], [
      { id: "rtx5060ti", ok: true, files: new Set(["new/style.safetensors"]) },
      { id: "rtx3090", ok: true, files: new Set(["new/style.safetensors"]) },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      name: "new/style.safetensors",
      label: "style",
      modelId: "",
      enabled: false,
      discoveredOn: ["rtx5060ti", "rtx3090"],
      missingOn: [],
    });
  });

  it("flags a backend-specific missing file without disabling a usable entry", () => {
    const result = reconcileImageLoraCatalog([entry()], [
      { id: "rtx5060ti", ok: true, files: new Set(["existing.safetensors"]) },
      { id: "rtx3090", ok: true, files: new Set() },
    ]);
    expect(result[0]).toMatchObject({
      enabled: true,
      discoveredOn: ["rtx5060ti"],
      missingOn: ["rtx3090"],
    });
  });

  it("automatically disables a catalog entry missing from every healthy backend", () => {
    const result = reconcileImageLoraCatalog([entry()], [
      { id: "rtx5060ti", ok: true, files: new Set() },
      { id: "rtx3090", ok: false, files: new Set() },
    ]);
    expect(result[0]).toMatchObject({ enabled: false, discoveredOn: [], missingOn: ["rtx5060ti"] });
  });
});
