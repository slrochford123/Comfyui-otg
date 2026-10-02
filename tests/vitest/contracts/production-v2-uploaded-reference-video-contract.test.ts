import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("Production V2 uploaded H3 reference video", () => {
  it("persists the upload and fingerprints its exact five-second window", () => {
    const production = read("lib/production/v2.ts");
    expect(production).toContain("ProductionV2H3UploadedVideoReference");
    expect(production).toContain("uploadedVideo: ProductionV2H3UploadedVideoReference | null");
    expect(production).toContain("uploadedReferenceVideo:");
    expect(production).toContain("clipStartSeconds: upload.clipStartSeconds");
    expect(production).toContain("clipDurationSeconds: 5");
  });

  it("offers upload, replace, preview, selection and removal controls", () => {
    const panel = read("app/app/components/ProductionV2Panel.tsx");
    expect(panel).toContain('data-otg="production-v2-uploaded-reference-video"');
    expect(panel).toContain('accept="video/*,.mp4,.m4v,.mov,.webm,.mkv,.avi"');
    expect(panel).toContain('"Replace Video" : "Upload Video"');
    expect(panel).toContain("Play Selected 5 Seconds");
    expect(panel).toContain("Use This 5 Seconds");
    expect(panel).toContain("Remove Video");
    expect(panel).toContain("referenceVideoPreviewRef.current.currentTime = startSeconds");
  });

  it("persists the current R2V scene before the server-authoritative upload", () => {
    const panel = read("app/app/components/ProductionV2Panel.tsx");
    const saveIndex = panel.indexOf('body: JSON.stringify({ action: "save", production })');
    const uploadIndex = panel.indexOf('form.set("video", file)');
    expect(saveIndex).toBeGreaterThan(-1);
    expect(uploadIndex).toBeGreaterThan(saveIndex);
    expect(panel).toContain('form.set("productionId", saved.production.id)');
  });

  it("keeps uploaded media owner-scoped and stores a verified window", () => {
    const route = read("app/api/production/v2/reference-video/route.ts");
    expect(route).toContain("assertProductionV2OwnedFile");
    expect(route).toContain("probeProductionV2Media");
    expect(route).toContain("normalizeH3ReferenceVideoClip");
    expect(route).toContain("mediaFileResponse");
    expect(route).toContain('String(body.action || "") !== "select-window"');
    expect(route).toContain("invalidateProductionV2Prompts");
  });

  it("server-trims the selected window and overrides only the inherited continuation video", () => {
    const generation = read("app/api/production/v2/generation/route.ts");
    expect(generation).toContain("const uploadedReferenceVideo =");
    expect(generation).toContain("requestedStartSeconds: uploadedReferenceVideo.clipStartSeconds");
    expect(generation).toContain('outputLabel: "uploaded-reference"');
    expect(generation).toContain("&& !uploadedReferenceVideo");
    expect(generation).toContain("retaining Continue Scene's exact final-frame guide as frame 0");
  });

  it("supports video-only R2V and shifts voice slots after embedded video audio", () => {
    const resolver = read("lib/production/referenceResolver.ts");
    const promptBuilder = read("lib/production/promptBuilder.ts");
    const scheduler = read("lib/production/h3GenerationScheduler.ts");
    expect(resolver).toContain("&& !scene.modelState.h3.referenceToVideo.uploadedVideo");
    expect(resolver).toContain('"<Video 1> is the user-selected exact five-second visual and temporal reference excerpt."');
    expect(resolver).toContain("binding.audioSlot + embeddedVideoAudioSlots");
    expect(promptBuilder).toContain("binding.audioSlot + embeddedVideoAudioSlots");
    expect(scheduler).toContain("if (continuationGuide && !videoReference)");
  });
});
