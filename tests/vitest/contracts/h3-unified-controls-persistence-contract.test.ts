import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  H3_MODE_CAPABILITIES,
  h3ModeCapabilities,
  type H3StudioModeId,
} from "../../../lib/h3ModeCapabilities";
import { compileH3BodySwapPrompt } from "../../../lib/h3SpecialModes/bodySwap";
import { compileH3RealismPrompt } from "../../../lib/h3SpecialModes/realism";
import { compileH3RefModsPrompt } from "../../../lib/h3SpecialModes/refMods";

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
    expect(h3ModeCapabilities("h3-realism").supportsLookControls).toBe(true);
    expect(h3ModeCapabilities("h3-body-swap").supportsLookControls).toBe(true);
    expect(h3ModeCapabilities("h3-refmods").supportsLookControls).toBe(true);
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

  it("carries shared creative controls into special-mode prompt compilers", () => {
    const creative = {
      visualStyle: "Cinematic realism",
      cameraFeel: "Handheld documentary",
      shotFlow: "Slow push-in",
    };
    expect(compileH3RealismPrompt({
      prompt: "a person walks into a room",
      creative,
    })).toContain("creative_direction:");
    expect(compileH3BodySwapPrompt({
      selector: "person",
      prompt: "the person waves",
      creative,
    })).toContain("Camera feel: Handheld documentary.");
    expect(compileH3RefModsPrompt({
      prompt: "Isabella walks through the cafe",
      refMods: [{
        id: "isabella",
        name: "Isabella",
        category: "character",
        sourceKind: "image",
        strength: 0.9,
        components: "Auto",
        visualStrength: 0.9,
        audioStrength: 0,
        copies: 1,
        description: "character card",
        characterId: "",
      }],
      creative,
    })).toContain("Shot flow / motion direction: Slow push-in.");
  });
});

