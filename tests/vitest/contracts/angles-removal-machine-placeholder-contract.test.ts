import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function exists(relativePath: string): boolean {
  return fs.existsSync(path.join(root, relativePath));
}

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

describe("Angles removal and Story Creator contract", () => {
  it("removes Angles-only application code and workflows", () => {
    const removed = [
      "app/app/components/AnglesPanel.tsx",
      "app/app/components/AnglesDirectorCameraControl.tsx",
      "app/app/components/AdvancedPanel.tsx",
      "app/app/components/OtgMultiAngleControl.tsx",
      "app/app/components/anglesErrorText.ts",
      "app/app/components/page.tsx",
      "app/api/angles",
      "app/api/3d",
      "app/app/3d-poc",
      "app/app/3d-character-mv",
      "lib/threeDJobs.ts",
      "lib/anglesCamera.ts",
      "lib/anglesHistory.ts",
      "scripts/angles",
      "comfy_workflows/presets/angles.json",
      "comfy_workflows/presets/3D Model.json",
      "comfy_workflows/internal/angles_3d_mesh_hunyuan_v21.json",
      "comfy_workflows/internal/angles_3d_preview.json",
      "comfy_workflows/internal/angles_3d_trellis2_character_mv_textured_glb.json",
      "comfy_workflows/internal/angles_3d_trellis2_textured_glb.json",
      "comfy_workflows/internal/angles_multiview_texture_turntable_v11.json",
      "comfy_workflows/internal/angles_multiview_texture_turntable_v12_hotfix.json",
    ];

    for (const relativePath of removed) {
      expect(
        exists(relativePath),
        `Angles-only path must be removed: ${relativePath}`,
      ).toBe(false);
    }
  });

  it("preserves shared multiview and reference functionality", () => {
    const preserved = [
      "app/api/background-angle-plate",
      "workflows/backgrounds/qwen-background-angle-plate.json",
      "app/app/components/CharactersPanel.tsx",
      "app/app/components/CharacterHubPanel.tsx",
      "app/api/comfy/route.ts",
      "app/api/characters/3d-model/route.ts",
      "app/api/preview/file/route.ts",
      "lib/production/referenceCatalog.ts",
      "lib/client/characterCardClient.ts",
      "comfy_workflows/presets/1_click_multiple_character_angles.json",
      "comfy_workflows/presets/character_card_8_angles_low_angle.json",
      "comfy_workflows/presets/TripoSplat Model Spin.json",
      "comfy_workflows/internal/character-reference/qwen_character_4angle_lowres.json",
    ];

    for (const relativePath of preserved) {
      expect(
        exists(relativePath),
        `Shared path must survive Angles removal: ${relativePath}`,
      ).toBe(true);
    }
  });

  it("replaces the Angles navigation surface with Story Creator", () => {
    const app = read("app/app/AppPageClient.tsx");
    const nav = read("app/app/components/SpinDialNav.tsx");

    expect(app).not.toContain("import AnglesPanel");
    expect(app).not.toContain("<AnglesPanel");
    expect(nav).not.toMatch(/label\s*:\s*["']Angles["']/);
    expect(`${app}\n${nav}`).toMatch(/Story Creator/);
    expect(app).toMatch(/["']machine["']/);
  });

  it("keeps the legacy /angles route only as a redirect to Story Creator", () => {
    const source = read("app/angles/page.tsx");

    expect(source).toContain("tab=machine");
    expect(source).not.toContain("<AnglesPanel");
    expect(source).not.toContain("AnglesDirectorCameraControl");
  });
  it("removes legacy Angles routing hooks without deleting shared reference features", () => {
    expect(exists("app/api/preview/route.ts")).toBe(false);
    expect(exists("app/api/preview/file/route.ts")).toBe(true);

    const characters = read("app/app/components/CharactersPanel.tsx");
    expect(characters).not.toContain('"/api/preview"');
    expect(characters).not.toContain("Character Card and Angles");
    expect(characters).not.toContain("Character Card or Angles");

    const support = read("app/app/components/SupportPanel.tsx");
    expect(support).not.toMatch(/<b>Angles<\/b>/);
    expect(support).not.toMatch(/["']Angles["']/);

    expect(read("app/api/jobs/route.ts")).not.toContain("angles-3d");
    expect(read("lib/jobs/types.ts")).not.toContain('"angles-3d"');

    expect(read("app/api/workflows/run/route.ts")).not.toMatch(
      /workflowId\s*===\s*["']angles["']/,
    );

    expect(read("lib/workflows/manifest.ts")).not.toMatch(
      /^\s*angles\s*:/m,
    );

    const index = JSON.parse(read("comfy_workflows/index.json"));
    expect(
      (index.workflows || []).some((item: any) => item?.id === "presets/angles"),
    ).toBe(false);

    const capabilities = JSON.parse(
      read("config/comfy-workflow-capabilities.json"),
    );

    const capabilityIds = new Set(
      (capabilities.workflows || []).map((item: any) => item?.id),
    );

    for (const removedId of [
      "internal/angles_3d_mesh_hunyuan_v21",
      "internal/angles_3d_preview",
      "internal/angles_3d_trellis2_character_mv_textured_glb",
      "internal/angles_3d_trellis2_textured_glb",
      "internal/angles_multiview_texture_turntable_v11",
      "internal/angles_multiview_texture_turntable_v12_hotfix",
      "presets/3D Model",
      "presets/angles",
    ]) {
      expect(capabilityIds.has(removedId)).toBe(false);
    }

    for (const preservedId of [
      "presets/TripoSplat Model Spin",
      "presets/1_click_multiple_character_angles",
      "presets/character_card_8_angles_low_angle",
      "internal/character-reference/qwen_character_4angle_lowres",
    ]) {
      expect(capabilityIds.has(preservedId)).toBe(true);
    }
  });

});
