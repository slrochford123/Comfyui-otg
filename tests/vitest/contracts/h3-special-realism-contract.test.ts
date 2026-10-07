import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  compileH3RealismPrompt,
  H3_REALISM_PEOPLE_TRIGGER,
  normalizeH3RealismLoras,
  validateH3RealismReferences,
  validateH3RealismRequest,
  type H3RealismReferenceInput,
} from "../../../lib/h3SpecialModes/realism";
import { buildH3RealismWorkflow } from "../../../lib/h3SpecialModes/realismWorkflow";
import {
  getH3RealismGalleryFileName,
  h3RealismPublicStatus,
  validateH3RealismJobInput,
  type H3RealismJob,
} from "../../../lib/h3SpecialModes/realismJobs";
import { H3_PRODUCTION_ROUTE_KEYS } from "../../../lib/production/h3ProductionRecipes";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("H3 Realism special mode contract", () => {
  it("renders the Realism workspace without enabling the legacy generation route", () => {
    const panel = read("app/app/components/H3Panel.tsx");
    const compileRoute = read("app/api/h3/special/realism/compile/route.ts");
    const generationRoute = read("app/api/h3/special/realism/generation/route.ts");

    expect(panel).toContain('data-otg="h3-realism-workspace"');
    expect(panel).toContain("+ {kind[0].toUpperCase() + kind.slice(1)}");
    expect(panel).toContain("View Compiled Prompt");
    expect(panel).toContain("Generate Realism");
    expect(panel).toContain('/api/h3/special/realism/generation');
    expect(panel).toContain("Realism quality");
    expect(panel).toContain("Realism duration");
    expect(panel).toContain("Realism orientation");
    expect(compileRoute).toContain("validateH3RealismRequest");
    expect(compileRoute).toContain("compileH3RealismPrompt");
    expect(generationRoute).toContain("validateH3RealismJobInput");
    expect(generationRoute).toContain("probeDurationSeconds");
  });

  it("keeps normal H3 production routes unchanged", () => {
    expect(H3_PRODUCTION_ROUTE_KEYS).toHaveLength(36);
    expect(H3_PRODUCTION_ROUTE_KEYS.some((key) => key.includes("realism"))).toBe(false);
    expect(H3_PRODUCTION_ROUTE_KEYS.some((key) => key.includes("body-swap"))).toBe(false);
  });

  it("validates Realism reference counts and mixed cap server-side", () => {
    expect(() =>
      validateH3RealismReferences(
        Array.from({ length: 10 }, (_, index) => ({
          kind: "image",
          name: `image-${index}.png`,
        })),
      ),
    ).toThrow("at most 9 image");
    expect(() =>
      validateH3RealismReferences(
        Array.from({ length: 4 }, (_, index) => ({
          kind: "video",
          name: `video-${index}.mp4`,
        })),
      ),
    ).toThrow("at most 3 video");
    expect(() =>
      validateH3RealismReferences(
        Array.from({ length: 4 }, (_, index) => ({
          kind: "audio",
          name: `audio-${index}.wav`,
        })),
      ),
    ).toThrow("at most 3 audio");

    const tooManyMixed: H3RealismReferenceInput[] = [
      ...Array.from({ length: 9 }, (_, index) => ({
        kind: "image" as const,
        name: `image-${index}.png`,
      })),
      ...Array.from({ length: 3 }, (_, index) => ({
        kind: "video" as const,
        name: `video-${index}.mp4`,
      })),
      { kind: "audio", name: "extra.wav" },
    ];
    expect(() => validateH3RealismReferences(tooManyMixed)).toThrow("at most 12 combined");
  });

  it("validates Realism video and audio duration limits", () => {
    expect(() =>
      validateH3RealismReferences([
        { kind: "video", name: "too-short.mp4", durationSeconds: 1.5 },
      ]),
    ).toThrow("2 to 15 seconds");
    expect(() =>
      validateH3RealismReferences([
        { kind: "video", name: "a.mp4", durationSeconds: 8 },
        { kind: "video", name: "b.mp4", durationSeconds: 8 },
      ]),
    ).toThrow("15 seconds or less");
    expect(() =>
      validateH3RealismReferences([
        { kind: "audio", name: "a.wav", durationSeconds: 8 },
        { kind: "audio", name: "b.wav", durationSeconds: 8 },
      ]),
    ).toThrow("15 seconds or less");
  });

  it("enforces exactly one speed LoRA and keeps People Realism independent", () => {
    expect(() =>
      normalizeH3RealismLoras({
        speedLoras: [
          "minimax_h3_ref2v_turbo_4step_v0.1",
          "ref2v_turbo_8step_v1.0_768p",
        ],
      }),
    ).toThrow("exactly one Realism speed LoRA");

    const balanced = normalizeH3RealismLoras({ preset: "balanced" });
    expect(balanced.speedLora).toBe("ref2v_turbo_8step_v1.0_768p");
    expect(balanced.loras.map((item) => item.id)).toEqual([
      "ref2v_turbo_8step_v1.0_768p",
      "minimax-h3-people",
    ]);

    const intelligence = normalizeH3RealismLoras({ preset: "max-intelligence" });
    expect(intelligence.peopleRealismEnabled).toBe(false);
    expect(intelligence.loras.map((item) => item.id)).toEqual([
      "ref2v_turbo_8step_v1.0_768p",
    ]);
  });

  it("compiles natural language into MiniMax H3 structured prompt sections", () => {
    const compiled = compileH3RealismPrompt({
      prompt: "the man walks into the cafe to buy a drink",
      durationSeconds: 5,
      orientation: "landscape",
      references: [
        { kind: "image", name: "man.png", description: "same face and jacket" },
        { kind: "video", name: "walk.mp4", description: "walking pace" },
        { kind: "audio", name: "cafe.wav", description: "cafe ambience" },
      ],
      loras: normalizeH3RealismLoras({ preset: "balanced" }),
    });

    expect(compiled.startsWith(`${H3_REALISM_PEOPLE_TRIGGER}\n\n`)).toBe(true);
    expect(compiled).toContain("subject_definitions:");
    expect(compiled).toContain("summary:");
    expect(compiled).toContain("retention_analysis:");
    expect(compiled).toContain("detailed_description:");
    expect(compiled).toContain("overall_soundscape:");
    expect(compiled).toContain("non_diegetic_music:");
    expect(compiled).toContain("<Picture 1>");
    expect(compiled).toContain("<Video 1>");
    expect(compiled).toContain("<Audio 1>");
    expect(compiled).toContain("the man walks into the cafe to buy a drink");
  });

  it("validates the full backend request shape", () => {
    const request = validateH3RealismRequest({
      prompt: "a woman smiles in soft window light",
      quality: "hq",
      orientation: "portrait",
      durationSeconds: 10,
      references: [{ kind: "image", name: "hero.png" }],
      loraSettings: { preset: "max-realism" },
    });
    expect(request.quality).toBe("hq");
    expect(request.orientation).toBe("portrait");
    expect(request.durationSeconds).toBe(10);
    expect(request.loras.speedLora).toBe("turbo_v4_step600_ema");
    const input = validateH3RealismJobInput({
      mode: "h3-realism",
      prompt: "a woman smiles in soft window light",
      quality: "hq",
      orientation: "portrait",
      durationSeconds: 10,
      seed: 99,
      references: [{ kind: "image", path: "/tmp/hero.png", name: "hero.png", description: "" }],
      loraSettings: { preset: "max-realism" },
    });
    expect(input.mode).toBe("h3-realism");
  });

  it("builds the Realism workflow from the copied special template", () => {
    expect(fs.existsSync(path.join(root, "comfy_workflows/internal/h3-special/realism.api.json"))).toBe(true);
    const built = buildH3RealismWorkflow({
      prompt: "the man walks into the cafe to buy a drink",
      quality: "sh",
      orientation: "portrait",
      durationSeconds: 5,
      seed: 123,
      outputPrefix: "contract/realism",
      references: [
        {
          kind: "image",
          name: "face.png",
          uploadedFilename: "face-upload.png",
          description: "same face",
        },
        {
          kind: "video",
          name: "walk.mp4",
          uploadedFilename: "walk-upload.mp4",
          description: "walking pace",
          durationSeconds: 5,
        },
      ],
      loraSettings: { preset: "balanced" },
    });

    expect(built.workflowId).toBe("h3-realism-special");
    expect(built.workflowFile).toBe("comfy_workflows/internal/h3-special/realism.api.json");
    expect(built.graph["263"].class_type).toBe("PrimitiveStringMultiline");
    expect(built.graph["263"].inputs?.value).toContain("subject_definitions:");
    expect(built.graph["263"].inputs?.value).toContain(H3_REALISM_PEOPLE_TRIGGER);
    expect(Object.values(built.graph).every((node) => Boolean(node.class_type))).toBe(true);
    expect(built.graph["265"].inputs?.width).toBe(352);
    expect(built.graph["265"].inputs?.height).toBe(608);
    expect(built.graph["265"].inputs?.length).toBe(124);
    expect(built.graph["256"].inputs?.noise_seed).toBe(123);
    expect(built.graph["51"].inputs?.image).toBe("face-upload.png");
    expect(built.graph["27"].inputs?.video).toBe("walk-upload.mp4");
    expect(built.graph["265"].inputs?.["ref_images.ref_image_0"]).toEqual(["51", 0]);
    expect(built.graph["265"].inputs?.["ref_images.ref_image_1"]).toBeUndefined();
    expect(built.graph["265"].inputs?.["ref_videos.ref_video_0"]).toEqual(["27", 0]);
    expect(built.graph["265"].inputs?.["ref_audios.ref_audio_0"]).toBeUndefined();
    expect(built.graph["49"]).toBeUndefined();
    expect(built.graph["25"]).toBeUndefined();
    expect(built.graph["48"]).toBeUndefined();
    expect(built.graph["53"].inputs?.lora_name).toBe("minimax_h3_ref2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors");
    expect(built.graph["335"]).toBeUndefined();
    expect(built.graph["336"]).toBeUndefined();
    expect(built.graph["337"].inputs?.model).toEqual(["53", 0]);
    expect(built.graph["58"].inputs?.model).toEqual(["337", 0]);
    expect(built.graph["332"].class_type).toBe("MiniMaxH3SigmaShift");
    expect(built.graph["332"].inputs?.model).toEqual(["58", 0]);
    expect(built.graph["332"].inputs?.shift_video).toBe(12);
    expect(built.graph["332"].inputs?.shift_audio).toBe(3);
    expect(built.graph["261"].inputs?.steps).toBe(12);
    expect(built.graph["261"].inputs?.model).toEqual(["332", 0]);
    expect(built.graph["289"].inputs?.step).toBe(8);
    expect(built.graph["223"].inputs?.model).toEqual(["332", 0]);
    expect(built.graph["226"].inputs?.sampler).toEqual(["255", 0]);
    expect(built.graph["226"].inputs?.sigmas).toEqual(["261", 0]);
    expect(built.graph["214"]).toBeUndefined();
    expect(built.graph["264"].inputs?.filename_prefix).toBe("contract/realism");
    expect(built.graph["264"].inputs?.frame_rate).toBe(24);
    expect(built.graph["264"].inputs?.format).toBe("video/h264-mp4");
  });

  it("does not mutate the Realism template across adapter builds", () => {
    const first = buildH3RealismWorkflow({
      prompt: "a woman smiles",
      quality: "hq",
      orientation: "landscape",
      durationSeconds: 10,
      seed: 1,
      outputPrefix: "contract/first",
      references: [{ kind: "image", name: "a.png", uploadedFilename: "a.png" }],
      loraSettings: { preset: "max-intelligence" },
    });
    const second = buildH3RealismWorkflow({
      prompt: "a man waves",
      quality: "lq",
      orientation: "portrait",
      durationSeconds: 5,
      seed: 2,
      outputPrefix: "contract/second",
      references: [
        { kind: "image", name: "b.png", uploadedFilename: "b.png" },
        { kind: "image", name: "c.png", uploadedFilename: "c.png" },
      ],
      loraSettings: { preset: "balanced" },
    });

    expect(first.graph["265"].inputs?.width).toBe(1376);
    expect(first.graph["265"].inputs?.height).toBe(768);
    expect(first.graph["337"]).toBeUndefined();
    expect(second.graph["265"].inputs?.width).toBe(608);
    expect(second.graph["265"].inputs?.height).toBe(1056);
    expect(second.graph["337"]).toBeDefined();
    expect(first.graph["51"].inputs?.image).toBe("a.png");
    expect(second.graph["49"].inputs?.image).toBe("c.png");
  });

  it("enforces People Realism trigger for expert edited prompts", () => {
    const built = buildH3RealismWorkflow({
      prompt: "fallback prompt",
      compiledPromptOverride: "subject_definitions:\nA single person.",
      quality: "sh",
      orientation: "landscape",
      durationSeconds: 5,
      seed: 7,
      outputPrefix: "contract/expert",
      references: [{ kind: "image", name: "face.png", uploadedFilename: "face.png" }],
      loraSettings: { preset: "balanced" },
    });
    expect(built.compiledPrompt.startsWith(`${H3_REALISM_PEOPLE_TRIGGER}\n\n`)).toBe(true);
  });

  it("reports Realism jobs through the special media and Gallery routes", () => {
    const job: H3RealismJob = {
      id: "h3-realism-contract-job",
      ownerKey: "contract-user",
      status: "completed",
      statusMessage: "Realism complete",
      input: {
        mode: "h3-realism",
        quality: "lq",
        orientation: "landscape",
        durationSeconds: 5,
        prompt: "natural language",
        seed: 42,
        references: [],
        loraSettings: { preset: "balanced" },
      },
      backend: "rtx3090",
      clientId: "client-contract",
      promptId: "prompt-contract",
      workflowId: "h3-realism-special",
      workflowFile: "comfy_workflows/internal/h3-special/realism.api.json",
      compiledPrompt: "compiled realism prompt",
      outputPath: "/tmp/result.mp4",
      galleryOwner: {
        ownerKey: "contract-user",
        username: "contract-user",
        deviceId: "contract-device",
        scope: "user",
      },
      galleryStatus: "saved",
      galleryFileName: "saved.mp4",
      galleryScope: "user",
      galleryError: null,
      error: null,
      createdAt: "2026-10-07T00:00:00.000Z",
      startedAt: "2026-10-07T00:00:01.000Z",
      completedAt: "2026-10-07T00:05:00.000Z",
      queueRemaining: null,
      progressPercent: 100,
      currentNode: null,
    };
    expect(getH3RealismGalleryFileName(job)).toBe("H3_realism_5s_lq_landscape_h3-realism-contract-job.mp4");
    expect(h3RealismPublicStatus(job)).toMatchObject({
      mode: "h3-realism",
      videoUrl: "/api/h3/special/realism/generation/media?jobId=h3-realism-contract-job",
      thumbnailUrl: "/api/h3/special/realism/generation/thumbnail?jobId=h3-realism-contract-job",
      galleryUrl: "/api/gallery/file?name=saved.mp4&scope=user",
    });
  });
});
