import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "app/app/components/CharactersPanel.tsx"),
  "utf8",
);

describe("Background Studio prompt-scoped preview output", () => {
  it("captures the exact ComfyUI prompt id returned by /api/comfy", () => {
    expect(source).toContain("OTG_BACKGROUND_PROMPT_HISTORY_V36AJ");
    expect(source).toContain(
      'const backgroundPreviewPromptIdV36AJ = String(json?.prompt_id || json?.promptId || "").trim();',
    );
  });

  it("resolves the exact prompt and exact filename prefix through history-image", () => {
    expect(source).toContain(
      "fetchComfyHistoryImageForPromptV36BP9(\n              backgroundPreviewPromptIdV36AJ,\n              { filenamePrefix: backgroundPreviewTitleV36G },",
    );
    expect(source).toContain("value: exactHistoryImageV36AJ.url");
  });

  it("retains the exact-filename fallback without allowing random recent images", () => {
    expect(source).toContain("findExactBackgroundPreviewCandidateV36R({");
    expect(source).toContain("It will not sync a random recent image.");
  });

  it("shows the prompt id while the exact output is pending", () => {
    expect(source).toContain(
      "Prompt ${backgroundPreviewPromptIdV36AJ}. Waiting for its exact output...",
    );
  });
});
