import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  canonicalH3OptionalLoraFilename,
  deleteH3LoraFiles,
  extractH3OptionalLoraFilenames,
  mergeH3LoraCatalogScans,
  publicH3LoraCatalog,
  readH3LoraCatalog,
  resolveH3LoraDeleteTarget,
  validateH3LoraSelections,
  writeH3LoraCatalog,
  type H3LoraBackendScan,
  type H3LoraCatalogEntry,
} from "../../../lib/h3LoraCatalogServer";
import { buildH3Workflow } from "../../../lib/production/h3Workflows";

const temporaryFiles: string[] = [];

function entry(
  overrides: Partial<H3LoraCatalogEntry> = {},
): H3LoraCatalogEntry {
  return {
    id: "realism",
    displayName: "Realism",
    filename: "MiniMax-H3/h3-realism.safetensors",
    description: "Existing description",
    enabled: true,
    approvedForH3: true,
    approvedForT2V: true,
    approvedForI2V: false,
    approvedForR2V: false,
    defaultStrength: 0.7,
    minStrength: 0.4,
    maxStrength: 1,
    recommendedMin: 0.5,
    recommendedMax: 0.9,
    triggerWords: ["realism"],
    triggerRequired: false,
    previewImage: "preview.jpg",
    notes: "Keep me",
    discoveredOn: ["rtx3090"],
    missingOn: ["rtx5060ti"],
    compatibilityStatus: "approved",
    ...overrides,
  };
}

function catalog(entries: H3LoraCatalogEntry[]) {
  return {
    version: 1 as const,
    updatedAt: "before",
    maxSelections: 3,
    entries,
  };
}

function scan(
  backend: "rtx3090" | "rtx5060ti",
  files: string[],
  ok = true,
): H3LoraBackendScan {
  return { backend, ok, files: new Set(files), error: ok ? "" : "offline" };
}

afterEach(() => {
  delete process.env.OTG_H3_LORA_CATALOG_FILE;
  delete process.env.OTG_H3_LORA_ROOT_RTX3090;
  temporaryFiles
    .splice(0)
    .forEach((file) => fs.rmSync(file, { force: true, recursive: true }));
});

describe("H3 LoRA folder discovery", () => {
  it("discovers only MiniMax-H3 optional model files", () => {
    const files = extractH3OptionalLoraFilenames({
      input: {
        required: {
          lora_name: [
            [
              "MiniMax-H3/HMCS_V2.safetensors",
              "MiniMax-H3/lora/H3_Deeper.safetensors",
              "MiniMax-H3/Acceleration/minimax_h3_turbo_8step.safetensors",
              "LTX-2.x/motion.safetensors",
              "Qwen-Image/style.safetensors",
              "root-h3-name.safetensors",
            ],
          ],
        },
      },
    });
    expect([...files].sort()).toEqual([
      "MiniMax-H3/HMCS_V2.safetensors",
      "MiniMax-H3/lora/H3_Deeper.safetensors",
    ]);
  });

  it("rejects traversal, absolute paths, hidden files, and required acceleration LoRAs", () => {
    expect(
      canonicalH3OptionalLoraFilename("MiniMax-H3/../outside.safetensors"),
    ).toBeNull();
    expect(
      canonicalH3OptionalLoraFilename("/MiniMax-H3/model.safetensors"),
    ).toBeNull();
    expect(
      canonicalH3OptionalLoraFilename("MiniMax-H3/.cache/model.safetensors"),
    ).toBeNull();
    expect(
      canonicalH3OptionalLoraFilename(
        "MiniMax-H3/Acceleration/turbo.safetensors",
      ),
    ).toBeNull();
  });

  it("creates newly discovered policies disabled and in review", () => {
    const filename = "MiniMax-H3/new-style.safetensors";
    const result = mergeH3LoraCatalogScans(catalog([]), [
      scan("rtx3090", [filename]),
      scan("rtx5060ti", []),
    ]);
    expect(result[0]).toMatchObject({
      filename,
      enabled: false,
      approvedForH3: false,
      compatibilityStatus: "review",
      discoveredOn: ["rtx3090"],
      missingOn: ["rtx5060ti"],
    });
  });

  it("preserves existing policy metadata across resync", () => {
    const existing = entry();
    const result = mergeH3LoraCatalogScans(catalog([existing]), [
      scan("rtx3090", [existing.filename]),
      scan("rtx5060ti", [existing.filename]),
    ]);
    expect(result[0]).toMatchObject({
      id: "realism",
      notes: "Keep me",
      previewImage: "preview.jpg",
      approvedForI2V: false,
      discoveredOn: ["rtx3090", "rtx5060ti"],
      missingOn: [],
    });
  });

  it("migrates a unique basename policy to its canonical H3 filename", () => {
    const legacy = entry({ filename: "h3-realism.safetensors" });
    const filename = "MiniMax-H3/h3-realism.safetensors";
    const result = mergeH3LoraCatalogScans(catalog([legacy]), [
      scan("rtx3090", [filename]),
    ]);
    expect(result[0]).toMatchObject({
      id: legacy.id,
      filename,
      notes: legacy.notes,
      approvedForH3: true,
    });
  });

  it.each([
    ["5060 only", [], ["MiniMax-H3/a.safetensors"], ["rtx5060ti"], ["rtx3090"]],
    ["3090 only", ["MiniMax-H3/a.safetensors"], [], ["rtx3090"], ["rtx5060ti"]],
    [
      "both",
      ["MiniMax-H3/a.safetensors"],
      ["MiniMax-H3/a.safetensors"],
      ["rtx3090", "rtx5060ti"],
      [],
    ],
  ])(
    "represents %s availability",
    (_label, on3090, on5060, discoveredOn, missingOn) => {
      const result = mergeH3LoraCatalogScans(catalog([]), [
        scan("rtx3090", on3090),
        scan("rtx5060ti", on5060),
      ]);
      expect(result[0]).toMatchObject({ discoveredOn, missingOn });
    },
  );

  it("preserves prior backend status when that backend is temporarily offline", () => {
    const existing = entry({
      discoveredOn: ["rtx3090", "rtx5060ti"],
      missingOn: [],
    });
    const result = mergeH3LoraCatalogScans(catalog([existing]), [
      scan("rtx3090", [existing.filename]),
      scan("rtx5060ti", [], false),
    ]);
    expect(result[0].discoveredOn).toEqual(["rtx3090", "rtx5060ti"]);
  });
});

