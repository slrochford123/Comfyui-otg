import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  categorizeH3RefModLibraryEntry,
  compileH3RefModsPrompt,
  isSafeRefModName,
  normalizeH3RefModSlots,
  refModSlotWarnings,
  reorderH3RefMods,
  validateH3RefModsRequest,
} from "../../../lib/h3SpecialModes/refMods";
import {
  h3RefModSidecarPath,
  isSafeRefModBaseName,
  normalizeH3RefModCreateConfig,
  validateH3RefModCreateRequest,
} from "../../../lib/h3SpecialModes/refModCreation";
import {
  buildH3RefModAudioPackWorkflow,
  buildH3RefModVisualPackWorkflow,
} from "../../../lib/h3SpecialModes/refModCreationWorkflow";
import { H3_PRODUCTION_ROUTE_KEYS } from "../../../lib/production/h3ProductionRecipes";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("H3 Ref Mods special mode contract", () => {
  it("adds a sixth Ref Mods tab without entering the normal H3 recipe matrix", () => {
    const panel = read("app/app/components/H3Panel.tsx");
    expect(panel).toContain('| "h3-refmods"');
    expect(panel).toContain('label: "Ref Mods"');
    expect(panel).toContain("lg:grid-cols-6");
    expect(panel).toContain('data-otg="h3-refmods-workspace"');
    expect(panel).toContain("/api/h3/special/refmods/library");
    expect(panel).toContain("/api/h3/special/refmods/generation");
    expect(panel).toContain("/api/h3/special/refmods/create");
    expect(panel).toContain('data-otg="h3-refmods-create"');
    expect(H3_PRODUCTION_ROUTE_KEYS.some((key) => key.includes("refmods"))).toBe(false);
    expect(read("lib/production/h3Workflows.ts")).not.toContain("h3-refmods");
  });

  it("preserves imported source workflows and records missing generation sources separately", () => {
    const sourceDir = path.join(root, "comfy_workflows/internal/h3-refmods/source");
    expect(fs.existsSync(path.join(sourceDir, "mm-refmod-audio-pack-by-loratech.source.json"))).toBe(true);
    expect(fs.existsSync(path.join(sourceDir, "mm-refmod-video-pack-by-loratech.source.json"))).toBe(true);
    expect(fs.existsSync(path.join(sourceDir, "face-creator.source.json"))).toBe(true);
    expect(fs.existsSync(path.join(sourceDir, "dataset-generator-v2-by-loratech.source.json"))).toBe(true);
    expect(fs.existsSync(path.join(sourceDir, "checkpoint-tester.source.json"))).toBe(true);
  });

  it("enforces the 8 RefMod cap server-side", () => {
    const refMods = Array.from({ length: 8 }, (_, index) => ({
      name: `characters/person-${index + 1}`,
      category: "character",
    }));
    expect(normalizeH3RefModSlots(refMods)).toHaveLength(8);
    expect(() =>
      normalizeH3RefModSlots([
        ...refMods,
        { name: "characters/person-9", category: "character" },
      ]),
    ).toThrow("at most 8 RefMods");
  });

  it("rejects unsafe library names and invalid strength controls", () => {
    expect(isSafeRefModName("characters/isabella")).toBe(true);
    expect(isSafeRefModName("../isabella")).toBe(false);
    expect(isSafeRefModName("/tmp/isabella")).toBe(false);
    expect(isSafeRefModName("isabella.safetensors")).toBe(false);
    expect(() =>
      normalizeH3RefModSlots([{ name: "isabella", strength: 1.2 }]),
    ).toThrow("strength must be between 0 and 1");
    expect(() =>
      normalizeH3RefModSlots([{ name: "isabella", visualStrength: -0.1 }]),
    ).toThrow("visual strength must be between 0 and 1");
  });

  it("keeps slot reordering deterministic", () => {
    const slots = normalizeH3RefModSlots([
      { id: "a", name: "characters/isabella", category: "character" },
      { id: "b", name: "characters/mika", category: "character" },
      { id: "c", name: "motion/walk", category: "motion" },
    ]);
    expect(reorderH3RefMods(slots, ["b", "a"]).map((slot) => slot.id)).toEqual(["b", "a", "c"]);
  });

  it("warns when a visual RefMod has effective visual strength zero", () => {
    const [slot] = normalizeH3RefModSlots([
      {
        name: "characters/isabella",
        category: "character",
        components: "Visual",
        visualStrength: 0,
      },
    ]);
    expect(refModSlotWarnings(slot)).toContain("Visual component is disabled for this RefMod.");
  });

  it("compiles deterministic subject mapping for one and two character RefMods", () => {
    const one = compileH3RefModsPrompt({
      prompt: "Isabella sits at a cafe.",
      refMods: normalizeH3RefModSlots([
        { name: "characters/isabella", category: "character", sourceKind: "video" },
      ]),
    });
    expect(one).toContain("<Subject 1> = RefMod slot 1");
    expect(one).toContain("<Video 1>");
    expect(one).toContain("Isabella sits at a cafe.");

    const two = compileH3RefModsPrompt({
      prompt: "Isabella and Mika are sitting together at a cafe talking.",
      refMods: normalizeH3RefModSlots([
        { name: "characters/mika", category: "character", sourceKind: "video" },
        { name: "characters/isabella", category: "character", sourceKind: "video" },
      ]),
    });
    expect(two.indexOf('"characters/mika"')).toBeLessThan(two.indexOf('"characters/isabella"'));
    expect(two).toContain("<Subject 1> = RefMod slot 1");
    expect(two).toContain("<Subject 2> = RefMod slot 2");
  });

  it("compiles mixed character, motion, and audio guidance without inventing characters", () => {
    const compiled = compileH3RefModsPrompt({
      prompt: "Isabella walks into the room while soft cafe ambience plays.",
      refMods: normalizeH3RefModSlots([
        { name: "characters/isabella", category: "character", sourceKind: "video" },
        { name: "motion/slow-walk", category: "motion", sourceKind: "video" },
        { name: "audio/cafe-room", category: "audio", sourceKind: "audio" },
      ]),
    });
    expect(compiled).toContain("subject_definitions:");
    expect(compiled).toContain("retention_analysis:");
    expect(compiled).toContain("overall_soundscape:");
    expect(compiled).toContain("<Subject 1>");
    expect(compiled).toContain("<Video 2>");
    expect(compiled).toContain("<Audio 1>");
    expect(compiled).not.toContain("<Subject 2>");
  });

  it("categorizes RefMod library entries by kind and metadata", () => {
    expect(categorizeH3RefModLibraryEntry({ kind: "audio", concept: "ambience" })).toBe("audio");
    expect(categorizeH3RefModLibraryEntry({ kind: "bundle" })).toBe("bundle");
    expect(categorizeH3RefModLibraryEntry({ kind: "video", concept: "identity" })).toBe("character");
    expect(categorizeH3RefModLibraryEntry({ kind: "video", concept: "pose_motion" })).toBe("motion");
  });

  it("rejects malformed generation requests before Comfy submission", () => {
    const route = read("app/api/h3/special/refmods/generation/route.ts");
    expect(route).toContain("validateH3RefModsRequest");
    expect(route).toContain("quarantined until the dedicated RefMod T2V API workflow");
    expect(() =>
      validateH3RefModsRequest({
        mode: "h3-refmods",
        quality: "sh",
        orientation: "landscape",
        durationSeconds: 5,
        prompt: "test",
        refMods: Array.from({ length: 9 }, (_, index) => ({ name: `mod-${index}` })),
      }),
    ).toThrow("at most 8 RefMods");
  });

  it("validates RefMod creation names, source counts, and sidecar paths", () => {
    expect(isSafeRefModBaseName("isabella_refmod")).toBe(true);
    expect(isSafeRefModBaseName("characters/isabella")).toBe(false);
    const character = normalizeH3RefModCreateConfig({
      kind: "character",
      name: "isabella_refmod",
      characterId: "char-1",
    });
    expect(character.libraryName).toBe("characters/isabella_refmod");
    expect(h3RefModSidecarPath(character.libraryName)).toContain("h3-special/refmods/registry/characters/isabella_refmod.json");
    expect(() =>
      validateH3RefModCreateRequest(
        { kind: "character", name: "too_few" },
        [{ path: "/tmp/1.png", name: "1.png", kind: "image" }],
      ),
    ).toThrow("4-8 images");
    expect(() =>
      validateH3RefModCreateRequest(
        { kind: "motion", name: "walk" },
        [{ path: "/tmp/a.mp4", name: "a.mp4", kind: "video", durationSeconds: 31 }],
      ),
    ).toThrow("30 seconds or shorter");
  });

  it("builds dedicated RefMod creator workflows without mutating standard H3 recipes", () => {
    const visual = buildH3RefModVisualPackWorkflow({
      folder: "otg_refmods/job-1",
      name: "isabella_refmod",
      subfolder: "characters",
      kind: "character",
      sourceCount: 8,
      description: "canonical image set",
    });
    expect(visual.workflowId).toBe("h3-refmod-visual-pack");
    expect(visual.libraryName).toBe("characters/isabella_refmod");
    expect(visual.graph["1"].inputs.vae_name).toBe("minimax_h3_video_vae_fp16.safetensors");
    expect(visual.graph["2"].class_type).toBe("MiniMaxH3RefModFolderLoader");
    expect(visual.graph["2"].inputs.folder).toBe("otg_refmods/job-1");
    expect(visual.graph["2"].inputs.max_items).toBe(8);
    expect(visual.graph["3"].inputs.concept_type).toBe("identity");
    expect(visual.graph["3"].inputs.save).toBe(false);
    expect(visual.graph["4"].inputs.subfolder).toBe("characters");

    const audio = buildH3RefModAudioPackWorkflow({
      audioFilename: "beat.wav",
      name: "lofi_beat",
      subfolder: "audio",
      audioCategory: "music",
      description: "lo-fi beat",
    });
    expect(audio.workflowId).toBe("h3-refmod-audio-pack");
    expect(audio.graph["1"].class_type).toBe("LoadAudio");
    expect(audio.graph["2"].inputs.vae_name).toBe("minimax_h3_audio_vae_fp32.safetensors");
    expect(audio.graph["3"].inputs.concept_type).toBe("music_style");
    expect(audio.graph["3"].inputs.save).toBe(false);
    expect(audio.graph["4"].inputs.subfolder).toBe("audio");
  });
});
