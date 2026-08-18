import { describe, expect, it } from "vitest";

import h3Workflow from "@/comfy_workflows/internal/voices/minimax_h3_audio.json";
import ltxWorkflow from "@/comfy_workflows/internal/voices/ltx25_audio.json";
import { prepareWorkflowForTarget, stripSageAttention, targetAllowsSageAttention } from "@/lib/comfyWorkflowCompatibility";

describe("Comfy workflow target compatibility", () => {
  it("strips and bypasses MiniMax Sage Attention for 5060 Ti", () => {
    const workflow = {
      "134": { class_type: "PathchSageAttentionKJ", inputs: { sage_attention: "auto", model: ["138", 0] } },
      "137": { class_type: "SpectrumApplyMiniMaxH3", inputs: { model: ["134", 0] } },
      "138": { class_type: "LoraLoaderModelOnly", inputs: { model: ["127", 0] } },
    };
    const result = prepareWorkflowForTarget(workflow, "5060ti");
    expect(result.sageAttentionEnabled).toBe(false);
    expect(result.removedSageNodeIds).toEqual(["134"]);
    expect(result.workflow["134"]).toBeUndefined();
    expect(result.workflow["137"].inputs.model).toEqual(["138", 0]);
  });

  it("strips and bypasses LTX Sage Attention for 5060 Ti", () => {
    const workflow = {
      "419": { class_type: "LTXVDualCFGGuider", inputs: { model: ["458", 0] } },
      "439": { class_type: "UNETLoader", inputs: {} },
      "458": { class_type: "PathchSageAttentionKJ", inputs: { sage_attention: "auto", model: ["439", 0] } },
    };
    const result = stripSageAttention(workflow);
    expect(result.workflow["458"]).toBeUndefined();
    expect(result.workflow["419"].inputs.model).toEqual(["439", 0]);
  });

  it("validates required control nodes in the verified MiniMax H3 template", () => {
    expect((h3Workflow as any)["131"]?.inputs).toBeTruthy();
    expect((h3Workflow as any)["133"]?.inputs).toBeTruthy();
    expect((h3Workflow as any)["129"]?.inputs).toBeTruthy();
    expect((h3Workflow as any)["139"]?.inputs).toBeTruthy();
    expect((h3Workflow as any)["134"]?.class_type).toContain("SageAttention");

    const result = prepareWorkflowForTarget(h3Workflow, "5060ti");
    expect(result.sageAttentionEnabled).toBe(false);
    expect(result.removedSageNodeIds).toContain("134");
    expect(result.workflow["134"]).toBeUndefined();
    expect(result.workflow["137"].inputs.model).toEqual(["138", 0]);
  });

  it("validates required control nodes in the verified LTX 2.5 template", () => {
    for (const nodeId of ["432", "433", "450", "429", "421", "455"]) {
      expect((ltxWorkflow as any)[nodeId]?.inputs).toBeTruthy();
    }
    expect((ltxWorkflow as any)["458"]?.class_type).toContain("SageAttention");

    const result = prepareWorkflowForTarget(ltxWorkflow, "5060ti");
    expect(result.sageAttentionEnabled).toBe(false);
    expect(result.removedSageNodeIds).toContain("458");
    expect(result.workflow["458"]).toBeUndefined();
    expect(result.workflow["419"].inputs.model).toEqual(["439", 0]);
  });

  it("allows Sage only on explicitly known 3090/shawn targets", () => {
    expect(targetAllowsSageAttention("3090")).toBe(true);
    expect(targetAllowsSageAttention("shawn-video-3090")).toBe(true);
    expect(targetAllowsSageAttention("5060ti")).toBe(false);
    expect(targetAllowsSageAttention(null)).toBe(false);

    const h3 = prepareWorkflowForTarget(h3Workflow, "shawn-3090");
    const ltx = prepareWorkflowForTarget(ltxWorkflow, "3090");
    expect(h3.sageAttentionEnabled).toBe(true);
    expect(h3.removedSageNodeIds).toEqual([]);
    expect((h3.workflow as any)["134"]).toBeTruthy();
    expect(ltx.sageAttentionEnabled).toBe(true);
    expect(ltx.removedSageNodeIds).toEqual([]);
    expect((ltx.workflow as any)["458"]).toBeTruthy();
  });
});
