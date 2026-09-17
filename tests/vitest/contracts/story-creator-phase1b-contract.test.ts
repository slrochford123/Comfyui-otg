import fs from "node:fs";
import path from "node:path";

import {
  describe,
  expect,
  it,
} from "vitest";

const root = process.cwd();

function read(relative: string) {
  return fs.readFileSync(
    path.join(root, relative),
    "utf8",
  );
}

describe("Story Creator Phase 1B", () => {
  it("adds durable project-scoped messages with cascade deletion", () => {
    const source = read(
      "lib/storyCreator/store.ts",
    );

    expect(source).toContain(
      "CREATE TABLE IF NOT EXISTS story_messages",
    );

    expect(source).toContain(
      "REFERENCES story_projects(id)",
    );

    expect(source).toContain(
      "ON DELETE CASCADE",
    );

    expect(source).toContain(
      "listStoryCreatorMessages",
    );

    expect(source).toContain(
      "addStoryCreatorMessage",
    );
  });

  it("derives project ownership from the authenticated server session", () => {
    const source = read(
      "app/api/story-creator/projects/route.ts",
    );

    expect(source).toContain(
      "getSessionUser",
    );

    expect(source).toContain(
      "user.ownerKey",
    );

    expect(source).not.toContain(
      "x-otg-story-owner",
    );

    expect(source).not.toContain(
      'searchParams.get("owner")',
    );
  });

  it("protects message reads and writes with the authenticated session", () => {
    const source = read(
      "app/api/story-creator/messages/route.ts",
    );

    expect(source).toContain(
      "getSessionUser",
    );

    expect(source).toContain(
      "listStoryCreatorMessages",
    );

    expect(source).toContain(
      "addStoryCreatorMessage",
    );
  });

  it("loads and persists the Story Director conversation", () => {
    const source = read(
      "app/app/components/StoryCreatorPanel.tsx",
    );

    expect(source).toContain(
      "/api/story-creator/messages",
    );

    expect(source).toContain(
      "persistMessage",
    );

    expect(source).toContain(
      "loadStoryMessages",
    );
  });

  it("reuses the existing strict-canon Story Helper profile", () => {
    const source = read(
      "app/app/components/StoryCreatorPanel.tsx",
    );

    expect(source).toContain(
      "/api/ollama-ai/chat",
    );

    expect(source).toContain(
      '"x-otg-ai-assistance-profile"',
    );

    expect(source).toContain(
      '"story-helper"',
    );
  });

  it("keeps Story Bible and Assets as later-phase placeholders", () => {
    const source = read(
      "app/app/components/StoryCreatorPanel.tsx",
    );

    expect(source).toContain(
      "Story Bible",
    );

    expect(source).toContain(
      "Assets",
    );

    expect(source).toContain(
      "Phase 2",
    );
  });
});
