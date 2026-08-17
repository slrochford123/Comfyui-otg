import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertWorkflowInputCount,
  loadComfyCapabilityRegistry,
  resolveWorkflowCapability,
} from "@/lib/comfyCapabilities";

afterEach(() => vi.unstubAllEnvs());

describe("Comfy capability manifests", () => {
  it("parses matching backend and workflow manifests", () => {
    const registry = loadComfyCapabilityRegistry();
    expect(registry.backends.map((backend) => backend.id)).toEqual(["rtx3090", "rtx5060ti"]);
    expect(registry.workflows).toHaveLength(62);
    expect(registry.policy).toEqual({ primaryBackendId: "rtx3090", fallbackBackendId: "rtx5060ti", requireVerifiedWorkflow: true });
  });

  it("resolves normalized workflow file paths", () => {
    const workflow = resolveWorkflowCapability({ workflowFile: "comfy_workflows/presets/WAN 2.2 T2V GGUF.json" });
    expect(workflow?.id).toBe("presets/WAN 2.2 T2V GGUF");
    expect(workflow?.backendSupport.rtx5060ti.state).toBe("missing-node");
    expect(workflow?.backendSupport.rtx5060ti.reason).toContain("UnetLoaderGGUF");
  });

  it("rejects an incorrect input count", () => {
    const workflow = resolveWorkflowCapability({ workflowId: "presets/WAN 2.2 FLF GGUF" });
    expect(workflow).not.toBeNull();
    expect(assertWorkflowInputCount(workflow!, 1)).toEqual({ ok: false, error: "presets/WAN 2.2 FLF GGUF requires 2 input asset(s); received 1." });
    expect(assertWorkflowInputCount(workflow!, 2)).toEqual({ ok: true });
  });

  it("only marks 5060 Ti workflows with cold/warm downloaded-output evidence verified", () => {
    const registry = loadComfyCapabilityRegistry();
    const verified = registry.workflows.filter((workflow) => workflow.backendSupport.rtx5060ti.state === "verified");
    expect(verified.map((workflow) => workflow.id)).toEqual([
      "presets/Create Anime Images",
      "presets/Create a Picture",
      "presets/Edit Image",
      "presets/character_card_8_angles_low_angle",
      "presets/image_boogu_image_0_1_turbo_t2i",
      "presets/image_ernie_image_turbo",
      "presets/image_krea2_turbo_t2i",
      "presets/image_z_image_turbo",
    ]);
    for (const workflow of verified) {
      const runs = workflow.backendSupport.rtx5060ti.testedConfiguration?.runs as Array<{ outputPaths: string[] }>;
      expect(runs).toHaveLength(2);

      const outputs = runs.flatMap((run) => run.outputPaths);
      expect(runs.every((run) => run.outputPaths.length > 0)).toBe(true);
      expect(outputs.every((output) => path.isAbsolute(output))).toBe(true);

      const localEvidenceCount = outputs.filter((output) => fs.existsSync(output)).length;
      if (localEvidenceCount > 0) {
        expect(localEvidenceCount).toBe(outputs.length);
      }
    }
  });

  it("rejects mismatched manifest versions", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "otg-capability-version-"));
    const backendFile = path.join(directory, "backends.json");
    const workflowFile = path.join(directory, "workflows.json");
    fs.writeFileSync(backendFile, JSON.stringify({ manifestVersion: "a", policy: {}, backends: [] }));
    fs.writeFileSync(workflowFile, JSON.stringify({ manifestVersion: "b", workflows: [] }));
    vi.stubEnv("OTG_COMFY_BACKENDS_FILE", backendFile);
    vi.stubEnv("OTG_COMFY_WORKFLOW_CAPABILITIES_FILE", workflowFile);
    expect(() => loadComfyCapabilityRegistry()).toThrow("manifest versions do not match");
    fs.rmSync(directory, { recursive: true, force: true });
  });
});
