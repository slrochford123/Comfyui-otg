import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  H3_STYLE_ID_ALIASES,
  H3_STYLE_REGISTRY,
  resolveH3CanonicalStyle,
} from "../../../lib/h3StyleRegistry";
import { normalizeProductionV2 } from "../../../lib/production/v2";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("unified H3 style selector contracts", () => {
  it("uses one shared selector in H3 Generate and Production Pipeline", () => {
    expect(read("app/app/components/H3Panel.tsx")).toContain("<H3StyleSelector");
    expect(read("app/app/components/ProductionV2Panel.tsx")).toContain("<H3StyleSelector");
  });

  it("loads animation only for the selected style and posters in the browser", () => {
    const source = read("app/app/components/H3StyleSelector.tsx");
    expect(source).toContain("function SelectedStylePreview");
    expect(source).toContain("autoPlay={!reducedMotion}");
    expect(source).toContain("loop muted playsInline");
    expect(source).toContain('loading="lazy"');
    expect(source).toContain("H3_STYLE_REGISTRY.filter");
    expect(source.match(/<video/g)).toHaveLength(1);
  });

  it("keeps unpublished media optional without disabling a style", () => {
    expect(H3_STYLE_REGISTRY.every((style) => style.enabled)).toBe(true);
    expect(H3_STYLE_REGISTRY.some((style) => !style.previewVideo)).toBe(true);
    expect(read("app/app/components/H3StyleSelector.tsx")).toContain(
      "The style remains fully usable.",
    );
  });

  it("resolves explicit aliases and migrates old Production visual-style names", () => {
    expect(H3_STYLE_ID_ALIASES["Cinematic realism"]).toBe("cinematic-realism");
    expect(resolveH3CanonicalStyle("Cinematic realism")?.id).toBe("cinematic-realism");
    const production = normalizeProductionV2({
      id: "p1",
      name: "legacy",
      status: "draft",
      scenes: [{ id: "s1", order: 1, promptOptions: { visualStyle: "Anime" } }],
    });
    expect(production.scenes[0]?.promptOptions.visualStyleId).toBe("anime");
    expect(production.scenes[0]?.promptOptions.visualStyle).toBe("Anime");
  });
});
