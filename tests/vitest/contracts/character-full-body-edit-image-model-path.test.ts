import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const BAD_MODEL =
  "Qwen/qwen_image_edit_2509_fp8_e4m3fn.safetensors";
const GOOD_MODEL =
  "qwen_image_edit_2509_fp8_e4m3fn.safetensors";

describe("Characters full-body Edit Image model contract", () => {
  it("uses the verified Edit Image UNETLoader inventory value", () => {
    const workflow = JSON.parse(
      fs.readFileSync(
        path.join(process.cwd(), "comfy_workflows/presets/Edit Image.json"),
        "utf8",
      ),
    );
    expect(workflow["433:37"]?.class_type).toBe("UNETLoader");
    expect(workflow["433:37"]?.inputs?.unet_name).toBe(GOOD_MODEL);
    expect(workflow["433:37"]?.inputs?.unet_name).not.toBe(BAD_MODEL);
  });

  it("keeps RTX 3090 dependency-complete and marks RTX 5060 Ti verified", () => {
    const registry = JSON.parse(
      fs.readFileSync(
        path.join(process.cwd(), "config/comfy-workflow-capabilities.json"),
        "utf8",
      ),
    );
    const entry = registry.workflows.find(
      (item: { id?: string }) => item.id === "presets/Edit Image",
    );

    expect(entry.requiredModels).toContain(GOOD_MODEL);
    expect(entry.requiredModels).not.toContain(BAD_MODEL);

    expect(entry.backendSupport.rtx3090.state).toBe("installed-not-tested");
    expect(entry.backendSupport.rtx3090.missingNodes).toEqual([]);
    expect(entry.backendSupport.rtx3090.missingModels).toEqual([]);

    const support5060 = entry.backendSupport.rtx5060ti;

    expect(support5060.state).toBe("verified");
    expect(support5060.missingNodes).toEqual([]);
    expect(support5060.missingModels).toEqual([]);

    const runs = support5060.testedConfiguration?.runs ?? [];

    expect(
      runs.some(
        (run: any) =>
          run.temperature === "cold" &&
          run.seed === 424242 &&
          run.runtimeSeconds === 70.568 &&
          Array.isArray(run.outputPaths) &&
          run.outputPaths.length > 0,
      ),
    ).toBe(true);

    expect(
      runs.some(
        (run: any) =>
          run.temperature === "warm" &&
          run.seed === 424243 &&
          run.runtimeSeconds === 44.738 &&
          Array.isArray(run.outputPaths) &&
          run.outputPaths.length > 0,
      ),
    ).toBe(true);
  });

  it("shows the actual backend error", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "app/app/components/CharactersPanel.tsx"),
      "utf8",
    );
    expect(source).toContain("const message = err instanceof Error");
    expect(source).toContain("setError(message);");
    expect(source).toContain('setMessage("");');
    expect(source).not.toContain("setMessage(message);");
    expect(source).not.toContain(
      'setError("Full-body generation failed. Check ComfyUI/edit-image workflow and try again.");',
    );
  });
});
