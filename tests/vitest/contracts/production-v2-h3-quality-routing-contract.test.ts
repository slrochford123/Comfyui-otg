import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  addProductionV2Scene,
  createProductionV2,
  createProductionV2Scene,
  normalizeProductionV2,
  normalizeProductionV2DurationForModel,
  switchProductionV2SceneModel,
} from "../../../lib/production/v2";

const root = path.resolve(__dirname, "../../..");

describe("Production V2 H3 quality persistence and UI contract", () => {
  it("defaults new and legacy H3 scenes to LQ", () => {
    expect(createProductionV2Scene(1, "minimax-h3").h3Quality).toBe("lq");
    const production = createProductionV2("Legacy", "minimax-h3");
    const raw = JSON.parse(JSON.stringify(production));
    delete raw.scenes[0].h3Quality;
    expect(normalizeProductionV2(raw).scenes[0].h3Quality).toBe("lq");
  });

  it("preserves quality through serialization and independently per scene", () => {
    let production = createProductionV2("Quality", "minimax-h3");
    production.scenes[0].h3Quality = "hq";
    production = addProductionV2Scene(production, "minimax-h3");
    production.scenes[1].h3Quality = "lq";
    production.activeSceneId = production.scenes[1].id;

    const loaded = normalizeProductionV2(JSON.parse(JSON.stringify(production)));
    expect(loaded.scenes.map((scene) => scene.h3Quality)).toEqual(["hq", "lq"]);
    expect(loaded.scenes.find((scene) => scene.id === loaded.activeSceneId)?.h3Quality).toBe("lq");
  });

  it("keeps H3 quality dormant and unchanged when switching to LTX", () => {
    const h3 = createProductionV2Scene(1, "minimax-h3");
    h3.h3Quality = "hq";
    const ltx = switchProductionV2SceneModel(h3, "ltx-2.5");
    expect(ltx.model).toBe("ltx-2.5");
    expect(ltx.h3Quality).toBe("hq");
  });

  it("keeps 15-second H3 scenes unavailable and normalizes them to 10 seconds", () => {
    expect(normalizeProductionV2DurationForModel("minimax-h3", 15)).toBe(10);
  });

  it("renders the LQ/HQ control only inside the MiniMax H3 UI branch", () => {
    const panel = fs.readFileSync(
      path.join(root, "app/app/components/ProductionV2Panel.tsx"),
      "utf8",
    );
    expect(panel).toContain('data-otg="production-v2-h3-quality-control"');
    expect(panel).toMatch(/selectedScene\.model === "minimax-h3"[\s\S]{0,500}production-v2-h3-quality-control/);
    expect(panel).toContain('h3Quality: "lq"');
    expect(panel).toContain('h3Quality: "hq"');
  });

  it("copies the source H3 quality into Continue Scene", () => {
    const route = fs.readFileSync(
      path.join(root, "app/api/production/v2/postprocess/route.ts"),
      "utf8",
    );
    expect(route).toMatch(/generationMode:\s*"h3-image-to-video" as const,[\s\S]{0,200}h3Quality:\s*sourceScene\.h3Quality/);
  });
});
