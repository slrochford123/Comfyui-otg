import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  IMAGE_MODELS,
  QWEN21_IMAGE_EDIT_MODELS,
  QWEN21_IMAGE_EDIT_WORKFLOW_ID,
  applyQwen21ImageEditExactPrompt,
} from "../../../lib/imageGenerateWorkflows";

const repoRoot = process.cwd();

const appSource = fs.readFileSync(
  path.join(repoRoot, "app/app/AppPageClient.tsx"),
  "utf8",
);

const routeSource = fs.readFileSync(
  path.join(repoRoot, "app/api/comfy/route.ts"),
  "utf8",
);

function loadEditGraph() {
  return JSON.parse(
    fs.readFileSync(
      path.join(
        repoRoot,
        "comfy_workflows/presets/image_qwen_image_2_1_image_edit.json",
      ),
      "utf8",
    ),
  );
}

describe("Generate Qwen Image Edit 2.1 exact prompt contract", () => {
  it("locks Generate Edit Image to the canonical Qwen 2.1 workflow", () => {
    const model = IMAGE_MODELS.find(
      (entry) => entry.operation === "edit",
    );

    expect(model?.id).toBe(QWEN21_IMAGE_EDIT_WORKFLOW_ID);
    expect(model?.label).toBe("Qwen Image Edit 2.1");

    const graph = loadEditGraph();

    expect(graph["451"]?.inputs?.unet_name).toBe(
      QWEN21_IMAGE_EDIT_MODELS.unet,
    );
    expect(graph["453"]?.inputs?.clip_name).toBe(
      QWEN21_IMAGE_EDIT_MODELS.clip,
    );
    expect(graph["454"]?.inputs?.vae_name).toBe(
      QWEN21_IMAGE_EDIT_MODELS.vae,
    );
    expect(graph["474"]?.class_type).toBe(
      "TextEncodeQwenImage21",
    );
  });

  it("binds the user instruction byte-for-byte without rewriting it", () => {
    const graph = loadEditGraph();

    const exactPrompt =
      "  Change ONLY the red shirt to blue.\\nKeep the face, pose, hands, background, lighting, and framing exactly the same.  ";

    const exactNegative =
      "Do not add people. Do not change the face.";

    applyQwen21ImageEditExactPrompt(
      graph,
      exactPrompt,
      exactNegative,
    );

    expect(graph["474"].inputs.prompt).toBe(exactPrompt);
    expect(graph["474"].inputs.negative_prompt).toBe(
      exactNegative,
    );

    expect(graph["458"].inputs.positive).toEqual([
      "474",
      0,
    ]);
    expect(graph["458"].inputs.negative).toEqual([
      "474",
      1,
    ]);
    expect(graph["458"].inputs.latent_image).toEqual([
      "474",
      2,
    ]);

    expect(graph["458"].inputs.steps).toBe(25);
    expect(graph["458"].inputs.cfg).toBe(1);
    expect(graph["458"].inputs.sampler_name).toBe("euler");
    expect(graph["458"].inputs.scheduler).toBe("simple");
  });

  it("does not add Generate style or character-continuity text to Edit Image", () => {
    expect(appSource).toContain(
      'const exactEditPrompt = isEditImageWorkflowSelected ? prompt : "";',
    );

    expect(appSource).toContain(
      "!isEditImageWorkflowSelected &&",
    );

    expect(appSource).toContain(
      'body.set("prompt", exactEditPrompt);',
    );

    expect(appSource).toContain(
      'body.set("positivePrompt", exactEditPrompt);',
    );

    expect(appSource).toContain(
      'body.set("requestKind", "generate-qwen21-image-edit");',
    );
  });

  it("prevents the generic text encoder from overwriting Qwen 2.1 node 474", () => {
    const guardedGenericWrite = routeSource.indexOf(
      "if ((positive || negative) && !generateQwen21Edit)",
    );

    const finalExactBind = routeSource.indexOf(
      "bindGenerateQwen21EditExactPrompt(graph, body);",
      guardedGenericWrite,
    );

    const comfySubmission = routeSource.indexOf(
      "body: JSON.stringify({ prompt: graph, client_id: comfyClientId })",
      finalExactBind,
    );

    expect(guardedGenericWrite).toBeGreaterThan(-1);
    expect(finalExactBind).toBeGreaterThan(
      guardedGenericWrite,
    );
    expect(comfySubmission).toBeGreaterThan(
      finalExactBind,
    );
  });
});
