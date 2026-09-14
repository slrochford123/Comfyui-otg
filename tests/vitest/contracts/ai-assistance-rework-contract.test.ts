import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();

const route = readFileSync(
  join(repoRoot, "app/api/ollama-ai/chat/route.ts"),
  "utf8",
);

const app = readFileSync(
  join(repoRoot, "app/app/AppPageClient.tsx"),
  "utf8",
);

const router = readFileSync(
  join(repoRoot, "lib/workers/qwenClusterRouter.ts"),
  "utf8",
);

describe("AI Assistance rework contract", () => {
  it("keeps AI Assistance scoped to Describe Picture and Story Helper", () => {
    expect(app).toContain(
      'type AssistanceTab = "describe" | "ask";',
    );

    expect(app).toContain(
      '<Card title="Describe Picture">',
    );

    expect(app).toContain(
      '<Card title="Story Helper">',
    );
  });

  it("removes the orphaned legacy Enhance Prompt tab implementation", () => {
    expect(app).not.toContain(
      "const [enhanceDraft, setEnhanceDraft]",
    );

    expect(app).not.toContain(
      "function handleEnhanceImageSelect",
    );

    expect(app).not.toContain(
      "async function handleEnhanceDraft",
    );

    // Generate still legitimately owns its separate Enhance Prompt action.
    expect(app).toContain(
      "enhancePromptText",
    );
  });

  it("gives Story Helper a larger bounded conversation window", () => {
    expect(route).toContain(
      "const AI_ASSISTANCE_NUM_CTX = 16 * 1024;",
    );

    expect(route).toContain(
      "const DEFAULT_CHAT_MESSAGE_LIMIT = 12;",
    );

    expect(route).toContain(
      "const STORY_HELPER_MESSAGE_LIMIT = 48;",
    );

    expect(route).toContain(
      ".slice(-Math.max(1, Math.floor(limit)));",
    );

    expect(route).toContain(
      "STORY_HELPER_MESSAGE_LIMIT",
    );
  });

  it("preserves strict canon compliance enforcement", () => {
    expect(route).toContain(
      "STRICT CANON MODE:",
    );

    expect(route).toContain(
      "Earlier assistant-authored additions are not canon unless a later user message explicitly adopts, confirms, repeats, or builds on them.",
    );

    expect(route).toContain(
      "Never promote an unaccepted assistant suggestion into canon.",
    );

    expect(route).toContain(
      "storyHelperGuard",
    );
  });

  it("leaves GPU selection under the cluster router instead of forcing CPU inference", () => {
    expect(route).not.toContain(
      "num_gpu: 0",
    );

    expect(router).toContain(
      "delete routedOptions.num_gpu;",
    );
  });
});
