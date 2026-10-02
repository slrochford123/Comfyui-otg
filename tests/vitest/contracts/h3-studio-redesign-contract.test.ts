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
  buildH3QuotedDialogueContract,
  composeH3StudioFinalPrompt,
  extractH3QuotedDialogue,
  h3StudioPromptFingerprint,
  preserveH3QuotedDialogue,
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
  it("preserves quoted character dialogue verbatim through Prompt Builder", () => {
    const original = 'Maya says “We leave at sunrise.” Then Jo answers "I am ready."';
    expect(extractH3QuotedDialogue(original).map((item) => item.text)).toEqual([
      "We leave at sunrise.",
      "I am ready.",
    ]);
    expect(buildH3QuotedDialogueContract(original)).toContain(
      "Do not omit, summarize, paraphrase, translate, merge, or add words",
    );

    const restored = preserveH3QuotedDialogue(
      original,
      "Maya and Jo agree to leave together.",
    );
    expect(restored).toContain('“We leave at sunrise.”');
    expect(restored).toContain('"I am ready."');
    expect(restored.indexOf("We leave at sunrise.")).toBeLessThan(
      restored.indexOf("I am ready."),
    );
  });

  it("does not duplicate exact dialogue already returned by Ollama", () => {
    const line = 'Maya says "Do not move."';
    const generated = 'Close-up as Maya says "Do not move."';
    expect(preserveH3QuotedDialogue(line, generated)).toBe(generated);
    expect(
      preserveH3QuotedDialogue('One says "Go." Then two says "Go."', 'One says "Go."'),
    ).toBe('One says "Go."\n\nSpoken dialogue — preserve verbatim:\n"Go."');
  });

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
    expect(panel).toContain("preserveH3QuotedDialogue");
    expect(panel).toContain(
      "Dialogue inside quotation marks is preserved word-for-word",
    );
    expect(route).toContain("buildH3QuotedDialogueContract(originalPrompt)");
  });

  it("lets the Prompt Builder accept a video-only H3 reference deck", () => {
    const route = read("app/api/h3/prompt/route.ts");
    expect(route).toContain(
      'mode === "h3-reference-to-video" && imageReferences.length === 0',
    );
    expect(route).toContain('? "h3-text-to-video"');
    expect(route).toContain("scene.generationMode = promptBuilderMode");
    expect(route).toContain("scene.promptStateByMode[promptBuilderMode]");
    expect(route).toContain("scene.selectedAssets = imageReferences");
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

  it("inserts optional LoRAs after the locked Turbo node without changing Turbo", () => {
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
    expect(built.graph["36"].inputs.strength_model).toBe(1);
    expect(built.graph["70"]).toMatchObject({
      class_type: "LoraLoaderModelOnly",
      inputs: {
        model: ["36", 0],
        lora_name: "creative.safetensors",
        strength_model: 0.65,
      },
    });
    expect(built.graph["38"].inputs.model).toEqual(["70", 0]);
  });
});
