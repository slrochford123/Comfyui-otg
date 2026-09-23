import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  readH3LoraCatalog,
  validateH3LoraSelections,
  writeH3LoraCatalog,
} from "../../../lib/h3LoraCatalogServer";
import {
  buildH3StudioLockedReferences,
  composeH3StudioFinalPrompt,
  h3StudioPromptFingerprint,
} from "../../../lib/h3Studio";
import { buildH3Workflow } from "../../../lib/production/h3Workflows";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const temporaryFiles: string[] = [];

afterEach(() => {
  delete process.env.OTG_H3_LORA_CATALOG_FILE;
  temporaryFiles.splice(0).forEach((file) => fs.rmSync(file, { force: true }));
});

describe("H3 Studio redesign contracts", () => {
  it("uses the shared durable Production Ollama operation and explicit review UI", () => {
    const panel = read("app/app/components/H3Panel.tsx");
    const route = read("app/api/h3/prompt/route.ts");
    expect(route).toContain("enqueueProductionV2PromptOperation");
    expect(route).toContain("createProductionV2Scene");
    expect(panel).toContain("Your Original");
    expect(panel).toContain("Ollama Suggestion");
    expect(panel).toContain("Keep Original");
    expect(panel).toContain("Use Suggested Prompt");
    expect(panel).toContain(
      "The optional Builder prompt changed.",
    );
    expect(panel).toContain("Use Current Raw Prompt");
  });

  it("assembles protected image, video-audio, and standalone-audio mappings deterministically", () => {
    const locked = buildH3StudioLockedReferences({
      mode: "h3-reference-to-video",
      references: [
        { id: "a", kind: "audio", name: "voice.wav", description: "narrator" },
        {
          id: "v",
          kind: "video",
          name: "move.mp4",
          description: "motion",
          includeAudio: true,
        },
        { id: "i", kind: "image", name: "hero.png", description: "hero" },
      ],
    });
    expect(locked).toContain("<Picture 1> / <Subject 1> = hero");
    expect(locked).toContain("<Video 1> = motion");
    expect(locked).toContain("<Audio 1> = audio from <Video 1>");
    expect(locked).toContain("<Audio 2> = narrator");
    expect(composeH3StudioFinalPrompt(locked, "Scene body")).toBe(
      `${locked}\n\nScene body`,
    );
  });

  it("marks every model-facing field as part of the prompt fingerprint", () => {
    const base = {
      mode: "h3-text-to-video" as const,
      quality: "lq" as const,
      orientation: "landscape" as const,
      durationSeconds: 5 as const,
      originalPrompt: "scene",
      scenePrompt: "built",
      visualStyle: "Cinematic realism",
      cameraFeel: "Static composition",
      shotFlow: "One continuous shot",
      soundDirection: "",
      thingsToAvoid: "",
      references: [],
      loras: [],
    };
    expect(h3StudioPromptFingerprint(base)).not.toBe(
      h3StudioPromptFingerprint({ ...base, quality: "hq" }),
    );
    expect(h3StudioPromptFingerprint(base)).not.toBe(
      h3StudioPromptFingerprint({ ...base, orientation: "portrait" }),
    );
    expect(h3StudioPromptFingerprint(base)).not.toBe(
      h3StudioPromptFingerprint({
        ...base,
        loras: [{ id: "x", strength: 0.7 }],
      }),
    );
    expect(h3StudioPromptFingerprint(base)).not.toBe(
      h3StudioPromptFingerprint({
        ...base,
        structured: { camera: "dolly left" },
      }),
    );
  });

  it("enforces admin approval, mode policy, count, and strength server-side", () => {
    const file = path.join(
      os.tmpdir(),
      `h3-lora-${process.pid}-${Date.now()}.json`,
    );
    temporaryFiles.push(file);
    process.env.OTG_H3_LORA_CATALOG_FILE = file;
    const entry = {
      id: "test-lora",
      displayName: "Test LoRA",
      filename: "MiniMax-H3/test-lora.safetensors",
      description: "test",
      enabled: true,
      approvedForH3: true,
      approvedForT2V: true,
      approvedForI2V: true,
      approvedForR2V: false,
      defaultStrength: 0.7,
      minStrength: 0.4,
      maxStrength: 1,
      recommendedMin: 0.5,
      recommendedMax: 0.9,
      triggerWords: [],
      triggerRequired: false,
      previewImage: "",
      notes: "",
      discoveredOn: ["rtx3090" as const],
      missingOn: ["rtx5060ti" as const],
      compatibilityStatus: "approved" as const,
    };
    writeH3LoraCatalog([entry], 1);
    expect(
      validateH3LoraSelections(
        [{ id: entry.id, strength: 0.7 }],
        "h3-text-to-video",
      ).resolved[0].filename,
    ).toBe(entry.filename);
    expect(() =>
      validateH3LoraSelections(
        [{ id: entry.id, strength: 1.2 }],
        "h3-text-to-video",
      ),
    ).toThrow("strength must be between");
    expect(() =>
      validateH3LoraSelections(
        [{ id: entry.id, strength: 0.7 }],
        "h3-reference-to-video",
      ),
    ).toThrow("not approved");
  });

  it("inserts optional LoRAs after the validated FastH3 base without changing B02 preview settings", () => {
    const built = buildH3Workflow({
      backend: "rtx3090",
      mode: "h3-text-to-video",
      h3Quality: "lq",
      durationSeconds: 5,
      finalPrompt: "A scene",
      seed: 1,
      outputPrefix: "test/h3-studio",
      optionalLoras: [
        {
          id: "creative",
          label: "Creative",
          filename: "creative.safetensors",
          strength: 0.65,
        },
      ],
    });
    expect(built.graph["30"].inputs.unet_name).toBe("fastvideo_fasth3_8step_v2_pruned_int8_convrot.safetensors");
    expect(built.graph["70"]).toMatchObject({
      class_type: "LoraLoaderModelOnly",
      inputs: {
        model: ["30", 0],
        lora_name: "creative.safetensors",
        strength_model: 0.65,
      },
    });
    expect(built.graph["38"].inputs.model).toEqual(["70", 0]);
    expect(built.graph["164"].inputs.tiny_vae).toBe("taeh3.safetensors");
  });
});
