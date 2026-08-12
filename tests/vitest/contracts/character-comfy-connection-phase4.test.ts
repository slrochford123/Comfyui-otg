// @vitest-environment node

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const hub = fs.readFileSync(path.join(root, "app/app/components/CharacterHubPanel.tsx"), "utf8");
const route = fs.readFileSync(path.join(root, "app/api/characters/create-image/route.ts"), "utf8");
const workflowFiles = [
  "image_ernie_image_turbo.json",
  "image_z_image_turbo.json",
  "image_krea2_turbo_t2i.json",
  "image_boogu_image_0_1_turbo_t2i.json",
  "image_mage_flow_turbo_t2i_int8.json",
];

describe("Character ComfyUI connection Phase 4", () => {
  it("installs all five supplied Character workflows", () => {
    for (const file of workflowFiles) {
      const absolute = path.join(root, "workflows/characters/create", file);
      expect(fs.existsSync(absolute)).toBe(true);
      expect(() => JSON.parse(fs.readFileSync(absolute, "utf8"))).not.toThrow();
    }
  });

  it("maps all five UI models to supplied workflows", () => {
    for (const file of workflowFiles) expect(route).toContain(file);
  });

  it("enforces exact portrait 1080x1920 final output", () => {
    expect(route).toContain("const OUTPUT_WIDTH = 1080");
    expect(route).toContain("const OUTPUT_HEIGHT = 1920");
    expect(route).toContain("const MAGE_INTERNAL_WIDTH = 1088");
    expect(route).toContain('class_type: "ImageScale"');
    expect(route).toContain('title: "OTG Exact 1080x1920 Output"');
  });

  it("uses temporary previews instead of normal SaveImage output", () => {
    expect(route).toContain('class_type: "PreviewImage"');
    expect(route).toContain("temporaryCandidate: true");
    expect(route).not.toContain('class_type: "SaveImage"');
  });

  it("routes Mage Flow through image-primary first with 3090 preflight fallback", () => {
    const mageStart = route.indexOf('"mage-flow": {');
    const mageEnd = route.indexOf("\n  },", mageStart);
    const mageBlock = route.slice(mageStart, mageEnd);

    expect(mageBlock).toContain(
      'preferredBackend: "image-primary"',
    );
    expect(mageBlock).not.toContain(
      'preferredBackend: "local-3090"',
    );
    expect(route).toContain(
      "validateBackend(imagePrimary, config)",
    );
    expect(route).toContain(
      "validateBackend(local3090, config)",
    );
    expect(route).toContain(
      'label: "local-3090-fallback"',
    );
  });

  it("generates a fresh server-side random seed", () => {
    expect(route).toContain("randomInt(");
    expect(route).toContain("const seed = randomSeed()");
  });

  it("keeps authentication and JSON parsing on independent request streams", () => {
    expect(route).toContain("const bodyRequest = request.clone()");
    expect(route).toContain("await getOwnerContext(request)");
    expect(route).toContain("await bodyRequest.json()");
    expect(route).not.toContain("await request.json()");
  });

  it("wires the Character UI to submit and display ComfyUI history output", () => {
    expect(hub).toContain('fetch("/api/characters/create-image"');
    expect(hub).toContain("/api/comfy/history-image?");
    expect(hub).toContain("Generate Character");
    expect(hub).toContain("Generated Candidates");
  });

  it("injects the focused rule only for Standard while keeping style separate", () => {
    expect(route).toContain(
      'args.mode === "standard" ? STANDARD_CHARACTER_STRUCTURE_RULE : ""',
    );
    expect(route).toContain(
      "args.description.trim()",
    );
    expect(route).toContain(
      "const selectedArtStylePrompt = STYLE_PROMPTS[args.style]",
    );
    expect(route).toContain(
      'return mode === "standard" ? STANDARD_CHARACTER_NEGATIVE_PROMPT : ""',
    );
    expect(route).not.toContain(
      "const modeRules =",
    );
    expect(route).not.toContain(
      "const framing =",
    );
  });
});
