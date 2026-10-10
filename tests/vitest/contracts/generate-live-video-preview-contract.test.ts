import fs from "node:fs";
import { describe, expect, it } from "vitest";

function read(path: string) {
  return fs.readFileSync(path, "utf8");
}

describe("Generate live video preview contract", () => {
  it("forwards Comfy approximate preview frames through the shared progress route", () => {
    const route = read("app/api/progress/route.ts");
    const progress = read("lib/comfyProgress.ts");

    expect(progress).toContain("approximatePreview");
    expect(progress).toContain("applyComfyBinaryPreviewEvent");
    expect(route).toContain("approximatePreview: status === \"running\"");
    expect(route).toContain("comfyProgress?.approximatePreview || null");
  });

  it("renders approximate preview in Generate before completed media replaces it", () => {
    const app = read("app/app/AppPageClient.tsx");

    expect(app).toContain("generateApproximatePreview");
    expect(app).toContain("setGenerateApproximatePreview(approximatePreview)");
    expect(app).toContain("Approximate Preview");
    expect(app).toContain("Final output replaces this preview after completion.");
    expect(app).toContain("setGenerateApproximatePreview(null)");
  });
});
