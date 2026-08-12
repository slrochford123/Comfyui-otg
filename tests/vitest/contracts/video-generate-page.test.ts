import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  VIDEO_FORMAT_OPTIONS,
  VIDEO_GENERATE_WORKFLOWS,
  VIDEO_GENERATION_OPTIONS,
  VIDEO_MODEL_OPTIONS,
  resolveVideoGenerateWorkflow,
} from "../../../lib/videoGenerateWorkflows";

describe("video Generate page structure", () => {
  it("shows one duration card only for non-WAN video workflows", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "app/app/AppPageClient.tsx"), "utf8");
    expect(source.match(/<Card title="Duration">/g)).toHaveLength(1);
    expect(source).toContain('generateMediaMode === "video" && !isWanWorkflowSelected ? <Card title="Duration">');
    expect(source).toContain('selectedVideoConfiguration?.workflowId || workflowId');
    expect(source).toContain("Choose 5, 10, or 15 seconds.");
  });

  it("submits the exact selected video workflow and blocks duplicate clicks synchronously", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "app/app/AppPageClient.tsx"), "utf8");
    expect(source).toContain('String(selectedVideoConfiguration?.workflowId || "")');
    expect(source).toContain('body.set("workflowId", submitWorkflowId)');
    expect(source).toContain('body.set("workflow", submitWorkflowId)');
    expect(source).toContain("if (generateSubmitInFlightRef.current || generateBusy) return;");
    expect(source).toContain("generateSubmitInFlightRef.current = true;");
    expect(source).toContain("generateSubmitInFlightRef.current = false;");
  });

  it("exposes only the three approved video generation types", () => {
    expect(VIDEO_GENERATION_OPTIONS.map((option) => option.label)).toEqual([
      "Create Video",
      "Create Video with Starter Image",
      "Create First and Last Image Video",
    ]);
  });

  it("offers LTX 2.3 and WAN 2.2 with SafeTensor and GGUF formats", () => {
    expect(VIDEO_MODEL_OPTIONS.map((option) => option.label)).toEqual(["LTX 2.3", "WAN 2.2"]);
    expect(VIDEO_FORMAT_OPTIONS.map((option) => option.label)).toEqual(["SafeTensor", "GGUF"]);
    expect(VIDEO_GENERATE_WORKFLOWS).toHaveLength(9);
  });

  it("maps the three current LTX 2.3 SafeTensor workflows exactly", () => {
    expect(resolveVideoGenerateWorkflow("create", "ltx23", "safetensors")?.workflowId).toBe("presets/Create a Video");
    expect(resolveVideoGenerateWorkflow("starter_image", "ltx23", "safetensors")?.workflowId).toBe("presets/Create a Video from Images");
    expect(resolveVideoGenerateWorkflow("first_last", "ltx23", "safetensors")?.workflowId).toBe("presets/Create First Image to Last Image Video");
  });

  it("maps all six approved WAN SafeTensor and GGUF combinations explicitly", () => {
    const wan = VIDEO_GENERATE_WORKFLOWS.filter((definition) => definition.modelId === "wan22");
    expect(wan).toHaveLength(6);
    expect(wan.every((definition) => definition.workflowId.startsWith("presets/WAN 2.2 "))).toBe(true);
  });
});
