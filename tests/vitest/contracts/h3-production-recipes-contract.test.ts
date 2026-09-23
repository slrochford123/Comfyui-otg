import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  getH3ProductionRecipe,
  getH3ProductionTimeEstimate,
  H3_PRODUCTION_DURATION_OPTIONS,
  H3_PRODUCTION_RECIPES,
  H3_PRODUCTION_ROUTE_KEYS,
  H3_QUALITY_OPTIONS,
  h3ProductionRouteKey,
  normalizeH3Quality,
  type H3ProductionBackendId,
  type H3ProductionDuration,
  type H3ProductionMode,
  type H3Quality,
} from "../../../lib/production/h3ProductionRecipes";

const root = path.resolve(__dirname, "../../..");
const backends: H3ProductionBackendId[] = ["rtx5060ti", "rtx3090"];
const modes: H3ProductionMode[] = [
  "h3-text-to-video",
  "h3-image-to-video",
  "h3-reference-to-video",
];
const durations: H3ProductionDuration[] = [5, 10];
const qualities: H3Quality[] = ["lq", "hq"];

describe("MiniMax H3 LQ/HQ production recipe matrix", () => {
  it("accepts only the two quality tiers and defaults unknown values to LQ", () => {
    expect(H3_QUALITY_OPTIONS).toEqual(["lq", "hq"]);
    expect(normalizeH3Quality("hq")).toBe("hq");
    expect(normalizeH3Quality("lq")).toBe("lq");
    expect(normalizeH3Quality("1.2mp")).toBe("lq");
    expect(normalizeH3Quality(undefined)).toBe("lq");
    expect(H3_PRODUCTION_DURATION_OPTIONS).toEqual([5, 10]);
  });

  it("registers exactly 24 unique, existing, deterministic route files", () => {
    expect(H3_PRODUCTION_ROUTE_KEYS).toHaveLength(24);
    expect(new Set(H3_PRODUCTION_ROUTE_KEYS).size).toBe(24);
    expect(Object.keys(H3_PRODUCTION_RECIPES)).toHaveLength(24);

    for (const backend of backends) {
      for (const mode of modes) {
        for (const duration of durations) {
          for (const quality of qualities) {
            const key = h3ProductionRouteKey(backend, mode, duration, quality);
            const recipe = getH3ProductionRecipe(mode, duration, backend, quality);
            expect(recipe.routeKey).toBe(key);
            expect(fs.existsSync(path.join(root, recipe.workflowFile))).toBe(true);
          }
        }
      }
    }
  });

  it("installs all 24 FastH3 B02 approximate-preview runtime graphs with provenance", () => {
    const provenance = JSON.parse(fs.readFileSync(
      path.join(root, "comfy_workflows/internal/production-v2/h3-b02-approx-preview/INSTALL_PROVENANCE.json"),
      "utf8",
    )) as { installed: string[]; activeFamily: string };
    expect(provenance.activeFamily).toBe("FastH3_B02_T2V_I2V_REF2VA_R2V_REFERENCE_VIDEO_APPROX_PREVIEW");
    expect(provenance.installed).toHaveLength(24);
    for (const route of provenance.installed) {
      const graph = fs.readFileSync(path.join(root, route), "utf8");
      expect(crypto.createHash("sha256").update(graph).digest("hex")).toMatch(/^[a-f0-9]{64}$/);
      expect(graph).toContain("ModelPreviewOverrideKJ");
      if (route.includes("_R2V_")) {
        expect(graph).toContain("minimax_h3_ref2va_pruned_int8_convrot.safetensors");
        expect(graph).toContain("minimax_h3_ref2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors");
        expect(graph).toContain("H3SLAAttention");
      } else {
        expect(graph).toContain("fastvideo_fasth3_8step_v2_pruned_int8_convrot.safetensors");
      }
    }
  });

  it("locks the LQ/HQ native contracts and validated FastH3 B02 preview recipe", () => {
    for (const recipe of Object.values(H3_PRODUCTION_RECIPES)) {
      expect([recipe.megapixels, recipe.nativeWidth, recipe.nativeHeight])
        .toEqual(recipe.quality === "lq" ? [0.6, 1056, 608] : [1, 1376, 768]);
      expect(recipe.frameCount).toBe(recipe.durationSeconds === 5 ? 124 : 243);
      expect(recipe.steps).toBe(8);
      expect(recipe.turboLoraStrength).toBe(1);
      expect(recipe.turboLoraFamily).toBe(recipe.mode === "h3-reference-to-video" ? "ref2va" : "none");
      expect(recipe.attentionPath).toBe("comfy_kitchen");
      expect(recipe.spectrumEnabled).toBe(false);
      expect(recipe.videoSigmaShift).toBe(recipe.mode === "h3-reference-to-video" ? 6 : 10);
      expect(recipe.audioSigmaShift).toBe(3);
      expect(recipe.preSubmitCleanup).toBeNull();
    }
  });

  it("does not register 1.2 MP, 1504x832, Spectrum, or obsolete 4-step graphs", () => {
    const registeredGraphs = H3_PRODUCTION_ROUTE_KEYS.map((key) => {
      const recipe = H3_PRODUCTION_RECIPES[key];
      return fs.readFileSync(path.join(root, recipe.workflowFile), "utf8");
    }).join("\n");

    expect(registeredGraphs).not.toMatch(/1504|832|1\.2/);
    expect(registeredGraphs).not.toMatch(/SpectrumApplyMiniMaxH3/i);
    expect(registeredGraphs).not.toMatch(/turbo_4step|4step/i);
  });

  it("fails a missing exact route instead of falling back to another tier", () => {
    expect(() => getH3ProductionRecipe(
      "h3-text-to-video",
      5,
      "rtx3090",
      "missing" as H3Quality,
    )).toThrow("No qualified MiniMax H3 workflow is registered");
  });

  it("returns exact backend ETA metadata or the backend range", () => {
    expect(getH3ProductionTimeEstimate("h3-image-to-video", 5, "lq", "rtx5060ti"))
      .toEqual({ seconds: 95.409, minSeconds: 95.409, maxSeconds: 95.409 });
    expect(getH3ProductionTimeEstimate("h3-reference-to-video", 10, "hq"))
      .toEqual({ seconds: null, minSeconds: 680.282, maxSeconds: 940.042 });
  });
});
