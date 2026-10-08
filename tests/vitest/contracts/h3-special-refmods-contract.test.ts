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
  H3_LTX_ALPHA_GENERATOR_ID,
  H3_LTX_ALPHA_REQUIRED_NODE_CLASSES,
  inspectH3LtxAlphaCompatibility,
} from "../../../lib/h3SpecialModes/ltxAlphaMotion";
import {
  buildH3RefModAudioPackWorkflow,
  buildH3RefModVisualPackWorkflow,
} from "../../../lib/h3SpecialModes/refModCreationWorkflow";
import {
  selectH3RefModSavedPathFromHistoryEntry,
} from "../../../lib/h3SpecialModes/refModCreationJobs";
import {
  buildH3RefModsT2VWorkflow,
} from "../../../lib/h3SpecialModes/refModsWorkflow";
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
    expect(route).toContain("createH3RefModsJob");
    expect(route).toContain("startH3RefModsJob");
    expect(route).not.toContain("quarantined until the dedicated RefMod T2V API workflow");
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

  it("builds a dedicated RefMods T2V workflow with loader slots and text encoder wiring", () => {
    const compiled = compileH3RefModsPrompt({
      prompt: "Isabella smiles at the camera.",
      refMods: normalizeH3RefModSlots([
        {
          name: "characters/isabella",
          category: "character",
          sourceKind: "video",
          strength: 0.9,
          components: "All",
          visualStrength: 1,
          audioStrength: 1,
        },
      ]),
    });
    const built = buildH3RefModsT2VWorkflow({
      backend: "rtx3090",
      quality: "sh",
      orientation: "landscape",
      durationSeconds: 5,
      prompt: compiled,
      refMods: normalizeH3RefModSlots([
        {
          name: "characters/isabella",
          category: "character",
          sourceKind: "video",
          strength: 0.9,
          components: "All",
          visualStrength: 1,
          audioStrength: 1,
        },
      ]),
      turbo: true,
      seed: 424242,
      outputPrefix: "otg_h3_refmods/test",
    });
    expect(built.workflowId).toBe("h3-refmods-t2v");
    expect(built.workflowFile).toContain("minimax_h3_t2v_rtx3090.json");
    expect(built.nativeWidth).toBe(608);
    expect(built.nativeHeight).toBe(352);
    expect(built.graph["9400"].class_type).toBe("MiniMaxH3RefModsLoader");
    expect(built.graph["9400"].inputs.mod_1).toBe("characters/isabella");
    expect(built.graph["9400"].inputs.strength_1).toBe(0.9);
    expect(built.graph["9400"].inputs.components_1).toBe("All");
    expect(built.graph["9401"].class_type).toBe("MiniMaxH3RefModTextEncode");
    expect(built.graph["9401"].inputs.mods).toEqual(["9400", 0]);
    expect(built.graph["9401"].inputs.vae).toEqual(["3", 0]);
    expect(built.graph["32"].inputs.conditioning).toEqual(["9401", 0]);
    expect(built.graph["21"].inputs.latent_image).toEqual(["39", 1]);
    expect(built.graph["39"].inputs.width).toBe(608);
    expect(built.graph["39"].inputs.height).toBe(352);
    expect(built.graph["39"].inputs.prompt).toBe(compiled);
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

  it("records Motion RefMod subject/camera isolation intent without mutating source clips", async () => {
    const subject = validateH3RefModCreateRequest(
      {
        kind: "motion",
        name: "walk_subject",
        motionType: "subject",
        isolateSubject: true,
      },
      [{ path: "/tmp/source.mp4", name: "source.mp4", kind: "video", durationSeconds: 4 }],
    );
    expect(subject.config.motionType).toBe("subject");
    expect(subject.config.isolateSubject).toBe(true);

    const camera = validateH3RefModCreateRequest(
      {
        kind: "motion",
        name: "orbit_camera",
        motionType: "camera_scene",
        isolateSubject: true,
      },
      [{ path: "/tmp/source.mp4", name: "source.mp4", kind: "video", durationSeconds: 4 }],
    );
    expect(camera.config.motionType).toBe("camera_scene");
    expect(camera.config.isolateSubject).toBe(false);

    expect(() =>
      validateH3RefModCreateRequest(
        { kind: "motion", name: "too_long_isolated", isolateSubject: true },
        [{ path: "/tmp/source.mp4", name: "source.mp4", kind: "video", durationSeconds: 7 }],
      ),
    ).toThrow("Subject Motion isolation is limited to 6 seconds");

    const unavailable = await inspectH3LtxAlphaCompatibility("");
    expect(unavailable.compatible).toBe(false);
    expect(unavailable.missingNodes).toEqual([...H3_LTX_ALPHA_REQUIRED_NODE_CLASSES]);
    expect(H3_LTX_ALPHA_GENERATOR_ID).toBe("ltx-2.5-alpha-gen");

    const jobs = read("lib/h3SpecialModes/refModCreationJobs.ts");
    expect(jobs).toContain("LTX 2.5 Alpha Generation is unavailable on this backend");
    expect(jobs).toContain("isolatedDerivativePath");
    expect(jobs).not.toContain("grayscale alpha matte directly");
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

  it("prefers the RefMod save output path over model asset filenames in creation history", () => {
    const saved = selectH3RefModSavedPathFromHistoryEntry({
      prompt: {
        "1": {
          class_type: "VAELoader",
          inputs: { vae_name: "minimax_h3_video_vae_fp16.safetensors" },
        },
      },
      outputs: {
        "3": {
          text: [
            JSON.stringify({
              saved_paths: [],
              name: "isabella",
            }),
          ],
        },
        "4": {
          text: [
            "/home/shawn-rochford/AI/ComfyUI/models/refmods/characters/isabella.safetensors",
          ],
        },
      },
    });
    expect(saved).toBe("/home/shawn-rochford/AI/ComfyUI/models/refmods/characters/isabella.safetensors");
  });
});
