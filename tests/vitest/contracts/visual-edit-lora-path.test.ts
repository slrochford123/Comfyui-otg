import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const EXPECTED_LORA =
  "ltxx/ltx23_edit_anything_global_rank128_v1_9000steps_adamw.safetensors";

const WORKFLOW_PATHS = [
  "comfy_workflows/internal/edit-video/ltx23_edit_anything.json",
  "app/workflows/production/ltx-edit-anything-video-api.json",
];

describe("Visual Edit LTX Edit Anything LoRA path contract", () => {
  for (const relativePath of WORKFLOW_PATHS) {
    it(`${relativePath} uses the exact Linux ComfyUI inventory value`, () => {
      const fullPath = path.join(process.cwd(), relativePath);
      const workflow = JSON.parse(fs.readFileSync(fullPath, "utf8"));
      const node = workflow["192"];

      expect(node?.class_type).toBe("LoraLoaderModelOnly");
      expect(node?.inputs?.lora_name).toBe(EXPECTED_LORA);
      expect(node?.inputs?.lora_name).not.toContain("\\");
    });
  }

  it("keeps the capability manifest aligned with the same exact LoRA filename", () => {
    const fullPath = path.join(
      process.cwd(),
      "config/comfy-workflow-capabilities.json"
    );
    const registry = JSON.parse(fs.readFileSync(fullPath, "utf8"));
    const workflow = registry.workflows.find(
      (item: { id?: string }) =>
        item.id === "internal/edit-video/ltx23_edit_anything"
    );

    expect(workflow).toBeTruthy();
    expect(workflow.requiredModels).toContain(EXPECTED_LORA);
  });
});
