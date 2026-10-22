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

describe("Story Creator project title safeguards", () => {
  it("requires a title and rejects duplicate titles per owner", async () => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "story-project-title-") ,
    );
    tempRoots.push(root);
    process.env.OTG_DATA_DIR = root;
    process.env.OTG_DATA_ROOT = root;
    vi.resetModules();

    const store = await import("../../../lib/storyCreator/store");

    expect(() =>
      store.createStoryCreatorProject({
        ownerKey: "title-owner",
        title: "   ",
      }),
    ).toThrowError(/title is required/i);

    const project = store.createStoryCreatorProject({
      ownerKey: "title-owner",
      title: "  The  First Story  ",
    });

    expect(project.title).toBe("The First Story");
    expect(() =>
      store.createStoryCreatorProject({
        ownerKey: "title-owner",
        title: "the first story",
      }),
    ).toThrowError(/already exists/i);

    expect(() =>
      store.updateStoryCreatorProject({
        ownerKey: "title-owner",
        id: project.id,
        title: "   ",
      }),
    ).toThrowError(/title is required/i);
  });
});
