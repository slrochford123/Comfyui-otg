import fs from "node:fs";
import { describe, expect, it } from "vitest";

function read(path: string) {
  return fs.readFileSync(path, "utf8");
}

describe("Video edit live preview contract", () => {
  it("keeps Generate Create & Animate on the shared Comfy progress bridge", () => {
    const workflows = read("lib/imageGenerateWorkflows.ts");
    const route = read("app/api/comfy/route.ts");
    const app = read("app/app/AppPageClient.tsx");

    expect(workflows).toContain('operation: "animate"');
    expect(workflows).toContain("presets/image_anima_base_v1");
    expect(route).toContain("recordComfyPromptSubmitted");
    expect(route).toContain("ensureComfyClientProgressMonitor");
    expect(route).toContain("writeState(ownerKey");
    expect(app).toContain("generateApproximatePreview");
    expect(app).toContain("Final output replaces this preview after completion.");
  });

  it("submits LTX Edit Anything in async live-preview mode and polls for final replacement", () => {
    const route = read("app/api/edit-video/ltx-edit/route.ts");
    const panel = read("app/app/components/EditVideoEditAnythingPanel.tsx");

    expect(route).toContain("recordComfyPromptSubmitted");
    expect(route).toContain("ensureComfyClientProgressMonitor");
    expect(route).toContain("waitForComfyClientProgressMonitor");
    expect(route).toContain("livePreview");
    expect(route).toContain("export async function GET");
    expect(route).toContain("export async function DELETE");
    expect(panel).toContain('form.set("livePreview", "true")');
    expect(panel).toContain("/api/progress?promptId=");
    expect(panel).toContain("/api/edit-video/ltx-edit?jobId=");
    expect(panel).toContain("Approximate Preview");
    expect(panel).toContain("Final output replaces this preview after completion.");
    expect(panel).toContain("Cancel");
  });

  it("registers Production Animate and legacy Production Edit Video Comfy prompts for preview forwarding", () => {
    const animateRoute = read("app/api/production/animate/route.ts");
    const productionEditRoute = read("app/api/production/edit-video/route.ts");

    for (const source of [animateRoute, productionEditRoute]) {
      expect(source).toContain("recordComfyPromptSubmitted");
      expect(source).toContain("ensureComfyClientProgressMonitor");
      expect(source).toContain("waitForComfyClientProgressMonitor");
      expect(source).toContain("client_id");
    }
  });
});
