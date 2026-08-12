import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const routeSource = fs.readFileSync(
  path.join(
    process.cwd(),
    "app",
    "api",
    "production",
    "picture",
    "scene-pass",
    "route.ts",
  ),
  "utf8",
);

const leaseSource = fs.readFileSync(
  path.join(
    process.cwd(),
    "lib",
    "workers",
    "comfyPromptLease.ts",
  ),
  "utf8",
);

const productionWorkflow = JSON.parse(
  fs
    .readFileSync(
      path.join(
        process.cwd(),
        "comfy_workflows",
        "internal",
        "production",
        "qwen_image_edit_2511_storyboard.json",
      ),
      "utf8",
    )
    .replace(/^\uFEFF/, ""),
) as Record<
  string,
  {
    class_type?: string;
    inputs?: Record<string, unknown>;
  }
>;

describe(
  "Production Qwen background workflow binding v4",
  () => {
    it("connects staged image 2 to both Qwen conditioning encoders", () => {
      expect(routeSource).toContain(
        'getScenePassNodeInputsV36BPF1(workflow, "167").image = imageNames[1];',
      );
      expect(routeSource).toContain(
        'positiveInputs.image2 = ["167", 0];',
      );
      expect(routeSource).toContain(
        'negativeInputs.image2 = ["167", 0];',
      );
    });

    it("connects staged image 3 to both Qwen conditioning encoders", () => {
      expect(routeSource).toContain(
        'getScenePassNodeInputsV36BPF1(workflow, "168").image = imageNames[2];',
      );
      expect(routeSource).toContain(
        'positiveInputs.image3 = ["168", 0];',
      );
      expect(routeSource).toContain(
        'negativeInputs.image3 = ["168", 0];',
      );
    });

    it("verifies every staged LoadImage filename and both encoder links before leased Comfy submission", () => {
      const assertionMarker =
        "OTG_SCENE_PASS_QWEN_IMAGE_BINDING_V36BPJ1_START";

      const buildCall =
        "assertScenePassQwenImageBindingsV36BPJ1(workflow, references);";

      const submitValidationCall =
        "const workflowImageBindings = assertScenePassQwenImageBindingsV36BPJ1(workflow, comfyReferences);";

      const leasedSubmitCall =
        "const response = await submitComfyPromptWith5060Lease({";

      const markerIndex =
        routeSource.indexOf(assertionMarker);

      const buildCallIndex =
        routeSource.indexOf(
          buildCall,
          markerIndex,
        );

      const submitValidationIndex =
        routeSource.indexOf(
          submitValidationCall,
          buildCallIndex,
        );

      const leasedSubmitIndex =
        routeSource.indexOf(
          leasedSubmitCall,
          submitValidationIndex,
        );

      expect(markerIndex).toBeGreaterThanOrEqual(0);

      expect(routeSource).toContain(
        "SCENE_PASS_QWEN_LOAD_IMAGE_BINDING_FAILED",
      );
      expect(routeSource).toContain(
        "SCENE_PASS_QWEN_ENCODER_IMAGE_BINDING_FAILED",
      );
      expect(routeSource).toContain(
        "SCENE_PASS_QWEN_UNUSED_IMAGE_BINDING_FAILED",
      );

      expect(buildCallIndex).toBeGreaterThan(
        markerIndex,
      );

      expect(submitValidationIndex).toBeGreaterThan(
        buildCallIndex,
      );

      expect(leasedSubmitIndex).toBeGreaterThan(
        submitValidationIndex,
      );

      expect(routeSource).toContain(
        'import { submitComfyPromptWith5060Lease } from "@/lib/workers/comfyPromptLease";',
      );

      expect(routeSource).toContain(
        "baseUrl: comfyUrl,",
      );

      expect(leaseSource).toContain(
        "`${baseUrl}/prompt`",
      );
    });

    it("returns and logs auditable workflow binding metadata", () => {
      expect(routeSource).toContain(
        'console.info("[scene-pass-qwen-image-bindings]"',
      );

      expect(routeSource).toContain(
        "workflowImageBindings,",
      );

      expect(routeSource).toContain(
        'positiveEncoderNodeId: "1"',
      );

      expect(routeSource).toContain(
        'negativeEncoderNodeId: "39"',
      );
    });

    it("matches the supplied production Qwen workflow's symmetric image contract", () => {
      const encoders = Object.values(
        productionWorkflow,
      ).filter((node) =>
        String(node.class_type || "").startsWith(
          "TextEncodeQwenImageEditPlus",
        ),
      );

      expect(encoders).toHaveLength(2);

      const [positive, negative] = encoders;

      for (const inputName of [
        "image1",
        "image2",
        "image3",
        "image4",
        "image5",
      ]) {
        expect(
          positive.inputs?.[inputName],
        ).toEqual(
          negative.inputs?.[inputName],
        );
      }
    });
  },
);
