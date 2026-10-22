import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

type StoryStore = typeof import("../../../lib/storyCreator/store");
type VisualActions = typeof import("../../../lib/storyCreator/visualActions");

let store: StoryStore;
let actions: VisualActions;
let tempRoot = "";
const previousDataDir = process.env.OTG_DATA_DIR;
const previousDataRoot = process.env.OTG_DATA_ROOT;

describe("Story Creator Phase 5 visual asset behavior", () => {
  beforeAll(async () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "otg-story-phase5-"));
    process.env.OTG_DATA_DIR = tempRoot;
    process.env.OTG_DATA_ROOT = tempRoot;
    vi.resetModules();
    store = await import("../../../lib/storyCreator/store");
    actions = await import("../../../lib/storyCreator/visualActions");
  });

  afterAll(() => {
    if (previousDataDir === undefined) delete process.env.OTG_DATA_DIR;
    else process.env.OTG_DATA_DIR = previousDataDir;
    if (previousDataRoot === undefined) delete process.env.OTG_DATA_ROOT;
    else process.env.OTG_DATA_ROOT = previousDataRoot;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it("persists versions, validates Qwen contracts, binds approved references, and preserves history", () => {
    const ownerKey = "phase5-owner";
    const outsider = "phase5-outsider";
    const project = store.createStoryCreatorProject({ ownerKey, title: "Atheria", format: "feature", genre: "fantasy" });
    store.createStoryCreatorProject({ ownerKey: outsider, title: "Other", format: "short", genre: "drama" });
    const entity = store.createStoryBibleEntity({
      ownerKey, projectId: project.id, entityType: "character", name: "Jorog", sourceRole: "user",
    });
    store.saveStoryProductionPlan({
      ownerKey,
      projectId: project.id,
      sourceRole: "user",
      plan: {
        title: "Atheria", format: "feature", summary: "Jorog enters the temple.", targetDurationSeconds: 5,
        acts: [{
          id: "act-1", order: 1, title: "Act 1", summary: "Arrival",
          scenes: [{
            id: "scene-2", order: 1, sceneNumber: "2", title: "Ruined Temple", purpose: "Reveal",
            location: "Ruined temple", timeOfDay: "night", characters: ["Jorog"], action: "Jorog enters.",
            dialogue: [], emotionalTone: "tense", continuityRequirements: ["same armor"], durationTargetSeconds: 5,
            screenplaySource: "INT. TEMPLE", shots: [{
              id: "shot-2", order: 1, shotNumber: "2", screenplayExcerpt: "Jorog enters", description: "Wide reveal",
              cameraFraming: "wide", cameraMovement: "slow push", characterActions: "enters", dialogue: [],
              referenceAssetIds: [], generationApproach: "image-to-video", requestedDurationSeconds: 5,
              status: "planned", acceptedTakeId: null, takes: [],
            }],
          }],
        }],
      },
    });
    const plan = store.approveStoryProductionPlan({ ownerKey, projectId: project.id });

    const prepared = store.prepareStoryVisualGeneration({
      ownerKey, projectId: project.id, visualKind: "character", name: "Jorog reference",
      prompt: "Jorog in approved armor, front view", artStyle: "cinematic reference", aspectRatio: "portrait",
      entityId: entity.id,
    });
    expect(prepared.generation.requiresExplicitConfirmation).toBe(true);
    expect(prepared.generation.endpoint).toBe("/api/assets/create-image");
    expect(prepared.generation.body).toMatchObject({ model: "qwen-image-2-1", orientation: "portrait" });
    expect(store.listStoryVisualAssets({ ownerKey, projectId: project.id })[0].versions[0].status).toBe("planned");
    expect(store.listStoryGenerationJobs({ ownerKey, projectId: project.id })).toHaveLength(0);

    const submitted = store.recordStoryVisualSubmission({
      ownerKey, projectId: project.id, versionId: prepared.version.id,
      promptId: "mock-qwen-prompt", response: { mocked: true },
    });
    expect(submitted.job.status).toBe("submitted");
    expect(submitted.version.status).toBe("generating");
    store.completeStoryGenerationJob({
      ownerKey, projectId: project.id, jobId: submitted.job.id,
      output: { url: "/mock/jorog.png", filePath: "output/jorog.png", provider: "qwen-image-2-1" },
      response: { mocked: true },
    });
    const ready = store.getStoryVisualVersion({ ownerKey, projectId: project.id, versionId: prepared.version.id });
    expect(ready.status).toBe("ready");
    expect(ready.url).toBe("/mock/jorog.png");
    expect(store.approveStoryVisualVersion({ ownerKey, projectId: project.id, versionId: ready.id }).status).toBe("approved");

    const entityBinding = store.bindStoryVisualVersion({
      ownerKey, projectId: project.id, versionId: ready.id,
      bindingType: "entity", entityId: entity.id, role: "identity",
    });
    expect(entityBinding.entityId).toBe(entity.id);
    const shotBinding = store.bindStoryVisualVersion({
      ownerKey, projectId: project.id, versionId: ready.id,
      bindingType: "shot", planVersion: plan.version, sceneId: "scene-2", shotId: "shot-2", role: "keyframe",
    });
    expect(shotBinding.shotId).toBe("shot-2");

    const edit = store.prepareStoryVisualGeneration({
      ownerKey, projectId: project.id, assetId: prepared.asset.id, parentVersionId: ready.id,
      visualKind: "character", name: "Jorog reference", prompt: "Keep Jorog exactly the same; darker background.",
      referenceVersionIds: [ready.id], aspectRatio: "portrait",
    });
    expect(edit.version.version).toBe(2);
    expect(edit.version.parentVersionId).toBe(ready.id);
    const restored = store.restoreStoryVisualVersion({ ownerKey, projectId: project.id, versionId: ready.id });
    expect(restored.version).toBe(3);
    expect(restored.metadata.restoredFromVersionId).toBe(ready.id);
    expect(store.listStoryVisualAssets({ ownerKey, projectId: project.id })[0].versions).toHaveLength(3);

    expect(() => store.getStoryVisualVersion({ ownerKey: outsider, projectId: project.id, versionId: ready.id })).toThrow();

    const directorAction = actions.resolveStoryVisualDirectorAction({
      instruction: "Use the same character reference and create an image for Shot 2 in Scene 2.",
      entities: store.listStoryBibleEntities({ ownerKey, projectId: project.id }),
      assets: store.listStoryVisualAssets({ ownerKey, projectId: project.id }),
      plan,
    });
    expect(directorAction.visualKind).toBe("shot_reference");
    expect(directorAction.sceneId).toBe("scene-2");
    expect(directorAction.shotId).toBe("shot-2");
    expect(directorAction.referenceVersionIds).toContain(ready.id);
  });

  it("attaches existing images as project-scoped ready versions without a GPU job", () => {
    const ownerKey = "upload-owner";
    const project = store.createStoryCreatorProject({ ownerKey, title: "Upload Story", format: "short", genre: "fantasy" });
    const attached = store.attachStoryVisualUpload({
      ownerKey, projectId: project.id, visualKind: "location", name: "Forest",
      prompt: "Approved forest location", url: "", filePath: "/tmp/mock-forest.png",
    });
    expect(attached.version.status).toBe("ready");
    expect(attached.version.url).toContain(`/visual-assets/media?projectId=${project.id}`);
    expect(store.listStoryGenerationJobs({ ownerKey, projectId: project.id })).toHaveLength(0);
  });

  it("resolves a follow-up create-the-image command from recent Story Director context", () => {
    const entity = {
      id: "entity-athera", projectId: "project-context", ownerKey: "owner-context",
      entityType: "character", name: "Atheria", sourceRole: "user" as const,
      sourceMessageId: null, createdAt: 1, updatedAt: 1,
    };
    expect(actions.isStoryVisualActionInstruction("Create the image.")).toBe(true);
    const action = actions.resolveStoryVisualDirectorAction({
      instruction: "Create the image.",
      conversationContext: "user: Atheria is a young traveler with silver braids and a green cloak.",
      entities: [entity], assets: [], plan: null,
    });
    expect(action).toMatchObject({
      action: "clarify", visualKind: "character",
      entityId: entity.id, name: "Atheria",
    });
    expect(action.questions[0]).toContain("photorealistic");

    const readyAction = actions.resolveStoryVisualDirectorAction({
      instruction: "Create the image.",
      conversationContext: "user: Atheria has silver braids, a green cloak, and a photorealistic cinematic style.",
      entities: [entity], assets: [], plan: null,
    });
    expect(readyAction.action).toBe("prepare-generation");
    expect(readyAction.prompt).toContain("silver braids");
  });

  it("automatic mode prepares production visuals without starting GPU jobs", () => {
    const ownerKey = "automatic-owner";
    const project = store.createStoryCreatorProject({ ownerKey, title: "Automatic Story", format: "short", genre: "fantasy" });
    store.saveStoryProductionPlan({
      ownerKey, projectId: project.id, sourceRole: "user",
      plan: { title: "Automatic Story", format: "short", summary: "One shot", targetDurationSeconds: 5, acts: [{ id: "act", order: 1, title: "Act", summary: "", scenes: [{ id: "scene", order: 1, sceneNumber: "1", title: "Gate", purpose: "Arrive", location: "Gate", timeOfDay: "day", characters: [], action: "The gate opens", dialogue: [], emotionalTone: "wonder", continuityRequirements: [], durationTargetSeconds: 5, screenplaySource: "", shots: [{ id: "shot", order: 1, shotNumber: "1", screenplayExcerpt: "", description: "Wide gate", cameraFraming: "wide", cameraMovement: "static", characterActions: "", dialogue: [], referenceAssetIds: [], generationApproach: "image-to-video", requestedDurationSeconds: 5, status: "planned", acceptedTakeId: null, takes: [] }] }] }] },
    });
    store.approveStoryProductionPlan({ ownerKey, projectId: project.id });
    const first = store.planStoryVisualAssetsFromProduction({ ownerKey, projectId: project.id });
    const second = store.planStoryVisualAssetsFromProduction({ ownerKey, projectId: project.id });
    expect(first).toMatchObject({ created: 2, reused: 0, jobsStarted: 0 });
    expect(second).toMatchObject({ created: 0, reused: 2, jobsStarted: 0 });
    expect(store.listStoryGenerationJobs({ ownerKey, projectId: project.id })).toHaveLength(0);
  });
});
