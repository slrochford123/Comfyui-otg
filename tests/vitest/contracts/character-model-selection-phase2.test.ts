// @vitest-environment node

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const hub = fs.readFileSync(
  path.join(root, "app/app/components/CharacterHubPanel.tsx"),
  "utf8"
);

describe("Character model-selection Phase 2", () => {
  it("provides the approved five image models", () => {
    expect(hub).toContain('label: "Ernie Image"');
    expect(hub).toContain('label: "Z Image"');
    expect(hub).toContain('label: "Krea 2"');
    expect(hub).toContain('label: "Boogu"');
    expect(hub).toContain('label: "Mage Flow"');
  });

  it("maps each model to the supplied workflow filename", () => {
    expect(hub).toContain(
      'workflowFile: "image_ernie_image_turbo.json"'
    );
    expect(hub).toContain(
      'workflowFile: "image_z_image_turbo.json"'
    );
    expect(hub).toContain(
      'workflowFile: "image_krea2_turbo_t2i.json"'
    );
    expect(hub).toContain(
      'workflowFile: "image_boogu_image_0_1_turbo_t2i.json"'
    );
    expect(hub).toContain(
      'workflowFile: "image_mage_flow_turbo_t2i_int8.json"'
    );
  });

  it("uses the same model catalog for standard and freeform creation", () => {
    expect(hub).toContain('<CharacterCreateSetup');
    expect(hub).toContain('mode="standard"');
    expect(hub).toContain('mode="freeform"');
    expect(hub).toContain("CHARACTER_IMAGE_MODELS.map");
  });

  it("keeps standard and freeform anatomy contracts distinct", () => {
    expect(hub).toContain(
      "full body visible head-to-toe"
    );
    expect(hub).toContain(
      "neutral standing"
    );
    expect(hub).toContain(
      "no-crop generation guidance"
    );
    expect(hub).toContain(
      "Freeform stays unrestricted by Standard anatomy and framing rules"
    );
  });

  it("connects generation through the dedicated Character create route", () => {
    expect(hub).toContain('fetch("/api/characters/create-image"');
    expect(hub).toContain('data-otg="character-create-generate"');
    expect(hub).toContain("Generate Character");
  });
});
