import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

type StoryStore =
  typeof import("../../../lib/storyCreator/store");
type DesignContext =
  typeof import("../../../lib/storyCreator/designContext");

let store: StoryStore;
let design: DesignContext;
let tempRoot = "";

const previousDataDir = process.env.OTG_DATA_DIR;
const previousDataRoot = process.env.OTG_DATA_ROOT;

function expectCode(
  action: () => unknown,
  expectedCode: string,
) {
  try {
    action();
  } catch (error) {
    expect(
      error &&
        typeof error === "object" &&
        "code" in error
        ? String((error as { code?: unknown }).code || "")
        : "",
    ).toBe(expectedCode);
    return;
  }

  throw new Error(`Expected error code ${expectedCode}.`);
}

describe("Story Creator V2 story-aware design context behavior", () => {
  beforeAll(async () => {
    tempRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "otg-story-v2-design-context-"),
    );

    process.env.OTG_DATA_DIR = tempRoot;
    process.env.OTG_DATA_ROOT = tempRoot;

    vi.resetModules();

    store = await import("../../../lib/storyCreator/store");
    design = await import("../../../lib/storyCreator/designContext");
  });

  afterAll(() => {
    if (previousDataDir === undefined) {
      delete process.env.OTG_DATA_DIR;
    } else {
      process.env.OTG_DATA_DIR = previousDataDir;
    }

    if (previousDataRoot === undefined) {
      delete process.env.OTG_DATA_ROOT;
    } else {
      process.env.OTG_DATA_ROOT = previousDataRoot;
    }

    if (tempRoot) {
      fs.rmSync(tempRoot, {
        recursive: true,
        force: true,
      });
    }
  });

  it("assembles active approved canon, bounded related environment context, and provenance", () => {
    const ownerKey = "design-context-owner";
    const otherOwner = "design-context-other-owner";
    const project = store.createStoryCreatorProject({
      ownerKey,
      title: "Moon Fortress",
    });
    const otherProject = store.createStoryCreatorProject({
      ownerKey: otherOwner,
      title: "Other Story",
    });

    const userMessage = store.addStoryCreatorMessage({
      ownerKey,
      projectId: project.id,
      role: "user",
      content: "Mara is stationed at the moon fortress.",
    });

    const mara = store.createStoryBibleEntity({
      ownerKey,
      projectId: project.id,
      entityType: "character",
      name: "Mara",
      sourceRole: "user",
      sourceMessageId: userMessage.id,
    });
    const fortress = store.createStoryBibleEntity({
      ownerKey,
      projectId: project.id,
      entityType: "location",
      name: "Moon Fortress",
      sourceRole: "user",
      sourceMessageId: userMessage.id,
    });
    const unrelated = store.createStoryBibleEntity({
      ownerKey,
      projectId: project.id,
      entityType: "character",
      name: "Unrelated Captain",
      sourceRole: "user",
      sourceMessageId: userMessage.id,
    });

    const visualFact = store.addStoryBibleFact({
      ownerKey,
      projectId: project.id,
      subjectEntityId: mara.id,
      predicate: "appearance",
      valueText: "blue eyes and silver armor",
      canonStatus: "canon",
      sourceRole: "user",
      sourceMessageId: userMessage.id,
    });
    const oldHair = store.addStoryBibleFact({
      ownerKey,
      projectId: project.id,
      subjectEntityId: mara.id,
      predicate: "hair",
      valueText: "long black hair",
      canonStatus: "canon",
      sourceRole: "user",
      sourceMessageId: userMessage.id,
    });
    const newHair = store.addStoryBibleFact({
      ownerKey,
      projectId: project.id,
      subjectEntityId: mara.id,
      predicate: "hair",
      valueText: "short white hair",
      canonStatus: "canon",
      sourceRole: "user",
      sourceMessageId: userMessage.id,
      supersedesFactId: oldHair.id,
    });
    const relationFact = store.addStoryBibleFact({
      ownerKey,
      projectId: project.id,
      subjectEntityId: mara.id,
      predicate: "stationed_at",
      valueText: "",
      objectEntityId: fortress.id,
      canonStatus: "canon",
      sourceRole: "user",
      sourceMessageId: userMessage.id,
    });
    const locationFact = store.addStoryBibleFact({
      ownerKey,
      projectId: project.id,
      subjectEntityId: fortress.id,
      predicate: "environment",
      valueText: "a crater wall observatory with blue glass",
      canonStatus: "canon",
      sourceRole: "user",
      sourceMessageId: userMessage.id,
    });
    const suggestion = store.addStoryBibleFact({
      ownerKey,
      projectId: project.id,
      subjectEntityId: mara.id,
      predicate: "clothing",
      valueText: "maybe a red cloak",
      canonStatus: "suggestion",
      sourceRole: "assistant",
      sourceMessageId: null,
    });
    store.addStoryBibleFact({
      ownerKey,
      projectId: project.id,
      subjectEntityId: unrelated.id,
      predicate: "appearance",
      valueText: "green visor",
      canonStatus: "canon",
      sourceRole: "user",
      sourceMessageId: userMessage.id,
    });

    const readyAsset = store.addStoryAsset({
      ownerKey,
      projectId: project.id,
      assetType: "character",
      name: "Mara approved sketch",
      prompt: "Mara with silver armor",
      status: "ready",
      provider: "qwen-image-2-1",
      url: "/api/comfy/history-image?promptId=ready",
      metadata: {
        selectedEntityId: mara.id,
      },
    });

    const context = design.assembleStoryDesignContext({
      ownerKey,
      projectId: project.id,
      entityId: mara.id,
      userInstruction:
        "Give her shoulder-length hair and a scar over her left eyebrow.",
    });

    expect(context.entity.id).toBe(mara.id);
    expect(context.authoritativeFacts.map((fact) => fact.id)).toEqual(
      expect.arrayContaining([visualFact.id, newHair.id]),
    );
    expect(context.authoritativeFacts.map((fact) => fact.id)).not.toContain(
      oldHair.id,
    );
    expect(context.relatedEntityIdsUsed).toBeUndefined();
    expect(context.relatedEntities.map((entity) => entity.id)).toContain(
      fortress.id,
    );
    expect(context.relatedFacts.map((fact) => fact.id)).toContain(
      locationFact.id,
    );
    expect(context.relatedFacts.map((fact) => fact.valueText).join(" ")).not.toContain(
      "green visor",
    );
    expect(context.unapprovedHints.map((fact) => fact.id)).toContain(
      suggestion.id,
    );
    expect(context.provenance.factIdsUsed).toEqual(
      expect.arrayContaining([
        visualFact.id,
        newHair.id,
        relationFact.id,
        locationFact.id,
      ]),
    );
    expect(context.provenance.relatedEntityIdsUsed).toContain(
      fortress.id,
    );
    expect(context.provenance.readyAssetIdsUsed).toContain(
      readyAsset.id,
    );
    expect(context.prompt).toContain(
      "Current user design direction, temporary for this generation only",
    );
    expect(context.prompt).toContain("shoulder-length hair");

    expectCode(
      () =>
        design.assembleStoryDesignContext({
          ownerKey: otherOwner,
          projectId: project.id,
          entityId: mara.id,
        }),
      "STORY_PROJECT_NOT_FOUND",
    );
    expectCode(
      () =>
        design.assembleStoryDesignContext({
          ownerKey,
          projectId: otherProject.id,
          entityId: mara.id,
        }),
      "STORY_PROJECT_NOT_FOUND",
    );
  });

  it("persists design provenance on new generated assets and jobs without changing canon", () => {
    const ownerKey = "design-generation-owner";
    const project = store.createStoryCreatorProject({
      ownerKey,
      title: "Regeneration Story",
    });
    const message = store.addStoryCreatorMessage({
      ownerKey,
      projectId: project.id,
      role: "user",
      content: "Ivo is a clockwork character.",
    });
    const ivo = store.createStoryBibleEntity({
      ownerKey,
      projectId: project.id,
      entityType: "character",
      name: "Ivo",
      sourceRole: "user",
      sourceMessageId: message.id,
    });
    const fact = store.addStoryBibleFact({
      ownerKey,
      projectId: project.id,
      subjectEntityId: ivo.id,
      predicate: "appearance",
      valueText: "brass hands and glass eyes",
      canonStatus: "canon",
      sourceRole: "user",
      sourceMessageId: message.id,
    });

    function submitDesign(userDesignInstruction: string) {
      const context = design.assembleStoryDesignContext({
        ownerKey,
        projectId: project.id,
        entityId: ivo.id,
        userInstruction: userDesignInstruction,
      });
      const provenance = {
        ...context.provenance,
        assembledFinalPrompt: context.prompt,
        contextGeneratedAt: context.provenance.generatedAt,
        userDesignInstruction,
      };
      const asset = store.addStoryAsset({
        ownerKey,
        projectId: project.id,
        assetType: "character",
        name: `${context.entity.name} Story Design`,
        prompt: context.prompt,
        status: "generating",
        provider: "qwen-image-2-1",
        jobId: `prompt-${userDesignInstruction.length}`,
        metadata: {
          selectedEntityId: context.entity.id,
          storyDesignContextProvenance: provenance,
        },
      });
      const job = store.addStoryGenerationJob({
        ownerKey,
        projectId: project.id,
        assetId: asset.id,
        jobType: "story-image",
        provider: "qwen-image-2-1",
        status: "submitted",
        promptId: asset.jobId,
        endpoint: "/api/assets/create-image",
        request: {
          model: "qwen-image-2-1",
          prompt: context.prompt,
          storyDesignContextProvenance: provenance,
        },
        response: {
          outputNodeId: "461",
        },
      });

      return { asset, job };
    }

    const first = submitDesign("Use a warm lantern glow.");
    const second = submitDesign("Use a cold blue rim light.");

    expect(first.asset.id).not.toBe(second.asset.id);
    expect(first.job.id).not.toBe(second.job.id);

    const assets = store.listStoryAssets({
      ownerKey,
      projectId: project.id,
    });
    const jobs = store.listStoryGenerationJobs({
      ownerKey,
      projectId: project.id,
    });

    expect(assets.map((asset) => asset.id)).toEqual(
      expect.arrayContaining([first.asset.id, second.asset.id]),
    );
    expect(jobs.map((job) => job.id)).toEqual(
      expect.arrayContaining([first.job.id, second.job.id]),
    );

    const stored = assets.find((asset) => asset.id === second.asset.id);
    const provenance = stored?.metadata
      .storyDesignContextProvenance as Record<string, unknown>;

    expect(stored?.metadata.selectedEntityId).toBe(ivo.id);
    expect(provenance.selectedEntityId).toBe(ivo.id);
    expect(provenance.factIdsUsed).toEqual([fact.id]);
    expect(provenance.userDesignInstruction).toBe(
      "Use a cold blue rim light.",
    );
    expect(provenance.assembledFinalPrompt).toContain(
      "cold blue rim light",
    );
    expect(provenance.contextGeneratedAt).toBeTruthy();

    const canonFacts = store.listStoryBibleFacts({
      ownerKey,
      projectId: project.id,
    });
    expect(canonFacts).toHaveLength(1);
    expect(canonFacts[0].id).toBe(fact.id);
  });
});
