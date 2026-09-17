import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();

const app = readFileSync(
  join(repoRoot, "app/app/AppPageClient.tsx"),
  "utf8",
);

const panel = readFileSync(
  join(repoRoot, "app/app/components/StoryCreatorPanel.tsx"),
  "utf8",
);

const store = readFileSync(
  join(repoRoot, "lib/storyCreator/store.ts"),
  "utf8",
);

const route = readFileSync(
  join(repoRoot, "app/api/story-creator/projects/route.ts"),
  "utf8",
);

describe("Story Creator Phase 1A contract", () => {
  it("renames the Machine tab to Story Creator", () => {
    expect(app).toContain('machine: "Story Creator"');
    expect(app).toContain("<StoryCreatorPanel");
    expect(app).not.toContain('data-otg="machine-placeholder"');
    expect(app).not.toContain(">The Machine<");
  });

  it("enforces the six Story project limit on the server", () => {
    expect(store).toContain(
      "export const STORY_CREATOR_PROJECT_LIMIT = 6",
    );

    expect(store).toContain("STORY_PROJECT_LIMIT");
  });

  it("uses durable sqlite storage", () => {
    expect(store).toContain('from "better-sqlite3"');
    expect(store).toContain("story-creator.sqlite");
    expect(store).toContain("CREATE TABLE IF NOT EXISTS story_projects");
  });

  it("supports project CRUD", () => {
    expect(route).toContain("export async function GET");
    expect(route).toContain("export async function POST");
    expect(route).toContain("export async function PATCH");
    expect(route).toContain("export async function DELETE");
  });

  it("provides New, Continue, Rename, and Delete UI", () => {
    expect(panel).toContain("+ New Story");
    expect(panel).toContain("Continue");
    expect(panel).toContain("Rename");
    expect(panel).toContain("Delete");
  });
});
