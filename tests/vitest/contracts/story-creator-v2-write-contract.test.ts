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

const route = read(
  "app/api/story-creator/write/route.ts",
);
const panel = read(
  "app/app/components/StoryCreatorPanel.tsx",
);
const writeTab = read(
  "app/app/components/storyCreatorV2/WriteTab.tsx",
);

describe("Story Creator V2 Write contract", () => {
  it("adds an authenticated writer route using the existing Qwen durable path", () => {
    expect(route).toContain("export async function POST");
    expect(route).not.toContain("export async function GET");
    expect(route).toContain("requireSessionUser");
    expect(route).toContain("qwenDurableFetch");
    expect(route).toContain("QWEN_CLUSTER_MODEL");
    expect(route).toContain("story-creator-write");
  });

  it("uses approved canon only by default", () => {
    expect(route).toContain(
      'fact.canonStatus === "canon"',
    );
    expect(route).toContain(
      "Approve at least one Story Bible canon fact before writing.",
    );
    expect(route).toContain(
      "Do not use suggestions, unknowns, or invented facts as if they are canon.",
    );
  });

  it("connects the Write tab to the selected Story project", () => {
    expect(panel).toContain("/api/story-creator/write");
    expect(panel).toContain("projectId: project.id");
    expect(panel).toContain("mode: storyWritingMode");
    expect(panel).toContain("instruction: storyWritingInstruction");
    expect(panel).not.toContain("selectedWriteProjectId");
  });

  it("renders the expected writing modes and canon policy", () => {
    expect(writeTab).toContain("Story Outline");
    expect(writeTab).toContain("Chapter");
    expect(writeTab).toContain("Episode");
    expect(writeTab).toContain("Scene");
    expect(writeTab).toContain("Dialogue");
    expect(writeTab).toContain("Approved Canon Only");
    expect(writeTab).toContain("Generate from canon");
  });
});
