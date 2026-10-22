import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const tempRoots: string[] = [];

afterEach(() => {
  vi.resetModules();
  for (const root of tempRoots) {
    fs.rmSync(root, { recursive: true, force: true });
  }
  tempRoots.length = 0;
  delete process.env.OTG_DATA_DIR;
  delete process.env.OTG_DATA_ROOT;
});

describe("Story Director persistent project context", () => {
  it("separates canon from proposals and omits private asset paths", async () => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "story-director-context-"),
    );
    tempRoots.push(root);
    process.env.OTG_DATA_DIR = root;
    process.env.OTG_DATA_ROOT = root;
    vi.resetModules();

    const store = await import("../../../lib/storyCreator/store");
    const { buildStoryDirectorProjectContext } = await import(
      "../../../lib/storyCreator/context"
    );
    const ownerKey = "context-owner";
    const project = store.createStoryCreatorProject({
      ownerKey,
      title: "Atheria Rising",
      format: "movie",
      genre: "fantasy",
    });
    const source = store.addStoryCreatorMessage({
      ownerKey,
      projectId: project.id,
      role: "user",
      content: "Jorog protects Atheria.",
    });
    const jorog = store.createStoryBibleEntity({
      ownerKey,
      projectId: project.id,
      entityType: "character",
      name: "Jorog",
      sourceRole: "user",
      sourceMessageId: source.id,
    });

    store.addStoryBibleFact({
      ownerKey,
      projectId: project.id,
      subjectEntityId: jorog.id,
      predicate: "protects",
      valueText: "Atheria",
      canonStatus: "canon",
      sourceRole: "user",
      sourceMessageId: source.id,
    });
    store.addStoryBibleFact({
      ownerKey,
      projectId: project.id,
      subjectEntityId: jorog.id,
      predicate: "weapon",
      valueText: "a crystal spear",
      canonStatus: "suggestion",
      sourceRole: "assistant",
    });
    store.addStoryAsset({
      ownerKey,
      projectId: project.id,
      assetType: "character",
      name: "Jorog hero reference",
      status: "ready",
      provider: "qwen-image-2.1",
      filePath: "/private/owner/path/jorog.png",
      prompt: "Jorog portrait",
    });

    const result = buildStoryDirectorProjectContext({
      ownerKey,
      projectId: project.id,
      query: "Continue Jorog's scene in Atheria",
    });

    expect(result.context).toContain(
      "APPROVED CANON - authoritative; preserve exactly",
    );
    expect(result.context).toContain("Jorog | protects | Atheria");
    expect(result.context).toContain(
      "PROPOSED DETAILS - not canon unless the user approves",
    );
    expect(result.context).toContain(
      "Jorog | weapon | a crystal spear",
    );
    expect(result.context).toContain(
      "character | Jorog hero reference | ready",
    );
    expect(result.context).not.toContain("/private/owner/path");
    expect(result.counts).toMatchObject({
      canon: 1,
      proposals: 1,
      assets: 1,
    });
  });

  it("denies a project owned by another user", async () => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "story-director-context-owner-"),
    );
    tempRoots.push(root);
    process.env.OTG_DATA_DIR = root;
    process.env.OTG_DATA_ROOT = root;
    vi.resetModules();

    const store = await import("../../../lib/storyCreator/store");
    const { buildStoryDirectorProjectContext } = await import(
      "../../../lib/storyCreator/context"
    );
    const project = store.createStoryCreatorProject({
      ownerKey: "first-owner",
      title: "Private Story",
    });

    expect(() =>
      buildStoryDirectorProjectContext({
        ownerKey: "second-owner",
        projectId: project.id,
        query: "recap",
      }),
    ).toThrow("Story project was not found.");
  });
});