describe("H3 LoRA policy and deletion boundaries", () => {
  it("exposes only approved, enabled, installed, mode-eligible policies", () => {
    const file = path.join(
      os.tmpdir(),
      `h3-catalog-${process.pid}-${Date.now()}.json`,
    );
    temporaryFiles.push(file);
    process.env.OTG_H3_LORA_CATALOG_FILE = file;
    writeH3LoraCatalog(
      [
        entry(),
        entry({
          id: "review",
          filename: "MiniMax-H3/review.safetensors",
          compatibilityStatus: "review",
        }),
      ],
      3,
    );
    expect(
      publicH3LoraCatalog("h3-text-to-video").entries.map((item) => item.id),
    ).toEqual(["realism"]);
    expect(publicH3LoraCatalog("h3-image-to-video").entries).toEqual([]);
    expect(() =>
      validateH3LoraSelections(
        [{ id: "realism", strength: 1.1 }],
        "h3-text-to-video",
      ),
    ).toThrow("strength must be between");
  });

  it("resolves deletion only within the inspected MiniMax-H3 root", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "h3-root-"));
    temporaryFiles.push(root);
    process.env.OTG_H3_LORA_ROOT_RTX3090 = root;
    expect(
      resolveH3LoraDeleteTarget("rtx3090", "MiniMax-H3/lora/model.safetensors")
        .target,
    ).toBe(path.join(root, "lora/model.safetensors"));
    expect(() =>
      resolveH3LoraDeleteTarget("rtx3090", "Other/model.safetensors"),
    ).toThrow("MiniMax-H3");
    expect(() =>
      resolveH3LoraDeleteTarget(
        "rtx3090",
        "MiniMax-H3/Acceleration/turbo.safetensors",
      ),
    ).toThrow("MiniMax-H3");
  });

  it("deletes only the exact selected local file and revokes its policy", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "h3-delete-"));
    temporaryFiles.push(root);
    const target = path.join(root, "lora", "selected.safetensors");
    const neighbor = path.join(root, "lora", "neighbor.safetensors");
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, "selected");
    fs.writeFileSync(neighbor, "neighbor");
    const catalogPath = path.join(root, "catalog.json");
    process.env.OTG_H3_LORA_ROOT_RTX3090 = root;
    process.env.OTG_H3_LORA_CATALOG_FILE = catalogPath;
    writeH3LoraCatalog(
      [
        entry({
          id: "selected",
          filename: "MiniMax-H3/lora/selected.safetensors",
          discoveredOn: ["rtx3090"],
          missingOn: [],
        }),
      ],
      3,
    );
    await deleteH3LoraFiles("selected", ["rtx3090"]);
    expect(fs.existsSync(target)).toBe(false);
    expect(fs.readFileSync(neighbor, "utf8")).toBe("neighbor");
    expect(readH3LoraCatalog().entries[0]).toMatchObject({
      enabled: false,
      approvedForH3: false,
      discoveredOn: [],
      missingOn: ["rtx3090"],
      compatibilityStatus: "review",
    });
  });

  it("keeps the required Turbo node locked while layering an optional LoRA", () => {
    const built = buildH3Workflow({
      backend: "rtx3090",
      mode: "h3-text-to-video",
      h3Quality: "lq",
      durationSeconds: 5,
      finalPrompt: "test",
      seed: 1,
      outputPrefix: "test",
      optionalLoras: [
        {
          id: "optional",
          label: "Optional",
          filename: "MiniMax-H3/optional.safetensors",
          strength: 0.7,
        },
      ],
    });
    expect(built.graph["36"].inputs.strength_model).toBe(1);
    expect(built.graph["70"].inputs.model).toEqual(["36", 0]);
  });
});
