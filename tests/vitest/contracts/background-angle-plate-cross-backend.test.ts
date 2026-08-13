import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const panelSource = readFileSync(
  resolve(process.cwd(), "app/app/components/CharactersPanel.tsx"),
  "utf8",
);

const routeSource = readFileSync(
  resolve(process.cwd(), "app/api/background-angle-plate/route.ts"),
  "utf8",
);

describe("Background Studio angle-plate cross-backend handoff", () => {
  it("accepts prompt-scoped app proxy image references", () => {
    expect(routeSource).toContain("OTG_BACKGROUND_ANGLE_PLATE_CROSS_BACKEND_SOURCE_V36AK");
    expect(routeSource).toContain('new URL(raw, "http://otg.local")');
    expect(routeSource).toContain('"/api/comfy/history-image"');
    expect(routeSource).toContain("fetchSourceImageFromProxy");
  });

  it("recognizes the Linux RTX 3090 ComfyUI output directory", () => {
    expect(routeSource).toContain('"/home/shawn-rochford/AI/ComfyUI/ComfyUI/output"');
    expect(routeSource).toContain("process.env.OTG_DATA_ROOT");
  });

  it("uploads exact source bytes to the angle workflow backend", () => {
    expect(routeSource).toContain("bytes: source.bytes");
    expect(routeSource).toContain('setNodeInput(workflow, "25", "image", upload.name)');
    expect(routeSource).toContain('setNodeInput(workflow, "142", "filename_prefix", filenamePrefix)');
  });

  it("requires a prompt id from the angle workflow", () => {
    expect(routeSource).toContain('const promptId = String(queued.json?.prompt_id || queued.json?.promptId || "").trim();');
    expect(routeSource).toContain("prompt_id: promptId");
  });

  it("resolves the final stitched plate by prompt id and exact prefix", () => {
    expect(panelSource).toContain("OTG_BACKGROUND_ANGLE_PLATE_PROMPT_HISTORY_V36AK");
    expect(panelSource).toContain("waitForBackgroundAnglePlateOutputCandidateV36AK({");
    expect(panelSource).toContain("promptId: anglePlatePromptIdV36AK");
    expect(panelSource).toContain("{ filenamePrefix: cleanPrefix }");
    expect(panelSource).toContain("value: exactHistoryImageV36AK.url");
  });
  it("shows the completed angle plate before saving the background card", () => {
    expect(panelSource).toContain("displayImage: plateWorkflowValue");
    expect(panelSource).toContain("sourceDisplayImageV36AF: originalDisplayValue || sourceValue");
  });

});
