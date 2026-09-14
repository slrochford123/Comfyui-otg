import { describe, expect, it } from "vitest";

import fs from "node:fs";
import path from "node:path";
import {
  assertProductionV2,
  composeProductionV2FinalPrompt,
  createProductionV2,
  normalizeProductionV2DurationForModel,
  productionV2DurationsForModel,
  productionV2LtxCharacterReferenceImage,
} from "@/lib/production/v2";
import {
  buildLtx25IngredientsLockedContext,
  buildLtx25IngredientsManifest,
} from "@/lib/production/ltx25IngredientsManifest";
import {
  LTX25_INGREDIENTS_QUALIFIED_DURATIONS,
  ltx25IngredientsFrameCount,
} from "@/lib/production/ltx25IngredientsWorkflow";

describe("Production V2 LTX 2.5 R13C authority + 5/10 duration", () => {
  it("qualifies exactly 5 and 10 seconds and maps them to 121/241 frames", () => {
    expect(productionV2DurationsForModel("ltx-2.5")).toEqual([5, 10]);
    expect([...LTX25_INGREDIENTS_QUALIFIED_DURATIONS]).toEqual([5, 10]);
    expect(normalizeProductionV2DurationForModel("ltx-2.5", 10)).toBe(10);
    expect(ltx25IngredientsFrameCount(5)).toBe(121);
    expect(ltx25IngredientsFrameCount(10)).toBe(241);
  });

  it("uses the Character Card as the LTX Character Ingredient authority", () => {
    const production = createProductionV2("R13C Character", "ltx-2.5");
    const character = {
      characterId: "char-1",
      snapshotName: "io",
      defaultImageRef: { workflowImage: "/weak-front.png" },
      characterCardRef: { workflowImage: "/strong-card.png" },
      ltxReferenceView: "left" as const,
      ltxViewImageRefs: {
        left: { workflowImage: "/weak-left.png" },
      },
      identityDescription: "io canonical identity",
      speaking: false,
      visible: true,
    };
    production.scenes[0].selectedCharacters = [character];
    expect(productionV2LtxCharacterReferenceImage(character)?.workflowImage).toBe(
      "/strong-card.png",
    );
  });

  it("builds the deterministic Ingredient manifest from Character Card, Background Master, then Asset default", () => {
    const production = createProductionV2("R13C Manifest", "ltx-2.5");
    const scene = production.scenes[0];
    scene.selectedCharacters = [
      {
        characterId: "char-1",
        snapshotName: "io",
        defaultImageRef: { workflowImage: "/weak-front.png" },
        characterCardRef: { workflowImage: "/strong-card.png" },
        ltxReferenceView: "left",
        ltxViewImageRefs: { left: { workflowImage: "/weak-left.png" } },
        identityDescription: "io canonical identity",
        speaking: false,
        visible: true,
      },
    ];
    scene.selectedBackground = {
      backgroundId: "bg-1",
      snapshotName: "Courtyard",
      masterImageRef: { workflowImage: "/background-master.png" },
      angleImageRefs: {
        front: { workflowImage: "/background-front.png" },
      },
      referenceView: "front",
      identityDescription: "Courtyard canonical environment",
    };
    scene.selectedAssets = [
      {
        assetId: "asset-1",
        snapshotName: "Relic",
        defaultImageRef: { workflowImage: "/asset-default.png" },
        identityDescription: "Relic canonical design",
      },
    ];

    const manifest = buildLtx25IngredientsManifest(scene);
    const serialized = JSON.stringify(manifest);
    expect(serialized).toContain("/strong-card.png");
    expect(serialized).not.toContain("/weak-front.png");
    expect(serialized).not.toContain("/weak-left.png");
    expect(serialized).toContain("/background-master.png");
    expect(serialized).not.toContain("/background-front.png");
    expect(serialized).toContain("/asset-default.png");
    expect(serialized.indexOf("/strong-card.png")).toBeLessThan(
      serialized.indexOf("/background-master.png"),
    );
    expect(serialized.indexOf("/background-master.png")).toBeLessThan(
      serialized.indexOf("/asset-default.png"),
    );
  });

  it("separates Reference sheet identity from Generated video action", () => {
    const production = createProductionV2("R13C Prompt", "ltx-2.5");
    const scene = production.scenes[0];
    scene.selectedCharacters = [
      {
        characterId: "char-1",
        snapshotName: "io",
        defaultImageRef: { workflowImage: "/weak-front.png" },
        characterCardRef: { workflowImage: "/strong-card.png" },
        identityDescription: "io canonical identity",
        speaking: false,
        visible: true,
      },
    ];
    const locked = buildLtx25IngredientsLockedContext(
      buildLtx25IngredientsManifest(scene),
    );
    const finalPrompt = composeProductionV2FinalPrompt(
      locked,
      "io walks across the courtyard.",
    );
    expect(finalPrompt).toContain("Reference sheet:");
    expect(finalPrompt).toContain("Generated video:");
    expect(finalPrompt.indexOf("Reference sheet:")).toBeLessThan(
      finalPrompt.indexOf("Generated video:"),
    );
    expect(finalPrompt.indexOf("Generated video:")).toBeLessThan(
      finalPrompt.indexOf("io walks across the courtyard."),
    );
  });

  it("keeps Continue Scene first-frame conditioning independent of the Ingredients manifest", () => {
    const route = fs.readFileSync(
      path.join(process.cwd(), "app/api/production/v2/generation/route.ts"),
      "utf8",
    );
    const jobs = fs.readFileSync(
      path.join(process.cwd(), "lib/production/ltx25IngredientsJobs.ts"),
      "utf8",
    );
    expect(route).toContain("manifest,");
    expect(route).toContain("continuationFirstFramePath,");
    expect(jobs).toContain("continuationFirstFramePath");
  });

  it("keeps the reference-sheet composer as conditioning-only black/text-free application output", () => {
    const sheet = fs.readFileSync(
      path.join(process.cwd(), "lib/production/ltx25IngredientsSheet.ts"),
      "utf8",
    );
    expect(sheet).toContain("background");
    expect(sheet).not.toMatch(/<text[\s>]/i);
    expect(sheet).not.toContain("Character 1");
    expect(sheet).not.toContain("Ingredient 1");
    expect(sheet).not.toContain("Reference sheet:");
  });

  it("accepts the 10-second duration at the core Production assertion", () => {
    const production = createProductionV2("R13C 10s", "ltx-2.5");
    production.scenes[0].durationSeconds = 10;
    expect(() => assertProductionV2(production)).not.toThrow();
  });
});
