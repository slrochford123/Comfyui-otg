// @vitest-environment node

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const route = fs.readFileSync(
  path.join(
    process.cwd(),
    "app/api/characters/create-image/route.ts",
  ),
  "utf8",
);

const mageStart = route.indexOf('"mage-flow": {');
const mageEnd = route.indexOf("\n  },", mageStart);
const mageBlock = route.slice(mageStart, mageEnd);

describe("Character Mage Flow 5060 Ti primary Phase 7", () => {
  it("prefers image-primary for Mage Flow", () => {
    expect(mageStart).toBeGreaterThanOrEqual(0);
    expect(mageBlock).toContain(
      'preferredBackend: "image-primary"',
    );
    expect(mageBlock).not.toContain(
      'preferredBackend: "local-3090"',
    );
  });

  it("keeps strict Mage Flow model requirements", () => {
    expect(mageBlock).toContain(
      'unet: "mage_flow_turbo_int8_convrot.safetensors"',
    );
    expect(mageBlock).toContain(
      'clip: "qwen3vl_4b_bf16.safetensors"',
    );
    expect(mageBlock).toContain(
      'vae: "mage_flow_vae_bf16.safetensors"',
    );
  });

  it("keeps image-primary preflight before 3090 fallback", () => {
    const primary = route.indexOf(
      "validateBackend(imagePrimary, config)",
    );
    const fallback = route.indexOf(
      "validateBackend(local3090, config)",
      primary,
    );

    expect(primary).toBeGreaterThanOrEqual(0);
    expect(fallback).toBeGreaterThan(primary);
    expect(route).toContain(
      'label: "local-3090-fallback"',
    );
  });

  it("does not fail over after prompt submission begins", () => {
    const choose = route.indexOf(
      "const backend = await chooseBackend(request, config)",
    );
    const submit = route.indexOf(
      "const promptId = await submitPrompt(backend.baseUrl, graph)",
    );

    expect(choose).toBeGreaterThanOrEqual(0);
    expect(submit).toBeGreaterThan(choose);
    expect(route).toContain(
      "Never fail over after",
    );
  });
});
