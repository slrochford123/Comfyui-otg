import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { H3_STYLE_PRESETS, resolveH3StylePreset } from "../../../lib/h3StylePresets";
import mediaManifest from "../../../lib/h3StyleMediaManifest.json";

const repoRoot = process.cwd();
const creativeStyles = H3_STYLE_PRESETS.filter((preset) => preset.id !== "none");
const manifest = mediaManifest as Record<string, { poster: string; previewVideo: string; previewGenerationPrompt?: string }>;

function publicFile(url: string) {
  return path.join(repoRoot, "public", url.replace(/^\//, ""));
}

describe("H3 style preview asset integration", () => {
  it("maps all 61 creative styles to preview assets and leaves Default / None without media", () => {
    expect(creativeStyles).toHaveLength(61);
    expect(Object.keys(manifest)).toHaveLength(61);
    expect(manifest).not.toHaveProperty("none");
    for (const preset of creativeStyles) {
      expect(manifest[preset.id], preset.id).toBeTruthy();
      expect(preset.preview?.poster).toBe(manifest[preset.id].poster);
      expect(preset.preview?.previewVideo).toBe(manifest[preset.id].previewVideo);
    }
  });

  it("keeps canonical aliases wired without renaming canonical IDs", () => {
    expect(resolveH3StylePreset("ink")?.id).toBe("sumi-e-ink");
    expect(resolveH3StylePreset("doodle-children-s-marker")?.id).toBe("childrens-marker");
    expect(resolveH3StylePreset("tom-and-jerry-style")?.id).toBe("theatrical-slapstick");
  });

  it("has every poster and preview video on disk", () => {
    for (const preset of creativeStyles) {
      const preview = manifest[preset.id];
      expect(fs.existsSync(publicFile(preview.poster)), `${preset.id} poster`).toBe(true);
      expect(fs.existsSync(publicFile(preview.previewVideo)), `${preset.id} video`).toBe(true);
    }
  });

  it("preserves preview prompts separately from master style prompts", () => {
    for (const preset of creativeStyles) {
      const previewPrompt = String(manifest[preset.id].previewGenerationPrompt || "").trim();
      expect(previewPrompt, `${preset.id} preview prompt`).not.toEqual("");
      expect(preset.masterPrompt, `${preset.id} master prompt`).not.toEqual(previewPrompt);
    }
  });

  it("uses static posters in selector cards and only one selected video component", () => {
    const source = fs.readFileSync(
      path.join(repoRoot, "app/app/components/H3StylePresetPicker.tsx"),
      "utf8",
    );
    expect(source).toContain('data-otg="h3-style-card-poster"');
    expect(source).toContain('data-otg="h3-selected-style-video"');
    expect(source).toContain('data-otg="h3-style-browser-toggle"');
    expect(source).toContain('data-otg="h3-style-card-browser"');
    expect(source).toContain("const [browserOpen, setBrowserOpen] = useState(false)");
    expect(source).toContain("setBrowserOpen(false)");
    expect(source).toContain('browserOpen ? "Hide Styles" : "Choose Style"');
    expect(source).toContain("autoPlay={shouldAutoplay}");
    expect(source).toContain("muted");
    expect(source).toContain("loop");
    expect(source).toContain("playsInline");
    expect(source).toContain("setPlaying((current) => !current)");
    expect(source).not.toMatch(/data-otg="h3-style-card"[\s\S]{0,500}<video/);
  });

  it("shares the canonical picker across H3 Studio and Production", () => {
    const h3Panel = fs.readFileSync(path.join(repoRoot, "app/app/components/H3Panel.tsx"), "utf8");
    const productionPanel = fs.readFileSync(path.join(repoRoot, "app/app/components/ProductionV2Panel.tsx"), "utf8");
    expect(h3Panel).toContain("H3StylePresetPicker");
    expect(productionPanel).toContain("H3StylePresetPicker");
    expect(productionPanel).toContain("resolveH3StylePresetByLabel");
  });
});
