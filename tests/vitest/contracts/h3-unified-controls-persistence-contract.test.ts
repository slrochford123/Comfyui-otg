import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  H3_MODE_CAPABILITIES,
  h3ModeCapabilities,
  type H3StudioModeId,
} from "../../../lib/h3ModeCapabilities";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

const modes: H3StudioModeId[] = [
  "h3-text-to-video",
  "h3-image-to-video",
  "h3-reference-to-video",
  "h3-realism",
  "h3-body-swap",
  "h3-refmods",
];

describe("H3 unified controls and cross-mode persistence", () => {
  it("declares one capability map for all H3 Studio modes", () => {
    expect(Object.keys(H3_MODE_CAPABILITIES).sort()).toEqual([...modes].sort());
    modes.forEach((mode) => {
      expect(h3ModeCapabilities(mode).supportsQuality).toBe(true);
      expect(h3ModeCapabilities(mode).supportsDuration).toBe(true);
      expect(h3ModeCapabilities(mode).supportsOrientation).toBe(true);
      expect(h3ModeCapabilities(mode).supportsRife).toBe(true);
    });

    expect(h3ModeCapabilities("h3-text-to-video").supportsReferenceDeck).toBe(false);
    expect(h3ModeCapabilities("h3-image-to-video").supportsSourceImage).toBe(true);
    expect(h3ModeCapabilities("h3-reference-to-video").supportsReferenceDeck).toBe(true);
    expect(h3ModeCapabilities("h3-realism").supportsRealismPreset).toBe(true);
    expect(h3ModeCapabilities("h3-body-swap").supportsBodySwapInputs).toBe(true);
    expect(h3ModeCapabilities("h3-refmods").supportsRefModSlots).toBe(true);
  });

  it("keeps optional H3 LoRAs and builder selection when switching into special modes", () => {
    const panel = read("app/app/components/H3Panel.tsx");
    expect(panel).toContain("const modeCapabilities = h3ModeCapabilities(studioMode)");
    expect(panel).toContain("function renderSharedOutputControls");
    expect(panel).toContain("function renderLegacyModelControls");
    expect(panel).not.toContain("if (!legacyModeActive) {\n      setCatalog([]);\n      setMaxLoras(0);\n      setSelectedLoras([]);");
    expect(panel).not.toContain("setSelectedLoras([]);\n    setPromptSource(\"direct\");");
  });

  it("persists shared controls plus special-mode drafts without flattening modes into one blob", () => {
    const persistence = read("app/app/components/h3InputPersistence.ts");
    const panel = read("app/app/components/H3Panel.tsx");

    expect(persistence).toContain("realismReferences?: PersistedH3MediaMeta[]");
    expect(persistence).toContain("bodySwapSourceVideo?: PersistedH3MediaMeta | null");
    expect(persistence).toContain("refModSlots?: PersistedH3RefModSlot[]");
    expect(panel).toContain("stored.realismReferences || []");
    expect(panel).toContain("stored.bodySwapSourceVideo");
    expect(panel).toContain("stored.refModSlots");
    expect(panel).toContain("realismReferences:");
    expect(panel).toContain("bodySwapSourceVideo:");
    expect(panel).toContain("refModSlots,");
    expect(panel).toContain("`realism-reference-${item.id}`");
    expect(panel).toContain("\"body-swap-source-video\"");
  });

  it("adds shared prompt affordances to special H3 prompt workspaces", () => {
    const panel = read("app/app/components/H3Panel.tsx");
    expect(panel).toContain('label="Dictate Realism prompt"');
    expect(panel).toContain('label="Dictate Body Swap instruction"');
    expect(panel).toContain('label="Dictate Ref Mods prompt"');
  });
});

