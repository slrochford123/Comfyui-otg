import fs from "node:fs";
import path from "node:path";

import {
  describe,
  expect,
  it,
} from "vitest";

const root = process.cwd();

function read(relativePath: string) {
  return fs.readFileSync(
    path.join(root, relativePath),
    "utf8",
  );
}

const store = read("lib/storyCreator/store.ts");
const exportRoute = read(
  "app/api/story-creator/export/production/route.ts",
);
const produceTab = read(
  "app/app/components/storyCreatorV2/ProduceTab.tsx",
);
const panel = read(
  "app/app/components/StoryCreatorPanel.tsx",
);

describe("Story Creator V2 production export contract", () => {
  it("persists production exports", () => {
    expect(store).toContain(
      "CREATE TABLE IF NOT EXISTS story_exports",
    );
    expect(store).toContain("addStoryExport");
    expect(store).toContain("listStoryExports");
  });

  it("packages approved canon, review material, assets, jobs, and workflows", () => {
    expect(exportRoute).toContain("export async function GET");
    expect(exportRoute).toContain("export async function POST");
    expect(exportRoute).toContain("requireSessionUser");
    expect(exportRoute).toContain(
      'fact.canonStatus === "canon"',
    );
    expect(exportRoute).toContain("openConflicts");
    expect(exportRoute).toContain("workflowBundle");
    expect(exportRoute).toContain("/api/h3/generation");
    expect(exportRoute).toContain("/api/assets/create-image");
    expect(exportRoute).toContain("/api/characters/voice-preview");
  });

  it("connects the Produce tab to package creation", () => {
    expect(panel).toContain(
      "/api/story-creator/export/production",
    );
    expect(produceTab).toContain("Build package");
    expect(produceTab).toContain("MiniMax H3 preview");
    expect(produceTab).toContain("Latest Package");
  });
});
