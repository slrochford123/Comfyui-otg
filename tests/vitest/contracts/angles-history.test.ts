import { describe, expect, it } from "vitest";

import { selectAnglesGeneratedOutput } from "@/lib/anglesHistory";

describe("Angles ComfyUI history output selection", () => {
  it("returns the generated image from output node 110 instead of the camera preview from node 93", () => {
    const record = {
      outputs: {
        "93": {
          images: [
            {
              filename: "qwen_multiangle_93__00004_.png",
              subfolder: "",
              type: "temp",
            },
          ],
        },
        "110": {
          images: [
            {
              filename: "ComfyUI_temp_abc_00001_.png",
              subfolder: "",
              type: "temp",
            },
          ],
        },
      },
    };

    const result = selectAnglesGeneratedOutput(record, "110", "qwen_multiangle_expected");

    expect(result.imageFile?.filename).toBe("ComfyUI_temp_abc_00001_.png");
    expect(result.outputNodeFiles).toHaveLength(1);
    expect(result.allFiles.map((file) => file.filename)).toEqual([
      "qwen_multiangle_93__00004_.png",
      "ComfyUI_temp_abc_00001_.png",
    ]);
  });

  it("does not return the unchanged camera preview when generated output node 110 is absent", () => {
    const record = {
      outputs: {
        "93": {
          images: [
            {
              filename: "qwen_multiangle_93__00004_.png",
              subfolder: "",
              type: "temp",
            },
          ],
        },
      },
    };

    const result = selectAnglesGeneratedOutput(record, "110", "qwen_multiangle_expected");

    expect(result.imageFile).toBeNull();
    expect(result.outputNodeFiles).toEqual([]);
    expect(result.allFiles).toHaveLength(1);
  });

  it("prefers an expected filename prefix within output node 110", () => {
    const record = {
      outputs: {
        "110": {
          images: [
            { filename: "other.png", type: "temp" },
            { filename: "qwen_multiangle_expected_00001_.png", type: "temp" },
          ],
        },
      },
    };

    const result = selectAnglesGeneratedOutput(record, "110", "qwen_multiangle_expected");

    expect(result.imageFile?.filename).toBe("qwen_multiangle_expected_00001_.png");
  });
});
