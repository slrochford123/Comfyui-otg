import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

function source(file: string) {
  return fs.readFileSync(path.join(process.cwd(), file), "utf8");
}

describe("H3 Realism Standard / Singularity model selector", () => {
  it("exposes the model selector only through the Realism capability", () => {
    const capabilities = source("lib/h3ModeCapabilities.ts");
    const realism = capabilities.slice(
      capabilities.indexOf('"h3-realism": {'),
      capabilities.indexOf('"h3-body-swap": {'),
    );

    expect(realism).toContain("supportsStandardSingularity: true");
  });

  it("uses the qualified Standard R2V and Singularity checkpoints", () => {
    const workflow = source("lib/h3SpecialModes/realismWorkflow.ts");

    expect(workflow).toContain(
      "minimax_h3_ref2va_pruned_int8_convrot.safetensors",
    );
    expect(workflow).toContain("H3_SINGULARITY_CHECKPOINT");
    expect(workflow).toContain(
      'checkpointMode === "singularity"',
    );
  });

  it("forces Realism on for Singularity and keeps Combat independent", () => {
    const workflow = source("lib/h3SpecialModes/realismWorkflow.ts");

    expect(workflow).toContain("peopleRealismEnabled: true");
    expect(workflow).toContain("H3_COMBAT_V2_LORA");
    expect(workflow).toContain("combatLoraEnabled === true");
  });

  it("sends the selected model and Combat state through the Realism API", () => {
    const panel = source("app/app/components/H3Panel.tsx");
    const route = source(
      "app/api/h3/special/realism/generation/route.ts",
    );

    expect(panel).toContain(
      "checkpointMode: h3Settings.checkpointMode",
    );
    expect(panel).toContain("Combat V2 LoRA");
    expect(panel).toContain("MiniMax H3 Singularity");
    expect(route).toContain("checkpointMode:");
    expect(route).toContain("combatLoraEnabled:");
  });
});
