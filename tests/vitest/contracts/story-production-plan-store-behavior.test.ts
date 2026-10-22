import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const roots: string[] = [];

afterEach(() => {
  vi.resetModules();
  for (const root of roots) {
    fs.rmSync(root, { recursive: true, force: true });
  }
  roots.length = 0;
  delete process.env.OTG_DATA_DIR;
  delete process.env.OTG_DATA_ROOT;
});

async function setup() {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "story-production-plan-"),
  );
  roots.push(root);
  process.env.OTG_DATA_DIR = root;
  process.env.OTG_DATA_ROOT = root;
  vi.resetModules();
  const store = await import("../../../lib/storyCreator/store");
  const planHelpers = await import(
    "../../../lib/storyCreator/productionPlan"
  );
  return { store, planHelpers };
}

describe("Story production plan persistence", () => {
  it("versions draft edits and preserves an explicit approval snapshot", async () => {
    const { store, planHelpers } = await setup();
    const ownerKey = "planner-owner";
    const project = store.createStoryCreatorProject({
      ownerKey,
      title: "Three Brothers",
      format: "movie",
    });
    const empty = planHelpers.createEmptyStoryProductionPlan({
      projectId: project.id,
      title: project.title,
      targetDurationSeconds: 600,
    });
    const scene = {
      title: "The Discovery",
      durationTargetSeconds: 60,
      characters: ["Jorog"],
      shots: [
        {
          description: "Jorog discovers the hidden chamber.",
          requestedDurationSeconds: 9,
          generationApproach: "reference-to-video",
          takes: [],
        },
      ],
    };

    const saved = store.saveStoryProductionPlan({
      ownerKey,
      projectId: project.id,
      plan: {
        ...empty,
        acts: [{ title: "Act 1", scenes: [scene] }],
      },
    });

    expect(saved.version).toBe(1);
    expect(saved.status).toBe("draft");
    expect(
      saved.plan.acts[0].scenes[0].shots[0].requestedDurationSeconds,
    ).toBe(5);
    expect(planHelpers.storyProductionWorkload(saved.plan)).toMatchObject({
      actCount: 1,
      sceneCount: 1,
      shotCount: 1,
      plannedVideoSeconds: 5,
      pendingVideoJobs: 1,
    });

    const approved = store.approveStoryProductionPlan({
      ownerKey,
      projectId: project.id,
    });
    expect(approved.version).toBe(2);
    expect(approved.status).toBe("approved");
    expect(approved.approvedAt).toBeTypeOf("number");

    const versions = store.listStoryProductionPlanVersions({
      ownerKey,
      projectId: project.id,
    });
    expect(versions.map((item) => item.status)).toEqual([
      "approved",
      "draft",
    ]);

    const edited = store.saveStoryProductionPlan({
      ownerKey,
      projectId: project.id,
      plan: { ...approved.plan, summary: "Revised after approval." },
    });
    expect(edited.version).toBe(3);
    expect(edited.status).toBe("draft");
    expect(edited.approvedAt).toBeNull();
  });

  it("isolates plans by authenticated owner", async () => {
    const { store } = await setup();
    const project = store.createStoryCreatorProject({
      ownerKey: "first-owner",
      title: "Private Production",
    });

    expect(() =>
      store.getStoryProductionPlan({
        ownerKey: "second-owner",
        projectId: project.id,
      }),
    ).toThrow();
  });
});
