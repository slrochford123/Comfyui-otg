import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

type StoryStore = typeof import("../../../lib/storyCreator/store");
type VideoProduction = typeof import("../../../lib/storyCreator/videoProduction");
type H3Jobs = typeof import("../../../lib/production/h3GenerationJobs");
type H3Workflows = typeof import("../../../lib/production/h3Workflows");

let store: StoryStore;
let video: VideoProduction;
let jobs: H3Jobs;
let workflows: H3Workflows;
let tempRoot = "";
let ownerKey = "";
let projectId = "";
let planVersion = 0;
let approvedVersionId = "";
let acceptedTakeId = "";
const previousDataDir = process.env.OTG_DATA_DIR;
const previousDataRoot = process.env.OTG_DATA_ROOT;

describe("Story Creator Phase 6 H3 video production behavior", () => {
  beforeAll(async () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "otg-story-phase6-"));
    process.env.OTG_DATA_DIR = tempRoot;
    process.env.OTG_DATA_ROOT = tempRoot;
    vi.resetModules();
    store = await import("../../../lib/storyCreator/store");
    video = await import("../../../lib/storyCreator/videoProduction");
    jobs = await import("../../../lib/production/h3GenerationJobs");
    workflows = await import("../../../lib/production/h3Workflows");
    jobs.setProductionV2GenerationJobStorePathForTests(path.join(tempRoot, "h3-jobs.sqlite"));

    ownerKey = "phase6-owner";
    const project = store.createStoryCreatorProject({ ownerKey, title: "Atheria", format: "feature", genre: "fantasy" });
    projectId = project.id;
    const entity = store.createStoryBibleEntity({
      ownerKey, projectId, entityType: "character", name: "Jorog", sourceRole: "user",
    });
    store.saveStoryProductionPlan({
      ownerKey,
      projectId,
      sourceRole: "user",
      plan: {
        title: "Atheria", format: "feature", summary: "Temple arrival", targetDurationSeconds: 10,
        acts: [{ id: "act-1", order: 1, title: "Act 1", summary: "", scenes: [{
          id: "scene-1", order: 1, sceneNumber: "1", title: "Temple", purpose: "Arrival",
          location: "Ruined temple", timeOfDay: "night", characters: ["Jorog"], action: "Jorog enters",
          dialogue: [], emotionalTone: "tense", continuityRequirements: ["same armor", "blue eyes"],
          durationTargetSeconds: 10, screenplaySource: "INT. TEMPLE - NIGHT", shots: [
            { id: "shot-1", order: 1, shotNumber: "1", screenplayExcerpt: "Jorog enters", description: "Wide entrance", cameraFraming: "wide", cameraMovement: "slow push", characterActions: "walks forward", dialogue: [], referenceAssetIds: [], generationApproach: "image-to-video", requestedDurationSeconds: 5, status: "planned", acceptedTakeId: null, takes: [] },
            { id: "shot-2", order: 2, shotNumber: "2", screenplayExcerpt: "He looks up", description: "Close reaction", cameraFraming: "close", cameraMovement: "locked", characterActions: "looks up", dialogue: [], referenceAssetIds: [], generationApproach: "reference-to-video", requestedDurationSeconds: 5, status: "planned", acceptedTakeId: null, takes: [] },
          ],
        }] }],
      },
    });
    planVersion = store.approveStoryProductionPlan({ ownerKey, projectId }).version;

    const imagePath = path.join(tempRoot, "jorog.png");
    fs.writeFileSync(imagePath, "mock image fixture");
    const attached = store.attachStoryVisualUpload({
      ownerKey, projectId, visualKind: "character", name: "Jorog approved card",
      prompt: "Jorog in the same armor", url: "/mock/jorog.png", filePath: imagePath,
      metadata: { fixture: true },
    });
    approvedVersionId = store.approveStoryVisualVersion({
      ownerKey, projectId, versionId: attached.version.id,
    }).id;
    store.bindStoryVisualVersion({
      ownerKey, projectId, versionId: approvedVersionId,
      bindingType: "entity", entityId: entity.id, role: "identity",
    });
  });

  afterAll(() => {
    jobs.setProductionV2GenerationJobStorePathForTests(null);
    video.setStoryVideoProductionStorePathForTests(null);
    if (previousDataDir === undefined) delete process.env.OTG_DATA_DIR;
    else process.env.OTG_DATA_DIR = previousDataDir;
    if (previousDataRoot === undefined) delete process.env.OTG_DATA_ROOT;
    else process.env.OTG_DATA_ROOT = previousDataRoot;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it("retrieves approved continuity references and prepares without GPU submission", () => {
    const context = video.getStoryVideoShotContext({
      ownerKey, projectId, planVersion, sceneId: "scene-1", shotId: "shot-1",
    });
    expect(context.availableReferences.map((reference) => reference.versionId)).toContain(approvedVersionId);
    expect(context.recommendedMethod).toBe("reference-to-video");
    expect(context.scene.continuityRequirements).toContain("same armor");

    const prepared = video.prepareStoryVideoTake({
      ownerKey, projectId, planVersion, sceneId: "scene-1", shotId: "shot-1",
      method: "reference-to-video", motion: "Jorog walks while the camera pushes in.",
      quality: "sh", durationSeconds: 5, referenceVersionIds: [approvedVersionId],
      idempotencyKey: "prepare-shot-1",
    });
    expect(prepared.requiresExplicitConfirmation).toBe(true);
    expect(prepared.take.status).toBe("proposed");
    expect(prepared.take.references).toHaveLength(1);
    expect(jobs.getLatestProductionV2SceneGeneration(ownerKey, `story-${projectId}-v${planVersion}`, "shot-1")).toBeNull();
    expect(() => video.submitStoryVideoTake({ ownerKey, projectId, takeId: prepared.take.id, authorized: false })).toThrow(/authorization/i);
  });

  it("submits idempotently, simulates completion, persists acceptance, and preserves earlier takes", () => {
    const prepared = video.prepareStoryVideoTake({
      ownerKey, projectId, planVersion, sceneId: "scene-1", shotId: "shot-1",
      method: "reference-to-video", motion: "Jorog walks.", quality: "lq",
      referenceVersionIds: [approvedVersionId], idempotencyKey: "lifecycle-take",
    });
    const submitted = video.submitStoryVideoTake({ ownerKey, projectId, takeId: prepared.take.id, authorized: true });
    const repeated = video.submitStoryVideoTake({ ownerKey, projectId, takeId: prepared.take.id, authorized: true });
    expect(repeated.job.id).toBe(submitted.job.id);
    expect(repeated.reused).toBe(true);
    expect(submitted.job.payload.references[0]?.pictureSlot).toBe(1);
    expect(workflows.buildH3Workflow({
      backend: "rtx3090", mode: submitted.job.mode, h3Quality: submitted.job.payload.h3Quality,
      finalPrompt: submitted.job.payload.finalPrompt, durationSeconds: submitted.job.payload.durationSeconds,
      seed: submitted.job.payload.seed, outputPrefix: "mock/r2v",
      references: submitted.job.payload.references.map((reference, index) => ({ ...reference, uploadedFilename: `fixture-${index + 1}.png` })),
      h3Settings: submitted.job.payload.h3Settings, userLoras: submitted.job.payload.userLoras,
    }).workflowId).toContain("r2v");

    const claimed = jobs.claimProductionV2GenerationJob(submitted.job.id, "rtx3090")!;
    jobs.markProductionV2GenerationSubmitted({
      id: claimed.id, backend: "rtx3090", promptId: "mock-prompt", workflowId: "mock-h3-r2v", workflowFile: "mock.api.json",
    });
    jobs.markProductionV2GenerationRunning(claimed.id);
    jobs.markProductionV2GenerationNativeReady(claimed.id, path.join(tempRoot, "native.mp4"));
    jobs.markProductionV2GenerationVsrSubmitted({ id: claimed.id, promptId: "mock-vsr" });
    jobs.markProductionV2GenerationVsrRunning(claimed.id);
    const outputPath = path.join(tempRoot, "final.mp4");
    fs.writeFileSync(outputPath, "mock video fixture");
    jobs.completeProductionV2GenerationJob(claimed.id, outputPath);

    const completed = video.listStoryVideoTakes({ ownerKey, projectId, planVersion })
      .find((take) => take.id === prepared.take.id)!;
    expect(completed.status).toBe("completed");
    expect(completed.outputPath).toBe(outputPath);
    expect(completed.backend).toBe("rtx3090");
    expect(video.setStoryVideoTakeDecision({ ownerKey, projectId, takeId: completed.id, decision: "accept" }).status).toBe("accepted");
    acceptedTakeId = completed.id;
    expect(video.listStoryVideoTakes({ ownerKey, projectId, planVersion }).find((take) => take.id === completed.id)?.status).toBe("accepted");

    const next = video.prepareStoryVideoRetry({
      ownerKey, projectId, takeId: completed.id, idempotencyKey: "second-take",
    }).take;
    expect(next.takeNumber).toBeGreaterThan(completed.takeNumber);
    expect(next.parentTakeId).toBe(completed.id);
    expect(video.getStoryVideoTake({ ownerKey, projectId, takeId: completed.id }).status).toBe("accepted");
  });

  it("maps text, image, and verified video-edit requests to distinct H3 contracts", () => {
    const text = video.prepareStoryVideoTake({
      ownerKey, projectId, planVersion, sceneId: "scene-1", shotId: "shot-2",
      method: "text-to-video", motion: "A quiet empty temple corridor.",
      referenceVersionIds: [], orientation: "portrait", quality: "lq",
      h3Settings: { checkpointMode: "singularity" }, idempotencyKey: "t2v-contract",
    }).take;
    const textJob = video.submitStoryVideoTake({ ownerKey, projectId, takeId: text.id, authorized: true }).job;
    expect(textJob.mode).toBe("h3-text-to-video");
    expect(textJob.payload.orientation).toBe("portrait");
    expect(textJob.payload.h3Settings?.checkpointMode).toBe("singularity");
    expect(workflows.buildH3Workflow({
      backend: "rtx3090", mode: textJob.mode, h3Quality: textJob.payload.h3Quality,
      orientation: textJob.payload.orientation, finalPrompt: textJob.payload.finalPrompt,
      durationSeconds: textJob.payload.durationSeconds, seed: textJob.payload.seed,
      outputPrefix: "mock/t2v", h3Settings: textJob.payload.h3Settings,
      userLoras: textJob.payload.userLoras,
    }).workflowId).toContain("t2v");
    expect(video.cancelQueuedStoryVideoTake({ ownerKey, projectId, takeId: text.id }).status).toBe("canceled");

    const image = video.prepareStoryVideoTake({
      ownerKey, projectId, planVersion, sceneId: "scene-1", shotId: "shot-2",
      method: "image-to-video", motion: "Jorog looks up.",
      referenceVersionIds: [approvedVersionId], idempotencyKey: "i2v-contract",
    }).take;
    const imageJob = video.submitStoryVideoTake({ ownerKey, projectId, takeId: image.id, authorized: true }).job;
    expect(imageJob.mode).toBe("h3-image-to-video");
    expect(imageJob.payload.startImage?.workflowImage).toBeTruthy();
    expect(workflows.buildH3Workflow({
      backend: "rtx3090", mode: imageJob.mode, h3Quality: imageJob.payload.h3Quality,
      finalPrompt: imageJob.payload.finalPrompt, durationSeconds: imageJob.payload.durationSeconds,
      seed: imageJob.payload.seed, outputPrefix: "mock/i2v", startImageFilename: "fixture.png",
      h3Settings: imageJob.payload.h3Settings, userLoras: imageJob.payload.userLoras,
    }).workflowId).toContain("i2v");
    expect(video.cancelQueuedStoryVideoTake({ ownerKey, projectId, takeId: image.id }).status).toBe("canceled");

    const edit = video.prepareStoryVideoTake({
      ownerKey, projectId, planVersion, sceneId: "scene-1", shotId: "shot-2",
      method: "video-edit", motion: "Slow the camera movement while preserving Jorog.",
      sourceTakeId: acceptedTakeId, videoClipStartSeconds: 0,
      idempotencyKey: "video-edit-contract",
    }).take;
    const editJob = video.submitStoryVideoTake({ ownerKey, projectId, takeId: edit.id, authorized: true }).job;
    expect(editJob.mode).toBe("h3-reference-to-video");
    expect(editJob.payload.operation).toBe("visual-edit");
    expect(editJob.payload.videoReference?.mediaVersionId).toBe(acceptedTakeId);
    expect(workflows.buildH3Workflow({
      backend: "rtx3090", mode: editJob.mode, h3Quality: editJob.payload.h3Quality,
      finalPrompt: editJob.payload.finalPrompt, durationSeconds: editJob.payload.durationSeconds,
      seed: editJob.payload.seed, outputPrefix: "mock/edit", operation: "visual-edit",
      videoReferenceFilename: "fixture.mp4", includeVideoReferenceAudio: true,
      h3Settings: editJob.payload.h3Settings, userLoras: editJob.payload.userLoras,
    }).workflowId).toContain("visual-edit");
    expect(video.cancelQueuedStoryVideoTake({ ownerKey, projectId, takeId: edit.id }).status).toBe("canceled");
  });

  it("preserves failed take state and prepares a separate retry", () => {
    const take = video.prepareStoryVideoTake({
      ownerKey, projectId, planVersion, sceneId: "scene-1", shotId: "shot-2",
      method: "reference-to-video", motion: "Failure fixture.",
      referenceVersionIds: [approvedVersionId], idempotencyKey: "failure-source",
    }).take;
    const job = video.submitStoryVideoTake({ ownerKey, projectId, takeId: take.id, authorized: true }).job;
    jobs.failProductionV2GenerationJob(job.id, "Mocked workflow failure");
    const failed = video.listStoryVideoTakes({ ownerKey, projectId, planVersion }).find((item) => item.id === take.id)!;
    expect(failed.status).toBe("failed");
    expect(failed.error).toContain("Mocked workflow failure");
    const retry = video.prepareStoryVideoRetry({ ownerKey, projectId, takeId: failed.id, idempotencyKey: "failure-retry" }).take;
    expect(retry.status).toBe("proposed");
    expect(retry.parentTakeId).toBe(failed.id);
    expect(video.getStoryVideoTake({ ownerKey, projectId, takeId: failed.id }).status).toBe("failed");
  });

  it("preserves the Scene Hunter snapshot during HQ promotion", () => {
    const source = video.prepareStoryVideoTake({
      ownerKey, projectId, planVersion, sceneId: "scene-1", shotId: "shot-2",
      method: "reference-to-video", motion: "A fast reaction.", quality: "sh", seed: 424242,
      referenceVersionIds: [approvedVersionId], idempotencyKey: "sh-source",
    }).take;
    const canceled = video.cancelQueuedStoryVideoTake({ ownerKey, projectId, takeId: source.id });
    expect(canceled.status).toBe("canceled");
    const promoted = video.prepareStoryVideoRetry({
      ownerKey, projectId, takeId: source.id, promoteSceneHunter: true, idempotencyKey: "sh-hq",
    }).take;
    expect(promoted.settings.quality).toBe("hq");
    expect(promoted.settings.seed).toBe(source.settings.seed);
    expect(promoted.prompt).toBe(source.prompt);
    expect(promoted.references).toEqual(source.references);
  });

  it("prepares bounded batches without jobs and enforces owner isolation", () => {
    const before = video.listStoryVideoTakes({ ownerKey, projectId, planVersion }).length;
    const prepared = video.prepareStoryVideoBatch({
      ownerKey, projectId, sceneIds: ["scene-1"], maxJobs: 1, idempotencyKey: "scene-batch",
    });
    expect(prepared.jobsStarted).toBe(0);
    expect(prepared.takes).toHaveLength(2);
    expect(prepared.batch.maxJobs).toBe(1);
    expect(video.listStoryVideoTakes({ ownerKey, projectId, planVersion }).length).toBe(before + 2);
    expect(() => video.approveStoryVideoBatch({ ownerKey, projectId, batchId: prepared.batch.id, authorized: false })).toThrow(/authorization/i);
    expect(() => video.getStoryVideoTake({ ownerKey: "outsider", projectId, takeId: prepared.takes[0].id })).toThrow();
  });
});
