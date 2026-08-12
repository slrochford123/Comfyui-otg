// @vitest-environment node

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

const hub = fs.readFileSync(
  path.join(
    root,
    "app/app/components/CharacterHubPanel.tsx",
  ),
  "utf8",
);

const threeDStyles = fs.readFileSync(
  path.join(
    root,
    "lib/characters/threeDAnimationStyles.ts",
  ),
  "utf8",
);

const televisionAnimeStyles = fs.readFileSync(
  path.join(
    root,
    "lib/characters/televisionAnimeStyles.ts",
  ),
  "utf8",
);

describe("Character style presets Phase 3", () => {
  it("uses the approved shared top-level art style catalog", () => {
    expect(hub).toContain('label: "Cartoon"');
    expect(hub).toContain('label: "Anime"');
    expect(hub).toContain('label: "3D Animation"');
    expect(hub).toContain('label: "Unreal Engine"');
    expect(hub).toContain('label: "Photorealistic"');
    expect(hub).toContain('label: "Cinematic"');
  });

  it("delegates detailed 3D and anime substyles to their dedicated catalogs", () => {
    expect(hub).toContain(
      "THREE_D_ANIMATION_STYLE_PRESETS",
    );
    expect(hub).toContain(
      "TELEVISION_ANIME_STYLE_PRESETS",
    );

    expect(threeDStyles).toContain(
      'label: "Pixar - Classic Toy Feature"',
    );

    expect(televisionAnimeStyles).toContain(
      'label: "Retro Anime (90s Cel)"',
    );
  });

  it("uses the same style selector for standard and freeform creation", () => {
    expect(hub).toContain(
      "CHARACTER_STYLE_PRESETS.map",
    );
    expect(hub).toContain(
      'data-otg="character-style-preset-select"',
    );
    expect(hub).toContain('mode="standard"');
    expect(hub).toContain('mode="freeform"');
  });

  it("shows fixed portrait 1080 x 1920 output", () => {
    expect(hub).toContain("width: 1080");
    expect(hub).toContain("height: 1920");
    expect(hub).toContain(
      'orientation: "Portrait"',
    );
    expect(hub).toContain(
      'aspectRatio: "9:16"',
    );
    expect(hub).toContain(
      'data-otg="character-output-settings"',
    );
    expect(hub).toContain("1080 x");
  });

  it("documents random seed behavior", () => {
    expect(hub).toContain(
      'seedBehavior: "Random every generation"',
    );
    expect(hub).toContain(
      "fresh random seed",
    );
  });

  it("connects the fixed-output UI to the dedicated Character generation route", () => {
    expect(hub).toContain(
      "Generate Character",
    );
    expect(hub).toContain(
      'fetch("/api/characters/create-image"',
    );
    expect(hub).toContain(
      "/api/comfy/history-image?",
    );
  });
});
