// @vitest-environment node

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const route = fs.readFileSync(
  path.join(
    process.cwd(),
    "app/api/characters/create-image/route.ts",
  ),
  "utf8",
);

const start = route.indexOf("const STYLE_PROMPTS:");
const end = route.indexOf("const supportCache", start);
const presets = route.slice(start, end);

describe("Character style presets Phase 6d", () => {
  it("does not use silhouette wording in style presets", () => {
    expect(presets.toLowerCase()).not.toContain("silhouette");
  });

  it("keeps all six style presets", () => {
    for (const preset of [
      "cartoon:",
      "anime:",
      '"pixar-3d":',
      '"unreal-engine":',
      "photorealistic:",
      "cinematic:",
    ]) {
      expect(presets).toContain(preset);
    }
  });
});
