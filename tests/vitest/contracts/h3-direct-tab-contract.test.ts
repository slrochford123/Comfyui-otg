import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { DEFAULT_PRODUCTION_V2_H3_USER_LORAS } from "../../../lib/production/h3Loras";
import { H3_PRODUCTION_ROUTE_KEYS } from "../../../lib/production/h3ProductionRecipes";
import { buildH3Workflow } from "../../../lib/production/h3Workflows";

const root = process.cwd();
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

describe("H3 direct-generation tab contract", () => {
  it("registers a top-level H3 tab and renders the isolated panel", () => {
    const nav = read("app/app/components/SpinDialNav.tsx");
    const app = read("app/app/AppPageClient.tsx");
    expect(nav).toContain('| "h3"');
    expect(nav).toContain('{ id: "h3", label: "H3" }');
    expect(app).toContain('tab === "h3" ? <H3Panel />');
  });

  it("keeps one 24-route workflow authority shared with Production", () => {
    expect(H3_PRODUCTION_ROUTE_KEYS).toHaveLength(24);
    const direct = read("lib/h3DirectJobs.ts");
    expect(direct).toContain("getH3ProductionTimeEstimate");
    expect(direct).toContain("buildH3Workflow");
    expect(direct).not.toContain("ROUTE_SPECS");
  });

  it("maps the optional I2V last image to the installed node input", () => {
    const built = buildH3Workflow({
      backend: "rtx3090",
      mode: "h3-image-to-video",
      h3Quality: "lq",
      durationSeconds: 5,
      finalPrompt: "A camera move between two frames.",
      seed: 1,
      outputPrefix: "contract/i2v-last-frame",
      startImageFilename: "first.png",
      lastImageFilename: "last.png",
      userLoras: DEFAULT_PRODUCTION_V2_H3_USER_LORAS,
    });
    expect(built.graph["42"]).toMatchObject({ class_type: "LoadImage", inputs: { image: "last.png" } });
    expect(built.graph["39"].inputs.last_frame).toEqual(["42", 0]);
  });

  it("maps ordered R2V videos and their audio without duplication", () => {
    const built = buildH3Workflow({
      backend: "rtx5060ti",
      mode: "h3-reference-to-video",
      h3Quality: "hq",
      durationSeconds: 10,
      finalPrompt: "<Video 1> = motion\n<Audio 1> = audio from <Video 1>\n<Video 2> = timing",
      seed: 2,
      outputPrefix: "contract/r2v-videos",
      references: [],
      voices: [],
      videoReferences: [
        { uploadedFilename: "one.mp4", includeAudio: true },
        { uploadedFilename: "two.mp4", includeAudio: false },
      ],
      userLoras: DEFAULT_PRODUCTION_V2_H3_USER_LORAS,
    });
    const inputs = built.graph["39"].inputs;
    expect(inputs["ref_videos.ref_video_0"]).toEqual(["61", 0]);
    expect(inputs["ref_videos.ref_video_1"]).toEqual(["63", 0]);
    expect(inputs["ref_video_audios.ref_video_audio_0"]).toEqual(["61", 1]);
    expect(inputs["ref_video_audios.ref_video_audio_1"]).toBeUndefined();
  });

  it("accepts embedded phone-video audio without a standalone audio manifest", () => {
    const built = buildH3Workflow({
      backend: "rtx5060ti",
      mode: "h3-reference-to-video",
      h3Quality: "lq",
      durationSeconds: 5,
      finalPrompt: "<Video 1> = phone upload\n<Audio 1> = audio from <Video 1>\n\nFollow the reference.",
      seed: 3,
      outputPrefix: "contract/r2v-phone-video-audio",
      references: [],
      voices: [],
      videoReferences: [{ uploadedFilename: "phone.mov", includeAudio: true }],
      userLoras: DEFAULT_PRODUCTION_V2_H3_USER_LORAS,
    });

    expect(built.graph["39"].inputs["ref_videos.ref_video_0"]).toEqual(["61", 0]);
    expect(built.graph["39"].inputs["ref_video_audios.ref_video_audio_0"]).toEqual(["61", 1]);
  });

  it("keeps embedded and standalone audio prompt slots contiguous", () => {
    const built = buildH3Workflow({
      backend: "rtx5060ti",
      mode: "h3-reference-to-video",
      h3Quality: "lq",
      durationSeconds: 5,
      finalPrompt: "<Video 1> = phone upload\n<Audio 1> = audio from <Video 1>\n<Audio 2> = narrator",
      seed: 4,
      outputPrefix: "contract/r2v-mixed-audio",
      references: [],
      voices: [{
        characterId: "direct-audio-1",
        snapshotName: "narrator.wav",
        sourcePath: "/tmp/narrator.wav",
        audioSlot: 1,
        subjectSlot: 1,
        speakerId: 1,
        uploadedFilename: "narrator.wav",
      }],
      videoReferences: [{ uploadedFilename: "phone.mp4", includeAudio: true }],
      userLoras: DEFAULT_PRODUCTION_V2_H3_USER_LORAS,
    });

    expect(built.graph["39"].inputs["ref_video_audios.ref_video_audio_0"]).toEqual(["61", 1]);
    expect(built.graph["39"].inputs["ref_audios.ref_audio_0"]).toEqual(["90", 0]);
  });

  it("rejects an Audio mapping when video audio is not selected", () => {
    expect(() => buildH3Workflow({
      backend: "rtx5060ti",
      mode: "h3-reference-to-video",
      h3Quality: "lq",
      durationSeconds: 5,
      finalPrompt: "<Video 1> = silent reference\n<Audio 1> = unavailable audio",
      seed: 5,
      outputPrefix: "contract/r2v-unselected-video-audio",
      references: [],
      voices: [],
      videoReferences: [{ uploadedFilename: "silent.mp4", includeAudio: false }],
      userLoras: DEFAULT_PRODUCTION_V2_H3_USER_LORAS,
    })).toThrow("submitted manifest contains only 0");
  });

  it("exposes required controls and deterministic reference limits", () => {
    const panel = read("app/app/components/H3Panel.tsx");
    expect(panel).toContain("Prompt Builder");
    expect(panel).toContain("Use Audio From Video");
    expect(panel).toContain("5-second reference window");
    expect(panel).toContain("videoClipStartSeconds");
    expect(panel).toContain('aria-label="Reference video 5-second start time"');
    expect(panel).toContain("getH3NativeDimensions(value, orientation).width");
    expect(panel).toContain('aria-label="H3 orientation"');
    expect(panel).toContain("H3_PRODUCTION_DURATION_OPTIONS.map");
    expect(panel).toContain("Up to 9 images, 3 videos, and 3 standalone audio references.");
    expect(panel).toContain('/api/ollama-ai/transcribe');
    expect(panel).toContain('/api/enhance-prompt');
  });

  it("trims H3 direct R2V video references to the selected 5-second window before upload", () => {
    const route = read("app/api/h3/generation/route.ts");

    expect(route).toContain("trimH3ReferenceVideoClip");
    expect(route).toContain("videoClipStartSeconds");
    expect(route).toContain("startSeconds: videoClipStarts[index] || 0");
    expect(route).toContain("H3_REFERENCE_VIDEO_CLIP_SECONDS");
  });

  it("renders approximate-preview video payloads as video, not still images", () => {
    const panel = read("app/app/components/H3Panel.tsx");
    const production = read("app/app/components/ProductionV2Panel.tsx");
    const progress = read("lib/comfyProgress.ts");

    expect(progress).toContain('mimeType.startsWith("image/") || mimeType.startsWith("video/")');
    expect(progress).toContain("data:${safeMimeType};base64");
    expect(progress).toContain("findPromptForClient");
    expect(progress).toContain("type === \"kj_preview_override\"");
    expect(progress).toContain("applyComfyEvent(payload, eventContext)");
    expect(panel).toContain('job.approximatePreview.mimeType.startsWith("video/")');
    expect(panel).toContain("<video");
    expect(production).toContain('generationJob.approximatePreview.mimeType.startsWith("video/")');
    expect(production).toContain("<video");
  });

  it("rehydrates the latest saved H3 job when the tab remounts", () => {
    const panel = read("app/app/components/H3Panel.tsx");
    const route = read("app/api/h3/generation/route.ts");
    const jobs = read("lib/h3DirectJobs.ts");

    expect(panel).toContain("H3_LAST_JOB_STORAGE_KEY");
    expect(panel).toContain('"/api/h3/generation"');
    expect(panel).toContain("readRememberedH3JobId()");
    expect(panel).toContain("rememberH3Job(data.job)");
    expect(route).toContain("getLatestH3DirectJob(ownerKey)");
    expect(route).toContain("ensureH3DirectJobRunner(job)");
    expect(jobs).toContain("export async function getLatestH3DirectJob");
    expect(jobs).toContain("export function ensureH3DirectJobRunner");
  });

  it("can reattach an active persisted H3 direct job without duplicate submission", () => {
    const jobs = read("lib/h3DirectJobs.ts");

    expect(jobs).toContain("clientId: string | null");
    expect(jobs).toContain("if (backend && promptId)");
    expect(jobs).toContain("Reconnected to running H3 generation");
    expect(jobs).toContain("ensureComfyClientProgressMonitor");
    expect(jobs).toContain("recordComfyPromptSubmitted");
    expect(jobs).toMatch(/if \(backend && promptId\)[\s\S]*else \{[\s\S]*submitH3Prompt/);
  });
});
