import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const routePath = path.join(
  process.cwd(),
  "app",
  "api",
  "production",
  "picture",
  "scene-pass",
  "route.ts",
);

const source = fs.readFileSync(routePath, "utf8");

describe("Production scene-pass reference staging", () => {
  it("preserves source locators until staging", () => {
    expect(source).toContain("if (/^https?:\\/\\//i.test(raw)) return raw;");
    expect(source).toContain('if (raw.startsWith("/api/")) return raw;');
    expect(source).toContain("if (path.isAbsolute(raw) && await scenePassFileExistsV36BPG1(raw))");
  });

  it("searches the configured OTG data roots", () => {
    expect(source).toContain("process.env.OTG_DATA_ROOT");
    expect(source).toContain("process.env.OTG_DATA_DIR");
  });

  it("uses the configured image backend and uploads references", () => {
    expect(source).toContain("process.env.OTG_PRODUCTION_SCENE_PASS_COMFY_URL");
    expect(source).toContain("process.env.OTG_ANGLES_IMAGE_COMFY_URL");
    expect(source).toContain("process.env.COMFY_BASE_URL");
    expect(source).toContain('"http://127.0.0.1:8188"');
    expect(source).toContain("/upload/image");
    expect(source).toContain("OTG_SCENE_PASS_REFERENCE_STAGING_V36BPG3");
    expect(source).toContain('[scene-pass-reference-staging]');
  });
});
